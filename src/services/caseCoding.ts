import type { Db } from "../data/db";
import { nowIso, uuid } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";

export type DiagnosisType = "PRE_OPERATIVE" | "POST_OPERATIVE" | "COMORBIDITY" | "OTHER";

export interface CaseCoding {
  procedures: { case_procedure_id: string; procedure_id: string; procedure_name: string; is_primary: number }[];
  diagnoses: { case_diagnosis_id: string; diagnosis_id: string; diagnosis_name: string; diagnosis_type: DiagnosisType }[];
}

export async function getCaseCoding(db: Db, caseId: string): Promise<CaseCoding> {
  const [procedures, diagnoses] = await Promise.all([
    db.select<CaseCoding["procedures"][number]>(
      `SELECT cp.case_procedure_id, cp.procedure_id, p.procedure_name, cp.is_primary
       FROM case_procedures cp JOIN procedures p ON p.procedure_id = cp.procedure_id
       WHERE cp.case_id = ? ORDER BY cp.is_primary DESC, p.procedure_name`, [caseId]),
    db.select<CaseCoding["diagnoses"][number]>(
      `SELECT cd.case_diagnosis_id, cd.diagnosis_id, d.diagnosis_name, cd.diagnosis_type
       FROM case_diagnoses cd JOIN diagnoses d ON d.diagnosis_id = cd.diagnosis_id
       WHERE cd.case_id = ? ORDER BY cd.diagnosis_type, d.diagnosis_name`, [caseId]),
  ]);
  return { procedures, diagnoses };
}

export async function saveCaseCoding(
  db: Db,
  params: {
    caseId: string;
    primaryProcedureId: string | null;
    additionalProcedureIds: string[];
    diagnoses: { diagnosisId: string; type: DiagnosisType }[];
    userId?: string | null;
  },
): Promise<void> {
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");
  const procedureIds = [params.primaryProcedureId, ...params.additionalProcedureIds].filter((v): v is string => !!v);
  if (new Set(procedureIds).size !== procedureIds.length) throw new Error("A procedure is selected more than once.");
  const diagnosisKeys = params.diagnoses.map((d) => `${d.type}:${d.diagnosisId}`);
  if (new Set(diagnosisKeys).size !== diagnosisKeys.length) throw new Error("A diagnosis is selected more than once.");
  const validTypes: DiagnosisType[] = ["PRE_OPERATIVE", "POST_OPERATIVE", "COMORBIDITY", "OTHER"];
  if (params.diagnoses.some((d) => !validTypes.includes(d.type))) throw new Error("Invalid diagnosis type.");
  const old = await getCaseCoding(db, params.caseId);
  await db.transaction(async (tx) => {
    for (const procedureId of procedureIds) {
      if (old.procedures.some((p) => p.procedure_id === procedureId)) continue;
      const rows = await tx.select<{ procedure_id: string }>(
        "SELECT procedure_id FROM procedures WHERE procedure_id = ? AND active = 1", [procedureId]);
      if (!rows.length) throw new Error("Selected procedure is unavailable.");
    }
    for (const item of params.diagnoses) {
      if (old.diagnoses.some((d) => d.diagnosis_id === item.diagnosisId && d.diagnosis_type === item.type)) continue;
      const rows = await tx.select<{ diagnosis_id: string }>(
        "SELECT diagnosis_id FROM diagnoses WHERE diagnosis_id = ? AND active = 1", [item.diagnosisId]);
      if (!rows.length) throw new Error("Selected diagnosis is unavailable.");
    }
    await tx.execute("UPDATE case_procedures SET is_primary = 0 WHERE case_id = ?", [params.caseId]);
    for (const existing of old.procedures) {
      if (!procedureIds.includes(existing.procedure_id)) {
        await tx.execute("DELETE FROM case_procedures WHERE case_procedure_id = ?", [existing.case_procedure_id]);
      }
    }
    for (const procedureId of procedureIds) {
      if (!old.procedures.some((p) => p.procedure_id === procedureId)) {
        await tx.execute(
          "INSERT INTO case_procedures (case_procedure_id, case_id, procedure_id, is_primary) VALUES (?, ?, ?, 0)",
          [uuid(), params.caseId, procedureId]);
      }
    }
    if (params.primaryProcedureId) {
      await tx.execute(
        "UPDATE case_procedures SET is_primary = 1 WHERE case_id = ? AND procedure_id = ?",
        [params.caseId, params.primaryProcedureId]);
    }
    for (const existing of old.diagnoses) {
      if (!params.diagnoses.some((d) => d.diagnosisId === existing.diagnosis_id && d.type === existing.diagnosis_type)) {
        await tx.execute("DELETE FROM case_diagnoses WHERE case_diagnosis_id = ?", [existing.case_diagnosis_id]);
      }
    }
    for (const item of params.diagnoses) {
      if (!old.diagnoses.some((d) => d.diagnosis_id === item.diagnosisId && d.diagnosis_type === item.type)) {
        await tx.execute(
          "INSERT INTO case_diagnoses (case_diagnosis_id, case_id, diagnosis_id, diagnosis_type) VALUES (?, ?, ?, ?)",
          [uuid(), params.caseId, item.diagnosisId, item.type]);
      }
    }
    await tx.execute("UPDATE surgical_cases SET updated_by = ?, updated_at = ? WHERE case_id = ?",
      [params.userId || null, nowIso(), params.caseId]);
    await logAudit(tx, {
      userId: params.userId, patientId: c.patient_id, admissionId: c.admission_id, caseId: params.caseId,
      action: "UPDATE_CASE_CODING", entityType: "SURGICAL_CASE", recordId: params.caseId,
      oldValue: JSON.stringify(old), newValue: JSON.stringify(params),
    });
  });
}

export async function getUncodedCases(db: Db): Promise<{ case_id: string; case_number: string; planned_procedure_summary: string | null }[]> {
  return db.select(
    `SELECT c.case_id, c.case_number, c.planned_procedure_summary FROM surgical_cases c
     WHERE NOT EXISTS (SELECT 1 FROM case_procedures cp WHERE cp.case_id = c.case_id AND cp.is_primary = 1)
     ORDER BY c.created_at DESC`);
}
