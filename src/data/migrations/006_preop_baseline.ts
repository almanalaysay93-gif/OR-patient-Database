export const M006_PREOP_BASELINE = `CREATE TABLE case_preop_baseline (
  case_id TEXT PRIMARY KEY REFERENCES surgical_cases(case_id),
  assessed_at TEXT,
  assessed_by TEXT REFERENCES users(user_id),
  height_cm REAL CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm < 300)),
  weight_kg REAL CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 700)),
  measured_at TEXT,
  asa_classification TEXT CHECK (asa_classification IS NULL OR asa_classification IN ('I','II','III','IV','V','VI','IE','IIE','IIIE','IVE','VE')),
  tobacco_status TEXT CHECK (tobacco_status IS NULL OR tobacco_status IN ('NEVER','FORMER','CURRENT','UNKNOWN')),
  functional_status TEXT CHECK (functional_status IS NULL OR functional_status IN ('INDEPENDENT','PARTIALLY_DEPENDENT','TOTALLY_DEPENDENT','UNKNOWN')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
