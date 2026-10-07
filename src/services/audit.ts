import type { Db, RawDb } from "../data/db";
import { uuid, nowIso } from "../data/db";

export interface AuditEntry {
  audit_id: string;
  user_id: string | null;
  username?: string | null;
  patient_id: string | null;
  admission_id: string | null;
  case_id: string | null;
  action: string;
  entity_type: string;
  record_id: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
  device_identifier: string | null;
}

export interface RecordAuditParams {
  userId?: string | null;
  patientId?: string | null;
  admissionId?: string | null;
  caseId?: string | null;
  action: string;
  entityType: string;
  recordId?: string | null;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  deviceIdentifier?: string | null;
}

export async function logAudit(
  executor: Db | RawDb,
  params: RecordAuditParams
): Promise<string> {
  const auditId = uuid();
  const timestamp = nowIso();

  await executor.execute(
    `INSERT INTO audit_log (
      audit_id, user_id, patient_id, admission_id, case_id,
      action, entity_type, record_id, field_name, old_value, new_value,
      timestamp, device_identifier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditId,
      params.userId ?? null,
      params.patientId ?? null,
      params.admissionId ?? null,
      params.caseId ?? null,
      params.action,
      params.entityType,
      params.recordId ?? null,
      params.fieldName ?? null,
      params.oldValue ?? null,
      params.newValue ?? null,
      timestamp,
      params.deviceIdentifier ?? "DESKTOP-APP",
    ]
  );

  return auditId;
}

export async function getAuditHistory(
  db: Db,
  filter?: { patientId?: string; caseId?: string; limit?: number }
): Promise<AuditEntry[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.patientId) {
    conditions.push("a.patient_id = ?");
    params.push(filter.patientId);
  }
  if (filter?.caseId) {
    conditions.push("a.case_id = ?");
    params.push(filter.caseId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ?? 100;
  params.push(limit);

  return db.select<AuditEntry>(
    `SELECT a.*, u.username, u.full_name as user_full_name
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.user_id
     ${where}
     ORDER BY a.timestamp DESC
     LIMIT ?`,
    params
  );
}
