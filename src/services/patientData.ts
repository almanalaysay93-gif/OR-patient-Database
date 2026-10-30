import type { Db } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";
import { getPatientById } from "./patients";
import { queueSheetSync } from "./sheetSync";

/** Patient's data: measurements, risk status, dialysis history and donor. One record per patient. */
export interface PatientData {
  patient_id: string;
  assessed_at: string | null;
  assessed_by: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  measured_at: string | null;
  asa_classification: string | null;
  tobacco_status: "NEVER" | "FORMER" | "CURRENT" | "UNKNOWN" | null;
  functional_status: "INDEPENDENT" | "PARTIALLY_DEPENDENT" | "TOTALLY_DEPENDENT" | "UNKNOWN" | null;
  dialysis_modality: DialysisModality | null;
  dialysis_access: DialysisAccess | null;
  dialysis_years: number | null;
  donor_relation: DonorRelation | null;
  donor_relationship_type_id: string | null;
  notes: string | null;
}

export const DIALYSIS_MODALITIES = ["NONE", "HEMODIALYSIS", "PERITONEAL_DIALYSIS", "UNKNOWN"] as const;
export const DIALYSIS_ACCESSES = ["AV_FISTULA", "AV_GRAFT", "TUNNELED_CATHETER", "NON_TUNNELED_CATHETER", "PD_CATHETER", "OTHER"] as const;
export const DONOR_RELATIONS = ["RELATED", "NON_RELATED"] as const;
export type DialysisModality = (typeof DIALYSIS_MODALITIES)[number];
export type DialysisAccess = (typeof DIALYSIS_ACCESSES)[number];
export type DonorRelation = (typeof DONOR_RELATIONS)[number];

export type PatientDataInput = Omit<PatientData, "patient_id" | "assessed_at" | "assessed_by">;

/** Roles that register patients or work the Pre-OR checklist may enter patient's data. */
const EDIT_PERMISSIONS = ["patients.create", "patients.edit_demographics", "preor.edit"];

export async function getPatientData(db: Db, patientId: string): Promise<PatientData | null> {
  requirePermission("patients.view");
  const rows = await db.select<PatientData>("SELECT * FROM patient_data WHERE patient_id = ?", [patientId]);
  return rows[0] || null;
}

/** True when at least one field holds a value, so an untouched form at registration saves nothing. */
export function hasPatientData(input: PatientDataInput): boolean {
  return Object.values(input).some((v) => v !== null && v !== undefined && v !== "");
}

/** Throws the first problem with the input. Runs before a patient is created, so a bad entry stops registration. */
export async function validatePatientData(db: Db, input: PatientDataInput): Promise<void> {
  if (input.height_cm != null && (input.height_cm <= 0 || input.height_cm >= 300)) throw new Error("Height must be between 0 and 300 cm.");
  if (input.weight_kg != null && (input.weight_kg <= 0 || input.weight_kg >= 700)) throw new Error("Weight must be between 0 and 700 kg.");
  if ((input.height_cm != null || input.weight_kg != null) && !input.measured_at) throw new Error("Measurement date is required.");
  const years = input.dialysis_years;
  if (years != null && (!Number.isFinite(years) || years < 0 || years > 60)) throw new Error("Years on dialysis must be between 0 and 60.");
  if (input.dialysis_modality === "NONE" && (input.dialysis_access || years != null)) {
    throw new Error("Dialysis access and years need a dialysis type other than none.");
  }
  const relationshipType = input.donor_relationship_type_id;
  if (relationshipType) {
    if (!input.donor_relation) throw new Error("Choose related or non-related donor before the type of relation.");
    const t = await db.select<{ donor_relation: string }>(
      "SELECT donor_relation FROM donor_relationship_types WHERE relationship_type_id = ?", [relationshipType]);
    if (!t[0]) throw new Error("Type of relation not found.");
    if (t[0].donor_relation !== input.donor_relation) throw new Error("Type of relation does not match the related or non-related donor choice.");
  }
}

export async function savePatientData(db: Db, patientId: string, input: PatientDataInput): Promise<void> {
  const userId = requirePermission(...EDIT_PERMISSIONS);
  const patient = await getPatientById(db, patientId);
  if (!patient) throw new Error("Patient not found.");
  await validatePatientData(db, input);
  const old = await getPatientData(db, patientId);
  const now = nowIso();
  const v = {
    ...input,
    dialysis_modality: input.dialysis_modality ?? null,
    dialysis_access: input.dialysis_access ?? null,
    dialysis_years: input.dialysis_years ?? null,
    donor_relation: input.donor_relation ?? null,
    donor_relationship_type_id: input.donor_relationship_type_id ?? null,
    notes: input.notes?.trim() || null,
  };
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO patient_data
       (patient_id, assessed_at, assessed_by, height_cm, weight_kg, measured_at, asa_classification,
        tobacco_status, functional_status, dialysis_modality, dialysis_access, dialysis_years, donor_relation,
        donor_relationship_type_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(patient_id) DO UPDATE SET assessed_at=excluded.assessed_at, assessed_by=excluded.assessed_by,
       height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, measured_at=excluded.measured_at,
       asa_classification=excluded.asa_classification, tobacco_status=excluded.tobacco_status,
       functional_status=excluded.functional_status, dialysis_modality=excluded.dialysis_modality,
       dialysis_access=excluded.dialysis_access, dialysis_years=excluded.dialysis_years,
       donor_relation=excluded.donor_relation,
       donor_relationship_type_id=excluded.donor_relationship_type_id, notes=excluded.notes, updated_at=excluded.updated_at`,
      [patientId, now, userId, v.height_cm, v.weight_kg, v.measured_at, v.asa_classification, v.tobacco_status,
        v.functional_status, v.dialysis_modality, v.dialysis_access, v.dialysis_years, v.donor_relation,
        v.donor_relationship_type_id, v.notes, now, now]);
    // Every case of this patient carries these fields in its Google Sheet row.
    const cases = await tx.select<{ case_id: string }>("SELECT case_id FROM surgical_cases WHERE patient_id = ?", [patientId]);
    for (const { case_id } of cases) await queueSheetSync(tx, case_id);
    await logAudit(tx, {
      userId, patientId, action: "SAVE_PATIENT_DATA", entityType: "PATIENT", recordId: patientId,
      oldValue: JSON.stringify(old), newValue: JSON.stringify(v),
    });
  });
}
