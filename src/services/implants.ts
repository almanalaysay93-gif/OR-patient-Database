import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission } from "./session";

export interface CaseImplant {
  implant_id: string;
  case_id: string;
  device_name: string;
  manufacturer: string | null;
  model_number: string | null;
  lot_number: string | null;
  serial_number: string | null;
  udi_barcode: string | null;
  expiry_date: string | null;
  anatomical_site: string | null;
  notes: string | null;
  created_at: string;
}

export interface AddImplantParams {
  caseId: string;
  deviceName: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  udiBarcode?: string | null;
  expiryDate?: string | null;
  anatomicalSite?: string | null;
  notes?: string | null;
  userId?: string;
}

export async function listCaseImplants(db: Db, caseId: string): Promise<CaseImplant[]> {
  requirePermission("patients.view");
  return db.select<CaseImplant>("SELECT * FROM case_implants WHERE case_id = ? ORDER BY created_at ASC", [caseId]);
}

export async function addCaseImplant(db: Db, params: AddImplantParams): Promise<CaseImplant> {
  const userId = requirePermission("intraor.edit", "cases.edit");
  const deviceName = params.deviceName.trim();
  if (!deviceName) throw new Error("Device or implant name is required.");

  const implantId = uuid();
  const now = nowIso();

  await db.execute(
    `INSERT INTO case_implants (
       implant_id, case_id, device_name, manufacturer, model_number,
       lot_number, serial_number, udi_barcode, expiry_date, anatomical_site, notes, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      implantId,
      params.caseId,
      deviceName,
      params.manufacturer?.trim() || null,
      params.modelNumber?.trim() || null,
      params.lotNumber?.trim() || null,
      params.serialNumber?.trim() || null,
      params.udiBarcode?.trim() || null,
      params.expiryDate || null,
      params.anatomicalSite?.trim() || null,
      params.notes?.trim() || null,
      now,
    ]
  );

  // Automatically mark implant_used = 1 on intra_or_records
  await db.execute(
    `INSERT INTO intra_or_records (intra_or_id, case_id, implant_used, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(case_id) DO UPDATE SET implant_used = 1, updated_at = ?`,
    [uuid(), params.caseId, now, now, now]
  );

  await logAudit(db, {
    action: "ADD_IMPLANT",
    entityType: "SURGICAL_CASE",
    recordId: params.caseId,
    caseId: params.caseId,
    newValue: `Recorded implant ${deviceName} (Lot: ${params.lotNumber || "N/A"})`,
    userId: params.userId || userId,
  });

  const rows = await db.select<CaseImplant>("SELECT * FROM case_implants WHERE implant_id = ?", [implantId]);
  return rows[0];
}

export async function deleteCaseImplant(db: Db, implantId: string, userId?: string): Promise<void> {
  const callerId = requirePermission("intraor.edit", "cases.edit");
  const existing = await db.select<CaseImplant>("SELECT * FROM case_implants WHERE implant_id = ?", [implantId]);
  if (!existing.length) return;

  const caseId = existing[0].case_id;
  await db.execute("DELETE FROM case_implants WHERE implant_id = ?", [implantId]);

  // If no implants left, check count
  const remaining = await db.select<{ count: number }>("SELECT COUNT(*) AS count FROM case_implants WHERE case_id = ?", [caseId]);
  if (remaining[0]?.count === 0) {
    await db.execute("UPDATE intra_or_records SET implant_used = 0 WHERE case_id = ?", [caseId]);
  }

  await logAudit(db, {
    action: "REMOVE_IMPLANT",
    entityType: "SURGICAL_CASE",
    recordId: caseId,
    caseId,
    oldValue: `Removed implant ${existing[0].device_name}`,
    userId: userId || callerId,
  });
}
