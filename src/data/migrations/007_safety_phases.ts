export const M007_SAFETY_PHASES = `CREATE TABLE safety_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE safety_items (
  item_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES safety_templates(template_id),
  phase TEXT NOT NULL CHECK (phase IN ('SIGN_IN','TIME_OUT','SIGN_OUT')),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL
);
CREATE TABLE case_safety_templates (
  case_id TEXT PRIMARY KEY REFERENCES surgical_cases(case_id),
  template_id TEXT NOT NULL REFERENCES safety_templates(template_id),
  assigned_at TEXT NOT NULL
);
CREATE TABLE safety_responses (
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id),
  item_id TEXT NOT NULL REFERENCES safety_items(item_id),
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETE','FAILED','NOT_APPLICABLE')),
  occurred_at TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT REFERENCES users(user_id),
  notes TEXT,
  override_reason TEXT,
  PRIMARY KEY (case_id, item_id)
);
CREATE INDEX idx_safety_items_phase ON safety_items(template_id, phase, display_order);
INSERT INTO safety_templates (template_id, name, version, created_at)
VALUES ('who-2009-local', 'Surgical safety checklist - local review required', '2009-draft-1', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO safety_items VALUES ('sign-in-identity', 'who-2009-local', 'SIGN_IN', 'Identity, site, procedure, and consent confirmed', 1, 1);
INSERT INTO safety_items VALUES ('sign-in-site', 'who-2009-local', 'SIGN_IN', 'Site marking confirmed when applicable', 1, 2);
INSERT INTO safety_items VALUES ('sign-in-anesthesia', 'who-2009-local', 'SIGN_IN', 'Anesthesia check and pulse oximeter confirmed', 1, 3);
INSERT INTO safety_items VALUES ('sign-in-risk', 'who-2009-local', 'SIGN_IN', 'Allergy, airway, and blood loss risks reviewed', 1, 4);
INSERT INTO safety_items VALUES ('time-out-team', 'who-2009-local', 'TIME_OUT', 'Team members and roles confirmed', 1, 1);
INSERT INTO safety_items VALUES ('time-out-patient', 'who-2009-local', 'TIME_OUT', 'Patient, procedure, and incision site reconfirmed', 1, 2);
INSERT INTO safety_items VALUES ('time-out-concerns', 'who-2009-local', 'TIME_OUT', 'Surgeon, anesthesia, and nursing concerns reviewed', 1, 3);
INSERT INTO safety_items VALUES ('time-out-antibiotic', 'who-2009-local', 'TIME_OUT', 'Antibiotic prophylaxis reviewed when applicable', 1, 4);
INSERT INTO safety_items VALUES ('time-out-imaging', 'who-2009-local', 'TIME_OUT', 'Essential imaging available when applicable', 1, 5);
INSERT INTO safety_items VALUES ('sign-out-procedure', 'who-2009-local', 'SIGN_OUT', 'Procedure performed confirmed', 1, 1);
INSERT INTO safety_items VALUES ('sign-out-count', 'who-2009-local', 'SIGN_OUT', 'Instrument, sponge, and needle counts confirmed', 1, 2);
INSERT INTO safety_items VALUES ('sign-out-specimen', 'who-2009-local', 'SIGN_OUT', 'Specimen labeling confirmed when applicable', 1, 3);
INSERT INTO safety_items VALUES ('sign-out-concerns', 'who-2009-local', 'SIGN_OUT', 'Equipment issues and recovery concerns reviewed', 1, 4);
INSERT INTO case_safety_templates (case_id, template_id, assigned_at)
SELECT case_id, 'who-2009-local', strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM surgical_cases;`;
