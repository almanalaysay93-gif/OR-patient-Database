export const M005_CASE_CODING = `ALTER TABLE procedures ADD COLUMN code_system TEXT;
ALTER TABLE diagnoses ADD COLUMN code_system TEXT;
CREATE UNIQUE INDEX idx_one_primary_procedure ON case_procedures(case_id) WHERE is_primary = 1;
CREATE UNIQUE INDEX idx_case_procedure_once ON case_procedures(case_id, procedure_id);
CREATE UNIQUE INDEX idx_case_diagnosis_once ON case_diagnoses(case_id, diagnosis_id, diagnosis_type);
CREATE INDEX idx_case_diagnosis_type ON case_diagnoses(case_id, diagnosis_type);
CREATE INDEX idx_procedure_code ON procedures(code_system, procedure_code);
CREATE INDEX idx_diagnosis_code ON diagnoses(code_system, diagnosis_code);`;
