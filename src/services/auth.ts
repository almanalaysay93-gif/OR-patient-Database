import { argon2id } from "hash-wasm";
import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";

export interface UserSession {
  userId: string;
  username: string;
  fullName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

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

export async function login(db: Db, username: string, plain: string): Promise<UserSession> {
  const rows = await db.select<UserRow>(
    `SELECT u.*, r.name as role_name
     FROM users u
     JOIN roles r ON u.role_id = r.role_id
     WHERE u.username = ? AND u.active = 1`,
    [username.trim()]
  );
  const user = rows[0];
  if (!user) {
    throw new Error("Invalid username or password.");
  }

  const valid = await verifyPassword(plain, user.password_hash);
  if (!valid) {
    throw new Error("Invalid username or password.");
  }

  const now = nowIso();
  await db.execute("UPDATE users SET last_login_at = ? WHERE user_id = ?", [now, user.user_id]);

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
  };
}

export function hasPermission(session: UserSession | null, permission: string): boolean {
  if (!session) return false;
  if (session.roleId === "role-admin") return true;
  return session.permissions.includes(permission);
}

export async function getOrCreateActiveSession(db: Db): Promise<UserSession> {
  const users = await db.select<UserRow>(
    `SELECT u.*, r.name as role_name
     FROM users u
     JOIN roles r ON u.role_id = r.role_id
     WHERE u.active = 1
     ORDER BY CASE WHEN u.role_id = 'role-admin' THEN 0 ELSE 1 END, u.created_at ASC
     LIMIT 1`
  );

  let user = users[0];
  if (!user) {
    const now = nowIso();
    const userId = "usr-admin";
    await db.execute(
      `INSERT OR IGNORE INTO users (user_id, username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
       VALUES (?, 'admin', 'Clinical Administrator', '', 'role-admin', 1, 0, ?, ?)`,
      [userId, now, now]
    );
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('setup_complete', '1')");
    const fresh = await db.select<UserRow>(
      `SELECT u.*, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       WHERE u.user_id = ?`,
      [userId]
    );
    user = fresh[0];
  }

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
  };
}
