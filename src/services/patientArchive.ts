import type { Db } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";

export interface ArchivedPatient {
  patient_id: string;
  hrn: string | null;
  first_name: string;
  last_name: string;
  archived_at: string | null;
  archive_reason: string | null;
  archived_by_name: string | null;
}

interface PatientRow {
  patient_id: string;
  hrn: string | null;
  first_name: string;
  last_name: string;
  is_active: number;
}

async function loadPatient(db: Db, patientId: string): Promise<PatientRow> {
  const rows = await db.select<PatientRow>(
    "SELECT patient_id, hrn, first_name, last_name, is_active FROM patients WHERE patient_id = ?",
    [patientId],
  );
  if (!rows[0]) throw new Error("Patient not found.");
  return rows[0];
}

/**
 * Hides a patient from lists and search. Nothing is deleted: admissions, cases and
 * the audit trail stay in the database and the patient can be restored.
 */
export async function archivePatient(db: Db, patientId: string, reason: string): Promise<void> {
  const userId = requirePermission("patients.archive");
  const why = (reason ?? "").trim();
  if (why.length < 3) throw new Error("Enter a reason (at least 3 characters).");
  const patient = await loadPatient(db, patientId);
  if (!patient.is_active) throw new Error("This patient is already archived.");

  const open = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM surgical_cases WHERE patient_id = ? AND case_status NOT IN ('COMPLETED','CANCELLED')",
    [patientId],
  );
  if (open[0]?.n) {
    throw new Error(
      `This patient has ${open[0].n} open case${open[0].n === 1 ? "" : "s"}. Cancel or complete ${open[0].n === 1 ? "it" : "them"} before archiving.`,
    );
  }

  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE patients SET is_active = 0, archived_at = ?, archived_by = ?, archive_reason = ?, updated_at = ? WHERE patient_id = ?",
      [now, userId, why, now, patientId],
    );
    await logAudit(tx, {
      userId,
      patientId,
      action: "ARCHIVE_PATIENT",
      entityType: "patients",
      recordId: patientId,
      fieldName: "is_active",
      oldValue: "1",
      newValue: JSON.stringify({ archived: true, reason: why }),
    });
  });
}

export async function restorePatient(db: Db, patientId: string): Promise<void> {
  const userId = requirePermission("patients.archive");
  const patient = await loadPatient(db, patientId);
  if (patient.is_active) throw new Error("This patient is not archived.");

  if (patient.hrn) {
    const clash = await db.select<{ patient_id: string }>(
      "SELECT patient_id FROM patients WHERE hrn = ? AND is_active = 1 AND patient_id <> ?",
      [patient.hrn, patientId],
    );
    if (clash.length > 0) {
      throw new Error(`Another active patient already uses HRN ${patient.hrn}. Fix that record before restoring this one.`);
    }
  }

  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE patients SET is_active = 1, archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = ? WHERE patient_id = ?",
      [now, patientId],
    );
    await logAudit(tx, {
      userId,
      patientId,
      action: "RESTORE_PATIENT",
      entityType: "patients",
      recordId: patientId,
      fieldName: "is_active",
      oldValue: "0",
      newValue: "1",
    });
  });
}

export async function listArchivedPatients(db: Db): Promise<ArchivedPatient[]> {
  requirePermission("patients.archive");
  return db.select<ArchivedPatient>(
    `SELECT p.patient_id, p.hrn, p.first_name, p.last_name, p.archived_at, p.archive_reason,
            u.full_name AS archived_by_name
     FROM patients p
     LEFT JOIN users u ON u.user_id = p.archived_by
     WHERE p.is_active = 0
     ORDER BY p.archived_at DESC`,
  );
}
