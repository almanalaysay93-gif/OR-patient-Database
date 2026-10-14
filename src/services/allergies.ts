import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";

export type AllergySeverity = "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING";

export interface PatientAllergy {
  allergy_id: string;
  patient_id: string;
  allergen: string;
  reaction: string | null;
  severity: AllergySeverity;
  verified: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAllergyParams {
  patientId: string;
  allergen: string;
  reaction?: string | null;
  severity?: AllergySeverity;
  notes?: string | null;
  userId?: string;
}

export async function listPatientAllergies(db: Db, patientId: string): Promise<PatientAllergy[]> {
  requirePermission("patients.view");
  return db.select<PatientAllergy>(
    `SELECT * FROM allergies WHERE patient_id = ? ORDER BY CASE severity 
       WHEN 'LIFE_THREATENING' THEN 1 
       WHEN 'SEVERE' THEN 2 
       WHEN 'MODERATE' THEN 3 
       ELSE 4 END, allergen ASC`,
    [patientId]
  );
}

export async function createPatientAllergy(db: Db, params: CreateAllergyParams): Promise<PatientAllergy> {
  const userId = requirePermission("patients.edit_demographics", "cases.edit", "preor.edit");
  const allergen = params.allergen.trim();
  if (!allergen) throw new Error("Allergen name is required.");

  const allergyId = uuid();
  const now = nowIso();
  const severity = params.severity || "MODERATE";

  await db.execute(
    `INSERT INTO allergies (allergy_id, patient_id, allergen, reaction, severity, verified, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [allergyId, params.patientId, allergen, params.reaction?.trim() || null, severity, params.notes?.trim() || null, now, now]
  );

  await logAudit(db, {
    action: "CREATE_ALLERGY",
    entityType: "PATIENT",
    recordId: params.patientId,
    newValue: `Added allergy ${allergen} (${severity})`,
    userId: params.userId || userId,
  });

  const rows = await db.select<PatientAllergy>("SELECT * FROM allergies WHERE allergy_id = ?", [allergyId]);
  return rows[0];
}

export async function deletePatientAllergy(db: Db, allergyId: string, userId?: string): Promise<void> {
  const callerId = requirePermission("patients.edit_demographics", "cases.edit");
  const existing = await db.select<PatientAllergy>("SELECT * FROM allergies WHERE allergy_id = ?", [allergyId]);
  if (!existing.length) return;

  await db.execute("DELETE FROM allergies WHERE allergy_id = ?", [allergyId]);

  await logAudit(db, {
    action: "DELETE_ALLERGY",
    entityType: "PATIENT",
    recordId: existing[0].patient_id,
    oldValue: `Removed allergy ${existing[0].allergen}`,
    userId: userId || callerId,
  });
}
