import type { Db, RawDb } from "../data/db";
import { nowIso } from "../data/db";
import { logAudit } from "./audit";
import { requirePermission, requireSession } from "./session";

/**
 * One-way copy of the pre-op dialysis and donor assessment to a Google Sheet,
 * through an Apps Script web app (apps-script/Code.gs). The rows are
 * identifiable, so the web app refuses any request without the shared token.
 */

const URL_KEY = "sheet_sync_url";
const TOKEN_KEY = "sheet_sync_token";
const BATCH = 50;

export interface SheetSyncConfig {
  url: string;
  tokenSet: boolean;
}

export interface SheetRow {
  case_number: string;
  hrn: string | null;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  sex: string | null;
  planned_procedure: string | null;
  dialysis: string | null;
  dialysis_access: string | null;
  years_on_dialysis: number | null;
  donor: string | null;
  type_of_relation: string | null;
  assessed_by: string | null;
  assessed_at: string | null;
  case_status: string | null;
  anesthesia_type: string | null;
  intra_asa: string | null;
  estimated_blood_loss_ml: number | null;
  blood_transfusion: number | null;
  units_transfused: number | null;
  specimen_collected: number | null;
  implant_used: number | null;
  procedure_start: string | null;
  procedure_end: string | null;
  post_op_destination: string | null;
  pacu_admission: string | null;
  pacu_discharge: string | null;
  post_op_status: string | null;
  pain_score: number | null;
  complications_present: number | null;
  icu_required: number | null;
  reoperation_required: number | null;
  mortality: number | null;
}

export interface SyncResult {
  sent: number;
  pending: number;
  error: string | null;
}

/** Fetch is injectable so tests never reach the network. */
export type Poster = (url: string, body: string) => Promise<{ ok: boolean; status: number; text: string }>;

const defaultPoster: Poster = async (url, body) => {
  // text/plain keeps the request "simple", so the browser sends it without a CORS preflight.
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, redirect: "follow" });
  return { ok: res.ok, status: res.status, text: await res.text() };
};

async function readSetting(db: RawDb, key: string): Promise<string> {
  const rows = await db.select<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]);
  return rows[0]?.value || "";
}

export async function getSheetSyncConfig(db: Db): Promise<SheetSyncConfig> {
  requirePermission("export.identifiable");
  return { url: await readSetting(db, URL_KEY), tokenSet: !!(await readSetting(db, TOKEN_KEY)) };
}

/** An empty token keeps the saved one. An empty URL turns the sync off. */
export async function saveSheetSyncConfig(db: Db, params: { url: string; token: string }): Promise<void> {
  const userId = requirePermission("export.identifiable");
  const url = params.url.trim();
  const token = params.token.trim();
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    throw new Error("Paste the Apps Script web app address that ends in /exec.");
  }
  if (token && token.length < 24) throw new Error("The sync token must have at least 24 characters.");
  if (url && !token && !(await readSetting(db, TOKEN_KEY))) throw new Error("Enter the sync token.");
  await db.transaction(async (tx) => {
    await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [URL_KEY, url]);
    if (token) await tx.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [TOKEN_KEY, token]);
    await logAudit(tx, {
      userId, action: "SAVE_SHEET_SYNC_CONFIG", entityType: "APP_SETTINGS",
      newValue: JSON.stringify({ url, tokenChanged: !!token }),
    });
  });
}

/**
 * Called inside each clinical save transaction (pre-op, intra-op, post-op, case completion),
 * so the queue entry and the save commit together.
 */
export async function queueSheetSync(tx: RawDb, caseId: string): Promise<void> {
  if (!(await readSetting(tx, URL_KEY))) return;
  await tx.execute(
    `INSERT INTO sheet_sync_pending (case_id, queued_at, attempts, last_error) VALUES (?, ?, 0, NULL)
     ON CONFLICT(case_id) DO UPDATE SET queued_at = excluded.queued_at`,
    [caseId, nowIso()]);
}

/** Queue every case that has any pre-op, intra-op or post-op record, for the first fill of a new Sheet. */
export async function queueAllForSheet(db: Db): Promise<number> {
  const userId = requirePermission("export.identifiable");
  if (!(await readSetting(db, URL_KEY))) throw new Error("Save the Google Sheet address first.");
  const now = nowIso();
  return db.transaction(async (tx) => {
    const ids = await tx.select<{ case_id: string }>(
      `SELECT case_id FROM case_preop_baseline UNION SELECT case_id FROM intra_or_records
       UNION SELECT case_id FROM post_or_records`);
    for (const { case_id } of ids) {
      await tx.execute(
        `INSERT INTO sheet_sync_pending (case_id, queued_at, attempts, last_error) VALUES (?, ?, 0, NULL)
         ON CONFLICT(case_id) DO UPDATE SET queued_at = excluded.queued_at`, [case_id, now]);
    }
    await logAudit(tx, { userId, action: "QUEUE_ALL_SHEET_SYNC", entityType: "APP_SETTINGS", newValue: String(ids.length) });
    return ids.length;
  });
}

export async function getSheetSyncStatus(db: Db): Promise<{ pending: number; lastError: string | null }> {
  requireSession();
  const rows = await db.select<{ n: number; err: string | null }>(
    `SELECT COUNT(*) AS n, (SELECT last_error FROM sheet_sync_pending WHERE last_error IS NOT NULL
       ORDER BY queued_at DESC LIMIT 1) AS err FROM sheet_sync_pending`);
  return { pending: rows[0]?.n || 0, lastError: rows[0]?.err || null };
}

async function buildRows(db: Db, caseIds: string[]): Promise<SheetRow[]> {
  const marks = caseIds.map(() => "?").join(",");
  return db.select<SheetRow>(
    `SELECT c.case_number, p.hrn, p.last_name, p.first_name, p.middle_name, p.sex,
       c.planned_procedure_summary AS planned_procedure,
       b.dialysis_modality AS dialysis, b.dialysis_access, b.dialysis_years AS years_on_dialysis,
       b.donor_relation AS donor, drt.name AS type_of_relation,
       u.full_name AS assessed_by, b.assessed_at,
       c.case_status,
       an.name AS anesthesia_type, i.asa_classification AS intra_asa, i.estimated_blood_loss_ml,
       i.blood_transfusion, i.units_transfused, i.specimen_collected, i.implant_used,
       i.procedure_start, i.procedure_end,
       d.name AS post_op_destination, po.pacu_admission, po.pacu_discharge, po.post_op_status,
       po.pain_score, po.complications_present, po.icu_required, po.reoperation_required, po.mortality
     FROM surgical_cases c
     JOIN patients p ON p.patient_id = c.patient_id
     LEFT JOIN case_preop_baseline b ON b.case_id = c.case_id
     LEFT JOIN donor_relationship_types drt ON drt.relationship_type_id = b.donor_relationship_type_id
     LEFT JOIN users u ON u.user_id = b.assessed_by
     LEFT JOIN intra_or_records i ON i.case_id = c.case_id
     LEFT JOIN anesthesia_types an ON an.anesthesia_type_id = i.anesthesia_type_id
     LEFT JOIN post_or_records po ON po.case_id = c.case_id
     LEFT JOIN post_op_destinations d ON d.destination_id = po.post_op_destination_id
     WHERE c.case_id IN (${marks})`, caseIds);
}

/**
 * Send queued cases. Any signed-in user may trigger it: the administrator chose
 * the destination, and the person saving a baseline should not need export rights.
 */
export async function flushSheetSync(db: Db, post: Poster = defaultPoster): Promise<SyncResult> {
  const userId = requireSession();
  const url = await readSetting(db, URL_KEY);
  const token = await readSetting(db, TOKEN_KEY);
  const queued = await db.select<{ case_id: string }>("SELECT case_id FROM sheet_sync_pending ORDER BY queued_at");
  if (!url || !token || !queued.length) return { sent: 0, pending: queued.length, error: null };

  let sent = 0;
  let error: string | null = null;
  for (let i = 0; i < queued.length && !error; i += BATCH) {
    const ids = queued.slice(i, i + BATCH).map((q) => q.case_id);
    const startedAt = nowIso();
    try {
      const rows = await buildRows(db, ids);
      const res = await post(url, JSON.stringify({ token, rows }));
      let reply: { ok?: boolean; error?: string } = {};
      try { reply = JSON.parse(res.text); } catch { /* a sign-in page or HTML error */ }
      if (!res.ok || !reply.ok) {
        throw new Error(reply.error || `The Google Sheet did not accept the rows (HTTP ${res.status}).`);
      }
      const marks = ids.map(() => "?").join(",");
      await db.transaction(async (tx) => {
        // A case saved again while the request ran keeps its newer queue entry.
        await tx.execute(`DELETE FROM sheet_sync_pending WHERE case_id IN (${marks}) AND queued_at <= ?`, [...ids, startedAt]);
        await logAudit(tx, { userId, action: "SHEET_SYNC", entityType: "PRE_OR", newValue: String(rows.length) });
      });
      sent += rows.length;
    } catch (err) {
      error = err instanceof TypeError ? "No connection to Google. The rows stay queued." : (err as Error).message;
      const marks = ids.map(() => "?").join(",");
      await db.execute(
        `UPDATE sheet_sync_pending SET attempts = attempts + 1, last_error = ? WHERE case_id IN (${marks})`, [error, ...ids]);
    }
  }
  const left = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM sheet_sync_pending");
  return { sent, pending: left[0]?.n || 0, error };
}
