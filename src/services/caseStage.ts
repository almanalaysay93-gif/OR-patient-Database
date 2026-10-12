import type { Db, RawDb } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById, type CaseStatus, type SurgicalCase } from "./patients";
import { requirePermission } from "./session";

/** Stages a supervisor can move a case to by hand. Cancelling and postponing have their own actions. */
export const MOVABLE_STAGES: { status: CaseStatus; label: string }[] = [
  { status: "PRE_OR", label: "Pre-Op (start over)" },
  { status: "SCHEDULED", label: "Scheduled" },
  { status: "IN_OR", label: "Intra-Op (in the OR)" },
  { status: "PACU", label: "Post-Op (PACU)" },
  { status: "POST_OR", label: "Post-Op (ward)" },
  { status: "COMPLETED", label: "Completed" },
];

const POSTPONABLE: CaseStatus[] = ["PRE_OR", "NOT_READY", "READY", "SCHEDULED"];

export const canCancel = (status: CaseStatus) => status !== "COMPLETED" && status !== "CANCELLED";
export const canPostpone = (status: CaseStatus) => POSTPONABLE.includes(status);

function cleanReason(reason: string): string {
  const text = (reason ?? "").trim();
  if (text.length < 3) throw new Error("Enter a reason (at least 3 characters).");
  return text;
}

async function loadCase(db: Db, caseId: string): Promise<SurgicalCase> {
  const found = await getCaseById(db, caseId);
  if (!found) throw new Error("Surgical case not found.");
  return found;
}

async function setStatus(
  tx: RawDb,
  target: SurgicalCase,
  newStatus: CaseStatus,
  reason: string,
  action: string,
  userId: string,
  now: string,
): Promise<void> {
  await tx.execute(
    "UPDATE surgical_cases SET case_status = ?, status_reason = ?, updated_by = ?, updated_at = ? WHERE case_id = ?",
    [newStatus, reason, userId, now, target.case_id],
  );
  await logAudit(tx, {
    userId,
    patientId: target.patient_id,
    admissionId: target.admission_id,
    caseId: target.case_id,
    action,
    entityType: "surgical_cases",
    recordId: target.case_id,
    fieldName: "case_status",
    oldValue: target.case_status,
    newValue: JSON.stringify({ status: newStatus, reason }),
  });
}

const setSchedule = (tx: RawDb, caseId: string, from: string[], to: string, userId: string, now: string) =>
  tx.execute(
    `UPDATE or_schedule SET schedule_status = ?, updated_by = ?, updated_at = ?
     WHERE case_id = ? AND schedule_status IN (${from.map(() => "?").join(",")})`,
    [to, userId, now, caseId, ...from],
  );

/** Cancels a case and frees its OR slot. The record and its history are kept. */
export async function cancelCase(db: Db, caseId: string, reason: string): Promise<void> {
  const userId = requirePermission("cases.edit");
  const why = cleanReason(reason);
  const target = await loadCase(db, caseId);
  if (!canCancel(target.case_status)) {
    throw new Error(target.case_status === "CANCELLED" ? "This case is already cancelled." : "A completed case cannot be cancelled.");
  }
  const now = nowIso();
  await db.transaction(async (tx) => {
    await setStatus(tx, target, "CANCELLED", why, "CANCEL_CASE", userId, now);
    await setSchedule(tx, caseId, ["SCHEDULED", "IN_PROGRESS", "POSTPONED"], "CANCELLED", userId, now);
  });
}

/** Postpones a case that has not started and frees its OR slot. */
export async function postponeCase(db: Db, caseId: string, reason: string): Promise<void> {
  const userId = requirePermission("cases.edit");
  const why = cleanReason(reason);
  const target = await loadCase(db, caseId);
  if (!canPostpone(target.case_status)) {
    throw new Error("Only a case that has not started can be postponed.");
  }
  const now = nowIso();
  await db.transaction(async (tx) => {
    await setStatus(tx, target, "POSTPONED", why, "POSTPONE_CASE", userId, now);
    await setSchedule(tx, caseId, ["SCHEDULED"], "POSTPONED", userId, now);
  });
}

/**
 * Moves a case to another stage by hand, forwards or backwards, to correct a mistake.
 * Also reopens a cancelled or postponed case. Clinical records already saved are kept.
 */
export async function moveCaseStage(db: Db, caseId: string, newStatus: CaseStatus, reason: string): Promise<void> {
  const userId = requirePermission("cases.change_stage");
  const why = cleanReason(reason);
  if (!MOVABLE_STAGES.some((s) => s.status === newStatus)) {
    throw new Error("A case cannot be moved to that stage here.");
  }
  const target = await loadCase(db, caseId);
  if (target.case_status === newStatus) throw new Error("The case is already in that stage.");

  if (newStatus === "SCHEDULED") {
    const slots = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM or_schedule WHERE case_id = ? AND schedule_status NOT IN ('CANCELLED','POSTPONED')",
      [caseId],
    );
    if (!slots[0]?.n) {
      throw new Error("This case has no OR booking. Book it on the Schedule screen instead (a cancelled or postponed case must be moved to Pre-Op first).");
    }
  }

  const now = nowIso();
  await db.transaction(async (tx) => {
    await setStatus(tx, target, newStatus, why, "MOVE_CASE_STAGE", userId, now);
    if (newStatus === "COMPLETED") {
      await setSchedule(tx, caseId, ["SCHEDULED", "IN_PROGRESS"], "COMPLETED", userId, now);
    } else if (newStatus === "PRE_OR" || newStatus === "SCHEDULED") {
      await setSchedule(tx, caseId, ["IN_PROGRESS", "COMPLETED"], "SCHEDULED", userId, now);
    } else {
      await setSchedule(tx, caseId, ["SCHEDULED", "COMPLETED"], "IN_PROGRESS", userId, now);
    }
  });
}
