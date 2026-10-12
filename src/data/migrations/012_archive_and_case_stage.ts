/**
 * Migration 012 - archiving patients and correcting a case's stage.
 * Patients are never deleted: archiving hides them and records who did it and why.
 * A case that is cancelled, postponed or moved by hand keeps the reason given.
 */
const newPermissions: [string, string, number][] = [
  ["patients.archive", "Archive and restore patients", 18],
  ["cases.change_stage", "Move cases between stages", 19],
];

export const M012_ARCHIVE_AND_CASE_STAGE = [
  "ALTER TABLE patients ADD COLUMN archived_at TEXT;",
  "ALTER TABLE patients ADD COLUMN archived_by TEXT REFERENCES users(user_id);",
  "ALTER TABLE patients ADD COLUMN archive_reason TEXT;",
  "ALTER TABLE surgical_cases ADD COLUMN status_reason TEXT;",
  ...newPermissions.map(
    ([k, l, i]) => `INSERT INTO permissions (permission_key, label, display_order) VALUES ('${k}', '${l}', ${i});`,
  ),
  ...["role-admin", "role-supervisor"].flatMap((role) =>
    newPermissions.map(([k]) => `INSERT INTO role_permissions (role_id, permission_key) VALUES ('${role}', '${k}');`),
  ),
].join("\n");
