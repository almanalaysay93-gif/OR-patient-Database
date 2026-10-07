/**
 * Migration 001 - full V1 schema.
 * All spec tables are created up front (including custom fields and research)
 * so later phases add features without destructive schema changes.
 * Conventions: TEXT UUID primary keys, ISO-8601 TEXT timestamps, INTEGER 0/1 booleans.
 */
export const M001_INITIAL = /* sql */ `
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE roles (
  role_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE permissions (
  permission_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(role_id),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE status_labels (
  domain TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, code)
);

CREATE TABLE specialties (
  specialty_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE patients (
  patient_id TEXT PRIMARY KEY,
  research_seq INTEGER NOT NULL UNIQUE,
  hrn TEXT,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  suffix TEXT,
  date_of_birth TEXT,
  sex TEXT CHECK (sex IN ('MALE','FEMALE','OTHER','UNKNOWN')),
  address TEXT,
  contact_number TEXT,
  blood_type TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(user_id),
  updated_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_patients_hrn ON patients(hrn);
CREATE INDEX idx_patients_name ON patients(last_name, first_name);

CREATE TABLE admissions (
  admission_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  admission_number TEXT,
  admission_date TEXT NOT NULL,
  discharge_date TEXT,
  ward TEXT,
  room TEXT,
  bed TEXT,
  attending_physician TEXT,
  admission_diagnosis_text TEXT,
  discharge_diagnosis_text TEXT,
  status TEXT NOT NULL DEFAULT 'ADMITTED' CHECK (status IN ('ADMITTED','DISCHARGED','CANCELLED')),
  created_by TEXT REFERENCES users(user_id),
  updated_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (discharge_date IS NULL OR discharge_date >= admission_date)
);
CREATE INDEX idx_admissions_patient ON admissions(patient_id);
CREATE INDEX idx_admissions_number ON admissions(admission_number);

CREATE TABLE surgical_cases (
  case_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  admission_id TEXT NOT NULL REFERENCES admissions(admission_id),
  case_number TEXT NOT NULL UNIQUE,
  case_type TEXT NOT NULL DEFAULT 'ELECTIVE' CHECK (case_type IN ('ELECTIVE','EMERGENCY','URGENT')),
  specialty_id TEXT REFERENCES specialties(specialty_id),
  priority TEXT,
  laterality TEXT CHECK (laterality IS NULL OR laterality IN ('LEFT','RIGHT','BILATERAL','NOT_APPLICABLE')),
  planned_procedure_summary TEXT,
  preoperative_diagnosis_summary TEXT,
  postoperative_diagnosis_summary TEXT,
  case_status TEXT NOT NULL DEFAULT 'PRE_OR' CHECK (case_status IN
    ('PRE_OR','NOT_READY','READY','SCHEDULED','IN_OR','PACU','POST_OR','COMPLETED','POSTPONED','CANCELLED')),
  created_by TEXT REFERENCES users(user_id),
  updated_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_cases_patient ON surgical_cases(patient_id);
CREATE INDEX idx_cases_admission ON surgical_cases(admission_id);
CREATE INDEX idx_cases_status ON surgical_cases(case_status);

CREATE TABLE procedures (
  procedure_id TEXT PRIMARY KEY,
  procedure_code TEXT,
  procedure_name TEXT NOT NULL,
  specialty_id TEXT REFERENCES specialties(specialty_id),
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE case_procedures (
  case_procedure_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  procedure_id TEXT NOT NULL REFERENCES procedures(procedure_id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX idx_case_procedures_case ON case_procedures(case_id);
CREATE INDEX idx_case_procedures_proc ON case_procedures(procedure_id);

CREATE TABLE diagnoses (
  diagnosis_id TEXT PRIMARY KEY,
  diagnosis_code TEXT,
  diagnosis_name TEXT NOT NULL,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE case_diagnoses (
  case_diagnosis_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  diagnosis_id TEXT NOT NULL REFERENCES diagnoses(diagnosis_id),
  diagnosis_type TEXT NOT NULL CHECK (diagnosis_type IN ('PRE_OPERATIVE','POST_OPERATIVE','COMORBIDITY','OTHER')),
  notes TEXT
);
CREATE INDEX idx_case_diagnoses_case ON case_diagnoses(case_id);
CREATE INDEX idx_case_diagnoses_dx ON case_diagnoses(diagnosis_id);

CREATE TABLE or_rooms (
  or_room_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE delay_reasons (
  delay_reason_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cancellation_reasons (
  cancellation_reason_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE or_schedule (
  schedule_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id),
  or_room_id TEXT NOT NULL REFERENCES or_rooms(or_room_id),
  scheduled_date TEXT NOT NULL,
  scheduled_start TEXT NOT NULL,
  estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes > 0),
  actual_room_in TEXT,
  actual_procedure_start TEXT,
  actual_procedure_end TEXT,
  actual_room_out TEXT,
  schedule_status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (schedule_status IN
    ('SCHEDULED','IN_PROGRESS','COMPLETED','POSTPONED','CANCELLED')),
  delay_minutes INTEGER CHECK (delay_minutes IS NULL OR delay_minutes >= 0),
  delay_reason_id TEXT REFERENCES delay_reasons(delay_reason_id),
  cancellation_reason_id TEXT REFERENCES cancellation_reasons(cancellation_reason_id),
  notes TEXT,
  created_by TEXT REFERENCES users(user_id),
  updated_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (actual_procedure_end IS NULL OR actual_procedure_start IS NULL OR actual_procedure_end >= actual_procedure_start),
  CHECK (actual_room_out IS NULL OR actual_room_in IS NULL OR actual_room_out >= actual_room_in)
);
CREATE INDEX idx_schedule_date_room ON or_schedule(scheduled_date, or_room_id);
CREATE INDEX idx_schedule_case ON or_schedule(case_id);

CREATE TABLE pre_or_assessments (
  assessment_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  npo_status TEXT,
  consent_complete INTEGER,
  site_marked INTEGER,
  allergy_checked INTEGER,
  blood_available INTEGER,
  laboratory_complete INTEGER,
  imaging_complete INTEGER,
  medical_clearance INTEGER,
  anesthesia_clearance INTEGER,
  readiness_status TEXT,
  readiness_percentage REAL,
  assessed_by TEXT REFERENCES users(user_id),
  assessed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pre_or_checklist_definitions (
  checklist_item_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  required_by_default INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pre_or_checklist_values (
  value_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  checklist_item_id TEXT NOT NULL REFERENCES pre_or_checklist_definitions(checklist_item_id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETE','NOT_APPLICABLE','FAILED')),
  value_text TEXT,
  completed_by TEXT REFERENCES users(user_id),
  completed_at TEXT,
  notes TEXT,
  UNIQUE (case_id, checklist_item_id)
);

CREATE TABLE anesthesia_types (
  anesthesia_type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE intra_or_records (
  intra_or_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  anesthesia_type_id TEXT REFERENCES anesthesia_types(anesthesia_type_id),
  asa_classification TEXT CHECK (asa_classification IS NULL OR asa_classification IN
    ('I','II','III','IV','V','VI','IE','IIE','IIIE','IVE','VE')),
  estimated_blood_loss_ml INTEGER CHECK (estimated_blood_loss_ml IS NULL OR estimated_blood_loss_ml >= 0),
  blood_transfusion INTEGER,
  units_transfused INTEGER CHECK (units_transfused IS NULL OR units_transfused >= 0),
  specimen_collected INTEGER,
  implant_used INTEGER,
  procedure_start TEXT,
  procedure_end TEXT,
  operative_findings TEXT,
  operative_notes TEXT,
  created_by TEXT REFERENCES users(user_id),
  updated_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (procedure_end IS NULL OR procedure_start IS NULL OR procedure_end >= procedure_start)
);

CREATE TABLE post_op_destinations (
  destination_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE post_or_records (
  post_or_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  pacu_admission TEXT,
  pacu_discharge TEXT,
  post_op_destination_id TEXT REFERENCES post_op_destinations(destination_id),
  post_op_status TEXT,
  pain_score INTEGER CHECK (pain_score IS NULL OR (pain_score BETWEEN 0 AND 10)),
  complications_present INTEGER,
  icu_required INTEGER,
  reoperation_required INTEGER,
  mortality INTEGER,
  notes TEXT,
  created_by TEXT REFERENCES users(user_id),
  updated_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (pacu_discharge IS NULL OR pacu_admission IS NULL OR pacu_discharge >= pacu_admission)
);

CREATE TABLE complication_types (
  complication_type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE complications (
  complication_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  complication_type_id TEXT NOT NULL REFERENCES complication_types(complication_type_id),
  severity TEXT CHECK (severity IS NULL OR severity IN ('MINOR','MODERATE','SEVERE','LIFE_THREATENING','FATAL')),
  occurred_at TEXT,
  description TEXT,
  intervention TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_complications_case ON complications(case_id);

CREATE TABLE team_roles (
  team_role_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  conflict_checked INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE staff (
  staff_id TEXT PRIMARY KEY,
  employee_code TEXT,
  full_name TEXT NOT NULL,
  professional_role TEXT,
  specialty TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE case_team (
  case_team_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  role TEXT NOT NULL REFERENCES team_roles(team_role_id),
  created_at TEXT NOT NULL,
  UNIQUE (case_id, staff_id, role)
);
CREATE INDEX idx_case_team_staff ON case_team(staff_id);

CREATE TABLE laboratory_test_definitions (
  test_definition_id TEXT PRIMARY KEY,
  test_name TEXT NOT NULL,
  test_code TEXT,
  default_unit TEXT,
  data_type TEXT NOT NULL DEFAULT 'NUMERIC' CHECK (data_type IN ('NUMERIC','TEXT')),
  analytics_enabled INTEGER NOT NULL DEFAULT 1,
  research_enabled INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE laboratory_results (
  lab_result_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  admission_id TEXT REFERENCES admissions(admission_id),
  case_id TEXT REFERENCES surgical_cases(case_id),
  test_definition_id TEXT NOT NULL REFERENCES laboratory_test_definitions(test_definition_id),
  result_value_text TEXT,
  result_value_numeric REAL,
  unit TEXT,
  reference_range TEXT,
  result_date_time TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_labs_patient ON laboratory_results(patient_id, result_date_time);

CREATE TABLE custom_field_definitions (
  field_id TEXT PRIMARY KEY,
  field_name TEXT NOT NULL,
  field_key TEXT NOT NULL UNIQUE,
  description TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('PATIENT','ADMISSION','SURGICAL_CASE','PRE_OR','INTRA_OR','POST_OR')),
  section TEXT,
  data_type TEXT NOT NULL CHECK (data_type IN ('SHORT_TEXT','LONG_TEXT','INTEGER','DECIMAL','DATE','DATETIME',
    'YES_NO','CHECKBOX','SINGLE_SELECT','MULTI_SELECT','STATUS','STAFF','OPTION_LIST')),
  required INTEGER NOT NULL DEFAULT 0,
  analytics_enabled INTEGER NOT NULL DEFAULT 0,
  research_enabled INTEGER NOT NULL DEFAULT 0,
  export_enabled INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  validation_json TEXT,
  options_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE custom_field_values (
  value_id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL REFERENCES custom_field_definitions(field_id),
  patient_id TEXT REFERENCES patients(patient_id),
  admission_id TEXT REFERENCES admissions(admission_id),
  case_id TEXT REFERENCES surgical_cases(case_id),
  text_value TEXT,
  number_value REAL,
  boolean_value INTEGER,
  date_value TEXT,
  datetime_value TEXT,
  json_value TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (patient_id IS NOT NULL OR admission_id IS NOT NULL OR case_id IS NOT NULL)
);
CREATE INDEX idx_cfv_field ON custom_field_values(field_id);
CREATE INDEX idx_cfv_case ON custom_field_values(case_id);
CREATE INDEX idx_cfv_patient ON custom_field_values(patient_id);

CREATE TABLE research_queries (
  query_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  definition_json TEXT,
  created_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE research_filter_groups (
  group_id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES research_queries(query_id) ON DELETE CASCADE,
  parent_group_id TEXT REFERENCES research_filter_groups(group_id) ON DELETE CASCADE,
  logical_operator TEXT NOT NULL CHECK (logical_operator IN ('AND','OR')),
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE research_filters (
  filter_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES research_filter_groups(group_id) ON DELETE CASCADE,
  field_source TEXT NOT NULL,
  field_identifier TEXT NOT NULL,
  operator TEXT NOT NULL,
  value_json TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  audit_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id),
  patient_id TEXT,
  admission_id TEXT,
  case_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  record_id TEXT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  timestamp TEXT NOT NULL,
  device_identifier TEXT
);
CREATE INDEX idx_audit_patient ON audit_log(patient_id, timestamp);
CREATE INDEX idx_audit_case ON audit_log(case_id, timestamp);
CREATE INDEX idx_audit_time ON audit_log(timestamp);

-- Audit rows are append-only at the database level.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit log entries cannot be changed.'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit log entries cannot be deleted.'); END;
`;
