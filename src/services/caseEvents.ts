import type { Db } from "../data/db";
import { nowIso, uuid } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";

export type CaseEventType = "ROOM_IN" | "ANESTHESIA_START" | "INCISION" | "CLOSURE" | "ROOM_OUT" | "PACU_IN" | "PACU_OUT";
export const CASE_EVENT_TYPES: CaseEventType[] = [
  "ROOM_IN", "ANESTHESIA_START", "INCISION", "CLOSURE", "ROOM_OUT", "PACU_IN", "PACU_OUT",
];

export interface CaseEvent {
  event_id: string;
  case_id: string;
  event_type: CaseEventType;
  occurred_at: string;
  recorded_at: string;
  recorded_by: string | null;
  correction_reason: string | null;
}

export async function getCaseEvents(db: Db, caseId: string): Promise<CaseEvent[]> {
  return db.select<CaseEvent>("SELECT * FROM case_events WHERE case_id = ? ORDER BY occurred_at", [caseId]);
}

export function validClinicalTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    /(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

export async function saveCaseEvent(
  db: Db,
  params: { caseId: string; eventType: CaseEventType; occurredAt: string; correctionReason?: string | null; userId?: string | null },
): Promise<void> {
  if (!CASE_EVENT_TYPES.includes(params.eventType)) throw new Error("Invalid event type.");
  if (!validClinicalTimestamp(params.occurredAt)) throw new Error("Enter a full date and time with a time zone.");
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Surgical case not found.");
  const oldEvents = await getCaseEvents(db, params.caseId);
  const old = oldEvents.find((e) => e.event_type === params.eventType);
  if (old && old.occurred_at !== params.occurredAt && !params.correctionReason?.trim()) {
    throw new Error("A reason is required to correct an event time.");
  }
  const merged = new Map(oldEvents.map((e) => [e.event_type, e.occurred_at]));
  merged.set(params.eventType, params.occurredAt);
  const order: CaseEventType[] = ["ROOM_IN", "INCISION", "CLOSURE", "ROOM_OUT", "PACU_IN", "PACU_OUT"];
  let prior: { type: CaseEventType; time: string } | null = null;
  for (const type of order) {
    const time = merged.get(type);
    if (!time) continue;
    if (prior && Date.parse(time) < Date.parse(prior.time)) {
      throw new Error(`${type} cannot occur before ${prior.type}.`);
    }
    prior = { type, time };
  }
  const anesthesia = merged.get("ANESTHESIA_START");
  const roomIn = merged.get("ROOM_IN");
  const incision = merged.get("INCISION");
  if (anesthesia && roomIn && Date.parse(anesthesia) < Date.parse(roomIn)) throw new Error("Anesthesia start cannot precede room entry.");
  if (anesthesia && incision && Date.parse(anesthesia) > Date.parse(incision)) throw new Error("Anesthesia start cannot follow incision.");
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO case_events
       (event_id, case_id, event_type, occurred_at, recorded_at, recorded_by, correction_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(case_id, event_type) DO UPDATE SET occurred_at=excluded.occurred_at,
       recorded_at=excluded.recorded_at, recorded_by=excluded.recorded_by,
       correction_reason=excluded.correction_reason`,
      [old?.event_id || uuid(), params.caseId, params.eventType, params.occurredAt, now,
        params.userId || null, params.correctionReason?.trim() || null]);
    await logAudit(tx, {
      userId: params.userId, patientId: c.patient_id, caseId: params.caseId,
      action: old ? "CORRECT_CASE_EVENT" : "CREATE_CASE_EVENT",
      entityType: "CASE_EVENT", recordId: old?.event_id || params.eventType,
      oldValue: old?.occurred_at || null, newValue: JSON.stringify({ occurredAt: params.occurredAt, reason: params.correctionReason || null }),
    });
  });
}

export function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / 60000);
}

export async function getRoomTurnover(db: Db, caseId: string): Promise<number | null> {
  const rows = await db.select<{ current_in: string; previous_out: string | null }>(
    `SELECT current.occurred_at AS current_in,
      (SELECT prev.occurred_at FROM case_events prev
       JOIN or_schedule ps ON ps.case_id = prev.case_id
       WHERE prev.event_type = 'ROOM_OUT' AND ps.or_room_id = s.or_room_id
         AND prev.occurred_at <= current.occurred_at AND prev.case_id <> current.case_id
         AND (julianday(current.occurred_at) - julianday(prev.occurred_at)) <= 1
       ORDER BY prev.occurred_at DESC LIMIT 1) AS previous_out
     FROM case_events current JOIN or_schedule s ON s.case_id = current.case_id
     WHERE current.case_id = ? AND current.event_type = 'ROOM_IN'
     ORDER BY s.created_at DESC LIMIT 1`, [caseId]);
  return minutesBetween(rows[0]?.previous_out, rows[0]?.current_in);
}
