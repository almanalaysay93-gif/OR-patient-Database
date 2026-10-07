import { sha256 } from "hash-wasm";
import type { Db } from "../db";
import { M001_INITIAL } from "./001_initial";
import { M002_SEED } from "./002_seed";
import { M003_AUTO_LOGIN } from "./003_workstation_auto_login";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Append-only. Never edit a shipped migration: checksums are verified on every start. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial_schema", sql: M001_INITIAL },
  { version: 2, name: "seed_reference_data", sql: M002_SEED },
  { version: 3, name: "workstation_auto_login", sql: M003_AUTO_LOGIN },
];

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: string[];
  backupPath: string | null;
}

export class MigrationError extends Error {}

/** Split a script into statements. Keeps CREATE TRIGGER ... BEGIN ... END; blocks intact. */
export function splitStatements(script: string): string[] {
  const lines = script.split(/\r?\n/).filter((l) => !l.trim().startsWith("--"));
  const out: string[] = [];
  let buf = "";
  let inTrigger = false;
  for (const line of lines) {
    buf += line + "\n";
    if (/CREATE\s+TRIGGER/i.test(line)) inTrigger = true;
    const trimmed = line.trim();
    if (inTrigger) {
      if (/END;\s*$/i.test(trimmed)) {
        out.push(buf.trim());
        buf = "";
        inTrigger = false;
      }
    } else if (trimmed.endsWith(";")) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.map((s) => s.replace(/;\s*$/, "")).filter(Boolean);
}

export async function runMigrations(db: Db, migrations: Migration[] = MIGRATIONS): Promise<MigrationResult> {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL
  )`);

  const applied = await db.select<{ version: number; name: string; checksum: string }>(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
  );
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const row of applied) {
    const m = known.get(row.version);
    if (!m) {
      throw new MigrationError(
        `This database was created by a newer version of the application (schema ${row.version}). Install the newer version to open it.`,
      );
    }
    const sum = await sha256(m.sql);
    if (sum !== row.checksum) {
      throw new MigrationError(
        `Schema migration ${row.version} (${row.name}) does not match the installed application. The database was not changed.`,
      );
    }
  }

  const fromVersion = applied.length ? applied[applied.length - 1].version : 0;
  const pending = migrations.filter((m) => m.version > fromVersion).sort((a, b) => a.version - b.version);
  if (!pending.length) return { fromVersion, toVersion: fromVersion, applied: [], backupPath: null };

  // Existing database: take a pre-migration backup before changing anything.
  let backupPath: string | null = null;
  if (fromVersion > 0 && db.backupDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = `${db.backupDir}\\OR-PreMigration-v${fromVersion}-${stamp}.db`;
    const ok = await db.backupTo(backupPath);
    if (!ok) backupPath = null;
  }

  const done: string[] = [];
  for (const m of pending) {
    const checksum = await sha256(m.sql);
    try {
      await db.transaction(async (tx) => {
        for (const stmt of splitStatements(m.sql)) await tx.execute(stmt);
        await tx.execute(
          "INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)",
          [m.version, m.name, new Date().toISOString(), checksum],
        );
      });
    } catch (err) {
      throw new MigrationError(
        `Database upgrade step ${m.version} (${m.name}) failed and was rolled back. Your data was not changed.` +
          (backupPath ? ` A backup is at ${backupPath}.` : "") +
          ` Details: ${(err as Error).message}`,
      );
    }
    done.push(`${m.version}_${m.name}`);
  }

  const check = await db.select<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations");
  const toVersion = check[0]?.v ?? 0;
  if (toVersion !== pending[pending.length - 1].version) {
    throw new MigrationError("Database upgrade could not be verified.");
  }
  return { fromVersion, toVersion, applied: done, backupPath };
}
