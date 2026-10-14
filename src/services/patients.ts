import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";

export interface Patient {
  patient_id: string;
  research_seq: number;
  research_id: string;
  hrn: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  full_name: string;
  date_of_birth: string | null;
  calculated_age: number | null;
  sex: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN" | null;
  address: string | null;
  contact_number: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relationship?: string | null;
  blood_type: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Admission {
  admission_id: string;
  patient_id: string;
  admission_number: string | null;
  admission_date: string;
  discharge_date: string | null;
  ward: string | null;
  room: string | null;
  bed: string | null;
  attending_physician: string | null;
  admission_diagnosis_text: string | null;
  discharge_diagnosis_text: string | null;
  status: "ADMITTED" | "DISCHARGED" | "CANCELLED";
  created_at: string;
  updated_at: string;
}

export type CaseStatus =
  | "PRE_OR"
  | "NOT_READY"
  | "READY"
  | "SCHEDULED"
  | "IN_OR"
  | "PACU"
  | "POST_OR"
  | "COMPLETED"
  | "POSTPONED"
  | "CANCELLED";

export interface SurgicalCase {
  case_id: string;
  patient_id: string;
  admission_id: string;
  case_number: string;
  case_type: "ELECTIVE" | "EMERGENCY" | "URGENT";
  specialty_id: string | null;
  specialty_name?: string | null;
  priority: string | null;
  laterality: "LEFT" | "RIGHT" | "BILATERAL" | "NOT_APPLICABLE" | null;
  planned_procedure_summary: string | null;
  preoperative_diagnosis_summary: string | null;
  postoperative_diagnosis_summary: string | null;
  case_status: CaseStatus;
  /** Reason given the last time the case was cancelled, postponed or moved by hand. */
  status_reason?: string | null;
  status_label?: string;
  created_at: string;
  updated_at: string;
  // Patient details joined for lists
  patient_name?: string;
  patient_hrn?: string | null;
  patient_dob?: string | null;
  patient_sex?: string | null;
  age_at_surgery?: number | null;
}

export function formatResearchId(seq: number): string {
  return `OR-${seq.toString().padStart(6, "0")}`;
}

export function calculateAge(dobIso: string | null | undefined, refDateIso?: string | null): number | null {
  if (!dobIso) return null;
  const birth = new Date(dobIso);
  if (isNaN(birth.getTime())) return null;
  const ref = refDateIso ? new Date(refDateIso) : new Date();
  if (isNaN(ref.getTime())) return null;

  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : 0;
}

export async function createPatient(
  db: Db,
  params: {
    hrn?: string | null;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    suffix?: string | null;
    dateOfBirth?: string | null;
    sex?: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN" | null;
    address?: string | null;
    contactNumber?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelationship?: string | null;
    bloodType?: string | null;
    userId?: string | null;
  }
): Promise<Patient> {
  params = { ...params, userId: requirePermission("patients.create") };
  const patientId = uuid();
  const now = nowIso();
  const cleanHrn = params.hrn?.trim() || null;

  // Check HRN uniqueness if populated
  if (cleanHrn) {
    const existing = await db.select<{ patient_id: string }>(
      "SELECT patient_id FROM patients WHERE hrn = ? AND is_active = 1",
      [cleanHrn]
    );
    if (existing.length > 0) {
      throw new Error(`A patient with HRN "${cleanHrn}" already exists.`);
    }
  }

  // Get next research sequence
  const seqRes = await db.select<{ next_seq: number }>(
    "SELECT COALESCE(MAX(research_seq), 0) + 1 as next_seq FROM patients"
  );
  const researchSeq = seqRes[0]?.next_seq ?? 1;

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO patients (
        patient_id, research_seq, hrn, first_name, middle_name, last_name, suffix,
        date_of_birth, sex, address, contact_number,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
        blood_type, is_active, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        patientId,
        researchSeq,
        cleanHrn,
        params.firstName.trim(),
        params.middleName?.trim() || null,
        params.lastName.trim(),
        params.suffix?.trim() || null,
        params.dateOfBirth || null,
        params.sex || null,
        params.address?.trim() || null,
        params.contactNumber?.trim() || null,
        params.emergencyContactName?.trim() || null,
        params.emergencyContactPhone?.trim() || null,
        params.emergencyContactRelationship?.trim() || null,
        params.bloodType || null,
        params.userId || null,
        params.userId || null,
        now,
        now,
      ]
    );

    await logAudit(tx, {
      userId: params.userId,
      patientId,
      action: "CREATE_PATIENT",
      entityType: "PATIENT",
      recordId: patientId,
      newValue: JSON.stringify({ name: `${params.lastName}, ${params.firstName}`, hrn: cleanHrn }),
    });
  });

  return getPatientById(db, patientId) as Promise<Patient>;
}

export interface PatientDetails {
  hrn?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  dateOfBirth?: string | null;
  sex?: Patient["sex"];
  address?: string | null;
  contactNumber?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
  bloodType?: string | null;
}

/** Corrects a patient's details. Each changed field gets its own audit entry with the old and new value. */
export async function updatePatient(db: Db, patientId: string, details: PatientDetails): Promise<Patient> {
  const userId = requirePermission("patients.edit_demographics");
  const rows = await db.select<Record<string, string | number | null>>(
    "SELECT * FROM patients WHERE patient_id = ?", [patientId]);
  const old = rows[0];
  if (!old) throw new Error("Patient not found.");
  if (!old.is_active) throw new Error("Restore this archived patient before editing.");

  const text = (v: string | null | undefined) => v?.trim() || null;
  const next: Record<string, string | null> = {
    hrn: text(details.hrn),
    first_name: text(details.firstName),
    middle_name: text(details.middleName),
    last_name: text(details.lastName),
    suffix: text(details.suffix),
    date_of_birth: details.dateOfBirth || null,
    sex: details.sex || null,
    address: text(details.address),
    contact_number: text(details.contactNumber),
    emergency_contact_name: text(details.emergencyContactName),
    emergency_contact_phone: text(details.emergencyContactPhone),
    emergency_contact_relationship: text(details.emergencyContactRelationship),
    blood_type: text(details.bloodType),
  };
  if (!next.first_name || !next.last_name) throw new Error("First name and last name are required.");
  if (next.date_of_birth && next.date_of_birth > nowIso().slice(0, 10)) {
    throw new Error("Date of birth cannot be in the future.");
  }
  if (next.hrn && next.hrn !== old.hrn) {
    const clash = await db.select<{ patient_id: string }>(
      "SELECT patient_id FROM patients WHERE hrn = ? AND is_active = 1 AND patient_id != ?", [next.hrn, patientId]);
    if (clash.length) throw new Error(`A patient with HRN "${next.hrn}" already exists.`);
  }

  const changed = Object.keys(next).filter((field) => (old[field] ?? null) !== next[field]);
  if (changed.length) {
    const now = nowIso();
    await db.transaction(async (tx) => {
      await tx.execute(
        `UPDATE patients SET ${changed.map((f) => `${f} = ?`).join(", ")}, updated_by = ?, updated_at = ? WHERE patient_id = ?`,
        [...changed.map((f) => next[f]), userId, now, patientId]);
      for (const field of changed) {
        await logAudit(tx, {
          userId, patientId, action: "UPDATE_PATIENT", entityType: "PATIENT", recordId: patientId,
          fieldName: field, oldValue: old[field] == null ? null : String(old[field]), newValue: next[field],
        });
      }
    });
  }
  return getPatientById(db, patientId) as Promise<Patient>;
}

export async function getPatientById(db: Db, patientId: string): Promise<Patient | null> {
  requirePermission("patients.view");
  const rows = await db.select<any>(
    "SELECT * FROM patients WHERE patient_id = ?",
    [patientId]
  );
  const p = rows[0];
  if (!p) return null;

  const middle = p.middle_name ? ` ${p.middle_name}` : "";
  const suffix = p.suffix ? ` ${p.suffix}` : "";
  const fullName = `${p.last_name}, ${p.first_name}${middle}${suffix}`;

  return {
    ...p,
    research_id: formatResearchId(p.research_seq),
    full_name: fullName,
    calculated_age: calculateAge(p.date_of_birth),
  };
}

export async function listPatients(
  db: Db,
  query?: { search?: string; limit?: number; offset?: number }
): Promise<{ patients: Patient[]; total: number }> {
  requirePermission("patients.view");
  let where = "WHERE is_active = 1";
  const params: any[] = [];

  if (query?.search && query.search.trim()) {
    const s = `%${query.search.trim()}%`;
    where += " AND (hrn LIKE ? OR first_name LIKE ? OR last_name LIKE ?)";
    params.push(s, s, s);
  }

  const countRes = await db.select<{ count: number }>(
    `SELECT COUNT(*) as count FROM patients ${where}`,
    params
  );
  const total = countRes[0]?.count ?? 0;

  const limit = query?.limit ?? 50;
  const offset = query?.offset ?? 0;
  params.push(limit, offset);

  const rows = await db.select<any>(
    `SELECT * FROM patients ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    params
  );

  const patients = rows.map((p) => {
    const middle = p.middle_name ? ` ${p.middle_name}` : "";
    const suffix = p.suffix ? ` ${p.suffix}` : "";
    return {
      ...p,
      research_id: formatResearchId(p.research_seq),
      full_name: `${p.last_name}, ${p.first_name}${middle}${suffix}`,
      calculated_age: calculateAge(p.date_of_birth),
    };
  });

  return { patients, total };
}

/** A generated record number that is not in use yet: the clock-based number, stepped forward on a clash. */
async function freeNumber(
  db: Db, table: "admissions" | "surgical_cases", column: "admission_number" | "case_number", prefix: string,
): Promise<string> {
  for (let n = Date.now() % 1000000; ; n = (n + 1) % 1000000) {
    const candidate = `${prefix}-${String(n).padStart(6, "0")}`;
    const taken = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, [candidate]);
    if (!taken[0]?.n) return candidate;
  }
}

export async function createAdmission(
  db: Db,
  params: {
    patientId: string;
    admissionNumber?: string | null;
    admissionDate: string;
    ward?: string | null;
    room?: string | null;
    bed?: string | null;
    attendingPhysician?: string | null;
    admissionDiagnosisText?: string | null;
    userId?: string | null;
  }
): Promise<Admission> {
  params = { ...params, userId: requirePermission("cases.edit") };
  const admissionId = uuid();
  const now = nowIso();
  const admissionNo =
    params.admissionNumber?.trim() || await freeNumber(db, "admissions", "admission_number", "ADM");

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO admissions (
        admission_id, patient_id, admission_number, admission_date,
        ward, room, bed, attending_physician, admission_diagnosis_text,
        status, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ADMITTED', ?, ?, ?, ?)`,
      [
        admissionId,
        params.patientId,
        admissionNo,
        params.admissionDate,
        params.ward?.trim() || null,
        params.room?.trim() || null,
        params.bed?.trim() || null,
        params.attendingPhysician?.trim() || null,
        params.admissionDiagnosisText?.trim() || null,
        params.userId || null,
        params.userId || null,
        now,
        now,
      ]
    );

    await logAudit(tx, {
      userId: params.userId,
      patientId: params.patientId,
      admissionId,
      action: "CREATE_ADMISSION",
      entityType: "ADMISSION",
      recordId: admissionId,
      newValue: admissionNo,
    });
  });

  const row = await db.select<Admission>("SELECT * FROM admissions WHERE admission_id = ?", [admissionId]);
  return row[0];
}

export async function getAdmissionsByPatient(db: Db, patientId: string): Promise<Admission[]> {
  requirePermission("patients.view");
  return db.select<Admission>(
    "SELECT * FROM admissions WHERE patient_id = ? ORDER BY admission_date DESC",
    [patientId]
  );
}

export async function createSurgicalCase(
  db: Db,
  params: {
    patientId: string;
    admissionId: string;
    caseNumber?: string | null;
    caseType?: "ELECTIVE" | "EMERGENCY" | "URGENT";
    specialtyId?: string | null;
    priority?: string | null;
    laterality?: "LEFT" | "RIGHT" | "BILATERAL" | "NOT_APPLICABLE" | null;
    plannedProcedureSummary?: string | null;
    preoperativeDiagnosisSummary?: string | null;
    userId?: string | null;
  }
): Promise<SurgicalCase> {
  params = { ...params, userId: requirePermission("cases.edit") };
  const caseId = uuid();
  const now = nowIso();
  const caseNo =
    params.caseNumber?.trim() || await freeNumber(db, "surgical_cases", "case_number", "CASE");

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO surgical_cases (
        case_id, patient_id, admission_id, case_number, case_type,
        specialty_id, priority, laterality, planned_procedure_summary,
        preoperative_diagnosis_summary, case_status, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRE_OR', ?, ?, ?, ?)`,
      [
        caseId,
        params.patientId,
        params.admissionId,
        caseNo,
        params.caseType || "ELECTIVE",
        params.specialtyId || null,
        params.priority || null,
        params.laterality || null,
        params.plannedProcedureSummary?.trim() || null,
        params.preoperativeDiagnosisSummary?.trim() || null,
        params.userId || null,
        params.userId || null,
        now,
        now,
      ]
    );

    // Initialize default Pre-OR checklist values from definitions
    const checkDefs = await tx.select<{ checklist_item_id: string }>(
      "SELECT checklist_item_id FROM pre_or_checklist_definitions WHERE active = 1 ORDER BY display_order"
    );
    for (const def of checkDefs) {
      await tx.execute(
        `INSERT INTO pre_or_checklist_values (value_id, case_id, checklist_item_id, status)
         VALUES (?, ?, ?, 'PENDING')`,
        [uuid(), caseId, def.checklist_item_id]
      );
    }

    // Initialize blank pre-or assessment row
    await tx.execute(
      `INSERT INTO pre_or_assessments (assessment_id, case_id, readiness_status, readiness_percentage, created_at, updated_at)
       VALUES (?, ?, 'NOT_READY', 0, ?, ?)`,
      [uuid(), caseId, now, now]
    );

    await tx.execute(
      "INSERT INTO case_safety_templates (case_id, template_id, assigned_at) VALUES (?, 'who-2009-local', ?)",
      [caseId, now]
    );

    await logAudit(tx, {
      userId: params.userId,
      patientId: params.patientId,
      admissionId: params.admissionId,
      caseId,
      action: "CREATE_SURGICAL_CASE",
      entityType: "SURGICAL_CASE",
      recordId: caseId,
      newValue: caseNo,
    });
  });

  return getCaseById(db, caseId) as Promise<SurgicalCase>;
}

export async function getCaseById(db: Db, caseId: string): Promise<SurgicalCase | null> {
  requirePermission("patients.view");
  const rows = await db.select<any>(
    `SELECT c.*, s.name as specialty_name, sl.label as status_label,
            p.first_name, p.last_name, p.middle_name, p.suffix, p.hrn as patient_hrn,
            p.date_of_birth as patient_dob, p.sex as patient_sex,
            sch.scheduled_date
     FROM surgical_cases c
     LEFT JOIN specialties s ON c.specialty_id = s.specialty_id
     LEFT JOIN status_labels sl ON sl.domain = 'case_status' AND sl.code = c.case_status
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN or_schedule sch ON sch.case_id = c.case_id
     WHERE c.case_id = ?`,
    [caseId]
  );
  const r = rows[0];
  if (!r) return null;

  const middle = r.middle_name ? ` ${r.middle_name}` : "";
  const suffix = r.suffix ? ` ${r.suffix}` : "";

  return {
    ...r,
    patient_name: `${r.last_name}, ${r.first_name}${middle}${suffix}`,
    age_at_surgery: calculateAge(r.patient_dob, r.scheduled_date),
  };
}

export async function getCasesByPatient(db: Db, patientId: string): Promise<SurgicalCase[]> {
  requirePermission("patients.view");
  const rows = await db.select<any>(
    `SELECT c.*, s.name as specialty_name, sl.label as status_label
     FROM surgical_cases c
     LEFT JOIN specialties s ON c.specialty_id = s.specialty_id
     LEFT JOIN status_labels sl ON sl.domain = 'case_status' AND sl.code = c.case_status
     WHERE c.patient_id = ?
     ORDER BY c.created_at DESC`,
    [patientId]
  );
  return rows;
}

export async function updateCaseStatus(
  db: Db,
  caseId: string,
  newStatus: CaseStatus,
  userId?: string | null
): Promise<void> {
  userId = requirePermission("cases.change_stage");
  const existing = await getCaseById(db, caseId);
  if (!existing) throw new Error("Surgical case not found.");

  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE surgical_cases SET case_status = ?, updated_by = ?, updated_at = ? WHERE case_id = ?",
      [newStatus, userId || null, now, caseId]
    );

    await logAudit(tx, {
      userId,
      patientId: existing.patient_id,
      admissionId: existing.admission_id,
      caseId,
      action: "UPDATE_CASE_STATUS",
      entityType: "SURGICAL_CASE",
      recordId: caseId,
      oldValue: existing.case_status,
      newValue: newStatus,
    });
  });
}

export async function searchGlobal(
  db: Db,
  term: string
): Promise<{
  patients: Patient[];
  cases: SurgicalCase[];
}> {
  requirePermission("patients.view");
  const q = `%${term.trim()}%`;
  const patientRows = await db.select<any>(
    `SELECT * FROM patients
     WHERE is_active = 1
       AND (hrn LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR contact_number LIKE ?)
     LIMIT 10`,
    [q, q, q, q]
  );

  const patients = patientRows.map((p) => {
    const middle = p.middle_name ? ` ${p.middle_name}` : "";
    const suffix = p.suffix ? ` ${p.suffix}` : "";
    return {
      ...p,
      research_id: formatResearchId(p.research_seq),
      full_name: `${p.last_name}, ${p.first_name}${middle}${suffix}`,
      calculated_age: calculateAge(p.date_of_birth),
    };
  });

  const caseRows = await db.select<any>(
    `SELECT c.*, s.name as specialty_name,
            p.first_name, p.last_name, p.middle_name, p.suffix, p.hrn as patient_hrn,
            p.date_of_birth as patient_dob
     FROM surgical_cases c
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN specialties s ON c.specialty_id = s.specialty_id
     WHERE p.is_active = 1 AND (c.case_number LIKE ? OR c.planned_procedure_summary LIKE ?)
     LIMIT 10`,
    [q, q]
  );

  const cases = caseRows.map((r) => {
    const middle = r.middle_name ? ` ${r.middle_name}` : "";
    const suffix = r.suffix ? ` ${r.suffix}` : "";
    return {
      ...r,
      patient_name: `${r.last_name}, ${r.first_name}${middle}${suffix}`,
      age_at_surgery: calculateAge(r.patient_dob),
    };
  });

  return { patients, cases };
}
