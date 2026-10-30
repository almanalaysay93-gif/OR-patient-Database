import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";

export type LabCategory =
  | "HEMATOLOGY"
  | "CHEMISTRY"
  | "ELECTROLYTES"
  | "COAGULATION"
  | "BLOOD_BANK"
  | "URINALYSIS"
  | "ABG"
  | "MICROBIOLOGY"
  | "PATHOLOGY"
  | "OTHER";

export type LabFlag = "NORMAL" | "ABNORMAL" | "CRITICAL";

export type AttachmentCategory =
  | "LAB_RESULT"
  | "PROCEDURE_IMAGE"
  | "PATIENT_PHOTO"
  | "PATHOLOGY"
  | "OTHER";

export interface PatientLabResult {
  lab_id: string;
  patient_id: string;
  case_id: string | null;
  case_number?: string | null;
  category: LabCategory;
  test_name: string;
  result_value: string;
  unit: string | null;
  reference_range: string | null;
  flag: LabFlag;
  specimen_collected_at: string;
  result_date: string;
  performed_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  attachments?: ClinicalAttachment[];
}

export interface ClinicalAttachment {
  attachment_id: string;
  patient_id: string;
  lab_id: string | null;
  case_id: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  data_url: string;
  title: string | null;
  description: string | null;
  category: AttachmentCategory;
  created_by: string | null;
  created_at: string;
}

export interface LabPreset {
  name: string;
  category: LabCategory;
  unit: string;
  referenceRange: string;
}

export const COMMON_LAB_PRESETS: LabPreset[] = [
  // Hematology
  { name: "Hemoglobin (Hgb)", category: "HEMATOLOGY", unit: "g/dL", referenceRange: "12.0 - 17.5 g/dL" },
  { name: "Hematocrit (Hct)", category: "HEMATOLOGY", unit: "%", referenceRange: "36.0 - 50.0 %" },
  { name: "White Blood Cells (WBC)", category: "HEMATOLOGY", unit: "x10^3/uL", referenceRange: "4.5 - 11.0 x10^3/uL" },
  { name: "Platelet Count", category: "HEMATOLOGY", unit: "x10^3/uL", referenceRange: "150 - 450 x10^3/uL" },
  // Chemistry
  { name: "Serum Creatinine", category: "CHEMISTRY", unit: "mg/dL", referenceRange: "0.6 - 1.3 mg/dL" },
  { name: "Blood Urea Nitrogen (BUN)", category: "CHEMISTRY", unit: "mg/dL", referenceRange: "7 - 20 mg/dL" },
  { name: "Fasting Blood Sugar (FBS)", category: "CHEMISTRY", unit: "mg/dL", referenceRange: "70 - 100 mg/dL" },
  { name: "Total Bilirubin", category: "CHEMISTRY", unit: "mg/dL", referenceRange: "0.2 - 1.2 mg/dL" },
  { name: "Serum Albumin", category: "CHEMISTRY", unit: "g/dL", referenceRange: "3.5 - 5.5 g/dL" },
  { name: "SGPT / ALT", category: "CHEMISTRY", unit: "U/L", referenceRange: "7 - 56 U/L" },
  { name: "SGOT / AST", category: "CHEMISTRY", unit: "U/L", referenceRange: "10 - 40 U/L" },
  // Electrolytes
  { name: "Sodium (Na+)", category: "ELECTROLYTES", unit: "mEq/L", referenceRange: "135 - 145 mEq/L" },
  { name: "Potassium (K+)", category: "ELECTROLYTES", unit: "mEq/L", referenceRange: "3.5 - 5.0 mEq/L" },
  { name: "Chloride (Cl-)", category: "ELECTROLYTES", unit: "mEq/L", referenceRange: "96 - 106 mEq/L" },
  { name: "Ionized Calcium", category: "ELECTROLYTES", unit: "mmol/L", referenceRange: "1.15 - 1.33 mmol/L" },
  // Coagulation
  { name: "Prothrombin Time (PT)", category: "COAGULATION", unit: "sec", referenceRange: "11.0 - 13.5 sec" },
  { name: "International Normalized Ratio (INR)", category: "COAGULATION", unit: "", referenceRange: "0.8 - 1.1" },
  { name: "Activated Partial Thromboplastin Time (aPTT)", category: "COAGULATION", unit: "sec", referenceRange: "25 - 35 sec" },
  // Blood Bank
  { name: "Blood Typing (ABO/Rh)", category: "BLOOD_BANK", unit: "", referenceRange: "Patient Type" },
  { name: "Crossmatching", category: "BLOOD_BANK", unit: "units", referenceRange: "Compatible" },
  // ABG
  { name: "Arterial Blood Gas - pH", category: "ABG", unit: "", referenceRange: "7.35 - 7.45" },
  { name: "Arterial Blood Gas - pO2", category: "ABG", unit: "mmHg", referenceRange: "80 - 100 mmHg" },
  { name: "Arterial Blood Gas - pCO2", category: "ABG", unit: "mmHg", referenceRange: "35 - 45 mmHg" },
  { name: "Arterial Blood Gas - HCO3", category: "ABG", unit: "mEq/L", referenceRange: "22 - 26 mEq/L" },
];

export interface CreateLabResultInput {
  patientId: string;
  caseId?: string | null;
  category: LabCategory;
  testName: string;
  resultValue: string;
  unit?: string | null;
  referenceRange?: string | null;
  flag?: LabFlag;
  specimenCollectedAt?: string;
  resultDate?: string;
  performedBy?: string | null;
  notes?: string | null;
  attachments?: Array<{
    fileName: string;
    fileType: string;
    fileSize: number;
    dataUrl: string;
    title?: string | null;
    description?: string | null;
    category?: AttachmentCategory;
  }>;
}

/** Largest attachment the station stores, in bytes of decoded file data. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ATTACHMENT_SIGNATURES: Array<{ type: string; magic: number[] }> = [
  { type: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { type: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/**
 * Checks an attachment before it is stored. Only PNG, JPEG and PDF up to 10 MB are accepted,
 * and the type is taken from the decoded bytes, so a renamed file is refused.
 * Returns the verified type and size, which replace the values the caller sent.
 */
export function checkAttachment(att: { fileType: string; dataUrl: string }): { fileType: string; fileSize: number } {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(att.dataUrl ?? "");
  if (!match) throw new Error("Attachment must be a PNG, JPEG or PDF file.");
  const declared = match[1].toLowerCase();
  const b64 = match[2];
  if (Math.floor((b64.length * 3) / 4) - (b64.match(/=+$/)?.[0].length ?? 0) > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment is larger than 10 MB.");
  }
  let head: string;
  try {
    head = atob(b64.slice(0, 16));
  } catch {
    throw new Error("Attachment must be a PNG, JPEG or PDF file.");
  }
  const sig = ATTACHMENT_SIGNATURES.find((s) => s.magic.every((byte, i) => head.charCodeAt(i) === byte));
  if (!sig || sig.type !== declared || sig.type !== (att.fileType ?? "").toLowerCase()) {
    throw new Error("Attachment must be a PNG, JPEG or PDF file.");
  }
  let size: number;
  try {
    size = atob(b64).length;
  } catch {
    throw new Error("Attachment must be a PNG, JPEG or PDF file.");
  }
  return { fileType: sig.type, fileSize: size };
}

export async function createLabResult(db: Db, input: CreateLabResultInput): Promise<PatientLabResult> {
  const userId = requirePermission("cases.edit", "patients.create", "patients.edit_demographics", "preor.edit");
  const now = nowIso();
  const labId = uuid();
  const testName = input.testName.trim();
  if (!testName) throw new Error("Test name is required.");
  const resultValue = input.resultValue.trim();
  if (!resultValue) throw new Error("Result value is required.");

  const specimenCollectedAt = input.specimenCollectedAt || now;
  const resultDate = input.resultDate || now.slice(0, 10);
  const flag = input.flag || "NORMAL";
  const checked = (input.attachments ?? []).map((att) => checkAttachment(att));

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO patient_lab_results (
        lab_id, patient_id, case_id, category, test_name, result_value, unit,
        reference_range, flag, specimen_collected_at, result_date, performed_by,
        notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        labId,
        input.patientId,
        input.caseId || null,
        input.category,
        testName,
        resultValue,
        input.unit?.trim() || null,
        input.referenceRange?.trim() || null,
        flag,
        specimenCollectedAt,
        resultDate,
        input.performedBy?.trim() || null,
        input.notes?.trim() || null,
        userId,
        now,
        now,
      ]
    );

    if (input.attachments && input.attachments.length > 0) {
      for (const [i, att] of input.attachments.entries()) {
        const attId = uuid();
        await tx.execute(
          `INSERT INTO clinical_attachments (
            attachment_id, patient_id, lab_id, case_id, file_name, file_type,
            file_size, data_url, title, description, category, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attId,
            input.patientId,
            labId,
            input.caseId || null,
            att.fileName,
            checked[i].fileType,
            checked[i].fileSize,
            att.dataUrl,
            att.title?.trim() || testName,
            att.description?.trim() || null,
            att.category || "LAB_RESULT",
            userId,
            now,
          ]
        );
      }
    }

    await logAudit(tx, {
      userId,
      action: "CREATE",
      entityType: "LAB_RESULT",
      recordId: labId,
      patientId: input.patientId,
      caseId: input.caseId || null,
      newValue: `${testName}: ${resultValue} ${input.unit || ""}`.trim(),
    });
  });

  const created = await getLabResultById(db, labId);
  if (!created) throw new Error("Failed to load created lab result.");
  return created;
}

export async function getLabResultById(db: Db, labId: string): Promise<PatientLabResult | null> {
  const rows = await db.select<PatientLabResult & { case_number: string | null }>(
    `SELECT l.*, c.case_number
     FROM patient_lab_results l
     LEFT JOIN surgical_cases c ON l.case_id = c.case_id
     WHERE l.lab_id = ?`,
    [labId]
  );
  if (!rows[0]) return null;
  const lab = rows[0];
  const attachments = await getAttachmentsByLab(db, labId);
  return { ...lab, attachments };
}

export async function getLabResultsByPatient(db: Db, patientId: string): Promise<PatientLabResult[]> {
  requirePermission("patients.view");
  const labs = await db.select<PatientLabResult & { case_number: string | null }>(
    `SELECT l.*, c.case_number
     FROM patient_lab_results l
     LEFT JOIN surgical_cases c ON l.case_id = c.case_id
     WHERE l.patient_id = ?
     ORDER BY l.specimen_collected_at DESC, l.created_at DESC`,
    [patientId]
  );

  const attachments = await getAttachmentsByPatient(db, patientId);
  const byLab = new Map<string, ClinicalAttachment[]>();
  for (const att of attachments) {
    if (att.lab_id) {
      const list = byLab.get(att.lab_id) || [];
      list.push(att);
      byLab.set(att.lab_id, list);
    }
  }

  return labs.map((l) => ({
    ...l,
    attachments: byLab.get(l.lab_id) || [],
  }));
}

export async function getLabResultsByCase(db: Db, caseId: string): Promise<PatientLabResult[]> {
  requirePermission("patients.view");
  const labs = await db.select<PatientLabResult & { case_number: string | null }>(
    `SELECT l.*, c.case_number
     FROM patient_lab_results l
     LEFT JOIN surgical_cases c ON l.case_id = c.case_id
     WHERE l.case_id = ?
     ORDER BY l.specimen_collected_at DESC`,
    [caseId]
  );
  const attachments = await getAttachmentsByCase(db, caseId);
  const byLab = new Map<string, ClinicalAttachment[]>();
  for (const att of attachments) {
    if (att.lab_id) {
      const list = byLab.get(att.lab_id) || [];
      list.push(att);
      byLab.set(att.lab_id, list);
    }
  }
  return labs.map((l) => ({
    ...l,
    attachments: byLab.get(l.lab_id) || [],
  }));
}

export async function deleteLabResult(db: Db, labId: string): Promise<void> {
  const userId = requirePermission("cases.edit", "patients.create", "patients.edit_demographics");
  const existing = await getLabResultById(db, labId);
  if (!existing) return;

  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM clinical_attachments WHERE lab_id = ?", [labId]);
    await tx.execute("DELETE FROM patient_lab_results WHERE lab_id = ?", [labId]);
    await logAudit(tx, {
      userId,
      action: "DELETE",
      entityType: "LAB_RESULT",
      recordId: labId,
      patientId: existing.patient_id,
      caseId: existing.case_id || null,
      oldValue: `${existing.test_name}: ${existing.result_value}`,
    });
  });
}

export interface CreateAttachmentInput {
  patientId: string;
  labId?: string | null;
  caseId?: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  dataUrl: string;
  title?: string | null;
  description?: string | null;
  category?: AttachmentCategory;
}

export async function createAttachment(db: Db, input: CreateAttachmentInput): Promise<ClinicalAttachment> {
  const userId = requirePermission("cases.edit", "patients.create", "patients.edit_demographics", "preor.edit");
  const now = nowIso();
  const attachmentId = uuid();
  const category = input.category || "LAB_RESULT";
  const checked = checkAttachment(input);

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO clinical_attachments (
        attachment_id, patient_id, lab_id, case_id, file_name, file_type,
        file_size, data_url, title, description, category, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachmentId,
        input.patientId,
        input.labId || null,
        input.caseId || null,
        input.fileName,
        checked.fileType,
        checked.fileSize,
        input.dataUrl,
        input.title?.trim() || input.fileName,
        input.description?.trim() || null,
        category,
        userId,
        now,
      ]
    );

    await logAudit(tx, {
      userId,
      action: "ATTACH_FILE",
      entityType: "ATTACHMENT",
      recordId: attachmentId,
      patientId: input.patientId,
      caseId: input.caseId || null,
      newValue: `${input.fileName} (${category}, ${(checked.fileSize / 1024).toFixed(1)} KB)`,
    });
  });

  const rows = await db.select<ClinicalAttachment>(
    "SELECT * FROM clinical_attachments WHERE attachment_id = ?",
    [attachmentId]
  );
  if (!rows[0]) throw new Error("Failed to load created attachment.");
  return rows[0];
}

export async function getAttachmentsByPatient(db: Db, patientId: string): Promise<ClinicalAttachment[]> {
  requirePermission("patients.view");
  return db.select<ClinicalAttachment>(
    "SELECT * FROM clinical_attachments WHERE patient_id = ? ORDER BY created_at DESC",
    [patientId]
  );
}

export async function getAttachmentsByLab(db: Db, labId: string): Promise<ClinicalAttachment[]> {
  requirePermission("patients.view");
  return db.select<ClinicalAttachment>(
    "SELECT * FROM clinical_attachments WHERE lab_id = ? ORDER BY created_at DESC",
    [labId]
  );
}

export async function getAttachmentsByCase(db: Db, caseId: string): Promise<ClinicalAttachment[]> {
  requirePermission("patients.view");
  return db.select<ClinicalAttachment>(
    "SELECT * FROM clinical_attachments WHERE case_id = ? ORDER BY created_at DESC",
    [caseId]
  );
}

export async function deleteAttachment(db: Db, attachmentId: string): Promise<void> {
  const userId = requirePermission("cases.edit", "patients.create", "patients.edit_demographics");
  const rows = await db.select<ClinicalAttachment>(
    "SELECT * FROM clinical_attachments WHERE attachment_id = ?",
    [attachmentId]
  );
  if (!rows[0]) return;
  const att = rows[0];

  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM clinical_attachments WHERE attachment_id = ?", [attachmentId]);
    await logAudit(tx, {
      userId,
      action: "DELETE",
      entityType: "ATTACHMENT",
      recordId: attachmentId,
      patientId: att.patient_id,
      caseId: att.case_id,
      oldValue: `${att.file_name} (${att.category})`,
    });
  });
}
