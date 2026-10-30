/**
 * Migration 019 - Google Sheet sync queue.
 *
 * A saved pre-op baseline queues its case here. The queue survives offline time
 * and restarts, and a case leaves it only after the Sheet confirms the row.
 */
export const M019_SHEET_SYNC = /* sql */ `
CREATE TABLE sheet_sync_pending (
  case_id TEXT PRIMARY KEY REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
`;
