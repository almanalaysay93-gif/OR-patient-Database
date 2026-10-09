import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { createAdmission, createPatient, createSurgicalCase } from "./patients";
import { createProcedure } from "./masterData";
import { saveCaseCoding } from "./caseCoding";
import { saveCaseEvent } from "./caseEvents";
import { completeCase } from "./intraPostOr";
import { getCaseFollowup } from "./followup";
import { getAnalyticsSummary } from "./analytics";

describe("F1-F5 clinical data", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openMemoryDb();
    await runMigrations(db);
  });

  async function makeCase() {
    const patient = await createPatient(db, {
      firstName: "Test", lastName: "Patient", dateOfBirth: "1980-05-10",
    });
    const admission = await createAdmission(db, {
      patientId: patient.patient_id, admissionDate: "2026-10-07",
    });
    return createSurgicalCase(db, {
      patientId: patient.patient_id, admissionId: admission.admission_id,
      plannedProcedureSummary: "Legacy name",
    });
  }

  it("groups procedures by catalog identity even when two terms have the same name", async () => {
    const first = await makeCase();
    const second = await makeCase();
    const local = await createProcedure(db, { name: "Repair", code: "L1", codeSystem: "LOCAL" });
    const external = await createProcedure(db, { name: "Repair", code: "E1", codeSystem: "EXTERNAL" });
    await saveCaseCoding(db, {
      caseId: first.case_id, primaryProcedureId: local.procedure_id,
      additionalProcedureIds: [], diagnoses: [],
    });
    await saveCaseCoding(db, {
      caseId: second.case_id, primaryProcedureId: external.procedure_id,
      additionalProcedureIds: [], diagnoses: [],
    });
    const summary = await getAnalyticsSummary(db);
    expect(summary.topProcedures).toHaveLength(2);
    expect(summary.topProcedures.map((p) => p.count)).toEqual([1, 1]);
  });

  it("starts a 30-day follow-up when a completed case has a dated surgery event", async () => {
    const c = await makeCase();
    await saveCaseEvent(db, {
      caseId: c.case_id, eventType: "INCISION", occurredAt: "2026-10-07T09:00:00Z",
    });
    await completeCase(db, c.case_id);
    const followup = await getCaseFollowup(db, c.case_id);
    expect(followup.assessments).toHaveLength(1);
    expect(followup.assessments[0].target_day).toBe(30);
    expect(followup.assessments[0].status).toBe("PENDING");
  });
});
