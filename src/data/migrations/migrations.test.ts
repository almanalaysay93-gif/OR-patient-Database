import { describe, it, expect } from "vitest";
import { openMemoryDb } from "../sqljs-adapter";
import { runMigrations } from "./index";

describe("Database migrations", () => {
  it("applies every migration cleanly on in-memory SQLite", async () => {
    const db = await openMemoryDb();
    const result = await runMigrations(db);

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(9);
    expect(result.applied).toEqual([
      "1_initial_schema",
      "2_seed_reference_data",
      "3_workstation_auto_login",
      "4_remove_assistant_settings",
      "5_case_coding",
      "6_preop_baseline",
      "7_safety_phases",
      "8_case_events",
      "9_followup",
    ]);

    // Check roles
    const roles = await db.select<{ role_id: string; name: string }>(
      "SELECT role_id, name FROM roles ORDER BY display_order"
    );
    expect(roles.length).toBe(6);
    expect(roles.map((r) => r.name)).toContain("Administrator");
    expect(roles.map((r) => r.name)).toContain("OR Supervisor");

    // Check pre-or checklist definitions
    const checklist = await db.select(
      "SELECT checklist_item_id, name FROM pre_or_checklist_definitions"
    );
    expect(checklist.length).toBeGreaterThanOrEqual(9);

    // Check audit immutability trigger
    await db.execute(
      "INSERT INTO audit_log (audit_id, action, entity_type, timestamp) VALUES ('test-audit-1', 'CREATE', 'PATIENT', '2026-10-07T00:00:00Z')"
    );

    // Verify update triggers abort
    await expect(
      db.execute("UPDATE audit_log SET action = 'UPDATE' WHERE audit_id = 'test-audit-1'")
    ).rejects.toThrow(/Audit log entries cannot be changed/);

    // Verify delete triggers abort
    await expect(
      db.execute("DELETE FROM audit_log WHERE audit_id = 'test-audit-1'")
    ).rejects.toThrow(/Audit log entries cannot be deleted/);
  });
});
