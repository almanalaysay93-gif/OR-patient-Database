export const M008_CASE_EVENTS = `CREATE TABLE case_events (
  event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id),
  event_type TEXT NOT NULL CHECK (event_type IN
    ('ROOM_IN','ANESTHESIA_START','INCISION','CLOSURE','ROOM_OUT','PACU_IN','PACU_OUT')),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT REFERENCES users(user_id),
  correction_reason TEXT,
  UNIQUE (case_id, event_type)
);
CREATE INDEX idx_case_events_case ON case_events(case_id, occurred_at);`;
