import type { Db } from "../data/db";
import { calculateAge, formatResearchId } from "./patients";
import { getAnalyticsSummary } from "./analytics";
import { computeReadiness, type ChecklistItemValue } from "./preOr";

/**
 * Read-only data tools for the AI assistant.
 *
 * Everything returned from here is sent to an external model, so results are
 * de-identified: patients appear only as research IDs with age and sex. Names,
 * HRN, date of birth, address, contact number, admission number and free-text
 * notes never leave this module. Names are kept locally in the EntityMap so the
 * UI can show them next to the research ID.
 */

export interface EntityRef {
  kind: "patient" | "case";
  patientId: string;
  caseId?: string;
  /** Shown to the user only. Never sent to the model. */
  label: string;
}

/** Token as it appears in model text (research ID or case number) -> local record. */
export type EntityMap = Map<string, EntityRef>;

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const CASE_STATUSES = [
  "PRE_OR", "NOT_READY", "READY", "SCHEDULED", "IN_OR", "PACU", "POST_OR", "COMPLETED", "POSTPONED", "CANCELLED",
];
const CASE_TYPES = ["ELECTIVE", "EMERGENCY", "URGENT"];

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_or_schedule",
      description:
        "List every case on the operating room schedule for one date, ordered by start time, with room, times, status, delay and surgical team.",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "Date as YYYY-MM-DD" } },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_cases",
      description:
        "Search surgical cases with optional filters. Returns the total match count and up to `limit` cases. Use for counts and lists such as cancelled cases, emergency cases or cases of one specialty.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: CASE_STATUSES },
          case_type: { type: "string", enum: CASE_TYPES },
          specialty: { type: "string", description: "Specialty name or part of it" },
          procedure: { type: "string", description: "Text contained in the planned procedure" },
          scheduled_from: { type: "string", description: "Earliest scheduled date, YYYY-MM-DD" },
          scheduled_to: { type: "string", description: "Latest scheduled date, YYYY-MM-DD" },
          limit: { type: "integer", description: "Maximum cases to return (default 50, max 200)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_case",
      description:
        "Full record for one surgical case by case number: patient research ID, diagnoses, schedule, pre-operative checklist and readiness, intra-operative record, post-operative record, complications and team.",
      parameters: {
        type: "object",
        properties: { case_number: { type: "string" } },
        required: ["case_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_patient",
      description:
        "Look up patients by name, hospital record number or research ID. The match happens on the workstation; only research IDs, age and sex are returned.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_patient",
      description: "Admissions and surgical cases for one patient by research ID (for example OR-000012).",
      parameters: {
        type: "object",
        properties: { research_id: { type: "string" } },
        required: ["research_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_preor_readiness",
      description:
        "Pre-operative board: every case not yet in the operating room with its readiness percentage and the checklist items still pending or failed.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_analytics_summary",
      description:
        "Aggregate statistics: case volumes by status, type, specialty and procedure, patient age and sex distribution, post-operative destinations and complication rates. Dates filter on when the case was created.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "YYYY-MM-DD" },
          end_date: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
  },
];

type Args = Record<string, unknown>;

function str(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function dateArg(args: Args, key: string, required = false): string | undefined {
  const v = str(args, key);
  if (!v) {
    if (required) throw new Error(`${key} is required (YYYY-MM-DD).`);
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${key} must be a date formatted YYYY-MM-DD.`);
  return v;
}

/** Ages above 89 are grouped, as in Safe Harbor de-identification. */
function safeAge(dob: string | null, refDate?: string | null): number | string | null {
  const age = calculateAge(dob, refDate);
  if (age == null) return null;
  return age > 89 ? "90+" : age;
}

const flag = (v: unknown): boolean | null => (v == null ? null : v === 1 || v === "1");

function patientLabel(r: { first_name: string; last_name: string }): string {
  return `${r.last_name}, ${r.first_name}`;
}

function registerPatient(entities: EntityMap, r: any): string {
  const researchId = formatResearchId(r.research_seq);
  entities.set(researchId, { kind: "patient", patientId: r.patient_id, label: patientLabel(r) });
  return researchId;
}

function registerCase(entities: EntityMap, r: any): void {
  if (!r.case_number) return;
  entities.set(r.case_number, {
    kind: "case",
    patientId: r.patient_id,
    caseId: r.case_id,
    label: `${r.case_number} · ${patientLabel(r)}`,
  });
}

async function teamByCase(db: Db, caseIds: string[]): Promise<Map<string, { role: string; name: string }[]>> {
  const out = new Map<string, { role: string; name: string }[]>();
  if (caseIds.length === 0) return out;
  const rows = await db.select<any>(
    `SELECT ct.case_id, tr.name as role, st.full_name as name
     FROM case_team ct
     JOIN staff st ON ct.staff_id = st.staff_id
     JOIN team_roles tr ON ct.role = tr.team_role_id
     WHERE ct.case_id IN (${caseIds.map(() => "?").join(",")})
     ORDER BY tr.display_order`,
    caseIds
  );
  for (const r of rows) {
    const list = out.get(r.case_id) ?? [];
    list.push({ role: r.role, name: r.name });
    out.set(r.case_id, list);
  }
  return out;
}

const LATEST_SCHEDULE_JOIN = `LEFT JOIN or_schedule sch ON sch.schedule_id = (
       SELECT schedule_id FROM or_schedule WHERE case_id = c.case_id
       ORDER BY scheduled_date DESC, scheduled_start DESC LIMIT 1)`;

async function getOrSchedule(db: Db, args: Args, entities: EntityMap) {
  const date = dateArg(args, "date", true)!;
  const rows = await db.select<any>(
    `SELECT s.scheduled_start, s.estimated_duration_minutes, s.actual_room_in, s.actual_procedure_start,
            s.actual_procedure_end, s.actual_room_out, s.schedule_status, s.delay_minutes,
            r.name as room_name, dr.name as delay_reason, cr.name as cancellation_reason,
            c.case_id, c.case_number, c.case_type, c.case_status, c.planned_procedure_summary,
            spec.name as specialty_name,
            p.patient_id, p.research_seq, p.first_name, p.last_name, p.date_of_birth, p.sex
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
  const teams = await teamByCase(db, rows.map((r) => r.case_id));
  return {
    date,
    case_count: rows.length,
    cases: rows.map((r) => {
      registerCase(entities, r);
      return {
        room: r.room_name,
        scheduled_start: r.scheduled_start,
        estimated_duration_minutes: r.estimated_duration_minutes,
        schedule_status: r.schedule_status,
        case_number: r.case_number,
        case_status: r.case_status,
        case_type: r.case_type,
        procedure: r.planned_procedure_summary,
        specialty: r.specialty_name,
        patient_research_id: registerPatient(entities, r),
        patient_age: safeAge(r.date_of_birth, date),
        patient_sex: r.sex,
        actual_room_in: r.actual_room_in,
        actual_procedure_start: r.actual_procedure_start,
        actual_procedure_end: r.actual_procedure_end,
        actual_room_out: r.actual_room_out,
        delay_minutes: r.delay_minutes,
        delay_reason: r.delay_reason,
        cancellation_reason: r.cancellation_reason,
        team: teams.get(r.case_id) ?? [],
      };
    }),
  };
}

async function listCases(db: Db, args: Args, entities: EntityMap) {
  const where: string[] = [];
  const params: (string | number)[] = [];

  const status = str(args, "status")?.toUpperCase();
  if (status) {
    if (!CASE_STATUSES.includes(status)) throw new Error(`status must be one of ${CASE_STATUSES.join(", ")}.`);
    where.push("c.case_status = ?");
    params.push(status);
  }
  const caseType = str(args, "case_type")?.toUpperCase();
  if (caseType) {
    if (!CASE_TYPES.includes(caseType)) throw new Error(`case_type must be one of ${CASE_TYPES.join(", ")}.`);
    where.push("c.case_type = ?");
    params.push(caseType);
  }
  const specialty = str(args, "specialty");
  if (specialty) {
    where.push("spec.name LIKE ?");
    params.push(`%${specialty}%`);
  }
  const procedure = str(args, "procedure");
  if (procedure) {
    where.push("c.planned_procedure_summary LIKE ?");
    params.push(`%${procedure}%`);
  }
  const from = dateArg(args, "scheduled_from");
  if (from) {
    where.push("sch.scheduled_date >= ?");
    params.push(from);
  }
  const to = dateArg(args, "scheduled_to");
  if (to) {
    where.push("sch.scheduled_date <= ?");
    params.push(to);
  }
  const rawLimit = Number(args.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;

  const from_ = `FROM surgical_cases c
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN specialties spec ON c.specialty_id = spec.specialty_id
     ${LATEST_SCHEDULE_JOIN}
     LEFT JOIN or_rooms r ON sch.or_room_id = r.or_room_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;

  const total = await db.select<{ count: number }>(`SELECT COUNT(*) as count ${from_}`, params);
  const rows = await db.select<any>(
    `SELECT c.case_id, c.case_number, c.case_type, c.case_status, c.planned_procedure_summary,
            spec.name as specialty_name, sch.scheduled_date, sch.scheduled_start, sch.delay_minutes,
            r.name as room_name,
            p.patient_id, p.research_seq, p.first_name, p.last_name, p.date_of_birth, p.sex
     ${from_}
     ORDER BY sch.scheduled_date DESC, sch.scheduled_start DESC, c.created_at DESC
     LIMIT ?`,
    [...params, limit]
  );

  return {
    total_matching: total[0]?.count ?? 0,
    returned: rows.length,
    cases: rows.map((r) => {
      registerCase(entities, r);
      return {
        case_number: r.case_number,
        case_status: r.case_status,
        case_type: r.case_type,
        procedure: r.planned_procedure_summary,
        specialty: r.specialty_name,
        scheduled_date: r.scheduled_date,
        scheduled_start: r.scheduled_start,
        room: r.room_name,
        delay_minutes: r.delay_minutes,
        patient_research_id: registerPatient(entities, r),
        patient_age: safeAge(r.date_of_birth, r.scheduled_date),
        patient_sex: r.sex,
      };
    }),
  };
}

async function getCase(db: Db, args: Args, entities: EntityMap) {
  const caseNumber = str(args, "case_number");
  if (!caseNumber) throw new Error("case_number is required.");

  const rows = await db.select<any>(
    `SELECT c.case_id, c.case_number, c.case_type, c.case_status, c.priority, c.laterality,
            c.planned_procedure_summary, c.preoperative_diagnosis_summary, c.postoperative_diagnosis_summary,
            spec.name as specialty_name,
            a.admission_date, a.discharge_date, a.ward, a.attending_physician, a.status as admission_status,
            p.patient_id, p.research_seq, p.first_name, p.last_name, p.date_of_birth, p.sex, p.blood_type
     FROM surgical_cases c
     JOIN patients p ON c.patient_id = p.patient_id
     JOIN admissions a ON c.admission_id = a.admission_id
     LEFT JOIN specialties spec ON c.specialty_id = spec.specialty_id
     WHERE c.case_number = ? COLLATE NOCASE`,
    [caseNumber]
  );
  const c = rows[0];
  if (!c) return { found: false, message: `No surgical case has the number "${caseNumber}".` };
  registerCase(entities, c);

  const [schedule, checklist, intra, post, complications, teams] = await Promise.all([
    db.select<any>(
      `SELECT s.scheduled_date, s.scheduled_start, s.estimated_duration_minutes, s.schedule_status,
              s.actual_room_in, s.actual_procedure_start, s.actual_procedure_end, s.actual_room_out,
              s.delay_minutes, r.name as room, dr.name as delay_reason, cr.name as cancellation_reason
       FROM or_schedule s
       JOIN or_rooms r ON s.or_room_id = r.or_room_id
       LEFT JOIN delay_reasons dr ON s.delay_reason_id = dr.delay_reason_id
       LEFT JOIN cancellation_reasons cr ON s.cancellation_reason_id = cr.cancellation_reason_id
       WHERE s.case_id = ?
       ORDER BY s.scheduled_date, s.scheduled_start`,
      [c.case_id]
    ),
    db.select<ChecklistItemValue>(
      `SELECT v.status, v.completed_at, d.name as item_name
       FROM pre_or_checklist_values v
       JOIN pre_or_checklist_definitions d ON v.checklist_item_id = d.checklist_item_id
       WHERE v.case_id = ?
       ORDER BY d.display_order`,
      [c.case_id]
    ),
    db.select<any>(
      `SELECT at.name as anesthesia_type, i.asa_classification, i.estimated_blood_loss_ml,
              i.blood_transfusion, i.units_transfused, i.specimen_collected, i.implant_used,
              i.procedure_start, i.procedure_end
       FROM intra_or_records i
       LEFT JOIN anesthesia_types at ON i.anesthesia_type_id = at.anesthesia_type_id
       WHERE i.case_id = ?`,
      [c.case_id]
    ),
    db.select<any>(
      `SELECT r.pacu_admission, r.pacu_discharge, d.name as destination, r.post_op_status, r.pain_score,
              r.complications_present, r.icu_required, r.reoperation_required, r.mortality
       FROM post_or_records r
       LEFT JOIN post_op_destinations d ON r.post_op_destination_id = d.destination_id
       WHERE r.case_id = ?`,
      [c.case_id]
    ),
    db.select<any>(
      `SELECT ct.name as complication, ct.category, cp.severity, cp.occurred_at
       FROM complications cp
       JOIN complication_types ct ON cp.complication_type_id = ct.complication_type_id
       WHERE cp.case_id = ?
       ORDER BY cp.occurred_at`,
      [c.case_id]
    ),
    teamByCase(db, [c.case_id]),
  ]);

  const readiness = computeReadiness(checklist);
  const i = intra[0];
  const po = post[0];
  const lastSchedule = schedule[schedule.length - 1];

  return {
    found: true,
    case_number: c.case_number,
    case_status: c.case_status,
    case_type: c.case_type,
    priority: c.priority,
    laterality: c.laterality,
    specialty: c.specialty_name,
    procedure: c.planned_procedure_summary,
    preoperative_diagnosis: c.preoperative_diagnosis_summary,
    postoperative_diagnosis: c.postoperative_diagnosis_summary,
    patient: {
      research_id: registerPatient(entities, c),
      age: safeAge(c.date_of_birth, lastSchedule?.scheduled_date),
      sex: c.sex,
      blood_type: c.blood_type,
    },
    admission: {
      status: c.admission_status,
      admission_date: c.admission_date,
      discharge_date: c.discharge_date,
      ward: c.ward,
      attending_physician: c.attending_physician,
    },
    schedule,
    pre_or: {
      readiness_percentage: readiness.readinessPercentage,
      is_ready: readiness.isReady,
      checklist: checklist.map((x) => ({ item: x.item_name, status: x.status, completed_at: x.completed_at })),
    },
    intra_or: i
      ? {
          anesthesia_type: i.anesthesia_type,
          asa_classification: i.asa_classification,
          estimated_blood_loss_ml: i.estimated_blood_loss_ml,
          blood_transfusion: flag(i.blood_transfusion),
          units_transfused: i.units_transfused,
          specimen_collected: flag(i.specimen_collected),
          implant_used: flag(i.implant_used),
          procedure_start: i.procedure_start,
          procedure_end: i.procedure_end,
        }
      : null,
    post_or: po
      ? {
          pacu_admission: po.pacu_admission,
          pacu_discharge: po.pacu_discharge,
          destination: po.destination,
          post_op_status: po.post_op_status,
          pain_score: po.pain_score,
          complications_present: flag(po.complications_present),
          icu_required: flag(po.icu_required),
          reoperation_required: flag(po.reoperation_required),
          mortality: flag(po.mortality),
        }
      : null,
    complications,
    team: teams.get(c.case_id) ?? [],
  };
}

function parseResearchSeq(text: string): number | null {
  const m = /^\s*OR-?\s*(\d+)\s*$/i.exec(text);
  return m ? Number(m[1]) : null;
}

async function findPatient(db: Db, args: Args, entities: EntityMap) {
  const query = str(args, "query");
  if (!query) throw new Error("query is required.");

  let rows: any[];
  const seq = parseResearchSeq(query);
  if (seq != null) {
    rows = await db.select<any>(
      `SELECT patient_id, research_seq, first_name, last_name, date_of_birth, sex FROM patients WHERE research_seq = ?`,
      [seq]
    );
  } else {
    // Every word must match some name part or the HRN, so "Juan Dela Cruz" and "Dela Cruz, Juan" both work.
    const tokens = query.split(/[\s,]+/).filter(Boolean).slice(0, 6);
    const clause = tokens
      .map(() => "(first_name LIKE ? OR last_name LIKE ? OR middle_name LIKE ? OR hrn LIKE ?)")
      .join(" AND ");
    const params = tokens.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`]);
    rows = await db.select<any>(
      `SELECT patient_id, research_seq, first_name, last_name, date_of_birth, sex
       FROM patients WHERE is_active = 1 AND ${clause}
       ORDER BY updated_at DESC LIMIT 10`,
      params
    );
  }

  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const countRows = await db.select<{ patient_id: string; count: number }>(
      `SELECT patient_id, COUNT(*) as count FROM surgical_cases
       WHERE patient_id IN (${rows.map(() => "?").join(",")}) GROUP BY patient_id`,
      rows.map((r) => r.patient_id)
    );
    for (const r of countRows) counts.set(r.patient_id, r.count);
  }

  return {
    match_count: rows.length,
    patients: rows.map((r) => ({
      research_id: registerPatient(entities, r),
      age: safeAge(r.date_of_birth),
      sex: r.sex,
      surgical_case_count: counts.get(r.patient_id) ?? 0,
    })),
  };
}

async function getPatient(db: Db, args: Args, entities: EntityMap) {
  const seq = parseResearchSeq(str(args, "research_id") ?? "");
  if (seq == null) throw new Error("research_id must look like OR-000012.");

  const rows = await db.select<any>(
    `SELECT patient_id, research_seq, first_name, last_name, date_of_birth, sex, blood_type, is_active
     FROM patients WHERE research_seq = ?`,
    [seq]
  );
  const p = rows[0];
  if (!p) return { found: false, message: `No patient has research ID ${formatResearchId(seq)}.` };

  const [admissions, cases] = await Promise.all([
    db.select<any>(
      `SELECT admission_date, discharge_date, ward, attending_physician, status
       FROM admissions WHERE patient_id = ? ORDER BY admission_date DESC`,
      [p.patient_id]
    ),
    db.select<any>(
      `SELECT c.case_id, c.patient_id, c.case_number, c.case_type, c.case_status, c.planned_procedure_summary,
              spec.name as specialty_name, sch.scheduled_date, sch.scheduled_start, r.name as room_name
       FROM surgical_cases c
       LEFT JOIN specialties spec ON c.specialty_id = spec.specialty_id
       ${LATEST_SCHEDULE_JOIN}
       LEFT JOIN or_rooms r ON sch.or_room_id = r.or_room_id
       WHERE c.patient_id = ?
       ORDER BY c.created_at DESC`,
      [p.patient_id]
    ),
  ]);

  return {
    found: true,
    research_id: registerPatient(entities, p),
    age: safeAge(p.date_of_birth),
    sex: p.sex,
    blood_type: p.blood_type,
    active: flag(p.is_active),
    admissions,
    cases: cases.map((c) => {
      registerCase(entities, { ...c, first_name: p.first_name, last_name: p.last_name });
      return {
        case_number: c.case_number,
        case_status: c.case_status,
        case_type: c.case_type,
        procedure: c.planned_procedure_summary,
        specialty: c.specialty_name,
        scheduled_date: c.scheduled_date,
        scheduled_start: c.scheduled_start,
        room: c.room_name,
      };
    }),
  };
}

async function getPreOrReadiness(db: Db, entities: EntityMap) {
  const rows = await db.select<any>(
    `SELECT c.case_id, c.case_number, c.case_type, c.case_status, c.planned_procedure_summary,
            spec.name as specialty_name, sch.scheduled_date, sch.scheduled_start, r.name as room_name,
            p.patient_id, p.research_seq, p.first_name, p.last_name, p.date_of_birth, p.sex
     FROM surgical_cases c
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN specialties spec ON c.specialty_id = spec.specialty_id
     ${LATEST_SCHEDULE_JOIN}
     LEFT JOIN or_rooms r ON sch.or_room_id = r.or_room_id
     WHERE c.case_status IN ('PRE_OR', 'NOT_READY', 'READY', 'SCHEDULED')
     ORDER BY sch.scheduled_date ASC, sch.scheduled_start ASC, c.created_at DESC`
  );

  const itemsByCase = new Map<string, ChecklistItemValue[]>();
  if (rows.length > 0) {
    const items = await db.select<ChecklistItemValue>(
      `SELECT v.case_id, v.status, d.name as item_name
       FROM pre_or_checklist_values v
       JOIN pre_or_checklist_definitions d ON v.checklist_item_id = d.checklist_item_id
       WHERE v.case_id IN (${rows.map(() => "?").join(",")})
       ORDER BY d.display_order`,
      rows.map((r) => r.case_id)
    );
    for (const it of items) {
      const list = itemsByCase.get(it.case_id) ?? [];
      list.push(it);
      itemsByCase.set(it.case_id, list);
    }
  }

  return {
    case_count: rows.length,
    cases: rows.map((r) => {
      registerCase(entities, r);
      const items = itemsByCase.get(r.case_id) ?? [];
      const readiness = computeReadiness(items);
      return {
        case_number: r.case_number,
        case_status: r.case_status,
        case_type: r.case_type,
        procedure: r.planned_procedure_summary,
        specialty: r.specialty_name,
        scheduled_date: r.scheduled_date,
        scheduled_start: r.scheduled_start,
        room: r.room_name,
        patient_research_id: registerPatient(entities, r),
        patient_age: safeAge(r.date_of_birth, r.scheduled_date),
        patient_sex: r.sex,
        readiness_percentage: readiness.readinessPercentage,
        is_ready: readiness.isReady,
        pending_items: items.filter((x) => x.status === "PENDING").map((x) => x.item_name),
        failed_items: items.filter((x) => x.status === "FAILED").map((x) => x.item_name),
      };
    }),
  };
}

/** Run one tool call. Throws with a message the model can read when the arguments are invalid. */
export async function executeTool(db: Db, name: string, args: Args, entities: EntityMap): Promise<unknown> {
  switch (name) {
    case "get_or_schedule":
      return getOrSchedule(db, args, entities);
    case "list_cases":
      return listCases(db, args, entities);
    case "get_case":
      return getCase(db, args, entities);
    case "find_patient":
      return findPatient(db, args, entities);
    case "get_patient":
      return getPatient(db, args, entities);
    case "get_preor_readiness":
      return getPreOrReadiness(db, entities);
    case "get_analytics_summary":
      return getAnalyticsSummary(db, {
        startDate: dateArg(args, "start_date"),
        endDate: dateArg(args, "end_date"),
      });
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}
