import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { DEMO_PLAN, seedDemoData } from "./demoData";
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

  it("refuses to load twice", async () => {
    await seedDemoData(db);
    await expect(seedDemoData(db)).rejects.toThrow("already loaded");
  }, 60000);
});
