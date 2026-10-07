import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";

export interface ScheduleItem {
  schedule_id: string;
  case_id: string;
  or_room_id: string;
  room_name?: string;
  scheduled_date: string;
  scheduled_start: string;
  estimated_duration_minutes: number;
  scheduled_end?: string;
  actual_room_in: string | null;
  actual_procedure_start: string | null;
  actual_procedure_end: string | null;
  actual_room_out: string | null;
  schedule_status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "POSTPONED" | "CANCELLED";
  delay_minutes: number | null;
  delay_reason_id: string | null;
  delay_reason_name?: string | null;
  cancellation_reason_id: string | null;
  cancellation_reason_name?: string | null;
  notes: string | null;
  // Patient & Case details
  patient_id?: string;
  patient_name?: string;
  patient_hrn?: string | null;
  case_number?: string;
  case_status?: string;
  planned_procedure_summary?: string | null;
  specialty_name?: string | null;
  surgeon_names?: string[];
  anesthesiologist_names?: string[];
}

export interface SchedulingConflict {
  type: "ROOM_OVERLAP" | "PATIENT_OVERLAP" | "SURGEON_OVERLAP" | "ANESTHESIOLOGIST_OVERLAP";
  description: string;
  conflictingCaseNumber: string;
  conflictingPatientName: string;
  conflictingTimeRange: string;
}

export function parseMinutesFromMidnight(timeStr: string): number {
  // HH:MM or HH:MM:SS
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

export function formatTimeFromMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function calculateEndTime(start: string, durationMinutes: number): string {
  const startMins = parseMinutesFromMidnight(start);
  return formatTimeFromMinutes(startMins + durationMinutes);
}

export function isTimeOverlapping(
  startA: string,
  durationA: number,
  startB: string,
  durationB: number
): boolean {
  const aStart = parseMinutesFromMidnight(startA);
  const aEnd = aStart + durationA;
  const bStart = parseMinutesFromMidnight(startB);
  const bEnd = bStart + durationB;

  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

export async function checkSchedulingConflicts(
  db: Db,
  params: {
    caseId: string;
    roomId: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    excludeScheduleId?: string;
  }
): Promise<SchedulingConflict[]> {
  const conflicts: SchedulingConflict[] = [];

  // 1. Check OR Room overlap on the same date
  const roomSchedules = await db.select<any>(
    `SELECT s.*, c.case_number, p.first_name, p.last_name
     FROM or_schedule s
     JOIN surgical_cases c ON s.case_id = c.case_id
     JOIN patients p ON c.patient_id = p.patient_id
     WHERE s.or_room_id = ?
       AND s.scheduled_date = ?
       AND s.schedule_status NOT IN ('CANCELLED', 'POSTPONED')
       ${params.excludeScheduleId ? "AND s.schedule_id != ?" : ""}`,
    params.excludeScheduleId
      ? [params.roomId, params.date, params.excludeScheduleId]
      : [params.roomId, params.date]
  );

  for (const s of roomSchedules) {
    if (isTimeOverlapping(params.startTime, params.durationMinutes, s.scheduled_start, s.estimated_duration_minutes)) {
      const endTime = calculateEndTime(s.scheduled_start, s.estimated_duration_minutes);
      conflicts.push({
        type: "ROOM_OVERLAP",
        description: `Room is already reserved by case ${s.case_number} (${s.scheduled_start} - ${endTime}).`,
        conflictingCaseNumber: s.case_number,
        conflictingPatientName: `${s.last_name}, ${s.first_name}`,
        conflictingTimeRange: `${s.scheduled_start} - ${endTime}`,
      });
    }
  }

  // 2. Check patient overlap on same date across any room
  const targetCase = await getCaseById(db, params.caseId);
  if (targetCase) {
    const patientSchedules = await db.select<any>(
      `SELECT s.*, c.case_number, r.name as room_name
       FROM or_schedule s
       JOIN surgical_cases c ON s.case_id = c.case_id
       JOIN or_rooms r ON s.or_room_id = r.or_room_id
       WHERE c.patient_id = ?
         AND s.scheduled_date = ?
         AND s.schedule_status NOT IN ('CANCELLED', 'POSTPONED')
         ${params.excludeScheduleId ? "AND s.schedule_id != ?" : ""}`,
      params.excludeScheduleId
        ? [targetCase.patient_id, params.date, params.excludeScheduleId]
        : [targetCase.patient_id, params.date]
    );

    for (const s of patientSchedules) {
      if (isTimeOverlapping(params.startTime, params.durationMinutes, s.scheduled_start, s.estimated_duration_minutes)) {
        const endTime = calculateEndTime(s.scheduled_start, s.estimated_duration_minutes);
        conflicts.push({
          type: "PATIENT_OVERLAP",
          description: `Patient is already scheduled for case ${s.case_number} in ${s.room_name} (${s.scheduled_start} - ${endTime}).`,
          conflictingCaseNumber: s.case_number,
          conflictingPatientName: targetCase.patient_name || "",
          conflictingTimeRange: `${s.scheduled_start} - ${endTime}`,
        });
      }
    }
  }

  // 3. Check staff team overlap (Surgeon and Anesthesiologist)
  const currentTeam = await db.select<any>(
    `SELECT ct.staff_id, st.full_name, tr.name as role_name, tr.conflict_checked
     FROM case_team ct
     JOIN staff st ON ct.staff_id = st.staff_id
     JOIN team_roles tr ON ct.role = tr.team_role_id
     WHERE ct.case_id = ? AND tr.conflict_checked = 1`,
    [params.caseId]
  );

  for (const member of currentTeam) {
    const otherCases = await db.select<any>(
      `SELECT s.*, c.case_number, p.first_name, p.last_name, r.name as room_name, tr.name as role_name
       FROM case_team ct
       JOIN or_schedule s ON s.case_id = ct.case_id
       JOIN surgical_cases c ON s.case_id = c.case_id
       JOIN patients p ON c.patient_id = p.patient_id
       JOIN or_rooms r ON s.or_room_id = r.or_room_id
       JOIN team_roles tr ON ct.role = tr.team_role_id
       WHERE ct.staff_id = ?
         AND s.scheduled_date = ?
         AND s.schedule_status NOT IN ('CANCELLED', 'POSTPONED')
         ${params.excludeScheduleId ? "AND s.schedule_id != ?" : ""}`,
      params.excludeScheduleId
        ? [member.staff_id, params.date, params.excludeScheduleId]
        : [member.staff_id, params.date]
    );

    for (const oc of otherCases) {
      if (isTimeOverlapping(params.startTime, params.durationMinutes, oc.scheduled_start, oc.estimated_duration_minutes)) {
        const endTime = calculateEndTime(oc.scheduled_start, oc.estimated_duration_minutes);
        const conflictType = oc.role_name.toLowerCase().includes("anesthes")
          ? "ANESTHESIOLOGIST_OVERLAP"
          : "SURGEON_OVERLAP";

        conflicts.push({
          type: conflictType,
          description: `${member.full_name} (${member.role_name}) is already assigned to case ${oc.case_number} in ${oc.room_name} (${oc.scheduled_start} - ${endTime}).`,
          conflictingCaseNumber: oc.case_number,
          conflictingPatientName: `${oc.last_name}, ${oc.first_name}`,
          conflictingTimeRange: `${oc.scheduled_start} - ${endTime}`,
        });
      }
    }
  }

  return conflicts;
}

export async function scheduleCase(
  db: Db,
  params: {
    caseId: string;
    roomId: string;
    date: string;
    startTime: string;
    estimatedDurationMinutes: number;
    notes?: string | null;
    userId?: string | null;
    allowConflictOverride?: boolean;
  }
): Promise<{ scheduleId: string; conflicts: SchedulingConflict[] }> {
  const conflicts = await checkSchedulingConflicts(db, {
    caseId: params.caseId,
    roomId: params.roomId,
    date: params.date,
    startTime: params.startTime,
    durationMinutes: params.estimatedDurationMinutes,
  });

  if (conflicts.length > 0 && !params.allowConflictOverride) {
    return { scheduleId: "", conflicts };
  }

  const scheduleId = uuid();
  const now = nowIso();
  const targetCase = await getCaseById(db, params.caseId);
  if (!targetCase) throw new Error("Case not found.");

  await db.transaction(async (tx) => {
    // Delete any old schedule for this case
    await tx.execute("DELETE FROM or_schedule WHERE case_id = ?", [params.caseId]);

    await tx.execute(
      `INSERT INTO or_schedule (
        schedule_id, case_id, or_room_id, scheduled_date, scheduled_start,
        estimated_duration_minutes, schedule_status, notes,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
      [
        scheduleId,
        params.caseId,
        params.roomId,
        params.date,
        params.startTime,
        params.estimatedDurationMinutes,
        params.notes || null,
        params.userId || null,
        params.userId || null,
        now,
        now,
      ]
    );

    // Update case status to SCHEDULED
    await tx.execute(
      "UPDATE surgical_cases SET case_status = 'SCHEDULED', updated_by = ?, updated_at = ? WHERE case_id = ?",
      [params.userId || null, now, params.caseId]
    );

    await logAudit(tx, {
      userId: params.userId,
      patientId: targetCase.patient_id,
      admissionId: targetCase.admission_id,
      caseId: params.caseId,
      action: "SCHEDULE_CASE",
      entityType: "OR_SCHEDULE",
      recordId: scheduleId,
      newValue: JSON.stringify({
        date: params.date,
        start: params.startTime,
        roomId: params.roomId,
        duration: params.estimatedDurationMinutes,
      }),
    });
  });

  return { scheduleId, conflicts };
}

export async function getScheduleByDate(db: Db, date: string): Promise<ScheduleItem[]> {
  const rows = await db.select<any>(
    `SELECT s.*, r.name as room_name,
            c.case_number, c.case_status, c.planned_procedure_summary,
            spec.name as specialty_name,
            p.patient_id, p.first_name, p.last_name, p.hrn as patient_hrn,
            dr.name as delay_reason_name, cr.name as cancellation_reason_name
     FROM or_schedule s
     JOIN or_rooms r ON s.or_room_id = r.or_room_id
     JOIN surgical_cases c ON s.case_id = c.case_id
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN specialties spec ON c.specialty_id = spec.specialty_id
     LEFT JOIN delay_reasons dr ON s.delay_reason_id = dr.delay_reason_id
     LEFT JOIN cancellation_reasons cr ON s.cancellation_reason_id = cr.cancellation_reason_id
     WHERE s.scheduled_date = ?
     ORDER BY s.scheduled_start ASC`,
    [date]
  );

  return rows.map((r) => ({
    ...r,
    patient_name: `${r.last_name}, ${r.first_name}`,
    scheduled_end: calculateEndTime(r.scheduled_start, r.estimated_duration_minutes),
  }));
}

export async function updateActualTimes(
  db: Db,
  params: {
    scheduleId: string;
    actualRoomIn?: string | null;
    actualProcedureStart?: string | null;
    actualProcedureEnd?: string | null;
    actualRoomOut?: string | null;
    delayMinutes?: number | null;
    delayReasonId?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  const now = nowIso();
  const scheduleRows = await db.select<any>(
    "SELECT * FROM or_schedule WHERE schedule_id = ?",
    [params.scheduleId]
  );
  const s = scheduleRows[0];
  if (!s) throw new Error("Schedule item not found.");

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE or_schedule
       SET actual_room_in = COALESCE(?, actual_room_in),
           actual_procedure_start = COALESCE(?, actual_procedure_start),
           actual_procedure_end = COALESCE(?, actual_procedure_end),
           actual_room_out = COALESCE(?, actual_room_out),
           delay_minutes = COALESCE(?, delay_minutes),
           delay_reason_id = COALESCE(?, delay_reason_id),
           updated_by = ?, updated_at = ?
       WHERE schedule_id = ?`,
      [
        params.actualRoomIn ?? null,
        params.actualProcedureStart ?? null,
        params.actualProcedureEnd ?? null,
        params.actualRoomOut ?? null,
        params.delayMinutes ?? null,
        params.delayReasonId ?? null,
        params.userId || null,
        now,
        params.scheduleId,
      ]
    );

    await logAudit(tx, {
      userId: params.userId,
      caseId: s.case_id,
      action: "UPDATE_SCHEDULE_TIMESTAMPS",
      entityType: "OR_SCHEDULE",
      recordId: params.scheduleId,
      newValue: JSON.stringify(params),
    });
  });
}
