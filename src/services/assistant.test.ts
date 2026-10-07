import { describe, it, expect, beforeEach, vi } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { createPatient, createAdmission, createSurgicalCase } from "./patients";
import { scheduleCase } from "./scheduling";
import { executeTool, type EntityMap } from "./assistantTools";
import { HELP_TEXT, answerQuestion, parseDateScope } from "./assistant";

// Wednesday.
const NOW = new Date(2026, 9, 7, 9, 0);

describe("offline assistant", () => {
  let db: Db;
  let entities: EntityMap;
  let patientId: string;
  let caseId: string;

  const ask = (question: string) => answerQuestion(db, question, entities, NOW);

  beforeEach(async () => {
    db = await openMemoryDb();
    await runMigrations(db);
    entities = new Map();

    await db.execute("INSERT INTO or_rooms (or_room_id, name, active, display_order) VALUES ('room-1', 'OR 1', 1, 1)");
    await db.execute("INSERT INTO specialties (specialty_id, name, active, display_order) VALUES ('spec-uro', 'Urology', 1, 1)");
    await db.execute("INSERT INTO staff (staff_id, full_name, professional_role, active, created_at, updated_at) VALUES ('staff-surg', 'Dr. Smith', 'Surgeon', 1, '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')");

    const p = await createPatient(db, {
      firstName: "Juan",
      middleName: "Reyes",
      lastName: "Dela Cruz",
      hrn: "HRN-1001",
      dateOfBirth: "1990-01-01",
      sex: "MALE",
      address: "12 Mabini St",
      contactNumber: "09171234567",
    });
    patientId = p.patient_id;
    const adm = await createAdmission(db, { patientId, admissionDate: "2026-10-06", ward: "Surgical Ward 3" });
    const c = await createSurgicalCase(db, {
      patientId,
      admissionId: adm.admission_id,
      caseNumber: "CASE-000101",
      caseType: "ELECTIVE",
      specialtyId: "spec-uro",
      plannedProcedureSummary: "Left Nephrectomy",
    });
    caseId = c.case_id;
    await scheduleCase(db, {
      caseId,
      roomId: "room-1",
      date: "2026-10-08",
      startTime: "08:00",
      estimatedDurationMinutes: 120,
    });
    await db.execute(
      "INSERT INTO case_team (case_team_id, case_id, staff_id, role, created_at) VALUES ('ct-1', ?, 'staff-surg', 'team-1', '2026-10-07T00:00:00Z')",
      [caseId]
    );
  });

  describe("lookups", () => {
    it("returns the schedule and records which records it mentioned", async () => {
      const result: any = await executeTool(db, "get_or_schedule", { date: "2026-10-08" }, entities);

      expect(result.case_count).toBe(1);
      expect(result.cases[0]).toMatchObject({
        case_number: "CASE-000101",
        room: "OR 1",
        procedure: "Left Nephrectomy",
        patient_research_id: "OR-000001",
        patient_age: 36,
        patient_sex: "MALE",
      });
      expect(result.cases[0].team).toEqual([{ role: expect.any(String), name: "Dr. Smith" }]);
      expect(entities.get("OR-000001")).toMatchObject({ kind: "patient", patientId, label: "Dela Cruz, Juan" });
      expect(entities.get("CASE-000101")).toMatchObject({ kind: "case", patientId, caseId });
    });

    it("returns the full case record with readiness", async () => {
      const result: any = await executeTool(db, "get_case", { case_number: "case-000101" }, entities);
      expect(result.found).toBe(true);
      expect(result.patient.research_id).toBe("OR-000001");
      expect(result.admission.ward).toBe("Surgical Ward 3");
      expect(result.schedule[0]).toMatchObject({ scheduled_date: "2026-10-08", room: "OR 1" });
      expect(result.pre_or.checklist.length).toBeGreaterThanOrEqual(9);
      expect(result.pre_or.is_ready).toBe(false);

      const missing: any = await executeTool(db, "get_case", { case_number: "NOPE" }, entities);
      expect(missing.found).toBe(false);
    });

    it("filters and counts cases", async () => {
      const all: any = await executeTool(db, "list_cases", { specialty: "uro", scheduled_from: "2026-10-01" }, entities);
      expect(all.total_matching).toBe(1);
      const none: any = await executeTool(db, "list_cases", { status: "cancelled" }, entities);
      expect(none.total_matching).toBe(0);
      await expect(executeTool(db, "list_cases", { status: "BOGUS" }, entities)).rejects.toThrow(/status must be one of/);
      await expect(executeTool(db, "get_or_schedule", { date: "tomorrow" }, entities)).rejects.toThrow(/YYYY-MM-DD/);
    });

    it("reports the real age", async () => {
      await createPatient(db, { firstName: "Old", lastName: "Timer", dateOfBirth: "1930-01-01", sex: "FEMALE" });
      const result: any = await executeTool(db, "get_patient", { research_id: "or-2" }, entities);
      expect(result.age).toBe(96);
    });
  });

  describe("dates", () => {
    const scope = (text: string) => {
      const s = parseDateScope(text, NOW);
      return s && [s.from, s.to];
    };

    it("reads single days", () => {
      expect(scope("schedule today")).toEqual(["2026-10-07", "2026-10-07"]);
      expect(scope("cases tomorrow")).toEqual(["2026-10-08", "2026-10-08"]);
      expect(scope("what happened yesterday")).toEqual(["2026-10-06", "2026-10-06"]);
      expect(scope("schedule on 2026-11-02")).toEqual(["2026-11-02", "2026-11-02"]);
      expect(scope("schedule Oct 12")).toEqual(["2026-10-12", "2026-10-12"]);
      expect(scope("schedule 3 November")).toEqual(["2026-11-03", "2026-11-03"]);
      expect(scope("cases on friday")).toEqual(["2026-10-09", "2026-10-09"]);
      expect(scope("cases on wednesday")).toEqual(["2026-10-07", "2026-10-07"]);
    });

    it("reads periods", () => {
      expect(scope("schedule this week")).toEqual(["2026-10-05", "2026-10-11"]);
      expect(scope("next week")).toEqual(["2026-10-12", "2026-10-18"]);
      expect(scope("cancelled last month")).toEqual(["2026-09-01", "2026-09-30"]);
      expect(scope("summary this year")).toEqual(["2026-01-01", "2026-12-31"]);
      expect(scope("cases in february")).toEqual(["2026-02-01", "2026-02-28"]);
      expect(scope("which cases are not ready")).toBeNull();
    });
  });

  describe("answers", () => {
    it("shows the schedule for a day and for a period", async () => {
      expect(await ask("schedule today")).toBe("No cases are scheduled today.");

      const tomorrow = await ask("What is on the schedule tomorrow?");
      expect(tomorrow).toContain("1 case scheduled tomorrow");
      expect(tomorrow).toContain("08:00 · OR 1 · CASE-000101 · Left Nephrectomy · OR-000001");
      expect(tomorrow).toContain("Dr. Smith");

      const week = await ask("cases this week");
      expect(week).toContain("1 case scheduled this week");
      expect(week).toContain("2026-10-08 08:00");
    });

    it("defaults to today when no day is named", async () => {
      expect(await ask("schedule")).toBe("No cases are scheduled today.");
    });

    it("shows one case by its number", async () => {
      const answer = await ask("status of case-000101?");
      expect(answer).toContain("**CASE-000101**");
      expect(answer).toContain("Patient: OR-000001 · 36 y · male");
      expect(answer).toContain("Left Nephrectomy · Urology · elective");
      expect(answer).toContain("Schedule: 2026-10-08 08:00 · OR 1 · 120 min");
      expect(answer).toMatch(/Readiness: \d+% · pending: /);
      expect(answer).toContain("Team: ");
      expect(entities.get("CASE-000101")?.caseId).toBe(caseId);
    });

    it("finds a patient by name, HRN or research ID", async () => {
      for (const q of ["Is Juan Dela Cruz ready?", "dela cruz", "look up hrn-1001", "OR-000001", "patient or-1"]) {
        const answer = await ask(q);
        expect(answer, q).toContain("OR-000001 · 36 y · male");
        expect(answer, q).toContain("CASE-000101 · Left Nephrectomy");
        expect(answer, q).toMatch(/\d+% ready/);
      }
      expect(entities.get("OR-000001")).toMatchObject({ patientId, label: "Dela Cruz, Juan" });
      expect(await ask("OR-000099")).toBe("No patient has research ID OR-000099.");
    });

    it("does not read a room name as a research ID", async () => {
      expect(await ask("schedule in OR 1 tomorrow")).toContain("1 case scheduled in OR 1 tomorrow");
      await db.execute("INSERT INTO or_rooms (or_room_id, name, active, display_order) VALUES ('room-2', 'OR 2', 1, 2)");
      expect(await ask("OR 2 tomorrow")).toBe("No cases are scheduled in OR 2 tomorrow.");
    });

    it("narrows shared surnames by first name", async () => {
      await createPatient(db, { firstName: "Maria", lastName: "Dela Cruz", dateOfBirth: "1985-05-05", sex: "FEMALE" });
      const both = await ask("dela cruz");
      expect(both).toContain("OR-000001");
      expect(both).toContain("OR-000002");
      const one = await ask("maria dela cruz");
      expect(one).toContain("OR-000002");
      expect(one).not.toContain("OR-000001");
    });

    it("lists readiness", async () => {
      const notReady = await ask("Which cases are not ready?");
      expect(notReady).toContain("1 case not ready yet (of 1 waiting)");
      expect(notReady).toContain("CASE-000101");
      expect(notReady).toContain("pending: ");
      expect(await ask("ready cases")).toBe("None of the 1 waiting case is ready yet.");
    });

    it("filters by status, type, specialty and delay", async () => {
      expect(await ask("cancelled cases this month")).toBe("No cancelled cases this month.");
      expect(await ask("emergency cases")).toBe("No emergency cases.");
      expect(await ask("elective cases this week")).toContain("1 elective case this week");
      expect(await ask("urology cases")).toContain("1 Urology case:");
      expect(await ask("delayed cases this month")).toBe("No delayed cases this month.");

      await db.execute("UPDATE surgical_cases SET case_status = 'CANCELLED' WHERE case_id = ?", [caseId]);
      const cancelled = await ask("How many cases were cancelled this month?");
      expect(cancelled).toContain("1 cancelled case this month");
      expect(cancelled).toContain("CASE-000101");
    });

    it("summarises statistics and complications", async () => {
      const stats = await ask("how many cases in total");
      expect(stats).toContain("Cases: 1 (");
      expect(stats).toContain("Patients: 1");
      expect(stats).toContain("By specialty: Urology 1");
      expect(await ask("complications this year")).toMatch(/^No complications are recorded/);
    });

    it("explains itself when it cannot match the question", async () => {
      expect(await ask("help")).toBe(HELP_TEXT);
      expect(await ask("")).toBe(HELP_TEXT);
      const unknown = await ask("zzz qqq");
      expect(unknown).toContain("I did not find a case, patient or topic");
      expect(unknown).toContain(HELP_TEXT);
    });

    it("never uses the network or changes data", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const count = async () =>
        (await db.select<{ n: number }>("SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM app_settings) AS n"))[0].n;
      const before = await count();
      for (const q of ["schedule tomorrow", "case-000101", "dela cruz", "not ready", "summary this year", "complications"]) {
        await ask(q);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await count()).toBe(before);
      vi.unstubAllGlobals();
    });
  });
});
