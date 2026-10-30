import { argon2id } from "hash-wasm";
import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { type UserSession } from "./session";

export { hasPermission, type UserSession } from "./session";

export interface UserRow {
  user_id: string;
  username: string;
  full_name: string;
  password_hash: string;
  role_id: string;
  role_name: string;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function hashPassword(plain: string): Promise<string> {
  // Use Argon2id with 32-byte salt, 64MB memory, 3 iterations
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password: plain,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 64 * 1024,
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifyPassword(plain: string, encodedHash: string): Promise<boolean> {
  try {
    const parts = encodedHash.split("$");
    // standard argon2id encoded format: $argon2id$v=19$m=65536,t=3,p=1$<salt_b64>$<hash_b64>
    if (parts.length < 6) return false;
    const saltBase64 = parts[4];
    const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
    const testHash = await argon2id({
      password: plain,
      salt,
      parallelism: 1,
      iterations: 3,
      memorySize: 64 * 1024,
      hashLength: 32,
      outputType: "encoded",
    });
    return testHash === encodedHash;
  } catch {
    return false;
  }
}

export async function getSetupStatus(db: Db): Promise<{ setupComplete: boolean; userCount: number }> {
  const settings = await db.select<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'setup_complete'"
  );
  const users = await db.select<{ count: number }>("SELECT COUNT(*) as count FROM users");
  const count = users[0]?.count ?? 0;
  return {
    setupComplete: settings[0]?.value === "1" && count > 0,
    userCount: count,
  };
}

export async function createInitialAdmin(
  db: Db,
  params: { username: string; fullName: string; password: string }
): Promise<UserSession> {
  const { setupComplete } = await getSetupStatus(db);
  if (setupComplete) {
    throw new Error("Initial setup is already complete.");
  }

  const hash = await hashPassword(params.password);
  const userId = uuid();
  const now = nowIso();

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO users (user_id, username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'role-admin', 1, 0, ?, ?)`,
      [userId, params.username.trim(), params.fullName.trim(), hash, now, now]
    );
    await tx.execute(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('setup_complete', '1')"
    );
    await tx.execute(
      `INSERT INTO audit_log (audit_id, user_id, action, entity_type, record_id, timestamp)
       VALUES (?, ?, 'INITIAL_ADMIN_CREATED', 'USER', ?, ?)`,
      [uuid(), userId, userId, now]
    );
  });

  return login(db, params.username, params.password);
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

/**
 * Failed sign-in counts live in app_settings, so a page reload or an app restart
 * does not reset the lockout. Value format: "<count>:<lockedUntilEpochMs>".
 */
const failureKey = (key: string) => `login_failures:${key.slice(0, 80)}`;

async function readFailures(db: Db, key: string): Promise<{ count: number; until: number } | undefined> {
  const rows = await db.select<{ value: string | null }>("SELECT value FROM app_settings WHERE key = ?", [failureKey(key)]);
  const [count, until] = (rows[0]?.value ?? "").split(":").map(Number);
  return Number.isFinite(count) && count > 0 ? { count, until: Number.isFinite(until) ? until : 0 } : undefined;
}

async function writeFailures(db: Db, key: string, count: number, until: number): Promise<void> {
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [failureKey(key), `${count}:${until}`]);
}

async function clearFailures(db: Db, key: string): Promise<void> {
  await db.execute("DELETE FROM app_settings WHERE key = ?", [failureKey(key)]);
}

async function loadSession(db: Db, user: UserRow): Promise<UserSession> {
  const perms = await db.select<{ permission_key: string }>(
    "SELECT permission_key FROM role_permissions WHERE role_id = ?",
    [user.role_id]
  );
  return {
    userId: user.user_id,
    username: user.username,
    fullName: user.full_name,
    roleId: user.role_id,
    roleName: user.role_name,
    permissions: perms.map((p) => p.permission_key),
    mustChangePassword: user.must_change_password === 1,
  };
}

async function findUser(db: Db, where: string, value: string): Promise<UserRow | undefined> {
  const rows = await db.select<UserRow>(
    `SELECT u.*, r.name as role_name
     FROM users u
     JOIN roles r ON u.role_id = r.role_id
     WHERE ${where}`,
    [value]
  );
  return rows[0];
}

export async function login(db: Db, username: string, plain: string, now: number = Date.now()): Promise<UserSession> {
  const key = username.trim().toLowerCase();
  const failed = await readFailures(db, key);
  if (failed && failed.until > now) {
    throw new Error(`Too many failed attempts. Try again in ${Math.ceil((failed.until - now) / 1000)} seconds.`);
  }

  const user = await findUser(db, "u.username = ?", username.trim());
  // An empty hash never verifies, so accounts without a password cannot sign in.
  const valid = !!user && user.active === 1 && (await verifyPassword(plain, user.password_hash));
  if (!user || !valid) {
    const expired = !!failed && failed.count >= MAX_FAILED_ATTEMPTS;
    const count = (expired ? 0 : failed?.count ?? 0) + 1;
    await writeFailures(db, key, count, count >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0);
    await logAudit(db, {
      userId: user?.user_id ?? null, action: "LOGIN_FAILED", entityType: "USER",
      recordId: user?.user_id ?? null, newValue: username.trim().slice(0, 80),
    });
    throw new Error("Invalid username or password.");
  }
  if (failed) await clearFailures(db, key);

  await db.execute("UPDATE users SET last_login_at = ? WHERE user_id = ?", [nowIso(), user.user_id]);
  await logAudit(db, { userId: user.user_id, action: "LOGIN", entityType: "USER", recordId: user.user_id });
  return loadSession(db, user);
}

/** Re-checks the password of the user who is already signed in (idle lock screen). */
export async function unlockSession(db: Db, session: UserSession, plain: string): Promise<UserSession> {
  const user = await findUser(db, "u.user_id = ?", session.userId);
  if (!user || user.active !== 1) throw new Error("This account is no longer active.");
  if (!(await verifyPassword(plain, user.password_hash))) {
    await logAudit(db, { userId: user.user_id, action: "UNLOCK_FAILED", entityType: "USER", recordId: user.user_id });
    throw new Error("Incorrect password.");
  }
  await logAudit(db, { userId: user.user_id, action: "UNLOCK", entityType: "USER", recordId: user.user_id });
  // Role or permissions may have changed while the screen was locked.
  return loadSession(db, user);
}

export async function recordSessionEvent(
  db: Db, session: UserSession, action: "LOGOUT" | "IDLE_LOCK" | "MANUAL_LOCK",
): Promise<void> {
  await logAudit(db, { userId: session.userId, action, entityType: "USER", recordId: session.userId });
}

export const MIN_PASSWORD_LENGTH = 12;

/** Pass the account user name when it is known, so a password equal to it is refused. */
export function validatePassword(plain: string, username?: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (username && plain.trim().toLowerCase() === username.trim().toLowerCase()) {
    throw new Error("Password must not be the same as the user name.");
  }
}

export async function getIdleLockMinutes(db: Db): Promise<number> {
  const rows = await db.select<{ value: string }>("SELECT value FROM app_settings WHERE key = 'idle_lock_minutes'");
  const n = Number(rows[0]?.value);
  return Number.isFinite(n) && n > 0 ? n : 60;
}
