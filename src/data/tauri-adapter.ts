import { invoke } from "@tauri-apps/api/core";
import { wrapRaw, type Db, type Row, type SqlValue } from "./db";
import type { BackupFile, BackupHost } from "../services/backup";

export interface AppPaths {
  data_dir: string;
  db_path: string;
  backup_dir: string;
  export_dir: string;
  log_dir: string;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getAppPaths(): Promise<AppPaths> {
  return invoke<AppPaths>("app_paths");
}

/** "locked": the encrypted database cannot be opened by this Windows account until the recovery key is entered. */
export function getDbStatus(): Promise<"ready" | "locked"> {
  return invoke<"ready" | "locked">("db_status");
}

export function unlockDatabase(recoveryKey: string): Promise<void> {
  return invoke<void>("unlock_database", { recoveryKey });
}

/** Production adapter: SQLCipher (encrypted SQLite) in the Rust process, database under %APPDATA%. */
export async function openTauriDb(): Promise<Db> {
  const paths = await getAppPaths();
  return wrapRaw(
    {
      select: <T = Row>(sql: string, params: SqlValue[] = []) => invoke<T[]>("db_select", { sql, params }),
      execute: (sql: string, params: SqlValue[] = []) => invoke<{ changes: number }>("db_execute", { sql, params }),
    },
    {
      kind: "tauri", backupDir: paths.backup_dir, supportsBackup: true,
      // The Rust side writes the backup encrypted and accepts a file name inside the Backups folder only.
      backup: (path) => invoke<void>("backup_database", { name: path.slice(path.lastIndexOf("\\") + 1) }),
    },
  );
}

/** Backup file operations, confined by the Rust side to the Backups folder. */
export const tauriBackupHost: BackupHost = {
  list: () => invoke<BackupFile[]>("list_backups"),
  remove: (name) => invoke<void>("delete_auto_backup", { name }),
  copyTo: (name, folder) => invoke<void>("copy_backup", { name, folder }),
  restore: (name, safetyName, recoveryKey) => invoke<void>("restore_backup", { name, safetyName, recoveryKey: recoveryKey ?? null }),
  recoveryKey: () => invoke<string>("get_recovery_key"),
};

/** Saves an export into the Exports folder and returns its full path. */
export function writeExportFile(name: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>("write_export", { name, bytes: Array.from(bytes) });
}
