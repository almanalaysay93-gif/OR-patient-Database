import type { Db, RawDb } from "../data/db";
import { nowIso, uuid } from "../data/db";
import { logAudit } from "./audit";
import { hashPassword, validatePassword, verifyPassword } from "./auth";
import { requirePermission, getActiveSession, setActiveSession, PermissionError } from "./session";

// Passwords set by someone else (new account, reset) are temporary: the owner must replace them at next sign-in.
// An administrator may keep such a password so it can be looked up later (staff_saved_passwords). The saved copy is
// deleted as soon as the owner chooses their own password, and every lookup is written to the audit log.

/** The built-in administrator. It can never be deactivated or demoted, so the workstation cannot be locked out. */
export const MASTER_ADMIN_ID = "usr-admin";
const ADMIN_ROLE = "role-admin";

export interface StaffAccount {
  user_id: string;
  username: string;
  full_name: string;
  role_id: string;
  role_name: string;
  active: number;
  last_login_at: string | null;
  created_at: string;
  /** When an administrator saved this account's current password, or null when none is saved. */
  password_saved_at: string | null;
}

export interface RoleOption {
  role_id: string;
  name: string;
  description: string | null;
}

const ACCOUNT_SQL = `SELECT u.user_id, u.username, u.full_name, u.role_id, r.name AS role_name,
    u.active, u.last_login_at, u.created_at, s.saved_at AS password_saved_at
  FROM users u JOIN roles r ON r.role_id = u.role_id
  LEFT JOIN staff_saved_passwords s ON s.user_id = u.user_id`;

export async function listUsers(db: Db): Promise<StaffAccount[]> {
  requirePermission("users.manage");
  return db.select<StaffAccount>(`${ACCOUNT_SQL} ORDER BY u.active DESC, u.full_name COLLATE NOCASE`);
}

export async function listRoles(db: Db): Promise<RoleOption[]> {
  requirePermission("users.manage");
  return db.select<RoleOption>("SELECT role_id, name, description FROM roles ORDER BY name");
}

async function getAccount(db: Db, userId: string): Promise<StaffAccount> {
  const rows = await db.select<StaffAccount>(`${ACCOUNT_SQL} WHERE u.user_id = ?`, [userId]);
  if (!rows[0]) throw new Error("Account not found.");
  return rows[0];
}

async function assertRole(db: Db, roleId: string): Promise<void> {
  const rows = await db.select<{ role_id: string }>("SELECT role_id FROM roles WHERE role_id = ?", [roleId]);
  if (!rows[0]) throw new Error("Select a valid role.");
}

/** Refuses a change that would leave the workstation without an active administrator. */
async function assertAnotherAdmin(db: Db, userId: string): Promise<void> {
  const rows = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND active = 1 AND user_id <> ?", [ADMIN_ROLE, userId]);
  if (!rows[0]?.n) throw new Error("At least one active administrator is required.");
}

export async function createUser(
  db: Db,
  params: { username: string; fullName: string; roleId: string; password: string; savePassword?: boolean },
): Promise<string> {
  const actor = requirePermission("users.manage");
  const username = params.username.trim();
  const fullName = params.fullName.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("Username must be 3-32 characters: letters, numbers, dot, dash or underscore.");
  }
  if (!fullName) throw new Error("Enter the full name of the staff member.");
  validatePassword(params.password, username);
  await assertRole(db, params.roleId);
  const taken = await db.select<{ user_id: string }>("SELECT user_id FROM users WHERE username = ?", [username]);
  if (taken[0]) throw new Error("This username is already in use.");

  const hash = await hashPassword(params.password);
  const id = uuid();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO users (user_id, username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [id, username, fullName, hash, params.roleId, now, now]);
    if (params.savePassword) await savePassword(tx, id, params.password, actor, now);
    await logAudit(tx, {
      userId: actor, action: "CREATE_USER", entityType: "USER", recordId: id,
      newValue: JSON.stringify({ username, fullName, roleId: params.roleId, passwordSaved: !!params.savePassword }),
    });
  });
  return id;
}

export async function setUserActive(db: Db, userId: string, active: boolean): Promise<void> {
  const actor = requirePermission("users.manage");
  const account = await getAccount(db, userId);
  if (!active) {
    if (userId === MASTER_ADMIN_ID) throw new Error("The master administrator account cannot be deactivated.");
    if (userId === actor) throw new Error("You cannot deactivate your own account.");
    if (account.role_id === ADMIN_ROLE) await assertAnotherAdmin(db, userId);
  }
  await db.transaction(async (tx) => {
    await tx.execute("UPDATE users SET active = ?, updated_at = ? WHERE user_id = ?", [active ? 1 : 0, nowIso(), userId]);
    await logAudit(tx, {
      userId: actor, action: active ? "ACTIVATE_USER" : "DEACTIVATE_USER", entityType: "USER", recordId: userId,
      fieldName: "active", oldValue: String(account.active), newValue: active ? "1" : "0",
    });
  });
}

export async function setUserRole(db: Db, userId: string, roleId: string): Promise<void> {
  const actor = requirePermission("users.manage");
  const account = await getAccount(db, userId);
  if (account.role_id === roleId) return;
  if (userId === MASTER_ADMIN_ID) throw new Error("The role of the master administrator cannot be changed.");
  if (userId === actor) throw new Error("You cannot change your own role.");
  await assertRole(db, roleId);
  if (account.role_id === ADMIN_ROLE && account.active === 1) await assertAnotherAdmin(db, userId);
  await db.transaction(async (tx) => {
    await tx.execute("UPDATE users SET role_id = ?, updated_at = ? WHERE user_id = ?", [roleId, nowIso(), userId]);
    await logAudit(tx, {
      userId: actor, action: "CHANGE_USER_ROLE", entityType: "USER", recordId: userId,
      fieldName: "role_id", oldValue: account.role_id, newValue: roleId,
    });
  });
}

export async function resetUserPassword(db: Db, userId: string, newPassword: string, keep = false): Promise<void> {
  const actor = requirePermission("users.manage");
  const target = await getAccount(db, userId);
  validatePassword(newPassword, target.username);
  const hash = await hashPassword(newPassword);
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE user_id = ?",
      [hash, userId === actor ? 0 : 1, now, userId]);
    // A saved copy of the old password no longer works, so it is replaced or removed.
    if (keep) await savePassword(tx, userId, newPassword, actor, now);
    else await tx.execute("DELETE FROM staff_saved_passwords WHERE user_id = ?", [userId]);
    await logAudit(tx, {
      userId: actor, action: "RESET_PASSWORD", entityType: "USER", recordId: userId,
      newValue: JSON.stringify({ passwordSaved: keep }),
    });
  });
}

async function savePassword(tx: RawDb, userId: string, password: string, actor: string, now: string): Promise<void> {
  await tx.execute(
    `INSERT INTO staff_saved_passwords (user_id, password, saved_by, saved_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET password = excluded.password, saved_by = excluded.saved_by, saved_at = excluded.saved_at`,
    [userId, password, actor, now]);
}

/** Returns the saved password of an account, or null when none is saved. Each lookup is audited. */
export async function getSavedPassword(db: Db, userId: string): Promise<string | null> {
  const actor = requirePermission("users.manage");
  const rows = await db.select<{ password: string }>("SELECT password FROM staff_saved_passwords WHERE user_id = ?", [userId]);
  if (!rows[0]) return null;
  await logAudit(db, { userId: actor, action: "VIEW_SAVED_PASSWORD", entityType: "USER", recordId: userId });
  return rows[0].password;
}

/** Deletes the saved password of an account without changing the password itself. */
export async function forgetSavedPassword(db: Db, userId: string): Promise<void> {
  const actor = requirePermission("users.manage");
  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM staff_saved_passwords WHERE user_id = ?", [userId]);
    await logAudit(tx, { userId: actor, action: "FORGET_SAVED_PASSWORD", entityType: "USER", recordId: userId });
  });
}

/**
 * Any signed-in user may change their own password after proving the current one.
 * This is the only service a user with a temporary password may call.
 */
export async function changeOwnPassword(db: Db, currentPassword: string, newPassword: string): Promise<void> {
  const session = getActiveSession();
  if (!session) throw new PermissionError("Sign in to continue.");
  const rows = await db.select<{ password_hash: string; username: string }>(
    "SELECT password_hash, username FROM users WHERE user_id = ?", [session.userId]);
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) {
    throw new Error("Current password is incorrect.");
  }
  validatePassword(newPassword, rows[0].username);
  if (newPassword === currentPassword) throw new Error("Choose a password different from the current one.");
  const hash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE user_id = ?",
      [hash, nowIso(), session.userId]);
    // A password the owner chose is never kept in readable form.
    await tx.execute("DELETE FROM staff_saved_passwords WHERE user_id = ?", [session.userId]);
    await logAudit(tx, { userId: session.userId, action: "CHANGE_OWN_PASSWORD", entityType: "USER", recordId: session.userId });
  });
  if (getActiveSession()?.userId === session.userId) setActiveSession({ ...session, mustChangePassword: false });
}
