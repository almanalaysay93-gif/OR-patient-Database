import type { Db } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";
import { getCaseById } from "./patients";
import { queueSheetSync } from "./sheetSync";

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

type DialysisFields = "dialysis_modality" | "dialysis_access" | "dialysis_years" | "donor_relation" | "donor_relationship_type_id";

export async function getPreopBaseline(db: Db, caseId: string): Promise<PreopBaseline | null> {
  requirePermission("patients.view");
  const rows = await db.select<PreopBaseline>("SELECT * FROM case_preop_baseline WHERE case_id = ?", [caseId]);
  return rows[0] || null;
}

export async function savePreopBaseline(
  db: Db,
  params: Omit<PreopBaseline, "case_id" | "assessed_at" | "assessed_by" | DialysisFields>
    & Partial<Pick<PreopBaseline, DialysisFields>> & { caseId: string; userId?: string | null },
): Promise<void> {
  params = { ...params, userId: requirePermission("preor.edit") };
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");
  if (params.height_cm != null && (params.height_cm <= 0 || params.height_cm >= 300)) throw new Error("Height must be between 0 and 300 cm.");
  if (params.weight_kg != null && (params.weight_kg <= 0 || params.weight_kg >= 700)) throw new Error("Weight must be between 0 and 700 kg.");
  if ((params.height_cm != null || params.weight_kg != null) && !params.measured_at) throw new Error("Measurement date is required.");
  const modality = params.dialysis_modality ?? null;
  const access = params.dialysis_access ?? null;
  const years = params.dialysis_years ?? null;
  const donor = params.donor_relation ?? null;
  if (years != null && (!Number.isFinite(years) || years < 0 || years > 60)) throw new Error("Years on dialysis must be between 0 and 60.");
  if (modality === "NONE" && (access || years != null)) throw new Error("Dialysis access and years need a dialysis type other than none.");
  const relationshipType = params.donor_relationship_type_id ?? null;
  if (relationshipType) {
    if (!donor) throw new Error("Choose related or non-related donor before the type of relation.");
    const t = await db.select<{ donor_relation: string; active: number }>(
      "SELECT donor_relation, active FROM donor_relationship_types WHERE relationship_type_id = ?", [relationshipType]);
    if (!t[0]) throw new Error("Type of relation not found.");
    if (t[0].donor_relation !== donor) throw new Error("Type of relation does not match the related or non-related donor choice.");
  }
  const old = await getPreopBaseline(db, params.caseId);
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO case_preop_baseline
       (case_id, assessed_at, assessed_by, height_cm, weight_kg, measured_at, asa_classification,
        tobacco_status, functional_status, dialysis_modality, dialysis_access, dialysis_years, donor_relation,
        donor_relationship_type_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id) DO UPDATE SET assessed_at=excluded.assessed_at, assessed_by=excluded.assessed_by,
       height_cm=excluded.height_cm, weight_kg=excluded.weight_kg, measured_at=excluded.measured_at,
       asa_classification=excluded.asa_classification, tobacco_status=excluded.tobacco_status,
       functional_status=excluded.functional_status, dialysis_modality=excluded.dialysis_modality,
       dialysis_access=excluded.dialysis_access, dialysis_years=excluded.dialysis_years,
       donor_relation=excluded.donor_relation,
       donor_relationship_type_id=excluded.donor_relationship_type_id, notes=excluded.notes, updated_at=excluded.updated_at`,
      [params.caseId, now, params.userId || null, params.height_cm, params.weight_kg, params.measured_at,
        params.asa_classification, params.tobacco_status, params.functional_status, modality, access, years, donor, relationshipType,
        params.notes?.trim() || null, now, now]);
    await queueSheetSync(tx, params.caseId);
    await logAudit(tx, {
      userId: params.userId, patientId: c.patient_id, caseId: params.caseId,
      action: "SAVE_PREOP_BASELINE", entityType: "PRE_OR", recordId: params.caseId,
      oldValue: JSON.stringify(old), newValue: JSON.stringify(params),
    });
  });
}
