import type { Db } from "../data/db";
import { logAudit } from "./audit";
import { minutesBetween } from "./caseEvents";
import { calculateAge, formatResearchId } from "./patients";
import { requirePermission } from "./session";
import { buildXlsx, type Cell, type Sheet } from "./xlsx";

export interface ExportOptions {
  /** Inclusive surgery-date range, YYYY-MM-DD. A case with no schedule uses the day it was created. */
  from?: string | null;
  to?: string | null;
  /** True adds names, HRN, birth date, case numbers and free-text notes. */
  identifiable: boolean;
}

type AnyRow = Record<string, any>;

interface Column {
  header: string;
  value: (row: AnyRow) => Cell;
  /** Left out of a de-identified export. */
  identifying?: boolean;
}

const yesNo = (v: unknown): Cell => (v == null ? null : Number(v) === 1 ? "Yes" : "No");
const col = (header: string, key: string, identifying = false): Column => ({ header, value: (r) => r[key], identifying });
const flag = (header: string, key: string): Column => ({ header, value: (r) => yesNo(r[key]) });

/** Every sheet starts with the same columns, so sheets can be joined on Case Ref. */
const KEY_COLUMNS: Column[] = [
  col("Case Ref", "case_ref"),
  col("Research ID", "research_id"),
  col("Case Number", "case_number", true),
  col("HRN", "hrn", true),
  col("Last Name", "last_name", true),
  col("First Name", "first_name", true),
  col("Middle Name", "middle_name", true),
  col("Date of Birth", "date_of_birth", true),
];

const PRE_OP: Column[] = [
  col("Sex", "sex"),
  col("Age at Surgery (years)", "age"),
  col("Surgery Date", "case_date"),
  col("Case Status", "case_status"),
  col("Case Type", "case_type"),
  col("Priority", "priority"),
  col("Specialty", "specialty_name"),
  col("Laterality", "laterality"),
  col("Planned Procedure", "planned_procedure_summary"),
  col("Coded Procedures", "procedures"),
  col("Pre-op Diagnosis", "preoperative_diagnosis_summary"),
  col("Coded Diagnoses", "diagnoses"),
  col("Admission Number", "admission_number", true),
  col("Admission Date", "admission_date"),
  col("Ward", "ward"),
  col("Height (cm)", "height_cm"),
  col("Weight (kg)", "weight_kg"),
  col("BMI", "bmi"),
  col("ASA Class (baseline)", "baseline_asa"),
  col("Tobacco Status", "tobacco_status"),
  col("Functional Status", "functional_status"),
  col("Dialysis", "dialysis_modality"),
  col("Dialysis Access", "dialysis_access"),
  col("Years on Dialysis", "dialysis_years"),
  col("Donor Relation", "donor_relation"),
  col("Donor Relationship Type", "donor_relationship_type"),
  col("Readiness Status", "readiness_status"),
  col("Readiness %", "readiness_percentage"),
  col("Checklist Items Complete", "checklist_done"),
  col("Checklist Items Total", "checklist_total"),
  col("Baseline Notes", "baseline_notes", true),
  col("Pre-op Notes", "preop_notes", true),
];

const INTRA_OP: Column[] = [
  col("Surgery Date", "case_date"),
  col("OR Room", "room_name"),
  col("Scheduled Start", "scheduled_start"),
  col("Estimated Duration (min)", "estimated_duration_minutes"),
  col("Schedule Status", "schedule_status"),
  col("Room In", "ev_ROOM_IN"),
  col("Anesthesia Start", "ev_ANESTHESIA_START"),
  col("Incision", "ev_INCISION"),
  col("Closure", "ev_CLOSURE"),
  col("Room Out", "ev_ROOM_OUT"),
  { header: "Incision to Closure (min)", value: (r) => minutesBetween(r.ev_INCISION, r.ev_CLOSURE) },
  { header: "Room Time (min)", value: (r) => minutesBetween(r.ev_ROOM_IN, r.ev_ROOM_OUT) },
  col("Anesthesia Type", "anesthesia_name"),
  col("ASA Class (intra-op)", "intra_asa"),
  col("Estimated Blood Loss (mL)", "estimated_blood_loss_ml"),
  flag("Blood Transfusion", "blood_transfusion"),
  col("Units Transfused", "units_transfused"),
  flag("Specimen Collected", "specimen_collected"),
  flag("Implant Used", "implant_used"),
  col("Safety Checks Complete", "safety_done"),
  col("Safety Checks Failed", "safety_failed"),
  col("Operative Findings", "operative_findings", true),
  col("Operative Notes", "operative_notes", true),
];

const POST_OP: Column[] = [
  col("Surgery Date", "case_date"),
  col("PACU In", "ev_PACU_IN"),
  col("PACU Out", "ev_PACU_OUT"),
  { header: "PACU Stay (min)", value: (r) => minutesBetween(r.ev_PACU_IN, r.ev_PACU_OUT) },
  col("Destination", "destination_name"),
  col("Post-op Status", "post_op_status"),
  col("Pain Score", "pain_score"),
  flag("Complications Present", "complications_present"),
  col("Complication Count", "complication_count"),
  flag("ICU Required", "icu_required"),
  flag("Reoperation Required", "reoperation_required"),
  flag("Mortality", "mortality"),
  col("30-day Follow-up Status", "followup_status"),
  col("30-day Follow-up Due", "followup_due"),
  col("30-day Follow-up Assessed", "followup_assessed_at"),
  col("Follow-up Method", "followup_method"),
  col("Post-op Notes", "postop_notes", true),
  col("Follow-up Notes", "followup_notes", true),
];

const COMPLICATIONS: Column[] = [
  col("Complication", "complication_name"),
  col("Category", "category"),
  col("Severity", "severity"),
  col("Occurred At", "occurred_at"),
  col("Description", "description", true),
  col("Intervention", "intervention", true),
  col("Outcome", "outcome", true),
];

const OUTCOMES: Column[] = [
  col("Event", "event_type"),
  col("Occurred At", "occurred_at"),
  col("Detected At", "detected_at"),
  col("SSI Type", "ssi_type"),
  col("Evidence Source", "evidence_source", true),
  col("Notes", "notes", true),
];

function toSheet(name: string, columns: Column[], rows: AnyRow[], identifiable: boolean): Sheet {
  const used = [...KEY_COLUMNS, ...columns].filter((c) => identifiable || !c.identifying);
  return { name, rows: [used.map((c) => c.header), ...rows.map((r) => used.map((c) => c.value(r) ?? null))] };
}

const validDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function buildClinicalExport(db: Db, opts: ExportOptions): Promise<{ sheets: Sheet[]; caseCount: number }> {
  requirePermission(opts.identifiable ? "export.identifiable" : "export.deidentified");
  const from = validDate(opts.from);
  const to = validDate(opts.to);
  if ((opts.from && !from) || (opts.to && !to)) throw new Error("Enter dates as YYYY-MM-DD.");
  if (from && to && from > to) throw new Error("The start date is after the end date.");

  const caseDate = "COALESCE(s.scheduled_date, substr(c.created_at, 1, 10))";
  const where: string[] = [];
  const params: string[] = [];
  if (from) { where.push(`${caseDate} >= ?`); params.push(from); }
  if (to) { where.push(`${caseDate} <= ?`); params.push(to); }

  const cases = await db.select<AnyRow>(
    `SELECT c.case_id, c.case_number, c.case_type, c.priority, c.laterality, c.case_status,
       c.planned_procedure_summary, c.preoperative_diagnosis_summary,
       ${caseDate} AS case_date,
       p.research_seq, p.hrn, p.first_name, p.middle_name, p.last_name, p.date_of_birth, p.sex,
       a.admission_number, a.admission_date, a.ward,
       sp.name AS specialty_name,
       b.height_cm, b.weight_kg, b.asa_classification AS baseline_asa, b.tobacco_status, b.functional_status,
       b.dialysis_modality, b.dialysis_access, b.dialysis_years, b.donor_relation,
       drt.name AS donor_relationship_type,
       b.notes AS baseline_notes,
       pa.readiness_status, pa.readiness_percentage, pa.notes AS preop_notes,
       r.name AS room_name, s.scheduled_start, s.estimated_duration_minutes, s.schedule_status,
       i.asa_classification AS intra_asa, i.estimated_blood_loss_ml, i.blood_transfusion, i.units_transfused,
       i.specimen_collected, i.implant_used, i.operative_findings, i.operative_notes,
       an.name AS anesthesia_name,
       po.post_op_status, po.pain_score, po.complications_present, po.icu_required, po.reoperation_required,
       po.mortality, po.notes AS postop_notes, d.name AS destination_name,
       f.status AS followup_status, f.due_date AS followup_due, f.assessed_at AS followup_assessed_at,
       f.method AS followup_method, f.notes AS followup_notes
     FROM surgical_cases c
     JOIN patients p ON p.patient_id = c.patient_id
     LEFT JOIN admissions a ON a.admission_id = c.admission_id
     LEFT JOIN specialties sp ON sp.specialty_id = c.specialty_id
     LEFT JOIN patient_data b ON b.patient_id = c.patient_id
     LEFT JOIN donor_relationship_types drt ON drt.relationship_type_id = b.donor_relationship_type_id
     LEFT JOIN pre_or_assessments pa ON pa.case_id = c.case_id
     LEFT JOIN or_schedule s ON s.case_id = c.case_id
     LEFT JOIN or_rooms r ON r.or_room_id = s.or_room_id
     LEFT JOIN intra_or_records i ON i.case_id = c.case_id
     LEFT JOIN anesthesia_types an ON an.anesthesia_type_id = i.anesthesia_type_id
     LEFT JOIN post_or_records po ON po.case_id = c.case_id
     LEFT JOIN post_op_destinations d ON d.destination_id = po.post_op_destination_id
     LEFT JOIN case_followup_assessments f ON f.case_id = c.case_id AND f.target_day = 30
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY case_date, c.created_at, c.case_id`,
    params);

  const byId = new Map<string, AnyRow>();
  cases.forEach((c, index) => {
    c.case_ref = `C${String(index + 1).padStart(5, "0")}`;
    c.research_id = formatResearchId(c.research_seq);
    c.age = calculateAge(c.date_of_birth, c.case_date);
    c.bmi = c.height_cm && c.weight_kg ? Math.round((c.weight_kg / (c.height_cm / 100) ** 2) * 10) / 10 : null;
    c.complication_count = 0;
    byId.set(c.case_id, c);
  });

  const [events, procedures, diagnoses, checklist, safety, complications, outcomes] = await Promise.all([
    db.select<AnyRow>("SELECT case_id, event_type, occurred_at FROM case_events"),
    db.select<AnyRow>(
      `SELECT cp.case_id, pr.procedure_code, pr.procedure_name FROM case_procedures cp
       JOIN procedures pr ON pr.procedure_id = cp.procedure_id ORDER BY cp.is_primary DESC, pr.procedure_name`),
    db.select<AnyRow>(
      `SELECT cd.case_id, dg.diagnosis_code, dg.diagnosis_name FROM case_diagnoses cd
       JOIN diagnoses dg ON dg.diagnosis_id = cd.diagnosis_id ORDER BY dg.diagnosis_name`),
    db.select<AnyRow>(
      `SELECT case_id, COUNT(*) AS total, SUM(CASE WHEN status IN ('COMPLETE','NOT_APPLICABLE') THEN 1 ELSE 0 END) AS done
       FROM pre_or_checklist_values GROUP BY case_id`),
    db.select<AnyRow>(
      `SELECT case_id, SUM(CASE WHEN status IN ('COMPLETE','NOT_APPLICABLE') THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
       FROM safety_responses GROUP BY case_id`),
    db.select<AnyRow>(
      `SELECT c.case_id, ct.name AS complication_name, ct.category, c.severity, c.occurred_at,
         c.description, c.intervention, c.outcome
       FROM complications c JOIN complication_types ct ON ct.complication_type_id = c.complication_type_id
       ORDER BY c.occurred_at`),
    db.select<AnyRow>(
      `SELECT case_id, event_type, occurred_at, detected_at, ssi_type, evidence_source, notes
       FROM postoperative_outcomes ORDER BY occurred_at`),
  ]);

  const coded = (code: string | null, name: string) => (code ? `${code} ${name}` : name);
  const append = (row: AnyRow, key: string, text: string) => { row[key] = row[key] ? `${row[key]}; ${text}` : text; };
  for (const e of events) { const c = byId.get(e.case_id); if (c) c[`ev_${e.event_type}`] = e.occurred_at; }
  for (const p of procedures) { const c = byId.get(p.case_id); if (c) append(c, "procedures", coded(p.procedure_code, p.procedure_name)); }
  for (const g of diagnoses) { const c = byId.get(g.case_id); if (c) append(c, "diagnoses", coded(g.diagnosis_code, g.diagnosis_name)); }
  for (const k of checklist) { const c = byId.get(k.case_id); if (c) { c.checklist_done = k.done; c.checklist_total = k.total; } }
  for (const s of safety) { const c = byId.get(s.case_id); if (c) { c.safety_done = s.done; c.safety_failed = s.failed; } }

  // Child rows carry their case's key columns so each sheet stands alone.
  const withCase = (rows: AnyRow[]) => rows.flatMap((row) => {
    const c = byId.get(row.case_id);
    return c ? [{ ...c, ...row }] : [];
  });
  const complicationRows = withCase(complications);
  for (const row of complicationRows) byId.get(row.case_id)!.complication_count += 1;

  const id = opts.identifiable;
  return {
    caseCount: cases.length,
    sheets: [
      toSheet("Pre-Op", PRE_OP, cases, id),
      toSheet("Intra-Op", INTRA_OP, cases, id),
      toSheet("Post-Op", POST_OP, cases, id),
      toSheet("Complications", COMPLICATIONS, complicationRows, id),
      toSheet("Follow-up Outcomes", OUTCOMES, withCase(outcomes), id),
    ],
  };
}

export interface ClinicalWorkbook {
  bytes: Uint8Array;
  filename: string;
  caseCount: number;
}

/** Builds the workbook and records who exported what. Identifiable exports need their own permission. */
export async function exportClinicalWorkbook(db: Db, opts: ExportOptions, now: Date = new Date()): Promise<ClinicalWorkbook> {
  const userId = requirePermission(opts.identifiable ? "export.identifiable" : "export.deidentified");
  const { sheets, caseCount } = await buildClinicalExport(db, opts);
  const bytes = buildXlsx(sheets);
  const filename = `OR-Export-${opts.identifiable ? "Identifiable" : "Deidentified"}-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`;
  await logAudit(db, {
    userId, action: opts.identifiable ? "EXPORT_IDENTIFIABLE" : "EXPORT_DEIDENTIFIED", entityType: "EXPORT",
    newValue: JSON.stringify({ filename, from: opts.from || null, to: opts.to || null, cases: caseCount }),
  });
  return { bytes, filename, caseCount };
}
