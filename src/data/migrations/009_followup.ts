export const M009_FOLLOWUP = `CREATE TABLE case_followup_assessments (
  followup_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id),
  target_day INTEGER NOT NULL CHECK (target_day IN (30, 90)),
  due_date TEXT NOT NULL,
  assessed_at TEXT,
  method TEXT CHECK (method IS NULL OR method IN ('IN_PERSON','PHONE','RECORD_REVIEW','OTHER')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ASSESSED','UNREACHABLE','DECEASED')),
  assessed_by TEXT REFERENCES users(user_id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_id, target_day)
);
CREATE INDEX idx_followup_due ON case_followup_assessments(status, due_date);
CREATE TABLE postoperative_outcomes (
  outcome_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id),
  followup_id TEXT REFERENCES case_followup_assessments(followup_id),
  event_type TEXT NOT NULL CHECK (event_type IN ('READMISSION','UNPLANNED_REOPERATION','DEATH','SURGICAL_SITE_INFECTION')),
  occurred_at TEXT NOT NULL,
  detected_at TEXT,
  ssi_type TEXT CHECK (ssi_type IS NULL OR ssi_type IN ('SUPERFICIAL_INCISIONAL','DEEP_INCISIONAL','ORGAN_SPACE')),
  case_procedure_id TEXT REFERENCES case_procedures(case_procedure_id),
  evidence_source TEXT,
  notes TEXT,
  recorded_by TEXT REFERENCES users(user_id),
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_outcomes_case ON postoperative_outcomes(case_id, event_type, occurred_at);`;
