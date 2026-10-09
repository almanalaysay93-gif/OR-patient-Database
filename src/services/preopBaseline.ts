import type { Db } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";

export interface PreopBaseline {
  case_id: string;
  assessed_at: string | null;
  assessed_by: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  measured_at: string | null;
  asa_classification: string | null;
  tobacco_status: "NEVER" | "FORMER" | "CURRENT" | "UNKNOWN" | null;
  functional_status: "INDEPENDENT" | "PARTIALLY_DEPENDENT" | "TOTALLY_DEPENDENT" | "UNKNOWN" | null;
  notes: string | null;
}

export async function getPreopBaseline(db: Db, caseId: string): Promise<PreopBaseline | null> {
  const rows = await db.select<PreopBaseline>("SELECT * FROM case_preop_baseline WHERE case_id = ?", [caseId]);
  return rows[0] || null;
}

export async function savePreopBaseline(
  db: Db,
  params: Omit<PreopBaseline, "case_id" | "assessed_at" | "assessed_by"> & { caseId: string; userId?: string | null },
): Promise<void> {
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");
  if (params.height_cm != null && (params.height_cm <= 0 || params.height_cm >= 300)) throw new Error("Height must be between 0 and 300 cm.");
  if (params.weight_kg != null && (params.weight_kg <= 0 || params.weight_kg >= 700)) throw new Error("Weight must be between 0 and 700 kg.");
  if ((params.height_cm != null || params.weight_kg != null) && !params.measured_at) throw new Error("Measurement date is required.");
  const old = await getPreopBaseline(db, params.caseId);
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO case_preop_baseline
       (case_id, assessed_at, assessed_by, height_cm, weight_kg, measured_at, asa_classification,
        tobacco_status, functional_status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id) DO UPDATE SET assessed_at=excluded.assessed_at, assessed_by=excluded.assessed_by,
       height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, measured_at=excluded.measured_at,
       asa_classification=excluded.asa_classification, tobacco_status=excluded.tobacco_status,
       functional_status=excluded.functional_status, notes=excluded.notes, updated_at=excluded.updated_at`,
      [params.caseId, now, params.userId || null, params.height_cm, params.weight_kg, params.measured_at,
        params.asa_classification, params.tobacco_status, params.functional_status, params.notes?.trim() || null, now, now]);
    await logAudit(tx, {
      userId: params.userId, patientId: c.patient_id, caseId: params.caseId,
      action: "SAVE_PREOP_BASELINE", entityType: "PRE_OR", recordId: params.caseId,
      oldValue: JSON.stringify(old), newValue: JSON.stringify(params),
    });
  });
}
