import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { openMemoryDb } from "../data/sqljs-adapter";
import { MIGRATIONS, runMigrations } from "../data/migrations";
import { M020_REVOKE_PUBLIC_ADMIN_PASSWORD } from "../data/migrations/020_revoke_public_admin_password";
import type { Db } from "../data/db";
import { ADMIN_SESSION } from "../test/setup";
import { setActiveSession, PermissionError, type UserSession } from "./session";
import { getIdleLockMinutes, login, recordSessionEvent, unlockSession, validatePassword } from "./auth";
import {
  changeOwnPassword, createUser, listUsers, resetUserPassword, setUserActive, setUserRole, MASTER_ADMIN_ID,
} from "./userAdmin";
import {
  createAdmission, createPatient, createSurgicalCase, getCaseById, getPatientById, listPatients, searchGlobal,
} from "./patients";
import { getPreOrChecklist, updateChecklistItem } from "./preOr";
import { getPreopBaseline, savePreopBaseline } from "./preopBaseline";
import { addDonorRelationshipType, getDonorRelationshipTypes, setDonorRelationshipTypeActive } from "./donorRelationships";
import { getSafetyItems, phaseComplete, saveSafetyResponse } from "./safetyPhases";
import { getCaseEvents, saveCaseEvent } from "./caseEvents";
import { getScheduleByDate, scheduleCase } from "./scheduling";
import { getAnalyticsSummary } from "./analytics";
import { answerQuestion } from "./assistant";
import { addComplication, completeCase, getIntraOrRecord, saveIntraOrRecord, savePostOrRecord } from "./intraPostOr";
import { addOrRoom, addSpecialty, saveFacilityProfile, getOrRooms } from "./masterData";
import { getAuditHistory } from "./audit";
import {
  createManualBackup, getBackupSettings, getRecoveryKey, isAutoBackupDue, listBackups, restoreBackup, runScheduledBackup,
  saveBackupSettings, type BackupFile, type BackupHost,
} from "./backup";
import { buildXlsx, columnLetter } from "./xlsx";
import { buildClinicalExport, exportClinicalWorkbook } from "./exportData";

const ADMIN_PASSWORD = "transplant@123";
const STAFF_PASSWORD = "nurse-pass-1";

let db: Db;

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
});

async function addStaff(username: string, roleId: string): Promise<UserSession> {
  await createUser(db, { username, fullName: `Staff ${username}`, roleId, password: STAFF_PASSWORD });
  // Skips the forced first-sign-in password change, which has its own tests.
  await db.execute("UPDATE users SET must_change_password = 0 WHERE username = ?", [username]);
  return login(db, username, STAFF_PASSWORD);
}

async function makeCase(first = "Maria", last = "Santos", hrn = "HRN-77") {
  const patient = await createPatient(db, { firstName: first, lastName: last, hrn, dateOfBirth: "1980-05-10", sex: "FEMALE" });
  const admission = await createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-07" });
  const c = await createSurgicalCase(db, {
    patientId: patient.patient_id, admissionId: admission.admission_id, plannedProcedureSummary: "Appendectomy",
  });
  return { patient, c };
}

const lastAudit = async (action: string) =>
  (await db.select<{ user_id: string | null; new_value: string | null }>(
    "SELECT user_id, new_value FROM audit_log WHERE action = ? ORDER BY rowid DESC LIMIT 1", [action]))[0];

describe("master admin sign-in", () => {
  it("signs the seeded admin in with the configured password and turns auto-login off", async () => {
    const session = await login(db, "admin", ADMIN_PASSWORD);
    expect(session.userId).toBe(MASTER_ADMIN_ID);
    expect(session.roleId).toBe("role-admin");
    expect(session.permissions).toContain("users.manage");
    const auto = await db.select<{ value: string }>("SELECT value FROM app_settings WHERE key = 'auto_login'");
    expect(auto[0].value).toBe("0");
    expect((await lastAudit("LOGIN")).user_id).toBe(MASTER_ADMIN_ID);
  });

  it("rejects a wrong password, an empty password and an unknown user with the same message", async () => {
    await expect(login(db, "admin", "wrong-password", 1_000)).rejects.toThrow("Invalid username or password.");
    await expect(login(db, "admin", "", 1_000)).rejects.toThrow("Invalid username or password.");
    await expect(login(db, "nobody-here", ADMIN_PASSWORD, 1_000)).rejects.toThrow("Invalid username or password.");
    expect((await lastAudit("LOGIN_FAILED")).new_value).toBe("nobody-here");
    await login(db, "admin", ADMIN_PASSWORD, 1_000);
  });

  it("locks an account for a minute after five wrong passwords, even for the right one", async () => {
    await addStaff("lockme", "role-nurse");
    const t0 = 5_000_000;
    for (let i = 0; i < 5; i++) {
      await expect(login(db, "lockme", "bad", t0)).rejects.toThrow("Invalid username or password.");
    }
    await expect(login(db, "LockMe", STAFF_PASSWORD, t0 + 1_000)).rejects.toThrow("Try again in 59 seconds");
    const session = await login(db, "lockme", STAFF_PASSWORD, t0 + 60_001);
    expect(session.username).toBe("lockme");
  });

  it("keeps the lockout after a reload of the app on the same database", async () => {
    await addStaff("reload.me", "role-nurse");
    const t0 = 7_000_000;
    for (let i = 0; i < 5; i++) {
      await expect(login(db, "reload.me", "bad", t0)).rejects.toThrow("Invalid username or password.");
    }
    vi.resetModules();
    const fresh = await import("./auth");
    await expect(fresh.login(db, "reload.me", STAFF_PASSWORD, t0 + 1_000)).rejects.toThrow("Too many failed attempts");
    expect((await fresh.login(db, "reload.me", STAFF_PASSWORD, t0 + 60_001)).username).toBe("reload.me");
    const left = await db.select("SELECT key FROM app_settings WHERE key LIKE 'login_failures:%'");
    expect(left).toHaveLength(0);
  });

  it("requires 12 or more characters and a password that is not the user name", () => {
    expect(() => validatePassword("elevenchars")).toThrow("at least 12 characters");
    expect(() => validatePassword("twelve-chars")).not.toThrow();
    expect(() => validatePassword("nurse.longname", "Nurse.LongName")).toThrow("same as the user name");
    expect(() => validatePassword("nurse.longname", "nurse.other")).not.toThrow();
  });

  it("refuses the user name as the password when an account is created or its password is set", async () => {
    await expect(createUser(db, {
      username: "nurse.longname", fullName: "Nurse Long", roleId: "role-nurse", password: "nurse.longname",
    })).rejects.toThrow("same as the user name");
    const nurse = await addStaff("nurse.second", "role-nurse");
    await expect(resetUserPassword(db, nurse.userId, "NURSE.SECOND")).rejects.toThrow("same as the user name");
    setActiveSession(nurse);
    await expect(changeOwnPassword(db, STAFF_PASSWORD, "nurse.second")).rejects.toThrow("same as the user name");
    setActiveSession(ADMIN_SESSION);
  });

  it("unlocks only with the signed-in user's own password and records lock events", async () => {
    const nurse = await addStaff("nurse.a", "role-nurse");
    await recordSessionEvent(db, nurse, "IDLE_LOCK");
    expect((await lastAudit("IDLE_LOCK")).user_id).toBe(nurse.userId);
    await expect(unlockSession(db, nurse, ADMIN_PASSWORD)).rejects.toThrow("Incorrect password.");
    expect((await unlockSession(db, nurse, STAFF_PASSWORD)).userId).toBe(nurse.userId);
    await setUserActive(db, nurse.userId, false);
    await expect(unlockSession(db, nurse, STAFF_PASSWORD)).rejects.toThrow("no longer active");
  });

  it("locks after 60 idle minutes by default", async () => {
    expect(await getIdleLockMinutes(db)).toBe(60);
    await db.execute("UPDATE app_settings SET value = 'abc' WHERE key = 'idle_lock_minutes'");
    expect(await getIdleLockMinutes(db)).toBe(60);
  });
});

describe("staff accounts", () => {
  it("lets the admin create an account that can then sign in with its role's permissions", async () => {
    const nurse = await addStaff("nurse.b", "role-nurse");
    expect(nurse.roleName).toBe("Nurse");
    expect(nurse.permissions).toContain("preor.edit");
    expect(nurse.permissions).not.toContain("users.manage");
    expect((await lastAudit("CREATE_USER")).user_id).toBe(MASTER_ADMIN_ID);
    const stored = await db.select<{ password_hash: string }>("SELECT password_hash FROM users WHERE username = 'nurse.b'");
    expect(stored[0].password_hash.startsWith("$argon2id$")).toBe(true);
    expect(stored[0].password_hash).not.toContain(STAFF_PASSWORD);
  });

  it("validates new accounts", async () => {
    const base = { username: "valid.user", fullName: "Valid User", roleId: "role-nurse", password: STAFF_PASSWORD };
    await expect(createUser(db, { ...base, username: "a b" })).rejects.toThrow("Username must be");
    await expect(createUser(db, { ...base, fullName: "  " })).rejects.toThrow("full name");
    await expect(createUser(db, { ...base, password: "short" })).rejects.toThrow("at least 12 characters");
    await expect(createUser(db, { ...base, roleId: "role-nope" })).rejects.toThrow("valid role");
    await expect(createUser(db, { ...base, username: "admin" })).rejects.toThrow("already in use");
  });

  it("stops non-administrators from managing accounts", async () => {
    const nurse = await addStaff("nurse.c", "role-nurse");
    setActiveSession(nurse);
    await expect(listUsers(db)).rejects.toThrow(PermissionError);
    await expect(createUser(db, { username: "sneaky", fullName: "Sneaky", roleId: "role-admin", password: STAFF_PASSWORD }))
      .rejects.toThrow("not allowed");
    await expect(resetUserPassword(db, MASTER_ADMIN_ID, "hijacked-pass")).rejects.toThrow(PermissionError);
    await expect(setUserRole(db, nurse.userId, "role-admin")).rejects.toThrow(PermissionError);
    setActiveSession(ADMIN_SESSION);
    await login(db, "admin", ADMIN_PASSWORD);
  });

  it("deactivated accounts cannot sign in, and reactivation restores access", async () => {
    const nurse = await addStaff("nurse.d", "role-nurse");
    await setUserActive(db, nurse.userId, false);
    await expect(login(db, "nurse.d", STAFF_PASSWORD, 1)).rejects.toThrow("Invalid username or password.");
    await setUserActive(db, nurse.userId, true);
    await login(db, "nurse.d", STAFF_PASSWORD, 2);
  });

  it("protects the master admin and the signed-in admin from lockout", async () => {
    await expect(setUserActive(db, MASTER_ADMIN_ID, false)).rejects.toThrow("cannot be deactivated");
    await expect(setUserRole(db, MASTER_ADMIN_ID, "role-nurse")).rejects.toThrow("cannot be changed");
    const second = await addStaff("admin2", "role-admin");
    setActiveSession(second);
    await expect(setUserActive(db, second.userId, false)).rejects.toThrow("your own account");
    await expect(setUserRole(db, second.userId, "role-nurse")).rejects.toThrow("your own role");
    await expect(setUserActive(db, MASTER_ADMIN_ID, false)).rejects.toThrow("cannot be deactivated");
  });

  it("resets and changes passwords", async () => {
    const nurse = await addStaff("nurse.e", "role-nurse");
    await resetUserPassword(db, nurse.userId, "reset-pass-9");
    await expect(login(db, "nurse.e", STAFF_PASSWORD, 1)).rejects.toThrow();
    setActiveSession(await login(db, "nurse.e", "reset-pass-9", 2));
    await expect(changeOwnPassword(db, "not-it", "another-pass-1")).rejects.toThrow("Current password is incorrect.");
    await expect(changeOwnPassword(db, "reset-pass-9", "short")).rejects.toThrow("at least 12");
    await expect(changeOwnPassword(db, "reset-pass-9", "reset-pass-9")).rejects.toThrow("different");
    await changeOwnPassword(db, "reset-pass-9", "another-pass-1");
    expect((await lastAudit("CHANGE_OWN_PASSWORD")).user_id).toBe(nurse.userId);
    await login(db, "nurse.e", "another-pass-1", 3);
  });

  it("lets the admin replace the default password", async () => {
    setActiveSession(await login(db, "admin", ADMIN_PASSWORD));
    await changeOwnPassword(db, ADMIN_PASSWORD, "a-much-longer-passphrase");
    await expect(login(db, "admin", ADMIN_PASSWORD, 10)).rejects.toThrow("Invalid username or password.");
    await login(db, "admin", "a-much-longer-passphrase", 11);
  });
});

describe("permission enforcement", () => {
  it("refuses every write when nobody is signed in", async () => {
    const { c } = await makeCase();
    setActiveSession(null);
    await expect(createPatient(db, { firstName: "No", lastName: "Session" })).rejects.toThrow("Sign in to continue.");
    await expect(saveIntraOrRecord(db, { caseId: c.case_id })).rejects.toThrow("Sign in to continue.");
    await expect(savePostOrRecord(db, { caseId: c.case_id })).rejects.toThrow("Sign in to continue.");
    await expect(completeCase(db, c.case_id)).rejects.toThrow("Sign in to continue.");
    await expect(getAuditHistory(db)).rejects.toThrow("Sign in to continue.");
    await expect(exportClinicalWorkbook(db, { identifiable: false })).rejects.toThrow("Sign in to continue.");
  });

  it("read-only users can change nothing", async () => {
    const { c, patient } = await makeCase();
    const items = await getPreOrChecklist(db, c.case_id);
    setActiveSession(await addStaff("viewer", "role-readonly"));
    await expect(createPatient(db, { firstName: "X", lastName: "Y" })).rejects.toThrow("Read Only");
    await expect(createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-08" })).rejects.toThrow(PermissionError);
    await expect(updateChecklistItem(db, { caseId: c.case_id, checklistItemId: items.items[0].checklist_item_id, status: "COMPLETE" }))
      .rejects.toThrow(PermissionError);
    await expect(saveCaseEvent(db, { caseId: c.case_id, eventType: "ROOM_IN", occurredAt: "2026-10-07T08:00:00Z" })).rejects.toThrow(PermissionError);
    await expect(savePostOrRecord(db, { caseId: c.case_id, painScore: 3 })).rejects.toThrow(PermissionError);
    await expect(addOrRoom(db, "OR 9")).rejects.toThrow(PermissionError);
    await expect(getAuditHistory(db)).rejects.toThrow(PermissionError);
    await expect(exportClinicalWorkbook(db, { identifiable: false })).rejects.toThrow(PermissionError);
    await expect(createManualBackup(db, null)).rejects.toThrow(PermissionError);
  });

  it("nurses document care but cannot schedule, manage master data or export", async () => {
    const { c } = await makeCase();
    await addOrRoom(db, "OR 1");
    const room = (await getOrRooms(db))[0];
    setActiveSession(await addStaff("nurse.f", "role-nurse"));
    await saveIntraOrRecord(db, { caseId: c.case_id, estimatedBloodLossMl: 50 });
    await savePostOrRecord(db, { caseId: c.case_id, painScore: 2 });
    await expect(scheduleCase(db, { caseId: c.case_id, roomId: room.or_room_id, date: "2026-10-08", startTime: "08:00", estimatedDurationMinutes: 60 }))
      .rejects.toThrow("Nurse");
    await expect(saveFacilityProfile(db, { facilityName: "X", departmentName: "Y" })).rejects.toThrow(PermissionError);
    await expect(exportClinicalWorkbook(db, { identifiable: true })).rejects.toThrow(PermissionError);
  });

  it("research users export de-identified data only and cannot touch patients", async () => {
    await makeCase();
    setActiveSession(await addStaff("research.a", "role-research"));
    await expect(createPatient(db, { firstName: "X", lastName: "Y" })).rejects.toThrow(PermissionError);
    await expect(exportClinicalWorkbook(db, { identifiable: true })).rejects.toThrow(PermissionError);
    const book = await exportClinicalWorkbook(db, { identifiable: false });
    expect(book.caseCount).toBe(1);
  });

  it("applies a role change at the next sign-in", async () => {
    const user = await addStaff("mover", "role-readonly");
    await setUserRole(db, user.userId, "role-nurse");
    setActiveSession(await login(db, "mover", STAFF_PASSWORD));
    await createPatient(db, { firstName: "Now", lastName: "Allowed" });
  });
});

describe("read enforcement", () => {
  it("refuses every read when nobody is signed in or the screen is locked", async () => {
    const { c, patient } = await makeCase();
    setActiveSession(null);
    await expect(listPatients(db)).rejects.toThrow("Sign in to continue.");
    await expect(getPatientById(db, patient.patient_id)).rejects.toThrow("Sign in to continue.");
    await expect(getCaseById(db, c.case_id)).rejects.toThrow("Sign in to continue.");
    await expect(searchGlobal(db, "Santos")).rejects.toThrow("Sign in to continue.");
    await expect(getIntraOrRecord(db, c.case_id)).rejects.toThrow("Sign in to continue.");
    await expect(getPreOrChecklist(db, c.case_id)).rejects.toThrow("Sign in to continue.");
    await expect(getScheduleByDate(db, "2026-10-07")).rejects.toThrow("Sign in to continue.");
    await expect(getAnalyticsSummary(db)).rejects.toThrow("Sign in to continue.");
    await expect(answerQuestion(db, "how many cases today", new Map())).rejects.toThrow("Sign in to continue.");
    await expect(getOrRooms(db)).rejects.toThrow("Sign in to continue.");
    await expect(buildClinicalExport(db, { identifiable: false })).rejects.toThrow("Sign in to continue.");
  });

  it("lets read-only users read patient records", async () => {
    const { c, patient } = await makeCase();
    setActiveSession(await addStaff("viewer.r", "role-readonly"));
    expect((await listPatients(db)).total).toBe(1);
    expect((await getPatientById(db, patient.patient_id))?.patient_id).toBe(patient.patient_id);
    expect((await getCaseById(db, c.case_id))?.case_id).toBe(c.case_id);
    await getAnalyticsSummary(db);
    await getOrRooms(db);
    await expect(buildClinicalExport(db, { identifiable: false })).rejects.toThrow(PermissionError);
  });

  it("keeps research users out of patient records but lets them read totals and reference lists", async () => {
    const { c, patient } = await makeCase();
    setActiveSession(await addStaff("research.r", "role-research"));
    await expect(listPatients(db)).rejects.toThrow("Research");
    await expect(getPatientById(db, patient.patient_id)).rejects.toThrow(PermissionError);
    await expect(getCaseById(db, c.case_id)).rejects.toThrow(PermissionError);
    await expect(searchGlobal(db, "Santos")).rejects.toThrow(PermissionError);
    await expect(getIntraOrRecord(db, c.case_id)).rejects.toThrow(PermissionError);
    await expect(getScheduleByDate(db, "2026-10-07")).rejects.toThrow(PermissionError);
    await expect(answerQuestion(db, "how many cases today", new Map())).rejects.toThrow(PermissionError);
    await expect(buildClinicalExport(db, { identifiable: true })).rejects.toThrow(PermissionError);
    await getAnalyticsSummary(db);
    await getOrRooms(db);
  });
});

describe("forced password change", () => {
  const BLOCKED = "Change your password to continue.";

  it("forces a change for an account that still uses a password published in this repository", async () => {
    expect(MIGRATIONS.find((m) => m.version === 20)?.sql).toBe(M020_REVOKE_PUBLIC_ADMIN_PASSWORD);
    const session = await login(db, "admin", ADMIN_PASSWORD);
    expect(session.mustChangePassword).toBe(true);
    setActiveSession(session);
    await expect(listPatients(db)).rejects.toThrow(BLOCKED);
  });

  it("blocks any account flagged with must_change_password until replaced", async () => {
    await db.execute("UPDATE users SET must_change_password = 1 WHERE user_id = ?", [MASTER_ADMIN_ID]);
    const session = await login(db, "admin", ADMIN_PASSWORD);
    expect(session.mustChangePassword).toBe(true);
    setActiveSession(session);
    await expect(listPatients(db)).rejects.toThrow(BLOCKED);
    await expect(createPatient(db, { firstName: "X", lastName: "Y" })).rejects.toThrow(BLOCKED);
    await expect(listUsers(db)).rejects.toThrow(BLOCKED);
    await expect(getOrRooms(db)).rejects.toThrow(BLOCKED);
    await expect(exportClinicalWorkbook(db, { identifiable: true })).rejects.toThrow(BLOCKED);

    await expect(changeOwnPassword(db, ADMIN_PASSWORD, ADMIN_PASSWORD)).rejects.toThrow("different");
    await expect(listUsers(db)).rejects.toThrow(BLOCKED);

    await changeOwnPassword(db, ADMIN_PASSWORD, "a-much-longer-passphrase");
    await listUsers(db);
    await createPatient(db, { firstName: "Now", lastName: "Allowed" });
    expect((await login(db, "admin", "a-much-longer-passphrase")).mustChangePassword).toBe(false);
  });

  it("leaves an administrator password that was already changed alone", async () => {
    await db.execute("UPDATE users SET password_hash = 'changed-earlier', must_change_password = 0 WHERE user_id = ?", [MASTER_ADMIN_ID]);
    await db.execute("DELETE FROM schema_migrations WHERE version = 13");
    await runMigrations(db);
    const rows = await db.select<{ must_change_password: number; password_hash: string }>(
      "SELECT must_change_password, password_hash FROM users WHERE user_id = ?", [MASTER_ADMIN_ID]);
    expect(rows[0].must_change_password).toBe(0);
    expect(rows[0].password_hash).toBe("changed-earlier");
  });

  it("makes new staff replace the password the admin chose, and again after a reset", async () => {
    const id = await createUser(db, { username: "nurse.new", fullName: "New Nurse", roleId: "role-nurse", password: STAFF_PASSWORD });
    const first = await login(db, "nurse.new", STAFF_PASSWORD);
    expect(first.mustChangePassword).toBe(true);
    setActiveSession(first);
    await expect(listPatients(db)).rejects.toThrow(BLOCKED);
    await changeOwnPassword(db, STAFF_PASSWORD, "my-own-pass-1");
    await listPatients(db);
    expect((await unlockSession(db, first, "my-own-pass-1")).mustChangePassword).toBe(false);

    setActiveSession(ADMIN_SESSION);
    await resetUserPassword(db, id, "reset-pass-9");
    expect((await login(db, "nurse.new", "reset-pass-9")).mustChangePassword).toBe(true);
  });
});

describe("audit attribution", () => {
  it("records the signed-in user, not the id a caller passes in", async () => {
    const nurse = await addStaff("nurse.g", "role-nurse");
    setActiveSession(nurse);
    const patient = await createPatient(db, { firstName: "Ana", lastName: "Reyes", userId: MASTER_ADMIN_ID } as any);
    const admission = await createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-07", userId: "someone-else" } as any);
    const c = await createSurgicalCase(db, { patientId: patient.patient_id, admissionId: admission.admission_id, plannedProcedureSummary: "Hernia repair" });
    await saveCaseEvent(db, { caseId: c.case_id, eventType: "ROOM_IN", occurredAt: "2026-10-07T08:00:00Z", userId: MASTER_ADMIN_ID });
    await saveIntraOrRecord(db, { caseId: c.case_id, estimatedBloodLossMl: 20, userId: null });

    const rows = await db.select<{ user_id: string | null; action: string }>(
      "SELECT user_id, action FROM audit_log WHERE patient_id = ?", [patient.patient_id]);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.filter((r) => r.user_id !== nurse.userId)).toEqual([]);

    const recorded = await db.select<{ recorded_by: string }>("SELECT recorded_by FROM case_events WHERE case_id = ?", [c.case_id]);
    expect(recorded[0].recorded_by).toBe(nurse.userId);
  });

  it("shows names in the audit log to those allowed to read it", async () => {
    const nurse = await addStaff("nurse.h", "role-nurse");
    setActiveSession(nurse);
    await createPatient(db, { firstName: "Log", lastName: "Entry" });
    setActiveSession(ADMIN_SESSION);
    const mine = await getAuditHistory(db, { userId: nurse.userId });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.username === "nurse.h" && e.user_full_name === "Staff nurse.h")).toBe(true);
    expect(await getAuditHistory(db, { limit: 2 })).toHaveLength(2);
    const all = await getAuditHistory(db, { limit: 1000 });
    const page2 = await getAuditHistory(db, { limit: 2, offset: 2 });
    expect(page2.map((e) => e.audit_id)).toEqual(all.slice(2, 4).map((e) => e.audit_id));
  });
});

describe("master data", () => {
  it("adds rooms and specialties, refusing blanks and duplicates", async () => {
    await addOrRoom(db, "  OR 1 ");
    await addSpecialty(db, "Urology");
    expect((await getOrRooms(db)).map((r) => r.name)).toEqual(["OR 1"]);
    await expect(addOrRoom(db, "or 1")).rejects.toThrow();
    await expect(addOrRoom(db, "   ")).rejects.toThrow();
    await expect(addSpecialty(db, "UROLOGY")).rejects.toThrow();
    expect((await lastAudit("ADD_SPECIALTY")).user_id).toBe(MASTER_ADMIN_ID);
  });

  it("saves the facility profile", async () => {
    await saveFacilityProfile(db, { facilityName: " General Hospital ", departmentName: "Surgery" });
    const rows = await db.select<{ value: string }>("SELECT value FROM app_settings WHERE key = 'facility_name'");
    expect(rows[0].value).toBe("General Hospital");
    await expect(saveFacilityProfile(db, { facilityName: "", departmentName: "Surgery" })).rejects.toThrow();
  });
});

describe("F1-F5 clinical rules", () => {
  it("validates and stores the pre-op baseline under the assessor's name", async () => {
    const { c } = await makeCase();
    const base = {
      caseId: c.case_id, height_cm: 160, weight_kg: 60, measured_at: "2026-10-07", asa_classification: "II",
      tobacco_status: "NEVER" as const, functional_status: "INDEPENDENT" as const, notes: " fit ",
    };
    await expect(savePreopBaseline(db, { ...base, height_cm: 300 })).rejects.toThrow("Height");
    await expect(savePreopBaseline(db, { ...base, weight_kg: 0 })).rejects.toThrow("Weight");
    await expect(savePreopBaseline(db, { ...base, measured_at: null })).rejects.toThrow("Measurement date");
    await savePreopBaseline(db, base);
    await savePreopBaseline(db, { ...base, weight_kg: 62 });
    const saved = await getPreopBaseline(db, c.case_id);
    expect(saved).toMatchObject({ height_cm: 160, weight_kg: 62, notes: "fit", assessed_by: MASTER_ADMIN_ID });
  });

  it("stores dialysis type, access, years on dialysis and donor relation", async () => {
    const { c } = await makeCase();
    const base = {
      caseId: c.case_id, height_cm: null, weight_kg: null, measured_at: null, asa_classification: null,
      tobacco_status: null, functional_status: null, notes: null,
    };
    await expect(savePreopBaseline(db, { ...base, dialysis_modality: "HEMODIALYSIS", dialysis_years: 61 }))
      .rejects.toThrow("Years on dialysis");
    await expect(savePreopBaseline(db, { ...base, dialysis_modality: "HEMODIALYSIS", dialysis_years: -1 }))
      .rejects.toThrow("Years on dialysis");
    await expect(savePreopBaseline(db, { ...base, dialysis_modality: "NONE", dialysis_access: "AV_FISTULA" }))
      .rejects.toThrow("dialysis type");
    await savePreopBaseline(db, {
      ...base, dialysis_modality: "HEMODIALYSIS", dialysis_access: "AV_FISTULA", dialysis_years: 3.5, donor_relation: "RELATED",
    });
    expect(await getPreopBaseline(db, c.case_id)).toMatchObject({
      dialysis_modality: "HEMODIALYSIS", dialysis_access: "AV_FISTULA", dialysis_years: 3.5, donor_relation: "RELATED",
    });
    await savePreopBaseline(db, { ...base, dialysis_modality: "NONE", donor_relation: "NON_RELATED" });
    expect(await getPreopBaseline(db, c.case_id)).toMatchObject({
      dialysis_modality: "NONE", dialysis_access: null, dialysis_years: null, donor_relation: "NON_RELATED",
    });
  });

  it("stores a donor type of relation that matches the related or non-related choice", async () => {
    const { c } = await makeCase();
    const base = {
      caseId: c.case_id, height_cm: null, weight_kg: null, measured_at: null, asa_classification: null,
      tobacco_status: null, functional_status: null, notes: null,
    };
    const types = await getDonorRelationshipTypes(db);
    expect(types.find((t) => t.relationship_type_id === "drt-sister")?.donor_relation).toBe("RELATED");
    expect(types.find((t) => t.relationship_type_id === "drt-spouse")?.donor_relation).toBe("NON_RELATED");
    await expect(savePreopBaseline(db, { ...base, donor_relation: "NON_RELATED", donor_relationship_type_id: "drt-sister" }))
      .rejects.toThrow("does not match");
    await expect(savePreopBaseline(db, { ...base, donor_relationship_type_id: "drt-sister" }))
      .rejects.toThrow("before the type of relation");
    await expect(savePreopBaseline(db, { ...base, donor_relation: "RELATED", donor_relationship_type_id: "missing" }))
      .rejects.toThrow("not found");
    await savePreopBaseline(db, { ...base, donor_relation: "RELATED", donor_relationship_type_id: "drt-sister" });
    expect(await getPreopBaseline(db, c.case_id)).toMatchObject({ donor_relationship_type_id: "drt-sister" });

    const id = await addDonorRelationshipType(db, " Step-sibling ", "RELATED");
    await expect(addDonorRelationshipType(db, "step-SIBLING", "RELATED")).rejects.toThrow("already exists");
    await setDonorRelationshipTypeActive(db, id, false);
    expect((await getDonorRelationshipTypes(db)).some((t) => t.relationship_type_id === id)).toBe(false);
    expect((await getDonorRelationshipTypes(db, false)).find((t) => t.relationship_type_id === id)?.name).toBe("Step-sibling");
  });

  it("requires a note for a failed safety check and tracks phase completion", async () => {
    const { c } = await makeCase();
    const other = await makeCase("Other", "Patient", "HRN-78");
    const items = await getSafetyItems(db, c.case_id);
    expect(items.length).toBeGreaterThan(0);
    const signIn = items.filter((i) => i.phase === "SIGN_IN");
    await expect(saveSafetyResponse(db, { caseId: c.case_id, itemId: signIn[0].item_id, status: "FAILED" })).rejects.toThrow("Describe");
    await expect(saveSafetyResponse(db, { caseId: c.case_id, itemId: "no-such-item", status: "COMPLETE" })).rejects.toThrow("does not belong");
    expect(phaseComplete(items, "SIGN_IN")).toBe(false);
    for (const item of signIn) await saveSafetyResponse(db, { caseId: c.case_id, itemId: item.item_id, status: "COMPLETE" });
    const after = await getSafetyItems(db, c.case_id);
    expect(phaseComplete(after, "SIGN_IN")).toBe(true);
    expect(phaseComplete(after, "TIME_OUT")).toBe(false);
    expect(after.find((i) => i.item_id === signIn[0].item_id)?.recorded_by).toBe(MASTER_ADMIN_ID);
    expect(phaseComplete(await getSafetyItems(db, other.c.case_id), "SIGN_IN")).toBe(false);
  });

  it("keeps case events in order and demands a reason for corrections", async () => {
    const { c } = await makeCase();
    const save = (eventType: any, occurredAt: string, correctionReason?: string) =>
      saveCaseEvent(db, { caseId: c.case_id, eventType, occurredAt, correctionReason });
    await expect(save("ROOM_IN", "2026-10-07 08:00")).rejects.toThrow("time zone");
    await save("ROOM_IN", "2026-10-07T08:00:00Z");
    await save("INCISION", "2026-10-07T08:30:00Z");
    await expect(save("CLOSURE", "2026-10-07T08:10:00Z")).rejects.toThrow("CLOSURE cannot occur before INCISION");
    await expect(save("ANESTHESIA_START", "2026-10-07T07:50:00Z")).rejects.toThrow("cannot precede room entry");
    await expect(save("ANESTHESIA_START", "2026-10-07T08:40:00Z")).rejects.toThrow("cannot follow incision");
    await expect(save("INCISION", "2026-10-07T08:35:00Z")).rejects.toThrow("reason is required");
    await save("INCISION", "2026-10-07T08:35:00Z", "Charted late");
    const events = await getCaseEvents(db, c.case_id);
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.event_type === "INCISION")).toMatchObject({ occurred_at: "2026-10-07T08:35:00Z", correction_reason: "Charted late" });
    expect((await lastAudit("CORRECT_CASE_EVENT")).user_id).toBe(MASTER_ADMIN_ID);
  });
});

/** In-memory stand-in for the desktop shell's backup folder. */
const RECOVERY_KEY = "0A1B2C3D-0A1B2C3D-0A1B2C3D-0A1B2C3D-0A1B2C3D-0A1B2C3D-0A1B2C3D-0A1B2C3D";

function fakeBackups(source: Db) {
  const files = new Map<string, BackupFile>();
  const copies: string[] = [];
  const restored: [string, string][] = [];
  const keysUsed: (string | undefined)[] = [];
  let failCopy = false;
  const fakeDb: Db = {
    ...source,
    backupDir: "C:\\Backups",
    backupTo: async (path: string) => {
      const name = path.split("\\").pop()!;
      files.set(name, { name, size: 2048, modified: files.size });
      return true;
    },
  };
  const host: BackupHost = {
    list: async () => [...files.values()],
    remove: async (name) => {
      if (!name.startsWith("OR-AutoBackup-")) throw new Error("refused");
      files.delete(name);
    },
    copyTo: async (name, folder) => {
      if (failCopy) throw new Error("drive not found");
      copies.push(`${folder}\\${name}`);
    },
    recoveryKey: async () => RECOVERY_KEY,
    restore: async (name, safetyName, recoveryKey) => {
      if (!files.has(name)) throw new Error("Backup file not found.");
      keysUsed.push(recoveryKey);
      files.set(safetyName, { name: safetyName, size: 2048, modified: 9_999 });
      restored.push([name, safetyName]);
    },
  };
  return { fakeDb, host, files, copies, restored, keysUsed, setFailCopy: (v: boolean) => { failCopy = v; } };
}

describe("backups", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, n, 6, 0, 0));

  it("is on by default: daily, keeping 14", async () => {
    expect(await getBackupSettings(db)).toEqual({ enabled: true, intervalHours: 24, keep: 14, mirrorDir: "", lastAutoBackup: null });
  });

  it("decides when an automatic backup is due", () => {
    const base = { enabled: true, intervalHours: 24, keep: 14, mirrorDir: "", lastAutoBackup: day(1).toISOString() };
    expect(isAutoBackupDue({ ...base, lastAutoBackup: null }, day(1))).toBe(true);
    expect(isAutoBackupDue(base, new Date(day(2).getTime() - 1))).toBe(false);
    expect(isAutoBackupDue(base, day(2))).toBe(true);
    expect(isAutoBackupDue({ ...base, lastAutoBackup: "garbage" }, day(1))).toBe(true);
    expect(isAutoBackupDue({ ...base, enabled: false, lastAutoBackup: null }, day(9))).toBe(false);
  });

  it("does nothing where file backups are unavailable", async () => {
    expect((await runScheduledBackup(db, null)).status).toBe("unsupported");
    await expect(createManualBackup(db, null)).rejects.toThrow("desktop app");
  });

  it("runs on schedule without anyone signed in, and prunes only old automatic backups", async () => {
    const { fakeDb, host, files } = fakeBackups(db);
    await saveBackupSettings(db, { enabled: true, intervalHours: 24, keep: 3, mirrorDir: "" });
    const manual = await createManualBackup(fakeDb, host, day(1));
    setActiveSession(null);

    expect((await runScheduledBackup(fakeDb, host, day(1))).status).toBe("done");
    expect((await runScheduledBackup(fakeDb, host, new Date(day(1).getTime() + 3_600_000))).status).toBe("not_due");
    for (let d = 2; d <= 5; d++) {
      const result = await runScheduledBackup(fakeDb, host, day(d));
      expect(result).toMatchObject({ status: "done", pruned: d >= 4 ? 1 : 0 });
    }
    const names = [...files.keys()];
    expect(names.filter((n) => n.startsWith("OR-AutoBackup-")).sort()).toEqual([
      "OR-AutoBackup-2026-10-03T06-00-00-000Z.db",
      "OR-AutoBackup-2026-10-04T06-00-00-000Z.db",
      "OR-AutoBackup-2026-10-05T06-00-00-000Z.db",
    ]);
    expect(names).toContain(manual.name);
    expect((await getBackupSettings(db)).lastAutoBackup).toBe(day(5).toISOString());
    expect((await lastAudit("BACKUP_AUTO")).user_id).toBeNull();
  });

  it("skips automatic backups when switched off", async () => {
    const { fakeDb, host, files } = fakeBackups(db);
    await saveBackupSettings(db, { enabled: false, intervalHours: 24, keep: 14, mirrorDir: "" });
    expect((await runScheduledBackup(fakeDb, host, day(1))).status).toBe("not_due");
    expect(files.size).toBe(0);
  });

  it("copies to a second folder and reports, without failing, when that folder is missing", async () => {
    const { fakeDb, host, files, copies, setFailCopy } = fakeBackups(db);
    await saveBackupSettings(db, { enabled: true, intervalHours: 24, keep: 14, mirrorDir: " E:\\OR-Backups " });
    const ok = await createManualBackup(fakeDb, host, day(1));
    expect(ok.mirrorError).toBeNull();
    expect(copies).toEqual([`E:\\OR-Backups\\${ok.name}`]);
    setFailCopy(true);
    const result = await runScheduledBackup(fakeDb, host, day(2));
    expect(result.status).toBe("done");
    expect(result.mirrorError).toContain("drive not found");
    expect(files.has(result.name!)).toBe(true);
  });

  it("validates the schedule and needs the backup permission", async () => {
    await expect(saveBackupSettings(db, { enabled: true, intervalHours: 0, keep: 14, mirrorDir: "" })).rejects.toThrow("1 to 168");
    await expect(saveBackupSettings(db, { enabled: true, intervalHours: 24, keep: 0, mirrorDir: "" })).rejects.toThrow("1 and 365");
    setActiveSession(await addStaff("nurse.i", "role-nurse"));
    await expect(saveBackupSettings(db, { enabled: false, intervalHours: 24, keep: 14, mirrorDir: "" })).rejects.toThrow(PermissionError);
    const { host } = fakeBackups(db);
    await expect(listBackups(host)).rejects.toThrow(PermissionError);
  });

  it("restores a backup after saving the current data, and signs everyone out", async () => {
    const { fakeDb, host, files, restored } = fakeBackups(db);
    const backup = await createManualBackup(fakeDb, host, day(1));
    const safety = await restoreBackup(fakeDb, host, backup.name, day(2));
    expect(safety).toBe("OR-PreRestore-2026-10-02T06-00-00-000Z.db");
    expect(restored).toEqual([[backup.name, safety]]);
    expect(files.has(safety)).toBe(true);
    expect((await lastAudit("RESTORE_COMPLETED")).user_id).toBe(MASTER_ADMIN_ID);
    await expect(createPatient(db, { firstName: "After", lastName: "Restore" })).rejects.toThrow("Sign in to continue.");
  });

  it("only administrators restore, and a missing file changes nothing", async () => {
    const { fakeDb, host, restored } = fakeBackups(db);
    await expect(restoreBackup(fakeDb, host, "OR-ManualBackup-missing.db")).rejects.toThrow("not found");
    await expect(restoreBackup(db, host, "x.db")).rejects.toThrow("desktop app");
    setActiveSession(await addStaff("super.a", "role-supervisor"));
    const backup = await createManualBackup(fakeDb, host, day(1));
    await expect(restoreBackup(fakeDb, host, backup.name)).rejects.toThrow(PermissionError);
    expect(restored).toEqual([]);
    expect((await listBackups(host)).map((f) => f.name)).toEqual([backup.name]);
  });

  it("shows the recovery key to administrators only, and records who looked without recording the key", async () => {
    const { fakeDb, host } = fakeBackups(db);
    expect(await getRecoveryKey(fakeDb, host)).toBe(RECOVERY_KEY);
    expect((await lastAudit("VIEW_RECOVERY_KEY")).user_id).toBe(MASTER_ADMIN_ID);
    await expect(getRecoveryKey(db, host)).rejects.toThrow("desktop app");

    setActiveSession(await addStaff("super.k", "role-supervisor"));
    await expect(getRecoveryKey(fakeDb, host)).rejects.toThrow(PermissionError);
    setActiveSession(null);
    await expect(getRecoveryKey(fakeDb, host)).rejects.toThrow("Sign in to continue.");

    const logged = await db.select<Record<string, unknown>>("SELECT * FROM audit_log");
    expect(JSON.stringify(logged)).not.toContain("0A1B2C3D");
  });

  it("passes the recovery key of another PC to the restore, and keeps it out of the audit log", async () => {
    const { fakeDb, host, keysUsed } = fakeBackups(db);
    const backup = await createManualBackup(fakeDb, host, day(1));
    await restoreBackup(fakeDb, host, backup.name, day(2), ` ${RECOVERY_KEY} `);
    setActiveSession(ADMIN_SESSION);
    await restoreBackup(fakeDb, host, backup.name, day(3), "  ");
    expect(keysUsed).toEqual([RECOVERY_KEY, undefined]);
    const logged = await db.select<Record<string, unknown>>("SELECT * FROM audit_log");
    expect(JSON.stringify(logged)).not.toContain("0A1B2C3D");
  });
});

function readWorkbook(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const text = (name: string) => strFromU8(files[name]);
  const names = [...text("xl/workbook.xml").matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  const sheets = new Map(names.map((name, i) => [name, text(`xl/worksheets/sheet${i + 1}.xml`)]));
  return { files, names, sheets, all: Object.keys(files).filter((n) => n.includes("sheet")).map(text).join("") };
}

describe("xlsx writer", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("writes a workbook with every required part", () => {
    const book = readWorkbook(buildXlsx([{ name: "One", rows: [["H1", "H2"], ["a", 5]] }, { name: "Two", rows: [["X"]] }]));
    expect(Object.keys(book.files).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]);
    expect(book.names).toEqual(["One", "Two"]);
    const one = book.sheets.get("One")!;
    expect(one).toContain(`<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">H1</t></is></c>`);
    expect(one).toContain(`<c r="B2"><v>5</v></c>`);
    expect(one).toContain(`state="frozen"`);
  });

  it("keeps formulas as text, escapes markup and skips blanks", () => {
    const book = readWorkbook(buildXlsx([{
      name: "S", rows: [["Note"], ["=HYPERLINK(\"http://x\",\"y\")"], ["<b>&\u0001</b>"], [null], [""], [Number.NaN]],
    }]));
    const xml = book.sheets.get("S")!;
    expect(xml).not.toContain("<f>");
    expect(xml).toContain(`t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;,&quot;y&quot;)</t>`);
    expect(xml).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(xml).toContain(`<row r="4"></row><row r="5"></row>`);
    expect(xml).toContain(`<c r="A6" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>`);
  });

  it("makes sheet names legal and unique", () => {
    const book = readWorkbook(buildXlsx([
      { name: "Pre/Op: [1]", rows: [["a"]] }, { name: "pre op   1", rows: [["a"]] },
      { name: "x".repeat(40), rows: [["a"]] }, { name: "  ", rows: [["a"]] },
    ]));
    expect(book.names[0]).toBe("Pre Op   1");
    expect(book.names[1]).toBe("pre op   1 2");
    expect(book.names[2]).toHaveLength(31);
    expect(book.names[3]).toBe("Sheet");
    expect(() => buildXlsx([])).toThrow("at least one sheet");
  });
});

describe("Excel export", () => {
  async function seedFullCase() {
    const { patient, c } = await makeCase();
    await addOrRoom(db, "OR 1");
    const room = (await getOrRooms(db))[0];
    await scheduleCase(db, { caseId: c.case_id, roomId: room.or_room_id, date: "2026-10-08", startTime: "08:00", estimatedDurationMinutes: 90 });
    await savePreopBaseline(db, {
      caseId: c.case_id, height_cm: 160, weight_kg: 60, measured_at: "2026-10-07", asa_classification: "II",
      tobacco_status: "NEVER", functional_status: "INDEPENDENT", notes: "PREOP-SECRET-NOTE",
    });
    await saveCaseEvent(db, { caseId: c.case_id, eventType: "ROOM_IN", occurredAt: "2026-10-08T08:00:00Z" });
    await saveCaseEvent(db, { caseId: c.case_id, eventType: "INCISION", occurredAt: "2026-10-08T08:20:00Z" });
    await saveIntraOrRecord(db, { caseId: c.case_id, estimatedBloodLossMl: 150, bloodTransfusion: false, operativeNotes: "=cmd|INTRAOP-SECRET-NOTE" });
    await savePostOrRecord(db, { caseId: c.case_id, painScore: 4, icuRequired: true, notes: "POSTOP-SECRET-NOTE" });
    const types = await db.select<{ complication_type_id: string }>("SELECT complication_type_id FROM complication_types LIMIT 1");
    if (types[0]) {
      await addComplication(db, { caseId: c.case_id, complicationTypeId: types[0].complication_type_id, severity: "MINOR", description: "COMP-SECRET-NOTE" });
    }
    return { patient, c };
  }

  const headers = (sheet: { rows: unknown[][] }) => sheet.rows[0] as string[];
  const valueOf = (sheet: { rows: unknown[][] }, header: string, row = 1) => sheet.rows[row][headers(sheet).indexOf(header)];

  it("exports pre-op, intra-op and post-op sheets with one row per case", async () => {
    const { c } = await seedFullCase();
    await makeCase("Second", "Person", "HRN-88");
    const { sheets, caseCount } = await buildClinicalExport(db, { identifiable: true });
    expect(caseCount).toBe(2);
    expect(sheets.map((s) => s.name)).toEqual(["Pre-Op", "Intra-Op", "Post-Op", "Complications", "Follow-up Outcomes"]);
    const [pre, intra, post] = sheets;
    for (const sheet of [pre, intra, post]) {
      expect(sheet.rows).toHaveLength(3);
      expect(headers(sheet).slice(0, 2)).toEqual(["Case Ref", "Research ID"]);
      expect(new Set(headers(sheet)).size).toBe(headers(sheet).length);
      for (const row of sheet.rows) expect(row).toHaveLength(headers(sheet).length);
    }
    const flat = (sheet: { rows: unknown[][] }) => sheet.rows.flat().map(String);
    expect(flat(pre)).toEqual(expect.arrayContaining(["Maria", "Santos", "HRN-77", "1980-05-10", c.case_number, "Appendectomy", "PREOP-SECRET-NOTE"]));
    expect(flat(pre)).toEqual(expect.arrayContaining(["160", "60", "II"]));
    expect(flat(intra)).toEqual(expect.arrayContaining(["150", "2026-10-08T08:20:00Z", "=cmd|INTRAOP-SECRET-NOTE"]));
    expect(flat(post)).toEqual(expect.arrayContaining(["4", "POSTOP-SECRET-NOTE"]));
    expect(valueOf(pre, "Case Ref")).toBe(valueOf(intra, "Case Ref"));
    expect(valueOf(pre, "Case Ref")).toBe(valueOf(post, "Case Ref"));
  });

  it("leaves identities and free text out of a de-identified export", async () => {
    const { c } = await seedFullCase();
    const book = await exportClinicalWorkbook(db, { identifiable: false }, new Date("2026-10-09T01:02:03Z"));
    expect(book.filename).toBe("OR-Export-Deidentified-2026-10-09-01-02-03.xlsx");
    const text = readWorkbook(book.bytes).all;
    for (const secret of ["Maria", "Santos", "HRN-77", "1980-05-10", c.case_number, "SECRET-NOTE", "Case Number", "Date of Birth"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("Research ID");
    expect(text).toContain("C00001");
    expect((await lastAudit("EXPORT_DEIDENTIFIED")).user_id).toBe(MASTER_ADMIN_ID);
  });

  it("writes an identifiable workbook that Excel cannot run formulas from", async () => {
    await seedFullCase();
    const book = await exportClinicalWorkbook(db, { identifiable: true });
    expect(book.filename).toMatch(/^OR-Export-Identifiable-.*\.xlsx$/);
    expect(book.caseCount).toBe(1);
    const parsed = readWorkbook(book.bytes);
    expect(parsed.names).toEqual(["Pre-Op", "Intra-Op", "Post-Op", "Complications", "Follow-up Outcomes"]);
    expect(parsed.all).toContain("Santos");
    expect(parsed.all).toContain("=cmd|INTRAOP-SECRET-NOTE");
    expect(parsed.all).not.toContain("<f>");
    expect((await lastAudit("EXPORT_IDENTIFIABLE")).user_id).toBe(MASTER_ADMIN_ID);
  });

  it("filters by surgery date and rejects bad ranges", async () => {
    await seedFullCase();
    expect((await buildClinicalExport(db, { identifiable: false, from: "2026-10-08", to: "2026-10-08" })).caseCount).toBe(1);
    expect((await buildClinicalExport(db, { identifiable: false, from: "2026-10-09" })).caseCount).toBe(0);
    expect((await buildClinicalExport(db, { identifiable: false, to: "2026-10-07" })).caseCount).toBe(0);
    await expect(buildClinicalExport(db, { identifiable: false, from: "08/10/2026" })).rejects.toThrow("YYYY-MM-DD");
    await expect(buildClinicalExport(db, { identifiable: false, from: "2026-10-09", to: "2026-10-01" })).rejects.toThrow("after the end date");
    const empty = await exportClinicalWorkbook(db, { identifiable: false, from: "2030-01-01" });
    expect(readWorkbook(empty.bytes).names).toHaveLength(5);
  });
});
