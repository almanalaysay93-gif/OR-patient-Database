import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { wrapRaw, type Db, type RawDb, type Row, type SqlValue } from "./db";

let SQL: SqlJsStatic | null = null;

async function loadSqlJs(wasmUrl?: string): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  SQL = await initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  return SQL;
}

function rawFromDatabase(database: Database): RawDb {
  return {
    async select<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(params);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async execute(sql: string, params: SqlValue[] = []) {
      database.run(sql, params);
      return { changes: database.getRowsModified() };
    },
  };
}

/** In-memory database for tests. */
export async function openMemoryDb(): Promise<Db> {
  const S = await loadSqlJs();
  const database = new S.Database();
  database.run("PRAGMA foreign_keys = ON");
  return wrapRaw(rawFromDatabase(database), { kind: "sqljs", backupDir: null, supportsBackup: false });
}

const IDB_NAME = "or-patient-management";
const IDB_STORE = "db";
const IDB_KEY = "main";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | null> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(bytes: Uint8Array): Promise<void> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Browser preview database (development and demo only, never production).
 * Persists the whole SQLite image to IndexedDB after writes.
 */
export async function openBrowserDb(wasmUrl: string): Promise<Db> {
  const S = await loadSqlJs(wasmUrl);
  const existing = await idbGet();
  const database = existing ? new S.Database(existing) : new S.Database();
  database.run("PRAGMA foreign_keys = ON");
  let timer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void idbPut(database.export()), 250);
  };
  return wrapRaw(rawFromDatabase(database), {
    kind: "sqljs",
    backupDir: null,
    supportsBackup: false,
    afterWrite: persist,
  });
}

export async function resetBrowserDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
