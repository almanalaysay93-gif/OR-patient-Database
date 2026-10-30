import type { Db } from "../data/db";
import { uuid, nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission, requireSession } from "./session";
import type { DonorRelation } from "./patientData";

export interface DonorRelationshipType {
  relationship_type_id: string;
  name: string;
  donor_relation: DonorRelation;
  active: number;
  display_order: number;
}

export async function getDonorRelationshipTypes(db: Db, onlyActive = true): Promise<DonorRelationshipType[]> {
  requireSession();
  return db.select<DonorRelationshipType>(
    `SELECT relationship_type_id, name, donor_relation, active, display_order FROM donor_relationship_types
     ${onlyActive ? "WHERE active = 1" : ""} ORDER BY donor_relation, display_order, name`);
}

export async function addDonorRelationshipType(db: Db, name: string, donorRelation: DonorRelation): Promise<string> {
  const userId = requirePermission("masterdata.manage");
  const clean = name.trim();
  if (!clean) throw new Error("Enter a relationship name.");
  if (donorRelation !== "RELATED" && donorRelation !== "NON_RELATED") throw new Error("Choose related or non-related.");
  const dup = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM donor_relationship_types WHERE name = ? COLLATE NOCASE", [clean]);
  if (dup[0]?.n) throw new Error("This relationship already exists.");
  const id = uuid();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO donor_relationship_types (relationship_type_id, name, donor_relation, active, display_order, created_at)
       VALUES (?, ?, ?, 1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM donor_relationship_types), ?)`,
      [id, clean, donorRelation, nowIso()]);
    await logAudit(tx, {
      userId, action: "ADD_DONOR_RELATIONSHIP_TYPE", entityType: "DONOR_RELATIONSHIP_TYPE", recordId: id,
      newValue: JSON.stringify({ name: clean, donorRelation }),
    });
  });
  return id;
}

export async function setDonorRelationshipTypeActive(db: Db, id: string, active: boolean): Promise<void> {
  const userId = requirePermission("masterdata.manage");
  await db.transaction(async (tx) => {
    await tx.execute("UPDATE donor_relationship_types SET active = ? WHERE relationship_type_id = ?", [active ? 1 : 0, id]);
    await logAudit(tx, {
      userId, action: active ? "ENABLE_DONOR_RELATIONSHIP_TYPE" : "DISABLE_DONOR_RELATIONSHIP_TYPE",
      entityType: "DONOR_RELATIONSHIP_TYPE", recordId: id,
    });
  });
}
