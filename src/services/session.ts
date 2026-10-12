/**
 * The signed-in user for this workstation process.
 * Services read the actor from here, never from the caller, so an action
 * cannot be recorded against someone other than the person signed in.
 */
export interface UserSession {
  userId: string;
  username: string;
  fullName: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  /** Set while the account still has a password someone else chose. Nothing else is allowed until it is changed. */
  mustChangePassword?: boolean;
}

export class PermissionError extends Error {}

let active: UserSession | null = null;

export function setActiveSession(session: UserSession | null): void {
  active = session;
}

export function getActiveSession(): UserSession | null {
  return active;
}

export function hasPermission(session: UserSession | null, permission: string): boolean {
  if (!session) return false;
  if (session.roleId === "role-admin") return true;
  return session.permissions.includes(permission);
}

/** Signed-in user id, or null before sign-in. */
export function currentUserId(): string | null {
  return active?.userId ?? null;
}

/** Guard for reference lists that any signed-in user may read. Returns their user id. */
export function requireSession(): string {
  if (!active) throw new PermissionError("Sign in to continue.");
  if (active.mustChangePassword) throw new PermissionError("Change your password to continue.");
  return active.userId;
}

/**
 * Guard for every service that reads, changes or releases data.
 * Passes when the signed-in user holds any of the listed permissions and returns their user id.
 */
export function requirePermission(...permissions: string[]): string {
  requireSession();
  if (!active) throw new PermissionError("Sign in to continue.");
  if (!permissions.some((p) => hasPermission(active, p))) {
    throw new PermissionError(`Your role (${active.roleName}) is not allowed to do this.`);
  }
  return active.userId;
}
