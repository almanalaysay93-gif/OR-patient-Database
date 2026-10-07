export type SqlValue = string | number | null;
export type Row = Record<string, SqlValue>;

/** Minimal statement-level access. Implemented by each storage adapter. */
export interface RawDb {
  select<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
}

/**
 * Database handle used by repositories.
 * Storage adapters (Tauri/rusqlite, sql.js) implement RawDb; this wrapper adds
 * serialized access and transactions so the persistence layer can later be
 * swapped for a network database without touching the UI.
 */
export interface Db extends RawDb {
  transaction<T>(fn: (tx: RawDb) => Promise<T>): Promise<T>;
  /** Write a consistent copy of the database to a file path (VACUUM INTO). Returns false if unsupported. */
  backupTo(path: string): Promise<boolean>;
  readonly kind: "tauri" | "sqljs";
  /** Absolute backups directory, or null when the adapter has no filesystem. */
  readonly backupDir: string | null;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export interface AdapterOptions {
  kind: Db["kind"];
  backupDir: string | null;
  supportsBackup: boolean;
  afterWrite?: () => void;
}

export function wrapRaw(raw: RawDb, opts: AdapterOptions): Db {
  const lock = new Mutex();
  let inTx = false;
  const notify = () => opts.afterWrite?.();
  return {
    kind: opts.kind,
    backupDir: opts.backupDir,
    select: (sql, params) => lock.run(() => raw.select(sql, params)),
    execute: (sql, params) =>
      lock.run(async () => {
        const r = await raw.execute(sql, params);
        notify();
        return r;
      }),
    transaction: (fn) =>
      lock.run(async () => {
        if (inTx) throw new Error("Nested transactions are not supported");
        inTx = true;
        await raw.execute("BEGIN IMMEDIATE");
        try {
          const result = await fn(raw);
          await raw.execute("COMMIT");
          notify();
          return result;
        } catch (err) {
          await raw.execute("ROLLBACK").catch(() => undefined);
          throw err;
        } finally {
          inTx = false;
        }
      }),
    backupTo: (path) =>
      lock.run(async () => {
        if (!opts.supportsBackup) return false;
        await raw.execute("VACUUM INTO ?", [path]);
        return true;
      }),
  };
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const bool = (v: boolean | null | undefined): number | null => (v == null ? null : v ? 1 : 0);
export const toBool = (v: SqlValue | undefined): boolean => v === 1 || v === "1";
