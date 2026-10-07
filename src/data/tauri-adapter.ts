import { invoke } from "@tauri-apps/api/core";
import { wrapRaw, type Db, type Row, type SqlValue } from "./db";

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

/** Production adapter: rusqlite in the Rust process, database under %APPDATA%. */
export async function openTauriDb(): Promise<Db> {
  const paths = await getAppPaths();
  return wrapRaw(
    {
      select: <T = Row>(sql: string, params: SqlValue[] = []) => invoke<T[]>("db_select", { sql, params }),
      execute: (sql: string, params: SqlValue[] = []) => invoke<{ changes: number }>("db_execute", { sql, params }),
    },
    { kind: "tauri", backupDir: paths.backup_dir, supportsBackup: true },
  );
}
