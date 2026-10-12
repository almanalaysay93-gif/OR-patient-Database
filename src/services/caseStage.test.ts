import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { ADMIN_SESSION } from "../test/setup";
import { setActiveSession, PermissionError, type UserSession } from "./session";
import { login } from "./auth";
import { createUser } from "./userAdmin";
import {
  createAdmission, createPatient, createSurgicalCase, getCaseById, getPatientById, listPatients, searchGlobal, updatePatient,
} from "./patients";
import { addOrRoom, getOrRooms } from "./masterData";
import { checkSchedulingConflicts, scheduleCase } from "./scheduling";
import { cancelCase, moveCaseStage, postponeCase } from "./caseStage";
import { archivePatient, listArchivedPatients, restorePatient } from "./patientArchive";

const STAFF_PASSWORD = "nurse-pass-1";

let db: Db;

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
});

async function addStaff(username: string, roleId: string): Promise<UserSession> {
  await createUser(db, { username, fullName: `Staff ${username}`, roleId, password: STAFF_PASSWORD });
  await db.execute("UPDATE users SET must_change_password = 0 WHERE username = ?", [username]);
  return login(db, username, STAFF_PASSWORD);
}

async function makeCase(hrn = "HRN-77") {
  const patient = await createPatient(db, { firstName: "Maria", lastName: "Santos", hrn, dateOfBirth: "1980-05-10", sex: "FEMALE" });
  const admission = await createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-07" });
  const c = await createSurgicalCase(db, {
    patientId: patient.patient_id, admissionId: admission.admission_id, plannedProcedureSummary: "Appendectomy",
  });
  return { patient, c };
}

async function book(caseId: string) {
  if ((await getOrRooms(db)).length === 0) await addOrRoom(db, "OR 1");
  const room = (await getOrRooms(db))[0];
  const slot = { caseId, roomId: room.or_room_id, date: "2026-10-12", startTime: "08:00", estimatedDurationMinutes: 60 };
  const res = await scheduleCase(db, slot);
  expect(res.conflicts).toEqual([]);
  return { room, slot };
}

const status = async (caseId: string) => (await getCaseById(db, caseId))!.case_status;
const slotStatus = async (caseId: string) =>
  (await db.select<{ schedule_status: string }>("SELECT schedule_status FROM or_schedule WHERE case_id = ?", [caseId]))[0]?.schedule_status;
const lastAudit = async (action: string) =>
  (await db.select<{ user_id: string | null; old_value: string | null; new_value: string | null }>(
    "SELECT user_id, old_value, new_value FROM audit_log WHERE action = ? ORDER BY rowid DESC LIMIT 1", [action]))[0];

describe("cancel and postpone a case", () => {
  it("cancels a booked case, frees the room and records who and why", async () => {
    const { c } = await makeCase();
    const { room, slot } = await book(c.case_id);
    const nurse = await addStaff("nurse1", "role-nurse");
    setActiveSession(nurse);

    await cancelCase(db, c.case_id, "Patient has a fever");

    expect(await status(c.case_id)).toBe("CANCELLED");
    expect(await slotStatus(c.case_id)).toBe("CANCELLED");
    expect((await getCaseById(db, c.case_id))!.status_reason).toBe("Patient has a fever");
    const audit = await lastAudit("CANCEL_CASE");
    expect(audit.user_id).toBe(nurse.userId);
    expect(audit.old_value).toBe("SCHEDULED");
    expect(JSON.parse(audit.new_value!)).toEqual({ status: "CANCELLED", reason: "Patient has a fever" });

    setActiveSession(ADMIN_SESSION);
    const other = await makeCase("HRN-78");
    expect(await checkSchedulingConflicts(db, {
      caseId: other.c.case_id, roomId: room.or_room_id, date: slot.date, startTime: slot.startTime, durationMinutes: 60,
    })).toEqual([]);
  });

  it("needs a reason and refuses cases that are finished or already cancelled", async () => {
    const { c } = await makeCase();
    await expect(cancelCase(db, c.case_id, "  ")).rejects.toThrow("Enter a reason");
    await expect(postponeCase(db, c.case_id, "no")).rejects.toThrow("Enter a reason");
    expect(await status(c.case_id)).toBe("PRE_OR");

    await cancelCase(db, c.case_id, "Duplicate entry");
    await expect(cancelCase(db, c.case_id, "Again please")).rejects.toThrow("already cancelled");
    await expect(postponeCase(db, c.case_id, "Too late")).rejects.toThrow("has not started");

    const done = await makeCase("HRN-79");
    await moveCaseStage(db, done.c.case_id, "COMPLETED", "Entered after the fact");
    await expect(cancelCase(db, done.c.case_id, "Wrong case")).rejects.toThrow("completed case cannot be cancelled");
  });

  it("postpones a booked case and lets it be rebooked after it is moved back to Pre-Op", async () => {
    const { c } = await makeCase();
    await book(c.case_id);
    await postponeCase(db, c.case_id, "No ICU bed available");
    expect(await status(c.case_id)).toBe("POSTPONED");
    expect(await slotStatus(c.case_id)).toBe("POSTPONED");
    expect((await lastAudit("POSTPONE_CASE")).old_value).toBe("SCHEDULED");

    await expect(moveCaseStage(db, c.case_id, "SCHEDULED", "Bed is free now")).rejects.toThrow("no OR booking");
    await moveCaseStage(db, c.case_id, "PRE_OR", "Bed is free now");
    await book(c.case_id);
    expect(await status(c.case_id)).toBe("SCHEDULED");
    expect(await slotStatus(c.case_id)).toBe("SCHEDULED");
  });

  it("read-only and research users cannot cancel or postpone", async () => {
    const { c } = await makeCase();
    for (const role of ["role-readonly", "role-research"]) {
      setActiveSession(ADMIN_SESSION);
      setActiveSession(await addStaff(`u-${role}`, role));
      await expect(cancelCase(db, c.case_id, "Not allowed")).rejects.toBeInstanceOf(PermissionError);
      await expect(postponeCase(db, c.case_id, "Not allowed")).rejects.toBeInstanceOf(PermissionError);
    }
    setActiveSession(ADMIN_SESSION);
    expect(await status(c.case_id)).toBe("PRE_OR");
  });
});

describe("move a case between stages by hand", () => {
  it("lets a supervisor move a case forwards and backwards and keeps the booking in step", async () => {
    const { c } = await makeCase();
    await book(c.case_id);
    const supervisor = await addStaff("sup1", "role-supervisor");
    setActiveSession(supervisor);

    await moveCaseStage(db, c.case_id, "IN_OR", "Started without tapping start");
    expect(await status(c.case_id)).toBe("IN_OR");
    expect(await slotStatus(c.case_id)).toBe("IN_PROGRESS");

    await moveCaseStage(db, c.case_id, "COMPLETED", "Paper record was completed");
    expect(await slotStatus(c.case_id)).toBe("COMPLETED");

    await moveCaseStage(db, c.case_id, "PACU", "Completed by mistake");
    expect(await status(c.case_id)).toBe("PACU");
    expect(await slotStatus(c.case_id)).toBe("IN_PROGRESS");

    await moveCaseStage(db, c.case_id, "SCHEDULED", "Wrong patient was opened");
    expect(await status(c.case_id)).toBe("SCHEDULED");
    expect(await slotStatus(c.case_id)).toBe("SCHEDULED");

    const audit = await lastAudit("MOVE_CASE_STAGE");
    expect(audit.user_id).toBe(supervisor.userId);
    expect(audit.old_value).toBe("PACU");
    expect(JSON.parse(audit.new_value!)).toEqual({ status: "SCHEDULED", reason: "Wrong patient was opened" });
  });

  it("reopens a cancelled case but does not bring its old room booking back", async () => {
    const { c } = await makeCase();
    await book(c.case_id);
    await cancelCase(db, c.case_id, "Cancelled the wrong case");
    await moveCaseStage(db, c.case_id, "PRE_OR", "Cancelled the wrong case");
    expect(await status(c.case_id)).toBe("PRE_OR");
    expect(await slotStatus(c.case_id)).toBe("CANCELLED");
  });

  it("needs a reason, a real change and a stage it is allowed to set", async () => {
    const { c } = await makeCase();
    await expect(moveCaseStage(db, c.case_id, "IN_OR", "")).rejects.toThrow("Enter a reason");
    await expect(moveCaseStage(db, c.case_id, "PRE_OR", "Same stage")).rejects.toThrow("already in that stage");
    await expect(moveCaseStage(db, c.case_id, "CANCELLED", "Use cancel instead")).rejects.toThrow("cannot be moved to that stage");
    await expect(moveCaseStage(db, c.case_id, "SCHEDULED", "No booking yet")).rejects.toThrow("no OR booking");
    await expect(moveCaseStage(db, "missing", "IN_OR", "No such case")).rejects.toThrow("Surgical case not found.");
  });

  it("nurses, doctors and read-only users cannot move a case", async () => {
    const { c } = await makeCase();
    for (const role of ["role-nurse", "role-doctor", "role-research", "role-readonly"]) {
      setActiveSession(ADMIN_SESSION);
      setActiveSession(await addStaff(`m-${role}`, role));
      await expect(moveCaseStage(db, c.case_id, "IN_OR", "Not allowed")).rejects.toBeInstanceOf(PermissionError);
    }
    setActiveSession(ADMIN_SESSION);
    expect(await status(c.case_id)).toBe("PRE_OR");
  });
});

describe("archive and restore a patient", () => {
  it("refuses while the patient has an open case", async () => {
    const { patient } = await makeCase();
    await expect(archivePatient(db, patient.patient_id, "Registered twice")).rejects.toThrow("1 open case");
    expect((await getPatientById(db, patient.patient_id))!.is_active).toBe(1);
  });

  it("hides the patient, keeps every record and restores it", async () => {
    const { patient, c } = await makeCase();
    await cancelCase(db, c.case_id, "Registered twice");
    const supervisor = await addStaff("sup2", "role-supervisor");
    setActiveSession(supervisor);

    await expect(archivePatient(db, patient.patient_id, " ")).rejects.toThrow("Enter a reason");
    await archivePatient(db, patient.patient_id, "Registered twice");

    expect((await listPatients(db, {})).total).toBe(0);
    expect(JSON.stringify(await searchGlobal(db, "Santos"))).not.toContain(patient.patient_id);
    expect(await getCaseById(db, c.case_id)).not.toBeNull();
    const archived = await listArchivedPatients(db);
    expect(archived).toHaveLength(1);
    expect(archived[0].archive_reason).toBe("Registered twice");
    expect(archived[0].archived_by_name).toBe("Staff sup2");
    expect((await lastAudit("ARCHIVE_PATIENT")).user_id).toBe(supervisor.userId);
    await expect(archivePatient(db, patient.patient_id, "Once more")).rejects.toThrow("already archived");

    await restorePatient(db, patient.patient_id);
    expect((await listPatients(db, {})).total).toBe(1);
    expect(await listArchivedPatients(db)).toHaveLength(0);
    expect((await lastAudit("RESTORE_PATIENT")).user_id).toBe(supervisor.userId);
    await expect(restorePatient(db, patient.patient_id)).rejects.toThrow("not archived");
  });

  it("will not restore a patient whose HRN is now used by someone else", async () => {
    const { patient, c } = await makeCase("HRN-500");
    await cancelCase(db, c.case_id, "Registered twice");
    await archivePatient(db, patient.patient_id, "Registered twice");
    await createPatient(db, { firstName: "Ana", lastName: "Reyes", hrn: "HRN-500" });
    await expect(restorePatient(db, patient.patient_id)).rejects.toThrow("already uses HRN HRN-500");
  });

  it("only administrators and supervisors can archive, restore or see the archive", async () => {
    const { patient, c } = await makeCase();
    await cancelCase(db, c.case_id, "Registered twice");
    for (const role of ["role-nurse", "role-doctor", "role-research", "role-readonly"]) {
      setActiveSession(ADMIN_SESSION);
      setActiveSession(await addStaff(`a-${role}`, role));
      await expect(archivePatient(db, patient.patient_id, "Not allowed")).rejects.toBeInstanceOf(PermissionError);
      await expect(restorePatient(db, patient.patient_id)).rejects.toBeInstanceOf(PermissionError);
      await expect(listArchivedPatients(db)).rejects.toBeInstanceOf(PermissionError);
    }
    setActiveSession(ADMIN_SESSION);
    await archivePatient(db, patient.patient_id, "Registered twice");
    expect(await listArchivedPatients(db)).toHaveLength(1);
  });
});

describe("editing patient details", () => {
  it("saves corrections and audits each changed field with the old and new value", async () => {
    const { patient } = await makeCase();
    const saved = await updatePatient(db, patient.patient_id, {
      firstName: "Marie", lastName: "Santos", hrn: "HRN-77", dateOfBirth: "1980-05-10", sex: "FEMALE", bloodType: "O+",
    });
    expect(saved.full_name).toBe("Santos, Marie");
    expect(saved.blood_type).toBe("O+");
    const audit = await db.select<{ field_name: string; old_value: string | null; new_value: string | null; user_id: string }>(
      "SELECT field_name, old_value, new_value, user_id FROM audit_log WHERE action = 'UPDATE_PATIENT' ORDER BY field_name");
    expect(audit.map((a) => a.field_name)).toEqual(["blood_type", "first_name"]);
    expect(audit[1]).toMatchObject({ old_value: "Maria", new_value: "Marie", user_id: ADMIN_SESSION.userId });
  });

  it("rejects a blank name, a future birth date and an HRN used by another patient", async () => {
    const { patient } = await makeCase();
    await makeCase("HRN-88");
    const base = { firstName: "Maria", lastName: "Santos" };
    await expect(updatePatient(db, patient.patient_id, { ...base, firstName: " " })).rejects.toThrow("required");
    await expect(updatePatient(db, patient.patient_id, { ...base, dateOfBirth: "2999-01-01" })).rejects.toThrow("future");
    await expect(updatePatient(db, patient.patient_id, { ...base, hrn: "HRN-88" })).rejects.toThrow("already exists");
  });

  it("is refused for roles without the edit permission", async () => {
    const { patient } = await makeCase();
    setActiveSession(await addStaff("viewer1", "role-readonly"));
    await expect(updatePatient(db, patient.patient_id, { firstName: "X", lastName: "Y" })).rejects.toThrow(PermissionError);
  });
});
