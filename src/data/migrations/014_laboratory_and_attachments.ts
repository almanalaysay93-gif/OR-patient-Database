/**
 * Migration 014 - Laboratory results and clinical attachments.
 * Allows recording quantitative and qualitative laboratory results (CBC, Chem, Coag, etc.)
 * and uploading files and images (lab slips, procedure images, patient clinical photos).
 */
export const M014_LABORATORY_AND_ATTACHMENTS = /* sql */ `
CREATE TABLE patient_lab_results (
  lab_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  case_id TEXT REFERENCES surgical_cases(case_id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('HEMATOLOGY', 'CHEMISTRY', 'ELECTROLYTES', 'COAGULATION', 'BLOOD_BANK', 'URINALYSIS', 'ABG', 'MICROBIOLOGY', 'PATHOLOGY', 'OTHER')),
  test_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  unit TEXT,
  reference_range TEXT,
  flag TEXT NOT NULL DEFAULT 'NORMAL' CHECK (flag IN ('NORMAL', 'ABNORMAL', 'CRITICAL')),
  specimen_collected_at TEXT NOT NULL,
  result_date TEXT NOT NULL,
  performed_by TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_patient_labs_patient ON patient_lab_results(patient_id);
CREATE INDEX idx_patient_labs_case ON patient_lab_results(case_id);
CREATE INDEX idx_patient_labs_category ON patient_lab_results(category);
CREATE INDEX idx_patient_labs_date ON patient_lab_results(result_date);

CREATE TABLE clinical_attachments (
  attachment_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  lab_id TEXT REFERENCES patient_lab_results(lab_id) ON DELETE CASCADE,
  case_id TEXT REFERENCES surgical_cases(case_id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  data_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'LAB_RESULT' CHECK (category IN ('LAB_RESULT', 'PROCEDURE_IMAGE', 'PATIENT_PHOTO', 'PATHOLOGY', 'OTHER')),
  created_by TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_clinical_att_patient ON clinical_attachments(patient_id);
CREATE INDEX idx_clinical_att_lab ON clinical_attachments(lab_id);
CREATE INDEX idx_clinical_att_case ON clinical_attachments(case_id);
`;
