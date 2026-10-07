import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";

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
    bloodType?: string | null;
    userId?: string | null;
  }
): Promise<Patient> {
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
        date_of_birth, sex, address, contact_number, blood_type, is_active,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
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

export async function getPatientById(db: Db, patientId: string): Promise<Patient | null> {
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
  const admissionId = uuid();
  const now = nowIso();
  const admissionNo =
    params.admissionNumber?.trim() ||
    `ADM-${Date.now().toString().slice(-6)}`;

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
  const caseId = uuid();
  const now = nowIso();
  const caseNo =
    params.caseNumber?.trim() ||
    `CASE-${Date.now().toString().slice(-6)}`;

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
     WHERE c.case_number LIKE ? OR c.planned_procedure_summary LIKE ?
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
