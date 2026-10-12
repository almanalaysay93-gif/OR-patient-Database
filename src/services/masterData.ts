import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission, requireSession } from "./session";

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
  requireSession();
  const sql = `SELECT * FROM specialties ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order, name`;
  return db.select<Specialty>(sql);
}

export async function getProcedures(db: Db, onlyActive = true): Promise<Procedure[]> {
  requireSession();
  const sql = `SELECT * FROM procedures ${onlyActive ? "WHERE active = 1" : ""} ORDER BY procedure_name`;
  return db.select<Procedure>(sql);
}

export async function getDiagnoses(db: Db, onlyActive = true): Promise<Diagnosis[]> {
  requireSession();
  const sql = `SELECT * FROM diagnoses ${onlyActive ? "WHERE active = 1" : ""} ORDER BY diagnosis_name`;
  return db.select<Diagnosis>(sql);
}

export async function createProcedure(
  db: Db, params: {
    name: string; code?: string | null; codeSystem?: string | null; specialtyId?: string | null; userId?: string | null;
  },
): Promise<Procedure> {
  params = { ...params, userId: requirePermission("masterdata.manage", "cases.edit") };
  const name = params.name.trim();
  if (!name) throw new Error("Procedure name is required.");
  const id = uuid();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO procedures
       (procedure_id, procedure_code, procedure_name, code_system, specialty_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, params.code?.trim() || null, name, params.codeSystem?.trim() || null, params.specialtyId || null, now, now]);
    await logAudit(tx, { userId: params.userId, action: "CREATE_PROCEDURE", entityType: "PROCEDURE",
      recordId: id, newValue: JSON.stringify({ name, code: params.code || null, system: params.codeSystem || null }) });
  });
  return (await db.select<Procedure>("SELECT * FROM procedures WHERE procedure_id = ?", [id]))[0];
}

export async function createDiagnosis(
  db: Db, params: { name: string; code?: string | null; codeSystem?: string | null; userId?: string | null },
): Promise<Diagnosis> {
  params = { ...params, userId: requirePermission("masterdata.manage", "cases.edit") };
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
  requireSession();
  const sql = `SELECT * FROM or_rooms ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order, name`;
  return db.select<OrRoom>(sql);
}

export async function getStaff(db: Db, onlyActive = true): Promise<StaffMember[]> {
  requireSession();
  const sql = `SELECT * FROM staff ${onlyActive ? "WHERE active = 1" : ""} ORDER BY full_name`;
  return db.select<StaffMember>(sql);
}

export async function getTeamRoles(db: Db, onlyActive = true): Promise<TeamRole[]> {
  requireSession();
  const sql = `SELECT * FROM team_roles ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`;
  return db.select<TeamRole>(sql);
}

export async function getAnesthesiaTypes(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  requireSession();
  return db.select<NamedEntity>(
    `SELECT anesthesia_type_id as id, name, active, display_order FROM anesthesia_types ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function getPostOpDestinations(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  requireSession();
  return db.select<NamedEntity>(
    `SELECT destination_id as id, name, active, display_order FROM post_op_destinations ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function getComplicationTypes(db: Db, onlyActive = true): Promise<{ complication_type_id: string; name: string; category: string; active: number }[]> {
  requireSession();
  return db.select(
    `SELECT complication_type_id, name, category, active FROM complication_types ${onlyActive ? "WHERE active = 1" : ""} ORDER BY category, name`
  );
}

export async function getDelayReasons(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  requireSession();
  return db.select<NamedEntity>(
    `SELECT delay_reason_id as id, name, active, display_order FROM delay_reasons ${onlyActive ? "WHERE active = 1" : ""} ORDER BY display_order`
  );
}

export async function getCancellationReasons(db: Db, onlyActive = true): Promise<NamedEntity[]> {
  requireSession();
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
  requirePermission("masterdata.manage");
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

async function addNamedRow(
  db: Db,
  kind: { table: "or_rooms" | "specialties"; idColumn: string; action: string; entity: string; label: string },
  name: string,
): Promise<string> {
  const userId = requirePermission("masterdata.manage");
  const clean = name.trim();
  if (!clean) throw new Error(`Enter a ${kind.label} name.`);
  const dup = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${kind.table} WHERE name = ? COLLATE NOCASE`, [clean]);
  if (dup[0]?.n) throw new Error(`This ${kind.label} already exists.`);
  const id = uuid();
  const extra = kind.table === "or_rooms" ? `Operating Suite - ${clean}` : clean.substring(0, 4).toUpperCase();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO ${kind.table} (${kind.idColumn}, name, ${kind.table === "or_rooms" ? "description" : "code"}, active, display_order)
       VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM ${kind.table}))`,
      [id, clean, extra]);
    await logAudit(tx, { userId, action: kind.action, entityType: kind.entity, recordId: id, newValue: clean });
  });
  return id;
}

export function addOrRoom(db: Db, name: string): Promise<string> {
  return addNamedRow(db, { table: "or_rooms", idColumn: "or_room_id", action: "ADD_OR_ROOM", entity: "OR_ROOM", label: "room" }, name);
}

export function addSpecialty(db: Db, name: string): Promise<string> {
  return addNamedRow(db, { table: "specialties", idColumn: "specialty_id", action: "ADD_SPECIALTY", entity: "SPECIALTY", label: "specialty" }, name);
}

export async function saveFacilityProfile(
  db: Db, params: { facilityName: string; departmentName: string },
): Promise<void> {
  const userId = requirePermission("masterdata.manage");
  const facility = params.facilityName.trim();
  const department = params.departmentName.trim();
  if (!facility) throw new Error("Facility name is required.");
  await db.transaction(async (tx) => {
    await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('facility_name', ?)", [facility]);
    await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('department_name', ?)", [department]);
    await logAudit(tx, {
      userId, action: "SAVE_FACILITY_PROFILE", entityType: "APP_SETTINGS",
      newValue: JSON.stringify({ facility, department }),
    });
  });
}
