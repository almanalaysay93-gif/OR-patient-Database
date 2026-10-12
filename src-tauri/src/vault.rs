//! Encryption at rest for the database and its backups (SQLCipher, AES-256).
//!
//! The 256-bit database key is random. It is stored beside the database, sealed with
//! Windows DPAPI for the signed-in Windows account, so the app opens without a prompt
//! on this PC only. The same key, written out as text, is the recovery key: it opens
//! the database or a backup on another PC or under another Windows account.

use rusqlite::Connection;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub type Key = [u8; 32];

const PLAIN_HEADER: &[u8; 16] = b"SQLite format 3\0";
const OPEN_PRAGMAS: &str =
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;";

pub fn new_key() -> Result<Key, String> {
    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key).map_err(|e| format!("Cannot generate a database key: {e}"))?;
    Ok(key)
}

fn hex(key: &Key) -> String {
    key.iter().map(|b| format!("{b:02X}")).collect()
}

/// The key as eight groups of eight characters, for printing.
pub fn format_recovery_key(key: &Key) -> String {
    let text = hex(key);
    (0..8).map(|i| &text[i * 8..i * 8 + 8]).collect::<Vec<_>>().join("-")
}

/// Accepts the printed form with any spacing, dashes or letter case.
pub fn parse_recovery_key(text: &str) -> Result<Key, String> {
    let digits: Vec<u8> = text
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_digit(16).map(|d| d as u8))
        .collect::<Option<_>>()
        .ok_or("The recovery key contains characters that are not 0-9 or A-F.")?;
    if digits.len() != 64 {
        return Err(format!("The recovery key has 64 characters; {} were entered.", digits.len()));
    }
    let mut key = [0u8; 32];
    for (i, pair) in digits.chunks(2).enumerate() {
        key[i] = pair[0] << 4 | pair[1];
    }
    Ok(key)
}

/// True for a database file that anyone can read without a key.
pub fn is_plaintext(path: &Path) -> bool {
    let mut header = [0u8; 16];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut header)).is_ok() && &header == PLAIN_HEADER
}

fn apply_key(conn: &Connection, key: &Key) -> Result<(), String> {
    conn.pragma_update(None, "key", format!("x'{}'", hex(key))).map_err(|e| e.to_string())
}

/// Opens a database with `key` (or without one) and proves it is readable.
fn open_checked(path: &Path, key: Option<&Key>) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    if let Some(key) = key {
        apply_key(&conn, key)?;
    }
    conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| "The database cannot be read with this key.".to_string())?;
    Ok(conn)
}

/// Opens the live database, ready for use.
pub fn open_live(path: &Path, key: &Key) -> Result<Connection, String> {
    let conn = open_checked(path, Some(key))?;
    conn.execute_batch(OPEN_PRAGMAS).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Writes a complete copy of `conn`'s database to a new file encrypted with `key`.
pub fn export_encrypted(conn: &Connection, dest: &Path, key: &Key) -> Result<(), String> {
    if dest.exists() {
        return Err(format!("{} already exists.", dest.display()));
    }
    conn.execute(
        "ATTACH DATABASE ?1 AS vault_out KEY ?2",
        [dest.display().to_string(), format!("x'{}'", hex(key))],
    )
    .map_err(|e| e.to_string())?;
    let exported = conn
        .query_row("SELECT sqlcipher_export('vault_out')", [], |_| Ok(()))
        .map_err(|e| e.to_string());
    let detached = conn.execute_batch("DETACH DATABASE vault_out").map_err(|e| e.to_string());
    if let Err(err) = exported.and(detached) {
        let _ = fs::remove_file(dest);
        return Err(err);
    }
    // Never report success for a copy that cannot be opened again.
    open_checked(dest, Some(key)).map(|_| ()).map_err(|e| {
        let _ = fs::remove_file(dest);
        e
    })
}

/// Opens a backup file whatever it was written with: no key (made before encryption),
/// this PC's key, or the key of another PC given as a recovery key.
pub fn open_backup(path: &Path, own: &Key, recovery: Option<&Key>) -> Result<Connection, String> {
    if is_plaintext(path) {
        return open_checked(path, None);
    }
    if let Ok(conn) = open_checked(path, Some(own)) {
        return Ok(conn);
    }
    match recovery {
        Some(key) => open_checked(path, Some(key))
            .map_err(|_| "The recovery key does not open this backup.".to_string()),
        None => Err("This backup was made on another PC. Enter the recovery key of that PC to restore it.".into()),
    }
}

fn sidecars(db_path: &Path) -> [PathBuf; 2] {
    let name = db_path.display().to_string();
    [PathBuf::from(format!("{name}-wal")), PathBuf::from(format!("{name}-shm"))]
}

/// Replaces an unencrypted database file with an encrypted one holding the same data.
pub fn encrypt_in_place(path: &Path, key: &Key) -> Result<(), String> {
    let temp = PathBuf::from(format!("{}.encrypting", path.display()));
    let _ = fs::remove_file(&temp);
    {
        let plain = open_checked(path, None)?;
        // Folds a leftover write-ahead log into the main file so no plaintext stays in a side file.
        let _ = plain.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
        export_encrypted(&plain, &temp, key)?;
    }
    for side in sidecars(path) {
        let _ = fs::remove_file(side);
    }
    fs::rename(&temp, path).map_err(|e| format!("Cannot replace {}: {e}", path.display()))
}

/// Swaps a prepared database file into the place of the live one. The live connection must be closed.
pub fn replace_database(prepared: &Path, db_path: &Path) -> Result<(), String> {
    for side in sidecars(db_path) {
        let _ = fs::remove_file(side);
    }
    fs::rename(prepared, db_path).map_err(|e| format!("Cannot replace {}: {e}", db_path.display()))
}

pub enum Opened {
    Ready(Connection, Key),
    /// The database is encrypted and this Windows account holds no key that opens it.
    NeedsRecoveryKey,
}

/// Start-up: opens the database, creating the key on first run and encrypting data left from older versions.
pub fn open_or_create(db_path: &Path, key_path: &Path, backup_dir: &Path) -> Result<Opened, String> {
    let stored = fs::read(key_path).ok().and_then(|sealed| unseal(&sealed).ok());
    // A zero-length file is a database that was created and never written to.
    let has_data = fs::metadata(db_path).is_ok_and(|m| m.len() > 0);
    let encrypted_db = has_data && !is_plaintext(db_path);

    let key = match stored {
        Some(key) => key,
        None if encrypted_db => return Ok(Opened::NeedsRecoveryKey),
        None => {
            let key = new_key()?;
            store_key(key_path, &key)?;
            key
        }
    };

    if has_data && !encrypted_db {
        encrypt_in_place(db_path, &key)?;
    }
    encrypt_old_backups(backup_dir, &key);
    match open_live(db_path, &key) {
        Ok(conn) => Ok(Opened::Ready(conn, key)),
        Err(_) if encrypted_db => Ok(Opened::NeedsRecoveryKey),
        Err(err) => Err(err),
    }
}

/// Opens the database with a recovery key typed by a person and remembers the key for this Windows account.
pub fn open_with_recovery_key(db_path: &Path, key_path: &Path, text: &str) -> Result<(Connection, Key), String> {
    let key = parse_recovery_key(text)?;
    let conn = open_live(db_path, &key).map_err(|_| "This recovery key does not open the database.".to_string())?;
    store_key(key_path, &key)?;
    Ok((conn, key))
}

pub fn store_key(key_path: &Path, key: &Key) -> Result<(), String> {
    fs::write(key_path, seal(key)?).map_err(|e| format!("Cannot save the database key: {e}"))
}

/// Backups written before encryption existed are readable by anyone; encrypt them where they lie.
/// A file that cannot be converted is left untouched.
fn encrypt_old_backups(backup_dir: &Path, key: &Key) {
    let Ok(entries) = fs::read_dir(backup_dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "db") && is_plaintext(&path) {
            let _ = encrypt_in_place(&path, key);
        }
    }
}

#[cfg(windows)]
mod dpapi {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(data: &[u8], what: &str, transform: impl FnOnce(&CRYPT_INTEGER_BLOB, &mut CRYPT_INTEGER_BLOB) -> i32) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
        if transform(&input, &mut output) == 0 || output.pbData.is_null() {
            return Err(format!("Windows could not {what} the database key."));
        }
        // SAFETY: on success Windows returns a buffer of cbData bytes that the caller frees with LocalFree.
        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { LocalFree(output.pbData as _) };
        Ok(bytes)
    }

    pub fn seal(data: &[u8]) -> Result<Vec<u8>, String> {
        // SAFETY: both blobs are valid for the call; no prompt is ever shown.
        run(data, "protect", |i, o| unsafe { CryptProtectData(i, null(), null(), null(), null(), CRYPTPROTECT_UI_FORBIDDEN, o) })
    }

    pub fn unseal(data: &[u8]) -> Result<Vec<u8>, String> {
        // SAFETY: as above.
        run(data, "unlock", |i, o| unsafe { CryptUnprotectData(i, null_mut(), null(), null(), null(), CRYPTPROTECT_UI_FORBIDDEN, o) })
    }
}

#[cfg(windows)]
fn seal(key: &Key) -> Result<Vec<u8>, String> {
    dpapi::seal(key)
}

#[cfg(windows)]
fn unseal(sealed: &[u8]) -> Result<Key, String> {
    dpapi::unseal(sealed)?.try_into().map_err(|_| "The stored database key is damaged.".to_string())
}

// This app ships for Windows only. Other systems are development machines: the key file is not sealed there.
#[cfg(not(windows))]
fn seal(key: &Key) -> Result<Vec<u8>, String> {
    Ok(key.to_vec())
}

#[cfg(not(windows))]
fn unseal(sealed: &[u8]) -> Result<Key, String> {
    sealed.try_into().map_err(|_| "The stored database key is damaged.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder per test, removed when the test ends.
    struct Folder(PathBuf);

    impl Folder {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("or-vault-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(dir.join("Backups")).unwrap();
            Folder(dir)
        }
        fn db(&self) -> PathBuf { self.0.join("app.db") }
        fn key(&self) -> PathBuf { self.0.join("app.key") }
        fn backups(&self) -> PathBuf { self.0.join("Backups") }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn plain_db(path: &Path, name: &str) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(&format!(
            "PRAGMA journal_mode = WAL; CREATE TABLE patients (name TEXT); INSERT INTO patients VALUES ('{name}');"
        ))
        .unwrap();
    }

    fn names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT name FROM patients ORDER BY rowid").unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    fn ready(opened: Result<Opened, String>) -> (Connection, Key) {
        match opened.unwrap() {
            Opened::Ready(conn, key) => (conn, key),
            Opened::NeedsRecoveryKey => panic!("expected the database to open"),
        }
    }

    fn contains(path: &Path, needle: &[u8]) -> bool {
        fs::read(path).unwrap().windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn recovery_key_round_trips_in_any_spacing() {
        let key = new_key().unwrap();
        let text = format_recovery_key(&key);
        assert_eq!(text.len(), 71);
        assert_eq!(parse_recovery_key(&text).unwrap(), key);
        assert_eq!(parse_recovery_key(&text.replace('-', " ").to_lowercase()).unwrap(), key);
        assert!(parse_recovery_key("ABCD").unwrap_err().contains("64 characters"));
        assert!(parse_recovery_key(&text.replace(&text[0..1], "Z")).is_err());
    }

    #[test]
    fn sealed_key_round_trips() {
        let key = new_key().unwrap();
        let sealed = seal(&key).unwrap();
        #[cfg(windows)]
        assert_ne!(sealed, key.to_vec());
        assert_eq!(unseal(&sealed).unwrap(), key);
    }

    #[test]
    fn first_run_creates_an_encrypted_database() {
        let dir = Folder::new("first-run");
        let (conn, key) = ready(open_or_create(&dir.db(), &dir.key(), &dir.backups()));
        conn.execute_batch("CREATE TABLE patients (name TEXT); INSERT INTO patients VALUES ('Maria Santos');").unwrap();
        drop(conn);
        assert!(!is_plaintext(&dir.db()));
        assert!(!contains(&dir.db(), b"Maria Santos"));

        let (again, same) = ready(open_or_create(&dir.db(), &dir.key(), &dir.backups()));
        assert_eq!(same, key);
        assert_eq!(names(&again), ["Maria Santos"]);
    }

    #[test]
    fn existing_plaintext_data_and_backups_are_encrypted_without_loss() {
        let dir = Folder::new("upgrade");
        plain_db(&dir.db(), "Maria Santos");
        let old_backup = dir.backups().join("OR-ManualBackup-old.db");
        plain_db(&old_backup, "Jose Cruz");
        assert!(contains(&dir.db(), b"Maria Santos"));

        let (conn, key) = ready(open_or_create(&dir.db(), &dir.key(), &dir.backups()));
        assert_eq!(names(&conn), ["Maria Santos"]);
        drop(conn);
        for file in [dir.db(), old_backup.clone()] {
            assert!(!is_plaintext(&file));
            assert!(!contains(&file, b"Maria Santos") && !contains(&file, b"Jose Cruz"));
        }
        assert!(sidecars(&dir.db()).iter().all(|p| !p.exists()));
        assert_eq!(names(&open_backup(&old_backup, &key, None).unwrap()), ["Jose Cruz"]);
    }

    #[test]
    fn a_lost_key_file_needs_the_recovery_key() {
        let dir = Folder::new("lost-key");
        plain_db(&dir.db(), "Maria Santos");
        let (conn, key) = ready(open_or_create(&dir.db(), &dir.key(), &dir.backups()));
        drop(conn);
        fs::remove_file(dir.key()).unwrap();

        assert!(matches!(open_or_create(&dir.db(), &dir.key(), &dir.backups()).unwrap(), Opened::NeedsRecoveryKey));
        assert!(!dir.key().exists(), "a new key must not replace the lost one");
        let wrong = format_recovery_key(&new_key().unwrap());
        assert!(open_with_recovery_key(&dir.db(), &dir.key(), &wrong).unwrap_err().contains("does not open"));

        let (conn, _) = open_with_recovery_key(&dir.db(), &dir.key(), &format_recovery_key(&key)).unwrap();
        assert_eq!(names(&conn), ["Maria Santos"]);
        drop(conn);
        ready(open_or_create(&dir.db(), &dir.key(), &dir.backups()));
    }

    #[test]
    fn backups_are_encrypted_and_restore_across_pcs_with_the_recovery_key() {
        let old_pc = Folder::new("old-pc");
        plain_db(&old_pc.db(), "Maria Santos");
        let (conn, old_key) = ready(open_or_create(&old_pc.db(), &old_pc.key(), &old_pc.backups()));
        let backup = old_pc.backups().join("OR-ManualBackup-1.db");
        export_encrypted(&conn, &backup, &old_key).unwrap();
        assert!(!contains(&backup, b"Maria Santos"));
        assert!(export_encrypted(&conn, &backup, &old_key).unwrap_err().contains("already exists"));

        let new_pc = Folder::new("new-pc");
        let (live, new_key) = ready(open_or_create(&new_pc.db(), &new_pc.key(), &new_pc.backups()));
        live.execute_batch("CREATE TABLE patients (name TEXT); INSERT INTO patients VALUES ('Newer Entry');").unwrap();
        assert!(open_backup(&backup, &new_key, None).unwrap_err().contains("another PC"));
        assert!(open_backup(&backup, &new_key, Some(&new_key)).unwrap_err().contains("does not open"));

        let source = open_backup(&backup, &new_key, Some(&old_key)).unwrap();
        let prepared = new_pc.0.join("prepared.db");
        export_encrypted(&source, &prepared, &new_key).unwrap();
        drop(source);
        drop(live);
        replace_database(&prepared, &new_pc.db()).unwrap();
        assert_eq!(names(&open_live(&new_pc.db(), &new_key).unwrap()), ["Maria Santos"]);
    }
}
