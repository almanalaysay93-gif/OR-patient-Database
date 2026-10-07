/**
 * Migration 002 - reference data. Every list here is editable later in Settings.
 * No patient data and no clinical statistics are seeded.
 */
const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

const permissions: [string, string][] = [
  ["patients.view", "View patients"],
  ["patients.create", "Create patients"],
  ["patients.edit_demographics", "Edit demographics"],
  ["cases.edit", "Edit admissions and surgical cases"],
  ["preor.edit", "Edit Pre-OR"],
  ["schedule.edit", "Edit schedule"],
  ["intraor.edit", "Edit Intra-OR"],
  ["postor.edit", "Edit Post-OR"],
  ["masterdata.manage", "Manage master data"],
  ["analytics.access", "Access analytics"],
  ["research.build", "Build research cohorts"],
  ["export.deidentified", "Export de-identified data"],
  ["export.identifiable", "Export identifiable data"],
  ["users.manage", "Manage users"],
  ["db.backup", "Backup database"],
  ["db.restore", "Restore database"],
  ["audit.view", "View audit logs"],
];

const roles: [string, string, string, string[]][] = [
  ["role-admin", "Administrator", "Full access", permissions.map((p) => p[0])],
  ["role-supervisor", "OR Supervisor", "Runs the OR day", [
    "patients.view", "patients.create", "patients.edit_demographics", "cases.edit", "preor.edit", "schedule.edit",
    "intraor.edit", "postor.edit", "masterdata.manage", "analytics.access", "research.build", "export.deidentified",
    "db.backup", "audit.view",
  ]],
  ["role-nurse", "Nurse", "Clinical documentation", [
    "patients.view", "patients.create", "patients.edit_demographics", "cases.edit", "preor.edit", "intraor.edit", "postor.edit",
  ]],
  ["role-doctor", "Doctor", "Clinical documentation and analytics", [
    "patients.view", "patients.create", "cases.edit", "preor.edit", "intraor.edit", "postor.edit", "analytics.access",
  ]],
  ["role-research", "Research User", "Cohorts and de-identified export", [
    "analytics.access", "research.build", "export.deidentified",
  ]],
  ["role-readonly", "Read Only", "View only", ["patients.view"]],
];

const caseStatus: [string, string][] = [
  ["PRE_OR", "Pre-OR"], ["NOT_READY", "Not ready"], ["READY", "Ready"], ["SCHEDULED", "Scheduled"],
  ["IN_OR", "In OR"], ["PACU", "PACU"], ["POST_OR", "Post-OR"], ["COMPLETED", "Completed"],
  ["POSTPONED", "Postponed"], ["CANCELLED", "Cancelled"],
];

const list = (table: string, idCol: string, prefix: string, names: string[]) =>
  names
    .map(
      (n, i) =>
        `INSERT INTO ${table} (${idCol}, name, active, display_order) VALUES ('${prefix}-${i + 1}', '${n.replace(/'/g, "''")}', 1, ${i + 1});`,
    )
    .join("\n");

const teamRoles: [string, number][] = [
  ["Primary Surgeon", 1], ["Assistant Surgeon", 0], ["Anesthesiologist", 1],
  ["Scrub Nurse", 0], ["Circulating Nurse", 0], ["Other", 0],
];

const checklist: [string, string][] = [
  ["Informed consent signed", "Surgical and anesthesia consent on file"],
  ["Surgical site marked", "Mark applies to lateralized procedures"],
  ["NPO status confirmed", "Fasting time verified"],
  ["Allergies checked", "Allergy status reviewed and recorded"],
  ["Blood available", "Type and crossmatch ready when required"],
  ["Laboratory results complete", "Required pre-operative labs resulted"],
  ["Imaging available", "Required imaging available in OR"],
  ["Medical clearance", "Clearance from attending service"],
  ["Anesthesia clearance", "Pre-anesthesia evaluation complete"],
];

const complicationTypes: [string, string][] = [
  ["Surgical site infection", "Infectious"], ["Sepsis", "Infectious"], ["Post-operative bleeding", "Hemorrhagic"],
  ["Hematoma", "Hemorrhagic"], ["Deep vein thrombosis", "Thromboembolic"], ["Pulmonary embolism", "Thromboembolic"],
  ["Pneumonia", "Respiratory"], ["Atelectasis", "Respiratory"], ["Acute kidney injury", "Renal"],
  ["Urinary retention", "Renal"], ["Arrhythmia", "Cardiac"], ["Myocardial infarction", "Cardiac"],
  ["Anastomotic leak", "Surgical"], ["Wound dehiscence", "Surgical"], ["Graft dysfunction", "Surgical"],
  ["Anesthesia-related event", "Anesthetic"], ["Other", "Other"],
];

export const M002_SEED = [
  ...permissions.map(
    ([k, l], i) => `INSERT INTO permissions (permission_key, label, display_order) VALUES ('${k}', '${l}', ${i + 1});`,
  ),
  ...roles.map(
    ([id, name, desc], i) =>
      `INSERT INTO roles (role_id, name, description, is_system, display_order) VALUES ('${id}', '${name}', '${desc}', 1, ${i + 1});`,
  ),
  ...roles.flatMap(([id, , , perms]) =>
    perms.map((p) => `INSERT INTO role_permissions (role_id, permission_key) VALUES ('${id}', '${p}');`),
  ),
  ...caseStatus.map(
    ([c, l], i) => `INSERT INTO status_labels (domain, code, label, display_order) VALUES ('case_status', '${c}', '${l}', ${i + 1});`,
  ),
  ...teamRoles.map(
    ([n, c], i) =>
      `INSERT INTO team_roles (team_role_id, name, conflict_checked, active, display_order) VALUES ('team-${i + 1}', '${n}', ${c}, 1, ${i + 1});`,
  ),
  ...checklist.map(
    ([n, d], i) =>
      `INSERT INTO pre_or_checklist_definitions (checklist_item_id, name, description, required_by_default, active, display_order) VALUES ('chk-${i + 1}', '${n}', '${d}', 1, 1, ${i + 1});`,
  ),
  list("anesthesia_types", "anesthesia_type_id", "anes", [
    "General", "Spinal", "Epidural", "Combined spinal-epidural", "Regional block", "Monitored anesthesia care", "Local",
  ]),
  list("post_op_destinations", "destination_id", "dest", ["Ward", "ICU", "PACU then ward", "High dependency unit", "Day surgery discharge", "Morgue"]),
  ...complicationTypes.map(
    ([n, c], i) =>
      `INSERT INTO complication_types (complication_type_id, name, category, active, display_order) VALUES ('comp-${i + 1}', '${n}', '${c}', 1, ${i + 1});`,
  ),
  list("delay_reasons", "delay_reason_id", "delay", [
    "Patient not ready", "Surgeon late", "Anesthesia not available", "Previous case overran", "Equipment not available",
    "Room turnover", "Bed not available", "Other",
  ]),
  list("cancellation_reasons", "cancellation_reason_id", "cancel", [
    "Patient condition changed", "Patient not fit for surgery", "No consent", "No ICU bed", "Time constraint",
    "Equipment failure", "Patient request", "Other",
  ]),
  `INSERT INTO app_settings (key, value) VALUES ('setup_complete', '0');`,
  `INSERT INTO app_settings (key, value) VALUES ('hrn_unique', '1');`,
  `INSERT INTO app_settings (key, value) VALUES ('visual_effects', 'FULL');`,
  `INSERT INTO app_settings (key, value) VALUES ('theme', 'light');`,
  `INSERT INTO app_settings (key, value) VALUES ('seeded_at', ${now});`,
].join("\n");
