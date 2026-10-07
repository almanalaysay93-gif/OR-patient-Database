import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { Db } from "../data/db";
import { CASE_STATUSES, executeTool, type EntityMap } from "./assistantTools";

/**
 * Offline assistant: answers questions about the local database with keyword rules.
 *
 * There is no AI model and no network access. A question is matched against a fixed
 * set of topics (schedule, readiness, case status, delays, complications, statistics,
 * a case number, a patient) and answered with a read-only lookup.
 */

const MAX_LINES = 25;
const ACTIVE_STATUSES = ["PRE_OR", "NOT_READY", "READY", "SCHEDULED"];

export const HELP_TEXT = [
  "I answer from this computer's database. I work offline and cannot change records. Try:",
  "- **Schedule**: \"schedule today\", \"cases tomorrow\", \"schedule this week\", \"OR 1 on 2026-10-08\"",
  "- **Readiness**: \"which cases are not ready\", \"ready cases\"",
  "- **Status**: \"cancelled cases this month\", \"emergency cases this week\", \"cases in PACU\"",
  "- **Delays**: \"delayed cases this month\"",
  "- **Complications**: \"complications this year\"",
  "- **Statistics**: \"how many cases this month\", \"summary this year\"",
  "- **One case**: type its case number",
  "- **One patient**: type the name, HRN or research ID",
].join("\n");

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

interface DateScope {
  from: string;
  to: string;
  /** How the period reads in a sentence, e.g. "today" or "this month". */
  label: string;
  single: boolean;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const day = (d: Date, label: string): DateScope => ({ from: iso(d), to: iso(d), label, single: true });
const range = (from: Date, to: Date, label: string): DateScope => ({ from: iso(from), to: iso(to), label, single: false });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Find the day or period a question refers to. Returns null when it names none. */
export function parseDateScope(text: string, now: Date): DateScope | null {
  const t = text.toLowerCase();
  const week = { weekStartsOn: 1 as const };

  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (isoMatch) return day(new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]), `on ${isoMatch[0]}`);

  if (/\b(today|tonight|now)\b/.test(t)) return day(now, "today");
  if (/\btomorrow\b/.test(t)) return day(addDays(now, 1), "tomorrow");
  if (/\byesterday\b/.test(t)) return day(addDays(now, -1), "yesterday");

  const period = /\b(this|next|last|past|previous)\s+(week|month|year)\b/.exec(t);
  if (period) {
    const shift = period[1] === "this" ? 0 : period[1] === "next" ? 1 : -1;
    const word = shift === 0 ? "this" : shift === 1 ? "next" : "last";
    if (period[2] === "week") {
      const d = addWeeks(now, shift);
      return range(startOfWeek(d, week), endOfWeek(d, week), `${word} week`);
    }
    if (period[2] === "month") {
      const d = addMonths(now, shift);
      return range(startOfMonth(d), endOfMonth(d), `${word} month`);
    }
    const d = addYears(now, shift);
    return range(startOfYear(d), endOfYear(d), `${word} year`);
  }

  const monthDay =
    new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})\\b`).exec(t) ??
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})\\b`).exec(t);
  if (monthDay) {
    const [name, num] = /\d/.test(monthDay[1]) ? [monthDay[2], monthDay[1]] : [monthDay[1], monthDay[2]];
    const d = new Date(now.getFullYear(), MONTHS.indexOf(name.slice(0, 3)), +num);
    return day(d, `on ${format(d, "MMM d")}`);
  }

  const month = new RegExp(`\\b(?:in|for|during)\\s+(${MONTH_NAMES})\\b`).exec(t);
  if (month) {
    const d = new Date(now.getFullYear(), MONTHS.indexOf(month[1].slice(0, 3)), 1);
    return range(d, endOfMonth(d), `in ${format(d, "MMMM")}`);
  }

  const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (weekday >= 0) {
    // The coming occurrence, counting today.
    const d = addDays(now, (weekday - now.getDay() + 7) % 7);
    return day(d, `on ${format(d, "EEEE, MMM d")}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const join = (parts: unknown[]) => parts.filter((p) => p != null && p !== "").join(" · ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const statusLabel = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase() : null);

function bullets(lines: string[]): string {
  const shown = lines.slice(0, MAX_LINES).map((l) => `- ${l}`);
  if (lines.length > MAX_LINES) shown.push(`- … and ${lines.length - MAX_LINES} more`);
  return shown.join("\n");
}

function caseLine(c: any, withDate: boolean): string {
  const when = withDate ? [c.scheduled_date, c.scheduled_start].filter(Boolean).join(" ") : c.scheduled_start;
  return join([
    when,
    c.room,
    c.case_number,
    c.procedure,
    c.patient_research_id,
    statusLabel(c.case_status),
    c.delay_minutes > 0 ? `delayed ${c.delay_minutes} min` : null,
  ]);
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

async function answerSchedule(db: Db, scope: DateScope, room: string | undefined, entities: EntityMap): Promise<string> {
  const where = room ? ` in ${room}` : "";
  const inRoom = (c: any) => !room || c.room === room;
  if (scope.single) {
    const r: any = await executeTool(db, "get_or_schedule", { date: scope.from }, entities);
    const cases = r.cases.filter(inRoom);
    if (cases.length === 0) return `No cases are scheduled${where} ${scope.label}.`;
    const lines = cases.map((c: any) => {
      const surgeon = c.team[0] ? `${c.team[0].role}: ${c.team[0].name}` : null;
      return join([caseLine(c, false), surgeon, c.cancellation_reason ? `cancelled: ${c.cancellation_reason}` : null]);
    });
    return `**${plural(cases.length, "case")} scheduled${where} ${scope.label}:**\n${bullets(lines)}`;
  }
  const r: any = await executeTool(db, "list_cases", { scheduled_from: scope.from, scheduled_to: scope.to, limit: 200 }, entities);
  const cases = [...r.cases].reverse().filter(inRoom);
  if (cases.length === 0) return `No cases are scheduled${where} ${scope.label}.`;
  const lines = cases.map((c: any) => caseLine(c, true));
  return `**${plural(cases.length, "case")} scheduled${where} ${scope.label}:**\n${bullets(lines)}`;
}

async function answerReadiness(db: Db, mode: "ready" | "not_ready" | "all", entities: EntityMap): Promise<string> {
  const r: any = await executeTool(db, "get_preor_readiness", {}, entities);
  const cases = r.cases.filter((c: any) => (mode === "all" ? true : mode === "ready" ? c.is_ready : !c.is_ready));
  if (r.case_count === 0) return "No cases are waiting for surgery.";
  if (cases.length === 0) {
    return mode === "ready"
      ? `None of the ${plural(r.case_count, "waiting case")} is ready yet.`
      : `All ${plural(r.case_count, "waiting case")} are ready.`;
  }
  const lines = cases.map((c: any) =>
    join([
      c.case_number,
      c.procedure,
      c.patient_research_id,
      [c.scheduled_date, c.scheduled_start].filter(Boolean).join(" ") || "not scheduled",
      `${c.readiness_percentage}% ready`,
      c.pending_items.length ? `pending: ${c.pending_items.join(", ")}` : null,
      c.failed_items.length ? `failed: ${c.failed_items.join(", ")}` : null,
    ])
  );
  const title =
    mode === "ready"
      ? `${plural(cases.length, "case")} ready for surgery`
      : mode === "not_ready"
        ? `${plural(cases.length, "case")} not ready yet (of ${r.case_count} waiting)`
        : `${plural(cases.length, "case")} waiting for surgery`;
  return `**${title}:**\n${bullets(lines)}`;
}

interface CaseFilter {
  status?: string;
  caseType?: string;
  specialty?: string;
  delayedOnly?: boolean;
}

async function answerCaseList(db: Db, filter: CaseFilter, scope: DateScope | null, entities: EntityMap): Promise<string> {
  const r: any = await executeTool(
    db,
    "list_cases",
    {
      status: filter.status,
      case_type: filter.caseType,
      specialty: filter.specialty,
      scheduled_from: scope?.from,
      scheduled_to: scope?.to,
      limit: 200,
    },
    entities
  );
  const cases = filter.delayedOnly ? r.cases.filter((c: any) => c.delay_minutes > 0) : r.cases;
  const total = filter.delayedOnly ? cases.length : r.total_matching;
  const what = join([
    filter.delayedOnly ? "delayed" : null,
    statusLabel(filter.status),
    statusLabel(filter.caseType),
    filter.specialty,
  ]).replace(/ · /g, " ");
  const period = scope ? ` ${scope.label}` : "";
  if (total === 0) return `No ${what} cases${period}.`.replace("  ", " ");
  const note = filter.delayedOnly && r.total_matching > r.returned ? `\nOnly the latest ${r.returned} cases were checked.` : "";
  return `**${plural(total, `${what} case`)}${period}:**\n${bullets(cases.map((c: any) => caseLine(c, true)))}${note}`;
}

async function answerComplications(db: Db, scope: DateScope | null, entities: EntityMap): Promise<string> {
  const s: any = await executeTool(db, "get_analytics_summary", { start_date: scope?.from, end_date: scope?.to }, entities);
  const c = s.complicationsSummary;
  const period = scope ? ` for cases created ${scope.label}` : "";
  if (c.totalComplications === 0) return `No complications are recorded${period}.`;
  const lines = c.byCategory.map((x: any) => `${x.category}: ${x.count}`);
  return [
    `**${plural(c.totalComplications, "complication")} recorded${period}**`,
    `${plural(c.casesWithComplications, "case")} affected, ${c.complicationRatePct}% of ${plural(s.totalCases, "case")}.`,
    bullets(lines),
  ].join("\n");
}

async function answerStatistics(db: Db, scope: DateScope | null, entities: EntityMap): Promise<string> {
  const s: any = await executeTool(db, "get_analytics_summary", { start_date: scope?.from, end_date: scope?.to }, entities);
  const period = scope ? ` for cases created ${scope.label}` : "";
  if (s.totalCases === 0) return `No cases are recorded${period}.`;
  const top = (rows: any[], key: string) =>
    rows.slice(0, 5).map((x) => `${x[key]} ${x.count}`).join(", ");
  const lines = [
    `Cases: ${s.totalCases} (${s.completedCases} completed, ${s.inProgressCases} in progress, ${s.scheduledCases} scheduled, ${s.cancelledCases} cancelled, ${s.delayedCases} delayed)`,
    `Patients: ${s.uniquePatients}`,
    s.caseTypes.length ? `By type: ${top(s.caseTypes, "type")}` : null,
    s.specialtyBreakdown.length ? `By specialty: ${top(s.specialtyBreakdown, "specialty")}` : null,
    s.topProcedures.length ? `Top procedures: ${top(s.topProcedures, "name")}` : null,
    `Complications: ${s.complicationsSummary.totalComplications} in ${plural(s.complicationsSummary.casesWithComplications, "case")}`,
  ].filter((l): l is string => l != null);
  return `**Summary${period}:**\n${bullets(lines)}`;
}

async function answerCase(db: Db, caseNumber: string, entities: EntityMap): Promise<string> {
  const c: any = await executeTool(db, "get_case", { case_number: caseNumber }, entities);
  if (!c.found) return c.message;
  const sched = c.schedule[c.schedule.length - 1];
  const pending = c.pre_or.checklist.filter((x: any) => x.status === "PENDING").map((x: any) => x.item);
  const failed = c.pre_or.checklist.filter((x: any) => x.status === "FAILED").map((x: any) => x.item);
  const yes = (label: string, v: boolean | null) => (v ? label : null);
  const lines = [
    `Patient: ${join([c.patient.research_id, c.patient.age != null ? `${c.patient.age} y` : null, statusLabel(c.patient.sex), c.patient.blood_type])}`,
    `Procedure: ${join([c.procedure ?? "not recorded", c.specialty, statusLabel(c.case_type), c.laterality && c.laterality !== "NOT_APPLICABLE" ? statusLabel(c.laterality) : null])}`,
    c.preoperative_diagnosis ? `Pre-op diagnosis: ${c.preoperative_diagnosis}` : null,
    c.postoperative_diagnosis ? `Post-op diagnosis: ${c.postoperative_diagnosis}` : null,
    `Admission: ${join([c.admission.admission_date, c.admission.ward, c.admission.attending_physician, statusLabel(c.admission.status)])}`,
    sched
      ? `Schedule: ${join([`${sched.scheduled_date} ${sched.scheduled_start}`, sched.room, `${sched.estimated_duration_minutes} min`, statusLabel(sched.schedule_status), sched.delay_minutes > 0 ? `delayed ${sched.delay_minutes} min${sched.delay_reason ? ` (${sched.delay_reason})` : ""}` : null, sched.cancellation_reason ? `cancelled: ${sched.cancellation_reason}` : null])}`
      : "Schedule: not scheduled",
    `Readiness: ${join([`${c.pre_or.readiness_percentage}%`, pending.length ? `pending: ${pending.join(", ")}` : null, failed.length ? `failed: ${failed.join(", ")}` : null])}`,
    c.team.length ? `Team: ${c.team.map((m: any) => `${m.role} ${m.name}`).join(", ")}` : null,
    c.intra_or
      ? `Intra-op: ${join([c.intra_or.anesthesia_type, c.intra_or.asa_classification ? `ASA ${c.intra_or.asa_classification}` : null, c.intra_or.estimated_blood_loss_ml != null ? `EBL ${c.intra_or.estimated_blood_loss_ml} mL` : null, yes("transfusion", c.intra_or.blood_transfusion), yes("specimen", c.intra_or.specimen_collected), yes("implant", c.intra_or.implant_used)]) || "recorded"}`
      : null,
    c.post_or
      ? `Post-op: ${join([c.post_or.destination, c.post_or.post_op_status, c.post_or.pain_score != null ? `pain ${c.post_or.pain_score}` : null, yes("ICU", c.post_or.icu_required), yes("reoperation", c.post_or.reoperation_required), yes("mortality", c.post_or.mortality)]) || "recorded"}`
      : null,
    c.complications.length
      ? `Complications: ${c.complications.map((x: any) => join([x.complication, x.severity]).replace(" · ", " ")).join(", ")}`
      : null,
  ].filter((l): l is string => l != null);
  return `**${c.case_number}** · ${statusLabel(c.case_status)}\n${bullets(lines)}`;
}

async function answerPatients(db: Db, researchIds: string[], entities: EntityMap): Promise<string> {
  const blocks: string[] = [];
  for (const id of researchIds.slice(0, 5)) {
    const p: any = await executeTool(db, "get_patient", { research_id: id }, entities);
    if (!p.found) {
      blocks.push(p.message);
      continue;
    }
    const lines: string[] = [];
    for (const c of p.cases) {
      let readiness: string | null = null;
      if (ACTIVE_STATUSES.includes(c.case_status)) {
        const full: any = await executeTool(db, "get_case", { case_number: c.case_number }, entities);
        const pending = full.pre_or.checklist.filter((x: any) => x.status === "PENDING").map((x: any) => x.item);
        readiness = join([`${full.pre_or.readiness_percentage}% ready`, pending.length ? `pending: ${pending.join(", ")}` : null]);
      }
      lines.push(
        join([
          c.case_number,
          c.procedure,
          statusLabel(c.case_status),
          [c.scheduled_date, c.scheduled_start].filter(Boolean).join(" ") || "not scheduled",
          c.room,
          readiness,
        ])
      );
    }
    const head = join([p.research_id, p.age != null ? `${p.age} y` : null, statusLabel(p.sex), p.blood_type]);
    blocks.push(lines.length ? `${head}\n${bullets(lines)}` : `${head}\n- No surgical cases recorded.`);
  }
  if (researchIds.length > 5) blocks.push(`… and ${researchIds.length - 5} more matching patients. Add the first name or HRN to narrow it.`);
  return blocks.join("\n");
}

// ---------------------------------------------------------------------------
// Matching a question to a topic
// ---------------------------------------------------------------------------

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${word.trim().split(/\s+/).map(escapeRegex).join("\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(text);

async function findCaseNumbers(db: Db, text: string): Promise<string[]> {
  const tokens = [...new Set(text.match(/[A-Za-z0-9][A-Za-z0-9\-/_]*/g) ?? [])]
    .filter((t) => /\d/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t))
    .slice(0, 10);
  if (tokens.length === 0) return [];
  const rows = await db.select<{ case_number: string }>(
    `SELECT case_number FROM surgical_cases WHERE ${tokens.map(() => "case_number = ? COLLATE NOCASE").join(" OR ")}`,
    tokens
  );
  return rows.map((r) => r.case_number);
}

/** Patients named in the question by research ID, HRN, or last name (narrowed by first name when given). */
async function findPatientsInText(db: Db, text: string): Promise<string[]> {
  const ids = [...text.matchAll(/\bOR-(\d{1,9})\b/gi)].map((m) => `OR-${m[1]}`);
  if (ids.length > 0) return ids;

  const rows = await db.select<{ research_seq: number; first_name: string; last_name: string; hrn: string | null }>(
    "SELECT research_seq, first_name, last_name, hrn FROM patients WHERE is_active = 1 ORDER BY updated_at DESC"
  );
  const toId = (r: { research_seq: number }) => `OR-${r.research_seq}`;
  const byHrn = rows.filter((r) => r.hrn && r.hrn.trim().length >= 3 && containsWord(text, r.hrn));
  if (byHrn.length > 0) return byHrn.map(toId);

  const byLast = rows.filter((r) => r.last_name?.trim().length >= 3 && containsWord(text, r.last_name));
  const byBoth = byLast.filter((r) => r.first_name?.trim().length >= 2 && containsWord(text, r.first_name));
  return (byBoth.length > 0 ? byBoth : byLast).map(toId);
}

async function findSpecialty(db: Db, text: string): Promise<string | undefined> {
  const rows = await db.select<{ name: string }>("SELECT name FROM specialties");
  return rows.find((r) => r.name?.trim().length >= 3 && containsWord(text, r.name))?.name;
}

async function findRoom(db: Db, text: string): Promise<string | undefined> {
  const rows = await db.select<{ name: string }>("SELECT name FROM or_rooms ORDER BY LENGTH(name) DESC");
  return rows.find((r) => r.name?.trim().length >= 2 && containsWord(text, r.name))?.name;
}

const STATUS_WORDS: [RegExp, string][] = [
  [/\bcancel/, "CANCELLED"],
  [/\bpostpone/, "POSTPONED"],
  [/\b(completed?|finished|done)\b/, "COMPLETED"],
  [/\b(pacu|recovery)\b/, "PACU"],
  // "in OR 2" names a room, not the status.
  [/\b(in[- ]or|in the or|in theat(?:er|re)|ongoing|in progress|being operated)\b(?!\s*\d)/, "IN_OR"],
  [/\bpost[- ]?or\b/, "POST_OR"],
];

/** Answer one question from the local database. `entities` collects the records the answer mentions. */
export async function answerQuestion(db: Db, question: string, entities: EntityMap, now: Date = new Date()): Promise<string> {
  const text = question.trim();
  const t = text.toLowerCase();
  if (!text) return HELP_TEXT;
  if (/^(help|\?|hi|hello|hey)\b/.test(t) || /\bwhat can you\b/.test(t)) return HELP_TEXT;

  const caseNumbers = await findCaseNumbers(db, text);
  if (caseNumbers.length > 0) {
    return (await Promise.all(caseNumbers.slice(0, 3).map((n) => answerCase(db, n, entities)))).join("\n");
  }

  const patients = await findPatientsInText(db, text);
  if (patients.length > 0) return answerPatients(db, patients, entities);

  const scope = parseDateScope(text, now);

  if (/\b(not|n't|un)\s*ready\b|\bunready\b|\bpending\b|\bincomplete\b|\bmissing\b/.test(t)) return answerReadiness(db, "not_ready", entities);
  if (/\bread(y|iness)\b|\bchecklist\b|\bpre[- ]?op\b|\bpre[- ]?or\b|\bwaiting\b/.test(t)) {
    return answerReadiness(db, /\breadiness\b|\bchecklist\b|\bpre[- ]?o[pr]\b|\bwaiting\b/.test(t) ? "all" : "ready", entities);
  }

  if (/\bcomplication/.test(t)) return answerComplications(db, scope, entities);

  const filter: CaseFilter = {
    status: STATUS_WORDS.find(([re]) => re.test(t))?.[1],
    caseType: /\bemergenc/.test(t) ? "EMERGENCY" : /\burgent\b/.test(t) ? "URGENT" : /\belective\b/.test(t) ? "ELECTIVE" : undefined,
    specialty: await findSpecialty(db, text),
    delayedOnly: /\bdelay|\blate\b/.test(t),
  };
  if (filter.status && !CASE_STATUSES.includes(filter.status)) filter.status = undefined;
  if (filter.status || filter.caseType || filter.specialty || filter.delayedOnly) {
    return answerCaseList(db, filter, scope, entities);
  }

  if (/\b(how many|count|total|number of|statistic|stats|summary|summar|overview|volume|analytics)\b/.test(t)) {
    return answerStatistics(db, scope, entities);
  }
  if (scope || /\b(schedule|scheduled|list|cases?|surger(?:y|ies)|operations?|rooms?|or)\b/.test(t)) {
    const today = { from: iso(now), to: iso(now), label: "today", single: true };
    return answerSchedule(db, scope ?? today, await findRoom(db, text), entities);
  }

  return `I did not find a case, patient or topic in that question.\n${HELP_TEXT}`;
}
