import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";

export interface MasterItem {
  id: string;
  name: string;
  code?: string | null;
  category?: string | null;
  active: boolean;
  display_order?: number;
}

export interface Specialty {
  specialty_id: string;
  name: string;
  code: string | null;
  active: number;
  display_order: number;
}

export interface Procedure {
  procedure_id: string;
  procedure_code: string | null;
  code_system: string | null;
  procedure_name: string;
  specialty_id: string | null;
  category: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Diagnosis {
  diagnosis_id: string;
  diagnosis_code: string | null;
  code_system: string | null;
  diagnosis_name: string;
  category: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface OrRoom {
  or_room_id: string;
  name: string;
  description: string | null;
  active: number;
  display_order: number;
}

export interface StaffMember {
  staff_id: string;
  employee_code: string | null;
  full_name: string;
  professional_role: string | null;
  specialty: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface TeamRole {
  team_role_id: string;
  name: string;
  conflict_checked: number;
  active: number;
  display_order: number;
}

export interface NamedEntity {
  id: string;
  name: string;
  active: number;
  display_order: number;
}

export async function getSpecialties(db: Db, onlyActive = true): Promise<Specialty[]> {
  const sql = `SELECT * FROM specialties ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order, name`;
  return db.select<Specialty>(sql);
}

export async function getProcedures(db: Db, onlyActive = true): Promise<Procedure[]> {
  const sql = `SELECT * FROM procedures ${onlyActive ? "WHERE active = 1" : ""} ORDER BY procedure_name`;
  return db.select<Procedure>(sql);
}

export async function getDiagnoses(db: Db, onlyActive = true): Promise<Diagnosis[]> {
  const sql = `SELECT * FROM diagnoses ${onlyActive ? "WHERE active = 1" : ""} ORDER BY diagnosis_name`;
  return db.select<Diagnosis>(sql);
}

export async function createProcedure(
  db: Db, params: { name: string; code?: string | null; codeSystem?: string | null; userId?: string | null },
): Promise<Procedure> {
  const name = params.name.trim();
  if (!name) throw new Error("Procedure name is required.");
  const id = uuid();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO procedures
       (procedure_id, procedure_code, procedure_name, code_system, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, params.code?.trim() || null, name, params.codeSystem?.trim() || null, now, now]);
    await logAudit(tx, { userId: params.userId, action: "CREATE_PROCEDURE", entityType: "PROCEDURE",
      recordId: id, newValue: JSON.stringify({ name, code: params.code || null, system: params.codeSystem || null }) });
  });
  return (await db.select<Procedure>("SELECT * FROM procedures WHERE procedure_id = ?", [id]))[0];
}

export async function createDiagnosis(
  db: Db, params: { name: string; code?: string | null; codeSystem?: string | null; userId?: string | null },
): Promise<Diagnosis> {
  const name = params.name.trim();
  if (!name) throw new Error("Diagnosis name is required.");
  const id = uuid();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO diagnoses
       (diagnosis_id, diagnosis_code, diagnosis_name, code_system, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, params.code?.trim() || null, name, params.codeSystem?.trim() || null, now, now]);
    await logAudit(tx, { userId: params.userId, action: "CREATE_DIAGNOSIS", entityType: "DIAGNOSIS",
      recordId: id, newValue: JSON.stringify({ name, code: params.code || null, system: params.codeSystem || null }) });
  });
  return (await db.select<Diagnosis>("SELECT * FROM diagnoses WHERE diagnosis_id = ?", [id]))[0];
}

export async function getOrRooms(db: Db, onlyActive = true): Promise<OrRoom[]> {
  const sql = `SELECT * FROM or_rooms ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order, name`;
  return db.select<OrRoom>(sql);
}

export async function getStaff(db: Db, onlyActive = true): Promise<StaffMember[]> {
  const sql = `SELECT * FROM staff ${onlyActive ? "WHERE active = 1" : ""} ORDER BY full_name`;
  return db.select<StaffMember>(sql);
}

export async function getTeamRoles(db: Db, onlyActive = true): Promise<TeamRole[]> {
  const sql = `SELECT * FROM team_roles ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`;
  return db.select<TeamRole>(sql);
}

export async function getAnesthesiaTypes(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  return db.select<NamedEntity>(
    `SELECT anesthesia_type_id as id, name, active, display_order FROM anesthesia_types ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function getPostOpDestinations(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  return db.select<NamedEntity>(
    `SELECT destination_id as id, name, active, display_order FROM post_op_destinations ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function getComplicationTypes(db: Db, onlyActive = true): Promise<{ complication_type_id: string; name: string; category: string; active: number }[]> {
  return db.select(
    `SELECT complication_type_id, name, category, active FROM complication_types ${onlyActive ? "WHERE active = 1" : ""} ORDER BY category, name`
  );
}

export async function getDelayReasons(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  return db.select<NamedEntity>(
    `SELECT delay_reason_id as id, name, active, display_order FROM delay_reasons ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function getCancellationReasons(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  return db.select<NamedEntity>(
    `SELECT cancellation_reason_id as id, name, active, display_order FROM cancellation_reasons ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function seedInitialFacilityData(
  db: Db,
  params: {
    facilityName: string;
    departmentName: string;
    orRooms: string[];
    specialties: string[];
    staffMembers: { name: string; role: string }[];
  }
): Promise<void> {
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('facility_name', ?)", [params.facilityName]);
    await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('department_name', ?)", [params.departmentName]);

    for (let i = 0; i < params.orRooms.length; i++) {
      const room = params.orRooms[i].trim();
      if (!room) continue;
      await tx.execute(
        "INSERT INTO or_rooms (or_room_id, name, description, active, display_order) VALUES (?, ?, ?, 1, ?)",
        [uuid(), room, `Operating Suite - ${room}`, i + 1]
      );
    }

    for (let i = 0; i < params.specialties.length; i++) {
      const spec = params.specialties[i].trim();
      if (!spec) continue;
      await tx.execute(
        "INSERT INTO specialties (specialty_id, name, code, active, display_order) VALUES (?, ?, ?, 1, ?)",
        [uuid(), spec, spec.substring(0, 4).toUpperCase(), i + 1]
      );
    }

    for (let i = 0; i < params.staffMembers.length; i++) {
      const s = params.staffMembers[i];
      if (!s.name.trim()) continue;
      await tx.execute(
        `INSERT INTO staff (staff_id, employee_code, full_name, professional_role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [uuid(), `EMP-${(i + 1).toString().padStart(4, "0")}`, s.name.trim(), s.role, now, now]
      );
    }
  });
}
