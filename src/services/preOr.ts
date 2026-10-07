import type { Db } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";

export type ChecklistStatus = "PENDING" | "COMPLETE" | "NOT_APPLICABLE" | "FAILED";

export interface ChecklistItemValue {
  value_id: string;
  case_id: string;
  checklist_item_id: string;
  item_name: string;
  description: string | null;
  required_by_default: number;
  status: ChecklistStatus;
  value_text: string | null;
  completed_by: string | null;
  completed_at: string | null;
  notes: string | null;
}

export interface ReadinessCalculation {
  totalItems: number;
  applicableItems: number;
  completedItems: number;
  pendingItems: number;
  failedItems: number;
  notApplicableItems: number;
  readinessPercentage: number;
  isReady: boolean;
  missingItems: string[];
}

export function computeReadiness(items: ChecklistItemValue[]): ReadinessCalculation {
  const applicable = items.filter((i) => i.status !== "NOT_APPLICABLE");
  const completed = applicable.filter((i) => i.status === "COMPLETE");
  const pending = applicable.filter((i) => i.status === "PENDING");
  const failed = applicable.filter((i) => i.status === "FAILED");
  const notApp = items.filter((i) => i.status === "NOT_APPLICABLE");

  const totalApplicable = applicable.length;
  const percentage =
    totalApplicable > 0 ? Math.round((completed.length / totalApplicable) * 100) : 100;

  const isReady = totalApplicable > 0 && completed.length === totalApplicable;

  const missing = applicable
    .filter((i) => i.status !== "COMPLETE")
    .map((i) => i.item_name);

  return {
    totalItems: items.length,
    applicableItems: totalApplicable,
    completedItems: completed.length,
    pendingItems: pending.length,
    failedItems: failed.length,
    notApplicableItems: notApp.length,
    readinessPercentage: percentage,
    isReady,
    missingItems: missing,
  };
}

export async function getPreOrChecklist(db: Db, caseId: string): Promise<{
  items: ChecklistItemValue[];
  readiness: ReadinessCalculation;
}> {
  const rows = await db.select<any>(
    `SELECT v.*, d.name as item_name, d.description, d.required_by_default
     FROM pre_or_checklist_values v
     JOIN pre_or_checklist_definitions d ON v.checklist_item_id = d.checklist_item_id
     WHERE v.case_id = ?
     ORDER BY d.display_order`,
    [caseId]
  );

  const readiness = computeReadiness(rows);
  return { items: rows, readiness };
}

export async function updateChecklistItem(
  db: Db,
  params: {
    caseId: string;
    checklistItemId: string;
    status: ChecklistStatus;
    valueText?: string | null;
    notes?: string | null;
    userId?: string | null;
  }
): Promise<ReadinessCalculation> {
  const now = nowIso();
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE pre_or_checklist_values
       SET status = ?, value_text = ?, notes = ?, completed_by = ?, completed_at = ?
       WHERE case_id = ? AND checklist_item_id = ?`,
      [
        params.status,
        params.valueText || null,
        params.notes || null,
        params.userId || null,
        params.status === "COMPLETE" ? now : null,
        params.caseId,
        params.checklistItemId,
      ]
    );

    // Fetch updated items
    const rows = await tx.select<any>(
      `SELECT v.*, d.name as item_name, d.description, d.required_by_default
       FROM pre_or_checklist_values v
       JOIN pre_or_checklist_definitions d ON v.checklist_item_id = d.checklist_item_id
       WHERE v.case_id = ?`,
      [params.caseId]
    );
    const readiness = computeReadiness(rows);

    // Update assessment summary
    const readinessStatus = readiness.isReady ? "READY" : "NOT_READY";
    await tx.execute(
      `UPDATE pre_or_assessments
       SET readiness_status = ?, readiness_percentage = ?, assessed_by = ?, assessed_at = ?, updated_at = ?
       WHERE case_id = ?`,
      [readinessStatus, readiness.readinessPercentage, params.userId || null, now, now, params.caseId]
    );

    // If case is in PRE_OR or NOT_READY/READY state, automatically advance status
    if (c.case_status === "PRE_OR" || c.case_status === "NOT_READY" || c.case_status === "READY") {
      const targetStatus = readiness.isReady ? "READY" : "NOT_READY";
      if (c.case_status !== targetStatus) {
        await tx.execute(
          "UPDATE surgical_cases SET case_status = ?, updated_at = ? WHERE case_id = ?",
          [targetStatus, now, params.caseId]
        );
      }
    }

    await logAudit(tx, {
      userId: params.userId,
      patientId: c.patient_id,
      admissionId: c.admission_id,
      caseId: params.caseId,
      action: "UPDATE_PRE_OR_CHECKLIST",
      entityType: "PRE_OR",
      recordId: params.checklistItemId,
      newValue: JSON.stringify({ status: params.status, readiness: readiness.readinessPercentage }),
    });
  });

  const { readiness } = await getPreOrChecklist(db, params.caseId);
  return readiness;
}

export async function getPreOrBoardCases(db: Db): Promise<any[]> {
  const rows = await db.select<any>(
    `SELECT c.case_id, c.case_number, c.case_type, c.case_status,
            c.planned_procedure_summary, s.name as specialty_name,
            p.patient_id, p.first_name, p.last_name, p.hrn, p.date_of_birth, p.sex,
            a.readiness_percentage, a.readiness_status,
            sch.scheduled_date, sch.scheduled_start, r.name as room_name
     FROM surgical_cases c
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN specialties s ON c.specialty_id = s.specialty_id
     LEFT JOIN pre_or_assessments a ON a.case_id = c.case_id
     LEFT JOIN or_schedule sch ON sch.case_id = c.case_id
     LEFT JOIN or_rooms r ON sch.or_room_id = r.or_room_id
     WHERE c.case_status IN ('PRE_OR', 'NOT_READY', 'READY', 'SCHEDULED')
     ORDER BY sch.scheduled_date ASC, sch.scheduled_start ASC, c.created_at DESC`
  );

  return rows.map((r) => ({
    ...r,
    patient_name: `${r.last_name}, ${r.first_name}`,
    readiness_percentage: Math.round(r.readiness_percentage ?? 0),
  }));
}
