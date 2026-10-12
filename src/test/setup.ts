import { beforeEach } from "vitest";
import { setActiveSession, type UserSession } from "../services/session";

/** Services refuse to run without a signed-in user, so each test starts as the built-in administrator. */
export const ADMIN_SESSION: UserSession = {
  userId: "usr-admin",
  username: "admin",
  fullName: "Clinical Administrator",
  roleId: "role-admin",
  roleName: "Administrator",
  permissions: [],
};

beforeEach(() => {
  setActiveSession(ADMIN_SESSION);
});
