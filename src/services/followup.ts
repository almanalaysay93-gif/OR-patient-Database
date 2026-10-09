import type { Db, RawDb } from "../data/db";
import { nowIso, uuid } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";
import { validClinicalTimestamp } from "./caseEvents";

export type FollowupStatus = "PENDING" | "ASSESSED" | "UNREACHABLE" | "DECEASED";
export type OutcomeType = "READMISSION" | "UNPLANNED_REOPERATION" | "DEATH" | "SURGICAL_SITE_INFECTION";

export interface FollowupAssessment {
  followup_id: string;
  case_id: string;
  target_day: 30 | 90;
  due_date: string;
  assessed_at: string | null;
  method: "IN_PERSON" | "PHONE" | "RECORD_REVIEW" | "OTHER" | null;
  status: FollowupStatus;
  assessed_by: string | null;
  notes: string | null;
}

export interface PostoperativeOutcome {
  outcome_id: string;
  case_id: string;
  followup_id: string | null;
  event_type: OutcomeType;
  occurred_at: string;
  detected_at: string | null;
  ssi_type: "SUPERFICIAL_INCISIONAL" | "DEEP_INCISIONAL" | "ORGAN_SPACE" | null;
  case_procedure_id: string | null;
  evidence_source: string | null;
  notes: string | null;
}

export async function getCaseFollowup(db: Db, caseId: string): Promise<{
  assessments: FollowupAssessment[];
  outcomes: PostoperativeOutcome[];
}> {
  const [assessments, outcomes] = await Promise.all([
    db.select<FollowupAssessment>(
      "SELECT * FROM case_followup_assessments WHERE case_id = ? ORDER BY target_day", [caseId]),
    db.select<PostoperativeOutcome>(
      "SELECT * FROM postoperative_outcomes WHERE case_id = ? ORDER BY occurred_at DESC", [caseId]),
  ]);
  return { assessments, outcomes };
}

/**
 * Creates the pending follow-up inside the caller's transaction.
 * Returns null when one already exists or the case has no dated surgery event.
 */
export async function createFollowupIfDue(
  tx: RawDb,
  params: { caseId: string; patientId: string; targetDay?: 30 | 90; userId?: string | null },
): Promise<string | null> {
  const targetDay = params.targetDay ?? 30;
  const existing = await tx.select<{ followup_id: string }>(
    "SELECT followup_id FROM case_followup_assessments WHERE case_id = ? AND target_day = ?",
    [params.caseId, targetDay]);
  if (existing[0]) return null;
  const events = await tx.select<{ event_type: string; occurred_at: string }>(
    "SELECT event_type, occurred_at FROM case_events WHERE case_id = ? AND event_type IN ('INCISION', 'ROOM_IN')",
    [params.caseId]);
  const surgery = events.find((e) => e.event_type === "INCISION") || events.find((e) => e.event_type === "ROOM_IN");
  if (!surgery) return null;
  const due = new Date(Date.parse(surgery.occurred_at) + targetDay * 86400000).toISOString().slice(0, 10);
  const now = nowIso();
  const followupId = uuid();
  await tx.execute(
    `INSERT INTO case_followup_assessments
     (followup_id, case_id, target_day, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
    [followupId, params.caseId, targetDay, due, now, now]);
  await logAudit(tx, {
    userId: params.userId, patientId: params.patientId, caseId: params.caseId,
    action: "CREATE_FOLLOWUP", entityType: "FOLLOWUP",
    recordId: followupId, newValue: JSON.stringify({ targetDay, due }),
  });
  return followupId;
}

export async function ensureFollowup(db: Db, caseId: string, targetDay: 30 | 90 = 30): Promise<FollowupAssessment> {
  const c = await getCaseById(db, caseId);
  if (!c) throw new Error("Surgical case not found.");
  const existing = await db.select<FollowupAssessment>(
    "SELECT * FROM case_followup_assessments WHERE case_id = ? AND target_day = ?", [caseId, targetDay]);
  if (existing[0]) return existing[0];
  const followupId = await db.transaction((tx) =>
    createFollowupIfDue(tx, { caseId, patientId: c.patient_id, targetDay }));
  if (!followupId) throw new Error("Record a dated incision or room entry before creating follow-up.");
  const rows = await db.select<FollowupAssessment>(
    "SELECT * FROM case_followup_assessments WHERE followup_id = ?", [followupId]);
  return rows[0];
}

export async function saveFollowupAssessment(
  db: Db,
  params: {
    followupId: string;
    status: FollowupStatus;
    assessedAt?: string | null;
    method?: FollowupAssessment["method"];
    notes?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  const rows = await db.select<FollowupAssessment>(
    "SELECT * FROM case_followup_assessments WHERE followup_id = ?", [params.followupId]);
  const old = rows[0];
  if (!old) throw new Error("Follow-up record not found.");
  if (params.status === "ASSESSED" && (!params.assessedAt || !validClinicalTimestamp(params.assessedAt) || !params.method)) {
    throw new Error("Assessment date, time, and method are required.");
  }
  if (params.status === "UNREACHABLE" && !params.notes?.trim()) throw new Error("Record the attempted contact.");
  const c = await getCaseById(db, old.case_id);
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE case_followup_assessments
       SET status = ?, assessed_at = ?, method = ?, assessed_by = ?, notes = ?, updated_at = ?
       WHERE followup_id = ?`,
      [params.status, params.assessedAt || null, params.method || null, params.userId || null,
        params.notes?.trim() || null, now, params.followupId]);
    await logAudit(tx, {
      userId: params.userId, patientId: c?.patient_id, caseId: old.case_id,
      action: "SAVE_FOLLOWUP", entityType: "FOLLOWUP", recordId: params.followupId,
      oldValue: JSON.stringify(old), newValue: JSON.stringify(params),
    });
  });
}

export async function addPostoperativeOutcome(
  db: Db,
  params: {
    caseId: string;
    followupId?: string | null;
    eventType: OutcomeType;
    occurredAt: string;
    detectedAt?: string | null;
    ssiType?: PostoperativeOutcome["ssi_type"];
    caseProcedureId?: string | null;
    evidenceSource?: string | null;
    notes?: string | null;
    userId?: string | null;
  },
): Promise<string> {
  if (!validClinicalTimestamp(params.occurredAt)) throw new Error("Enter a full event date and time.");
  if (params.detectedAt && !validClinicalTimestamp(params.detectedAt)) throw new Error("Enter a full detection date and time.");
  if (params.eventType === "SURGICAL_SITE_INFECTION" && (!params.ssiType || !params.evidenceSource?.trim())) {
    throw new Error("Infection type and evidence source are required.");
  }
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");
  if (params.followupId) {
    const found = await db.select<{ followup_id: string }>(
      "SELECT followup_id FROM case_followup_assessments WHERE followup_id = ? AND case_id = ?",
      [params.followupId, params.caseId]);
    if (!found.length) throw new Error("Follow-up does not belong to this case.");
  }
  if (params.caseProcedureId) {
    const found = await db.select<{ case_procedure_id: string }>(
      "SELECT case_procedure_id FROM case_procedures WHERE case_procedure_id = ? AND case_id = ?",
      [params.caseProcedureId, params.caseId]);
    if (!found.length) throw new Error("Procedure does not belong to this case.");
  }
  if (params.eventType === "SURGICAL_SITE_INFECTION") {
    const procedures = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM case_procedures WHERE case_id = ?", [params.caseId]);
    if ((procedures[0]?.n || 0) > 1 && !params.caseProcedureId) {
      throw new Error("Select the procedure linked to this infection.");
    }
  }
  const id = uuid();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO postoperative_outcomes
       (outcome_id, case_id, followup_id, event_type, occurred_at, detected_at,
        ssi_type, case_procedure_id, evidence_source, notes, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, params.caseId, params.followupId || null, params.eventType, params.occurredAt,
        params.detectedAt || null, params.ssiType || null, params.caseProcedureId || null,
        params.evidenceSource?.trim() || null, params.notes?.trim() || null, params.userId || null, now]);
    await logAudit(tx, {
      userId: params.userId, patientId: c.patient_id, caseId: params.caseId,
      action: "ADD_POSTOPERATIVE_OUTCOME", entityType: "POSTOPERATIVE_OUTCOME", recordId: id,
      newValue: JSON.stringify(params),
    });
  });
  return id;
}

export async function getFollowupQueue(db: Db): Promise<{
  case_id: string; case_number: string; patient_name: string; due_date: string | null; status: string;
}[]> {
  return db.select(
    `SELECT c.case_id, c.case_number, p.last_name || ', ' || p.first_name AS patient_name,
       f.due_date, COALESCE(f.status, 'NOT_CREATED') AS status
     FROM surgical_cases c
     JOIN patients p ON p.patient_id = c.patient_id
     LEFT JOIN case_followup_assessments f ON f.case_id = c.case_id AND f.target_day = 30
     WHERE c.case_status = 'COMPLETED'
     ORDER BY CASE WHEN f.due_date IS NULL THEN 0 ELSE 1 END, f.due_date, c.created_at DESC`);
}
