import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import { M022_PATIENT_DATA } from "../data/migrations/022_patient_data";
import type { Db } from "../data/db";
import { createAdmission, createPatient, createSurgicalCase } from "./patients";
import { getPatientData, hasPatientData, savePatientData, validatePatientData, type PatientDataInput } from "./patientData";

let db: Db;
/** The setting that turns Google Sheet sync on (sheetSync.ts URL_KEY). */
const SHEET_URL_KEY = "sheet_sync_url";

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
});

const EMPTY: PatientDataInput = {
  height_cm: null, weight_kg: null, measured_at: null, asa_classification: null, tobacco_status: null,
  functional_status: null, dialysis_modality: null, dialysis_access: null, dialysis_years: null,
  donor_relation: null, donor_relationship_type_id: null, notes: null,
};

async function patientWithCases(n: number, hrn = "HRN-PD") {
  const patient = await createPatient(db, { firstName: "Lea", lastName: "Reyes", hrn });
  const admission = await createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-07" });
  const cases = [];
  for (let i = 0; i < n; i++) {
    cases.push(await createSurgicalCase(db, { patientId: patient.patient_id, admissionId: admission.admission_id, plannedProcedureSummary: `Case ${i}` }));
  }
  return { patient, cases };
}

describe("patient's data", () => {
  it("is kept once per patient and shared by every case of that patient", async () => {
    const { patient, cases } = await patientWithCases(2);
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [SHEET_URL_KEY, "https://script.google.com/macros/s/TEST/exec"]);
    await savePatientData(db, patient.patient_id, { ...EMPTY, dialysis_modality: "PERITONEAL_DIALYSIS", dialysis_access: "PD_CATHETER", dialysis_years: 1 });
    expect(await getPatientData(db, patient.patient_id)).toMatchObject({ dialysis_modality: "PERITONEAL_DIALYSIS", dialysis_access: "PD_CATHETER" });
    // Both cases go to the Google Sheet queue, since both rows carry these fields.
    const queued = await db.select<{ case_id: string }>("SELECT case_id FROM sheet_sync_pending ORDER BY case_id");
    expect(queued.map((q) => q.case_id).sort()).toEqual(cases.map((c) => c.case_id).sort());
  });

  it("can be saved for a patient with no case yet, as at registration", async () => {
    const patient = await createPatient(db, { firstName: "New", lastName: "Patient" });
    await savePatientData(db, patient.patient_id, { ...EMPTY, donor_relation: "RELATED", donor_relationship_type_id: "drt-sister" });
    expect(await getPatientData(db, patient.patient_id)).toMatchObject({ donor_relationship_type_id: "drt-sister" });
  });

  it("is checked before registration, and an untouched form counts as empty", async () => {
    await expect(validatePatientData(db, { ...EMPTY, dialysis_modality: "NONE", dialysis_years: 2 })).rejects.toThrow("dialysis type");
    await expect(validatePatientData(db, { ...EMPTY, height_cm: 170 })).rejects.toThrow("Measurement date");
    expect(hasPatientData(EMPTY)).toBe(false);
    expect(hasPatientData({ ...EMPTY, tobacco_status: "NEVER" })).toBe(true);
  });

  it("migration 022 copies each patient's newest case baseline", async () => {
    const { patient, cases } = await patientWithCases(2, "HRN-MIG");
    const row = (caseId: string, modality: string, updated: string) => db.execute(
      `INSERT INTO case_preop_baseline (case_id, dialysis_modality, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [caseId, modality, updated, updated]);
    await row(cases[0].case_id, "HEMODIALYSIS", "2026-10-01T00:00:00Z");
    await row(cases[1].case_id, "PERITONEAL_DIALYSIS", "2026-10-05T00:00:00Z");
    await db.execute("DELETE FROM patient_data");
    for (const sql of M022_PATIENT_DATA.split(";\n").map((s) => s.trim()).filter(Boolean)) await db.execute(sql);
    expect((await getPatientData(db, patient.patient_id))?.dialysis_modality).toBe("PERITONEAL_DIALYSIS");
  });
});
