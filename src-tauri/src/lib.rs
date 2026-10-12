mod vault;

use rusqlite::{types::ValueRef, Connection};
use serde::Serialize;
use serde_json::{Map, Value};
use std::{fs, path::{Path, PathBuf}, sync::{Mutex, MutexGuard}, time::UNIX_EPOCH};
use tauri::{Manager, State};

/// The open database and its key. `None` while the database is locked: it is encrypted
/// and this Windows account holds no key for it, so a person must enter the recovery key.
struct DbState(Mutex<Option<(Connection, vault::Key)>>);

const LOCKED: &str = "The database is locked. Enter the recovery key to open it.";

impl DbState {
    fn lock(&self) -> Result<MutexGuard<'_, Option<(Connection, vault::Key)>>, String> {
        self.0.lock().map_err(|e| e.to_string())
    }
}

#[derive(Serialize, Clone)]
struct AppPaths {
    data_dir: String,
    db_path: String,
    #[serde(skip)]
    key_path: PathBuf,
    backup_dir: String,
    export_dir: String,
    log_dir: String,
}

struct PathsState(AppPaths);

#[derive(Serialize)]
struct ExecResult {
    changes: usize,
}

/// Map rusqlite errors to messages that do not leak SQL internals as the primary text.
fn friendly(err: rusqlite::Error) -> String {
    let raw = err.to_string();
    if raw.contains("FOREIGN KEY") {
        return format!("This record is linked to other records and cannot be changed this way. Archive it instead. [{raw}]");
    }
    if raw.contains("UNIQUE") {
        return format!("A record with the same identifier already exists. [{raw}]");
    }
    if raw.contains("CHECK") {
        return format!("A value is outside the allowed range or order (for example an end time before a start time). [{raw}]");
    }
    raw
}

fn to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                V::Integer(i)
            } else {
                V::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => V::Text(s.clone()),
        other => V::Text(other.to_string()),
    }
}

#[tauri::command]
fn db_select(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let guard = state.lock()?;
    let (conn, _) = guard.as_ref().ok_or(LOCKED)?;
    let mut stmt = conn.prepare(&sql).map_err(friendly)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bound: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(bound.iter())).map_err(friendly)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(friendly)? {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v = match row.get_ref(i).map_err(friendly)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => Value::from(f),
                ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
                ValueRef::Blob(_) => Value::Null,
            };
            m.insert(name.clone(), v);
        }
        out.push(m);
    }
    Ok(out)
}

#[tauri::command]
fn db_execute(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<ExecResult, String> {
    let guard = state.lock()?;
    let (conn, _) = guard.as_ref().ok_or(LOCKED)?;
    let bound: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    let changes = conn
        .execute(&sql, rusqlite::params_from_iter(bound.iter()))
        .map_err(friendly)?;
    Ok(ExecResult { changes })
}

#[tauri::command]
fn app_paths(paths: State<PathsState>) -> AppPaths {
    paths.0.clone()
}

/// "ready", or "locked" when the recovery key is needed before anything else can run.
#[tauri::command]
fn db_status(state: State<DbState>) -> Result<&'static str, String> {
    Ok(if state.lock()?.is_some() { "ready" } else { "locked" })
}

/// Opens a locked database with the recovery key and remembers the key for this Windows account.
#[tauri::command]
fn unlock_database(state: State<DbState>, paths: State<PathsState>, recovery_key: String) -> Result<(), String> {
    let mut guard = state.lock()?;
    if guard.is_none() {
        *guard = Some(vault::open_with_recovery_key(Path::new(&paths.0.db_path), &paths.0.key_path, &recovery_key)?);
    }
    Ok(())
}

/// The recovery key as text. The caller checks permission and writes the audit entry.
#[tauri::command]
fn get_recovery_key(state: State<DbState>) -> Result<String, String> {
    let guard = state.lock()?;
    let (_, key) = guard.as_ref().ok_or(LOCKED)?;
    Ok(vault::format_recovery_key(key))
}

/// Writes an encrypted copy of the live database into the backups folder.
#[tauri::command]
fn backup_database(state: State<DbState>, paths: State<PathsState>, name: String) -> Result<(), String> {
    let dest = backup_file(&paths.0, &name)?;
    let guard = state.lock()?;
    let (conn, key) = guard.as_ref().ok_or(LOCKED)?;
    vault::export_encrypted(conn, &dest, key)
}

#[derive(Serialize)]
struct BackupFile {
    name: String,
    size: u64,
    /// Milliseconds since the Unix epoch.
    modified: u64,
}

/// Accepts a bare `*.db` file name only, so a caller can never reach outside the backups folder.
fn backup_file(paths: &AppPaths, name: &str) -> Result<PathBuf, String> {
    let plain = !name.is_empty()
        && name.ends_with(".db")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.contains("..");
    if !plain {
        return Err("Invalid backup file name.".into());
    }
    Ok(Path::new(&paths.backup_dir).join(name))
}

#[tauri::command]
fn list_backups(paths: State<PathsState>) -> Result<Vec<BackupFile>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&paths.0.backup_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() || !name.ends_with(".db") {
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(BackupFile { name, size: meta.len(), modified });
    }
    Ok(out)
}

/// Retention only ever removes automatic backups; manual and pre-restore copies stay until a person deletes them.
#[tauri::command]
fn delete_auto_backup(paths: State<PathsState>, name: String) -> Result<(), String> {
    if !name.starts_with("OR-AutoBackup-") {
        return Err("Only automatic backups can be removed by retention.".into());
    }
    let path = backup_file(&paths.0, &name)?;
    fs::remove_file(&path).map_err(|e| format!("Cannot remove {}: {e}", path.display()))
}

#[tauri::command]
fn copy_backup(paths: State<PathsState>, name: String, folder: String) -> Result<(), String> {
    let source = backup_file(&paths.0, &name)?;
    let folder = PathBuf::from(folder.trim());
    if !folder.is_absolute() {
        return Err(r"The second backup folder must be a full path, for example E:\OR-Backups.".into());
    }
    ensure(&folder)?;
    fs::copy(&source, folder.join(&name)).map_err(|e| format!("Cannot copy to {}: {e}", folder.display()))?;
    Ok(())
}

/// Replaces the live database with a backup file. The live database is saved first under `safety_name`.
/// `recovery_key` is only needed for a backup that was made on another PC.
#[tauri::command]
fn restore_backup(
    state: State<DbState>,
    paths: State<PathsState>,
    name: String,
    safety_name: String,
    recovery_key: Option<String>,
) -> Result<(), String> {
    let source_path = backup_file(&paths.0, &name)?;
    let safety_path = backup_file(&paths.0, &safety_name)?;
    if !source_path.is_file() {
        return Err("Backup file not found.".into());
    }
    if safety_path.exists() {
        return Err("A pre-restore backup with this name already exists.".into());
    }
    let recovery = match recovery_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(text) => Some(vault::parse_recovery_key(text)?),
        None => None,
    };

    let mut guard = state.lock()?;
    let (conn, key) = guard.as_ref().ok_or(LOCKED)?;
    let key = *key;

    let source = vault::open_backup(&source_path, &key, recovery.as_ref())?;
    let check: String = source
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "This file is not a readable database.".to_string())?;
    if check != "ok" {
        return Err(format!("This backup is damaged and was not restored. [{check}]"));
    }
    let tables: i64 = source
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations','patients','users')",
            [],
            |r| r.get(0),
        )
        .map_err(friendly)?;
    if tables != 3 {
        return Err("This file is not an OR Patient Management backup.".into());
    }

    vault::export_encrypted(conn, &safety_path, &key)?;
    // The backup is re-encrypted with this PC's key into a new file first, so the live
    // database is only touched once a complete, verified replacement exists.
    let db_path = Path::new(&paths.0.db_path);
    let prepared = PathBuf::from(format!("{}.restoring", paths.0.db_path));
    let _ = fs::remove_file(&prepared);
    vault::export_encrypted(&source, &prepared, &key)?;
    drop(source);

    *guard = None; // closes the live database
    let swapped = vault::replace_database(&prepared, db_path);
    if swapped.is_err() {
        let _ = fs::remove_file(&prepared);
    }
    // Reopens the restored database, or the untouched old one when the swap failed.
    *guard = Some((vault::open_live(db_path, &key)?, key));
    swapped
}

/// Writes an export into the Exports folder and returns its full path.
#[tauri::command]
fn write_export(paths: State<PathsState>, name: String, bytes: Vec<u8>) -> Result<String, String> {
    let plain = name.ends_with(".xlsx")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.contains("..");
    if !plain {
        return Err("Invalid export file name.".into());
    }
    let path = Path::new(&paths.0.export_dir).join(&name);
    fs::write(&path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

fn ensure(dir: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // %APPDATA%\<identifier> - never beside the executable.
            let data_dir = app.path().app_data_dir()?;
            let db_dir = data_dir.join("Database");
            let backup_dir = data_dir.join("Backups");
            let export_dir = data_dir.join("Exports");
            let log_dir = data_dir.join("Logs");
            for d in [&db_dir, &backup_dir, &export_dir, &log_dir] {
                ensure(d)?;
            }
            let db_path = db_dir.join("or-patient-management.db");
            let key_path = db_dir.join("or-patient-management.key");
            let opened = match vault::open_or_create(&db_path, &key_path, &backup_dir)? {
                vault::Opened::Ready(conn, key) => Some((conn, key)),
                vault::Opened::NeedsRecoveryKey => None,
            };
            app.manage(DbState(Mutex::new(opened)));
            app.manage(PathsState(AppPaths {
                data_dir: data_dir.display().to_string(),
                db_path: db_path.display().to_string(),
                key_path,
                backup_dir: backup_dir.display().to_string(),
                export_dir: export_dir.display().to_string(),
                log_dir: log_dir.display().to_string(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            app_paths,
            db_status,
            unlock_database,
            get_recovery_key,
            backup_database,
            list_backups,
            delete_auto_backup,
            copy_backup,
            restore_backup,
            write_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running OR Patient Management");
}
