import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { clearDemoData, countDemoPatients, DEMO_PLAN, DEMO_PROCEDURES, seedDemoData } from "./demoData";
import { createPatient } from "./patients";
import { listArchivedPatients } from "./patientArchive";

let db: Db;

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
});

describe("demo data", () => {
  it("loads 100 simulated patients across every stage", async () => {
    const summary = await seedDemoData(db);
    expect(summary.total).toBe(100);

    const rows = await db.select<{ case_status: string; n: number }>(
      "SELECT case_status, COUNT(*) AS n FROM surgical_cases GROUP BY case_status");
    const byStatus = Object.fromEntries(rows.map((r) => [r.case_status, r.n]));
    expect(byStatus).toEqual({
      PRE_OR: DEMO_PLAN.PRE_OR,
      NOT_READY: DEMO_PLAN.NOT_READY,
      READY: DEMO_PLAN.READY,
      SCHEDULED: DEMO_PLAN.SCHEDULED,
      IN_OR: DEMO_PLAN.IN_OR,
      PACU: DEMO_PLAN.PACU,
      COMPLETED: DEMO_PLAN.COMPLETED + DEMO_PLAN.ARCHIVED,
      CANCELLED: DEMO_PLAN.CANCELLED,
      POSTPONED: DEMO_PLAN.POSTPONED,
    });
    expect(await listArchivedPatients(db)).toHaveLength(DEMO_PLAN.ARCHIVED);

    const count = async (sql: string) => (await db.select<{ n: number }>(sql))[0].n;
    expect(await count("SELECT COUNT(*) AS n FROM complications")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM case_followup_assessments WHERE status = 'ASSESSED'")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM postoperative_outcomes")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE user_id IS NULL")).toBe(0);
  }, 60000);

  it("keeps each case's specialty and clinical details consistent with its procedure", async () => {
    await seedDemoData(db);
    const cases = await db.select<{ procedure: string; specialty: string | null }>(
      `SELECT c.planned_procedure_summary AS procedure, s.name AS specialty
       FROM surgical_cases c LEFT JOIN specialties s ON s.specialty_id = c.specialty_id`);
    expect(cases).toHaveLength(100);
    for (const c of cases) {
      expect(c.specialty, c.procedure).toBe(DEMO_PROCEDURES.find((p) => p.name === c.procedure)?.specialty);
    }

    const catalog = await db.select<{ procedure_name: string; specialty: string | null }>(
      `SELECT p.procedure_name, s.name AS specialty
       FROM procedures p LEFT JOIN specialties s ON s.specialty_id = p.specialty_id`);
    for (const p of DEMO_PROCEDURES) {
      expect(catalog.find((x) => x.procedure_name === p.name)?.specialty, p.name).toBe(p.specialty);
    }

    const count = async (sql: string) => (await db.select<{ n: number }>(sql))[0].n;
    // Nobody is sent to the morgue or ICU unless the record says so.
    expect(await count(
      `SELECT COUNT(*) AS n FROM post_or_records r JOIN post_op_destinations d ON d.destination_id = r.post_op_destination_id
       WHERE (d.name = 'Morgue' AND r.mortality = 0) OR (d.name = 'ICU' AND r.icu_required = 0)`)).toBe(0);
    // Cesarean patients are women of childbearing age.
    expect(await count(
      `SELECT COUNT(*) AS n FROM surgical_cases c JOIN patients p ON p.patient_id = c.patient_id
       WHERE c.planned_procedure_summary = 'Cesarean section'
         AND (p.sex <> 'FEMALE' OR CAST(substr(p.date_of_birth, 1, 4) AS INTEGER) < CAST(strftime('%Y', 'now') AS INTEGER) - 45)`)).toBe(0);
    // An OR slot follows its case into theatre.
    expect(await count(
      `SELECT COUNT(*) AS n FROM surgical_cases c JOIN or_schedule s ON s.case_id = c.case_id
       WHERE c.case_status IN ('IN_OR', 'PACU') AND s.schedule_status <> 'IN_PROGRESS'`)).toBe(0);
  }, 60000);

  it("clears the simulated patients and their records, and keeps everything else", async () => {
    await createPatient(db, { firstName: "Real", lastName: "Patient", hrn: "HRN-REAL-1", dateOfBirth: "1970-01-01", sex: "MALE" });
    await seedDemoData(db);
    expect(await clearDemoData(db)).toBe(100);

    const count = async (sql: string) => (await db.select<{ n: number }>(sql))[0].n;
    expect(await countDemoPatients(db)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM surgical_cases")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM or_schedule")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM post_or_records")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM patients WHERE hrn = 'HRN-REAL-1'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log")).toBeGreaterThan(0);
    expect(await clearDemoData(db)).toBe(0);
  }, 60000);

  it("refuses to load twice", async () => {
    await seedDemoData(db);
    await expect(seedDemoData(db)).rejects.toThrow("already loaded");
  }, 60000);
});
