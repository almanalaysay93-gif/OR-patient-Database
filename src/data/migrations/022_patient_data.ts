/**
 * Migration 022 - the preoperative baseline becomes "Patient's data", kept once per patient
 * instead of once per surgical case, so it can be entered at registration.
 *
 * Each patient's newest case baseline is copied over. case_preop_baseline is kept unchanged
 * as history and is no longer written.
 */
export const M022_PATIENT_DATA = [
  `CREATE TABLE IF NOT EXISTS patient_data (
     patient_id TEXT PRIMARY KEY REFERENCES patients(patient_id),
     assessed_at TEXT,
     assessed_by TEXT REFERENCES users(user_id),
     height_cm REAL CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)),
     weight_kg REAL CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 700)),
     measured_at TEXT,
     asa_classification TEXT CHECK (asa_classification IS NULL OR asa_classification IN ('I','II','III','IV','V','VI','IE','IIE','IIIE','IVE','VE')),
     tobacco_status TEXT CHECK (tobacco_status IS NULL OR tobacco_status IN ('NEVER','FORMER','CURRENT','UNKNOWN')),
     functional_status TEXT CHECK (functional_status IS NULL OR functional_status IN ('INDEPENDENT','PARTIALLY_DEPENDENT','TOTALLY_DEPENDENT','UNKNOWN')),
     dialysis_modality TEXT CHECK (dialysis_modality IS NULL OR dialysis_modality IN ('NONE','HEMODIALYSIS','PERITONEAL_DIALYSIS','UNKNOWN')),
     dialysis_access TEXT CHECK (dialysis_access IS NULL OR dialysis_access IN ('AV_FISTULA','AV_GRAFT','TUNNELED_CATHETER','NON_TUNNELED_CATHETER','PD_CATHETER','OTHER')),
     dialysis_years REAL CHECK (dialysis_years IS NULL OR (dialysis_years >= 0 AND dialysis_years <= 60)),
     donor_relation TEXT CHECK (donor_relation IS NULL OR donor_relation IN ('RELATED','NON_RELATED')),
     donor_relationship_type_id TEXT REFERENCES donor_relationship_types(relationship_type_id),
     notes TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  `INSERT OR IGNORE INTO patient_data
     (patient_id, assessed_at, assessed_by, height_cm, weight_kg, measured_at, asa_classification, tobacco_status,
      functional_status, dialysis_modality, dialysis_access, dialysis_years, donor_relation, donor_relationship_type_id,
      notes, created_at, updated_at)
   SELECT c.patient_id, b.assessed_at, b.assessed_by, b.height_cm, b.weight_kg, b.measured_at, b.asa_classification,
      b.tobacco_status, b.functional_status, b.dialysis_modality, b.dialysis_access, b.dialysis_years, b.donor_relation,
      b.donor_relationship_type_id, b.notes, b.created_at, b.updated_at
   FROM case_preop_baseline b
   JOIN surgical_cases c ON c.case_id = b.case_id
   WHERE b.rowid = (
     SELECT b2.rowid FROM case_preop_baseline b2 JOIN surgical_cases c2 ON c2.case_id = b2.case_id
     WHERE c2.patient_id = c.patient_id ORDER BY b2.updated_at DESC, b2.rowid DESC LIMIT 1
   );`,
].join("\n");
