import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { ADMIN_SESSION } from "../test/setup";
import { setActiveSession, PermissionError } from "./session";
import { login, validatePassword } from "./auth";
import {
  changeOwnPassword, createUser, forgetSavedPassword, getSavedPassword, listUsers, resetUserPassword,
} from "./userAdmin";
import { generatePassword } from "./passwordGenerator";

let db: Db;

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
  setActiveSession(ADMIN_SESSION);
});

const savedRow = async (userId: string) =>
  (await db.select<{ password: string }>("SELECT password FROM staff_saved_passwords WHERE user_id = ?", [userId]))[0];

const auditCount = async (action: string) =>
  (await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?", [action]))[0].n;

describe("saved staff passwords", () => {
  it("keeps the starting password only when the administrator asks for it", async () => {
    const kept = await createUser(db, { username: "nurse.kept", fullName: "Kept", roleId: "role-nurse", password: "starting-pass-01", savePassword: true });
    const notKept = await createUser(db, { username: "nurse.plain", fullName: "Plain", roleId: "role-nurse", password: "starting-pass-02" });
    expect((await savedRow(kept))?.password).toBe("starting-pass-01");
    expect(await savedRow(notKept)).toBeUndefined();
    const accounts = await listUsers(db);
    expect(accounts.find((a) => a.user_id === kept)?.password_saved_at).toBeTruthy();
    expect(accounts.find((a) => a.user_id === notKept)?.password_saved_at).toBeNull();
  });

  it("audits every lookup and returns null when nothing is saved", async () => {
    const id = await createUser(db, { username: "nurse.look", fullName: "Look", roleId: "role-nurse", password: "starting-pass-03", savePassword: true });
    expect(await getSavedPassword(db, id)).toBe("starting-pass-03");
    expect(await getSavedPassword(db, id)).toBe("starting-pass-03");
    expect(await auditCount("VIEW_SAVED_PASSWORD")).toBe(2);
    await forgetSavedPassword(db, id);
    expect(await getSavedPassword(db, id)).toBeNull();
  });

  it("replaces the saved copy on a reset, and removes it on a reset that is not kept", async () => {
    const id = await createUser(db, { username: "nurse.reset", fullName: "Reset", roleId: "role-nurse", password: "starting-pass-04", savePassword: true });
    await resetUserPassword(db, id, "second-pass-0004", true);
    expect((await savedRow(id))?.password).toBe("second-pass-0004");
    await resetUserPassword(db, id, "third-pass-00004");
    expect(await savedRow(id)).toBeUndefined();
  });

  it("deletes the saved copy when the staff member chooses their own password", async () => {
    const id = await createUser(db, { username: "nurse.own", fullName: "Own", roleId: "role-nurse", password: "starting-pass-05", savePassword: true });
    setActiveSession(await login(db, "nurse.own", "starting-pass-05"));
    await changeOwnPassword(db, "starting-pass-05", "my-own-secret-05");
    setActiveSession(ADMIN_SESSION);
    expect(await savedRow(id)).toBeUndefined();
  });

  it("refuses a lookup by a role without user management", async () => {
    const id = await createUser(db, { username: "nurse.other", fullName: "Other", roleId: "role-nurse", password: "starting-pass-06", savePassword: true });
    setActiveSession({ ...ADMIN_SESSION, userId: "usr-x", roleId: "role-supervisor", roleName: "OR Supervisor", permissions: ["patients.view", "db.backup"] });
    await expect(getSavedPassword(db, id)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("generatePassword", () => {
  it("makes 16-character passwords with every character class that pass the password rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%*\-_+=?]/);
      expect(p).not.toMatch(/[0O1lI]/);
      expect(() => validatePassword(p, "nurse.one")).not.toThrow();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });

  it("refuses a length below the 12-character rule", () => {
    expect(() => generatePassword(8)).toThrow("at least 12");
  });
});
