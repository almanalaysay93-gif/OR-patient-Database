import type { Db } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";

export type SafetyPhase = "SIGN_IN" | "TIME_OUT" | "SIGN_OUT";
export type SafetyStatus = "PENDING" | "COMPLETE" | "FAILED" | "NOT_APPLICABLE";

export interface SafetyItem {
  item_id: string;
  template_id: string;
  template_version: string;
  phase: SafetyPhase;
  label: string;
  required: number;
  status: SafetyStatus;
  occurred_at: string | null;
  recorded_at: string | null;
  recorded_by: string | null;
  notes: string | null;
}

export async function getSafetyItems(db: Db, caseId: string): Promise<SafetyItem[]> {
  return db.select<SafetyItem>(
    `SELECT i.item_id, i.template_id, t.version AS template_version, i.phase, i.label, i.required,
            COALESCE(r.status, 'PENDING') AS status, r.occurred_at, r.recorded_at, r.recorded_by, r.notes
     FROM case_safety_templates ct
     JOIN safety_templates t ON t.template_id = ct.template_id
     JOIN safety_items i ON i.template_id = t.template_id
     LEFT JOIN safety_responses r ON r.item_id = i.item_id AND r.case_id = ct.case_id
     WHERE ct.case_id = ? ORDER BY CASE i.phase WHEN 'SIGN_IN' THEN 1 WHEN 'TIME_OUT' THEN 2 ELSE 3 END, i.display_order`,
    [caseId]);
}

export async function saveSafetyResponse(
  db: Db,
  params: { caseId: string; itemId: string; status: SafetyStatus; notes?: string | null; userId?: string | null },
): Promise<void> {
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");
  const valid: SafetyStatus[] = ["PENDING", "COMPLETE", "FAILED", "NOT_APPLICABLE"];
  if (!valid.includes(params.status)) throw new Error("Invalid safety status.");
  if (params.status === "FAILED" && !params.notes?.trim()) throw new Error("Describe the failed safety check.");
  const item = await db.select<{ item_id: string }>(
    `SELECT i.item_id FROM safety_items i
     JOIN case_safety_templates ct ON ct.template_id = i.template_id
     WHERE ct.case_id = ? AND i.item_id = ?`, [params.caseId, params.itemId]);
  if (!item.length) throw new Error("Safety item does not belong to this case.");
  const old = await db.select<SafetyItem>(
    "SELECT * FROM safety_responses WHERE case_id = ? AND item_id = ?", [params.caseId, params.itemId]);
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO safety_responses
       (case_id, item_id, status, occurred_at, recorded_at, recorded_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id, item_id) DO UPDATE SET status=excluded.status, occurred_at=excluded.occurred_at,
       recorded_at=excluded.recorded_at, recorded_by=excluded.recorded_by, notes=excluded.notes`,
      [params.caseId, params.itemId, params.status, params.status === "PENDING" ? null : now,
        now, params.userId || null, params.notes?.trim() || null]);
    await logAudit(tx, {
      userId: params.userId, patientId: c.patient_id, caseId: params.caseId,
      action: "SAVE_SAFETY_RESPONSE", entityType: "SAFETY_CHECK", recordId: params.itemId,
      oldValue: JSON.stringify(old[0] || null),
      newValue: JSON.stringify({ status: params.status, notes: params.notes || null, occurredAt: now }),
    });
  });
}

export function phaseComplete(items: SafetyItem[], phase: SafetyPhase): boolean {
  const relevant = items.filter((i) => i.phase === phase && i.required);
  return relevant.length > 0 && relevant.every((i) => i.status === "COMPLETE" || i.status === "NOT_APPLICABLE");
}
