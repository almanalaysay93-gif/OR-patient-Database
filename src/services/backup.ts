import type { Db } from "../data/db";
import { logAudit } from "./audit";
import { currentUserId, requirePermission, setActiveSession } from "./session";

export interface BackupFile {
  name: string;
  size: number;
  /** Milliseconds since the Unix epoch. */
  modified: number;
}

/** Filesystem operations the desktop shell provides. Tests supply an in-memory one. */
export interface BackupHost {
  list(): Promise<BackupFile[]>;
  /** Removes one automatic backup. The shell refuses any other file. */
  remove(name: string): Promise<void>;
  copyTo(name: string, folder: string): Promise<void>;
  /**
   * Saves the live database as `safetyName`, then replaces it with the backup `name`.
   * `recoveryKey` opens a backup that was made on another PC.
   */
  restore(name: string, safetyName: string, recoveryKey?: string): Promise<void>;
  /** The key that opens this PC's database and backups anywhere. */
  recoveryKey(): Promise<string>;
}

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number;
  keep: number;
  mirrorDir: string;
  lastAutoBackup: string | null;
}

export const AUTO_PREFIX = "OR-AutoBackup-";
export const MANUAL_PREFIX = "OR-ManualBackup-";
export const SAFETY_PREFIX = "OR-PreRestore-";

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function getBackupSettings(db: Db): Promise<BackupSettings> {
  const rows = await db.select<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings
     WHERE key IN ('auto_backup_enabled','auto_backup_interval_hours','auto_backup_keep','backup_mirror_dir','last_auto_backup')`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map.get("auto_backup_enabled") !== "0",
    intervalHours: positive(map.get("auto_backup_interval_hours"), 24),
    keep: Math.floor(positive(map.get("auto_backup_keep"), 14)),
    mirrorDir: map.get("backup_mirror_dir") ?? "",
    lastAutoBackup: map.get("last_auto_backup") || null,
  };
}

export async function saveBackupSettings(
  db: Db, params: { enabled: boolean; intervalHours: number; keep: number; mirrorDir: string },
): Promise<void> {
  const userId = requirePermission("db.backup");
  if (!(params.intervalHours >= 1 && params.intervalHours <= 168)) throw new Error("Backup interval must be 1 to 168 hours.");
  if (!(params.keep >= 1 && params.keep <= 365)) throw new Error("Keep between 1 and 365 automatic backups.");
  const values: [string, string][] = [
    ["auto_backup_enabled", params.enabled ? "1" : "0"],
    ["auto_backup_interval_hours", String(params.intervalHours)],
    ["auto_backup_keep", String(Math.floor(params.keep))],
    ["backup_mirror_dir", params.mirrorDir.trim()],
  ];
  await db.transaction(async (tx) => {
    for (const [key, value] of values) {
      await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [key, value]);
    }
    await logAudit(tx, {
      userId, action: "SAVE_BACKUP_SETTINGS", entityType: "APP_SETTINGS", newValue: JSON.stringify(Object.fromEntries(values)),
    });
  });
}

export async function listBackups(host: BackupHost): Promise<BackupFile[]> {
  requirePermission("db.backup", "db.restore");
  return (await host.list()).sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
}

/** Writes the backup file and copies it to the second folder when one is set. */
async function writeBackup(db: Db, host: BackupHost | null, name: string, mirrorDir: string): Promise<string | null> {
  if (!db.backupDir || !(await db.backupTo(`${db.backupDir}\\${name}`))) {
    throw new Error("File backups are only available in the installed desktop app.");
  }
  if (!mirrorDir || !host) return null;
  try {
    await host.copyTo(name, mirrorDir);
    return null;
  } catch (err) {
    return `Second copy to ${mirrorDir} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function createManualBackup(
  db: Db, host: BackupHost | null, now: Date = new Date(),
): Promise<{ name: string; mirrorError: string | null }> {
  const userId = requirePermission("db.backup");
  const { mirrorDir } = await getBackupSettings(db);
  const name = `${MANUAL_PREFIX}${stamp(now)}.db`;
  const mirrorError = await writeBackup(db, host, name, mirrorDir);
  await logAudit(db, { userId, action: "BACKUP_MANUAL", entityType: "DATABASE", newValue: name });
  return { name, mirrorError };
}

export function isAutoBackupDue(settings: BackupSettings, now: Date): boolean {
  if (!settings.enabled) return false;
  if (!settings.lastAutoBackup) return true;
  const last = Date.parse(settings.lastAutoBackup);
  return !Number.isFinite(last) || now.getTime() - last >= settings.intervalHours * 3_600_000;
}

export interface ScheduledBackupResult {
  status: "unsupported" | "not_due" | "done";
  name?: string;
  pruned: number;
  mirrorError: string | null;
}

/**
 * Runs from the app timer, not from a user action, so it needs no permission.
 * Takes a backup when one is due, then deletes the oldest automatic backups beyond the retention count.
 */
export async function runScheduledBackup(db: Db, host: BackupHost | null, now: Date = new Date()): Promise<ScheduledBackupResult> {
  if (!db.backupDir || !host) return { status: "unsupported", pruned: 0, mirrorError: null };
  const settings = await getBackupSettings(db);
  if (!isAutoBackupDue(settings, now)) return { status: "not_due", pruned: 0, mirrorError: null };

  const name = `${AUTO_PREFIX}${stamp(now)}.db`;
  const mirrorError = await writeBackup(db, host, name, settings.mirrorDir);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_auto_backup', ?)", [now.toISOString()]);

  // The timestamp in the name sorts chronologically.
  const autos = (await host.list()).filter((f) => f.name.startsWith(AUTO_PREFIX)).sort((a, b) => b.name.localeCompare(a.name));
  const stale = autos.slice(settings.keep);
  for (const file of stale) await host.remove(file.name);

  await logAudit(db, {
    userId: currentUserId(), action: "BACKUP_AUTO", entityType: "DATABASE",
    newValue: JSON.stringify({ name, pruned: stale.length, mirrorError }),
  });
  return { status: "done", name, pruned: stale.length, mirrorError };
}

/**
 * Replaces the live database with a backup. The current database is saved first as a
 * pre-restore backup, so a wrong choice can itself be undone. The caller must reload the app afterwards.
 */
export async function restoreBackup(
  db: Db, host: BackupHost, name: string, now: Date = new Date(), recoveryKey?: string,
): Promise<string> {
  const userId = requirePermission("db.restore");
  if (!db.backupDir) throw new Error("Restore is only available in the installed desktop app.");
  const safetyName = `${SAFETY_PREFIX}${stamp(now)}.db`;
  await logAudit(db, { userId, action: "RESTORE_STARTED", entityType: "DATABASE", oldValue: safetyName, newValue: name });
  await host.restore(name, safetyName, recoveryKey?.trim() || undefined);

  // The restored database has its own users; the person restoring may not exist in it.
  const known = await db.select<{ user_id: string }>("SELECT user_id FROM users WHERE user_id = ?", [userId]);
  setActiveSession(null);
  await logAudit(db, {
    userId: known[0] ? userId : null, action: "RESTORE_COMPLETED", entityType: "DATABASE",
    oldValue: safetyName, newValue: name,
  });
  return safetyName;
}

/**
 * The recovery key opens the encrypted database and its backups on another PC or Windows account.
 * Whoever holds it can read every record, so only administrators see it and each viewing is audited.
 */
export async function getRecoveryKey(db: Db, host: BackupHost): Promise<string> {
  const userId = requirePermission("db.restore");
  if (!db.backupDir) throw new Error("The recovery key exists in the installed desktop app only.");
  await logAudit(db, { userId, action: "VIEW_RECOVERY_KEY", entityType: "DATABASE" });
  return host.recoveryKey();
}
