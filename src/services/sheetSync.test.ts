import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { ADMIN_SESSION } from "../test/setup";
import { setActiveSession } from "./session";
import { createAdmission, createPatient, createSurgicalCase } from "./patients";
import { savePreopBaseline } from "./preopBaseline";
import { completeCase, savePostOrRecord, saveIntraOrRecord } from "./intraPostOr";
import {
  flushSheetSync, getSheetSyncConfig, getSheetSyncStatus, queueAllForSheet, retryDelayMs, saveSheetSyncConfig,
  SYNC_TIMEOUT_MS, type Poster,
} from "./sheetSync";

const URL = "https://script.google.com/macros/s/AKfycbTEST_id-1/exec";
const TOKEN = "test-token-0123456789abcdefghij";
let db: Db;

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
});

async function caseWithBaseline(hrn = "HRN-1") {
  const patient = await createPatient(db, { firstName: "Ana", lastName: "Cruz", hrn, dateOfBirth: "1980-05-10", sex: "FEMALE" });
  const admission = await createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-07" });
  const c = await createSurgicalCase(db, {
    patientId: patient.patient_id, admissionId: admission.admission_id, plannedProcedureSummary: "Kidney transplant",
  });
  await savePreopBaseline(db, {
    caseId: c.case_id, height_cm: null, weight_kg: null, measured_at: null, asa_classification: null,
    tobacco_status: null, functional_status: null, notes: "PRIVATE-NOTE",
    dialysis_modality: "HEMODIALYSIS", dialysis_access: "AV_FISTULA", dialysis_years: 2.5,
    donor_relation: "RELATED", donor_relationship_type_id: "drt-sister",
  });
  return c;
}

function recorder(reply: { ok: boolean; status: number; text: string }) {
  const calls: { url: string; body: { token: string; rows: Record<string, unknown>[] } }[] = [];
  const post: Poster = async (url, body) => {
    calls.push({ url, body: JSON.parse(body) });
    return reply;
  };
  return { calls, post };
}

describe("Google Sheet sync", () => {
  it("does not queue anything until an address is saved", async () => {
    await caseWithBaseline();
    expect((await getSheetSyncStatus(db)).pending).toBe(0);
  });

  it("validates the address and token", async () => {
    await expect(saveSheetSyncConfig(db, { url: "https://evil.example/exec", token: TOKEN })).rejects.toThrow("/exec");
    await expect(saveSheetSyncConfig(db, { url: URL, token: "short" })).rejects.toThrow("24 characters");
    await expect(saveSheetSyncConfig(db, { url: URL, token: "" })).rejects.toThrow("Enter the sync token");
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    await saveSheetSyncConfig(db, { url: URL, token: "" });
    expect(await getSheetSyncConfig(db)).toEqual({ url: URL, tokenSet: true });
  });

  it("queues a saved baseline and sends the identifiable row with the token", async () => {
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    const c = await caseWithBaseline();
    expect((await getSheetSyncStatus(db)).pending).toBe(1);

    const { calls, post } = recorder({ ok: true, status: 200, text: '{"ok":true,"count":1}' });
    expect(await flushSheetSync(db, post)).toEqual({ sent: 1, pending: 0, error: null });
    expect(calls[0].url).toBe(URL);
    expect(calls[0].body.token).toBe(TOKEN);
    expect(calls[0].body.rows[0]).toMatchObject({
      case_number: c.case_number, hrn: "HRN-1", last_name: "Cruz", first_name: "Ana",
      dialysis: "HEMODIALYSIS", dialysis_access: "AV_FISTULA", years_on_dialysis: 2.5,
      donor: "RELATED", type_of_relation: "Sister", assessed_by: "Clinical Administrator",
    });
    expect(JSON.stringify(calls[0].body)).not.toContain("PRIVATE-NOTE");
  });

  it("keeps rows queued with the reason when the Sheet refuses or the network is down", async () => {
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    await caseWithBaseline();

    const refused = recorder({ ok: true, status: 200, text: '{"ok":false,"error":"The sync token does not match the Sheet."}' });
    expect(await flushSheetSync(db, refused.post)).toMatchObject({ sent: 0, pending: 1, error: "The sync token does not match the Sheet." });

    const signInPage = recorder({ ok: true, status: 200, text: "<html>Sign in</html>" });
    expect((await flushSheetSync(db, signInPage.post, { force: true })).error).toContain("did not accept");

    const offline: Poster = async () => { throw new TypeError("Failed to fetch"); };
    expect(await flushSheetSync(db, offline, { force: true })).toMatchObject({ pending: 1, error: "No connection to Google. The rows stay queued." });
    expect((await getSheetSyncStatus(db)).lastError).toBe("No connection to Google. The rows stay queued.");
  });

  it("stops waiting for a Sheet that never answers and keeps the row queued", async () => {
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    await caseWithBaseline();
    let aborted = false;
    const hang: Poster = (_url, _body, signal) => {
      signal?.addEventListener("abort", () => { aborted = true; });
      return new Promise(() => undefined);
    };
    const r = await flushSheetSync(db, hang, { timeoutMs: 20 });
    expect(r).toMatchObject({ sent: 0, pending: 1 });
    expect(r.error).toContain("did not answer within");
    expect(aborted).toBe(true);
    const status = await getSheetSyncStatus(db);
    expect(status.pending).toBe(1);
    expect(status.lastError).toContain("did not answer within");
    expect(SYNC_TIMEOUT_MS).toBe(30_000);
  });

  it("never runs two sends at once and sends a case saved during a send", async () => {
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    await caseWithBaseline("HRN-1");
    let open = 0;
    let maxOpen = 0;
    const sentHrns: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: Poster = async (_url, body) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      if (sentHrns.length === 0) await gate;
      sentHrns.push(...JSON.parse(body).rows.map((row: { hrn: unknown }) => row.hrn));
      open--;
      return { ok: true, status: 200, text: '{"ok":true}' };
    };
    const first = flushSheetSync(db, slow);
    await new Promise((r) => setTimeout(r, 10));
    await caseWithBaseline("HRN-2");
    const second = flushSheetSync(db, slow);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(maxOpen).toBe(1);
    expect(a.sent).toBe(1);
    expect(b).toMatchObject({ sent: 1, pending: 0, error: null });
    expect(sentHrns).toEqual(["HRN-1", "HRN-2"]);
  });

  it("waits longer after each failure before an automatic try, up to 15 minutes", async () => {
    expect([0, 1, 2, 3, 6, 50].map(retryDelayMs)).toEqual([0, 30_000, 60_000, 120_000, 900_000, 900_000]);
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    await caseWithBaseline();
    let t = 1_000_000;
    const now = () => t;
    let calls = 0;
    const offline: Poster = async () => { calls++; throw new TypeError("Failed to fetch"); };
    await flushSheetSync(db, offline, { now });
    expect(calls).toBe(1);

    t += 29_000;
    const waiting = await flushSheetSync(db, offline, { now });
    expect(calls).toBe(1);
    expect(waiting).toMatchObject({ sent: 0, pending: 1 });
    expect(waiting.error).toContain("next automatic try is in 1 s");

    t += 1_000;
    await flushSheetSync(db, offline, { now });
    expect(calls).toBe(2);
    t += 59_000;
    await flushSheetSync(db, offline, { now });
    expect(calls).toBe(2);

    const ok = recorder({ ok: true, status: 200, text: '{"ok":true}' });
    expect(await flushSheetSync(db, ok.post, { now, force: true })).toMatchObject({ sent: 1, pending: 0, error: null });
    await caseWithBaseline("HRN-2");
    expect((await flushSheetSync(db, ok.post, { now })).sent).toBe(1);
  });

  it("lets a nurse's save reach the Sheet without export rights, but not change the connection", async () => {
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    await caseWithBaseline();
    setActiveSession({ ...ADMIN_SESSION, userId: "usr-admin", roleId: "role-nurse", roleName: "Nurse", permissions: ["patients.view", "preor.edit"] });
    const { post } = recorder({ ok: true, status: 200, text: '{"ok":true}' });
    expect((await flushSheetSync(db, post)).sent).toBe(1);
    await expect(saveSheetSyncConfig(db, { url: "", token: "" })).rejects.toThrow("not allowed");
  });

  it("queues every case with a baseline for a first fill", async () => {
    await caseWithBaseline("HRN-1");
    await caseWithBaseline("HRN-2");
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    expect(await queueAllForSheet(db)).toBe(2);
    expect((await getSheetSyncStatus(db)).pending).toBe(2);
  });

  it("sends intra-op and post-op fields and queues each save of those records", async () => {
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    const c = await caseWithBaseline("HRN-9");
    await flushSheetSync(db, recorder({ ok: true, status: 200, text: '{"ok":true}' }).post);

    await saveIntraOrRecord(db, {
      caseId: c.case_id, anesthesiaTypeId: "anes-1", asaClassification: "III", estimatedBloodLossMl: 350,
      bloodTransfusion: true, unitsTransfused: 2, specimenCollected: true, implantUsed: false,
      operativeFindings: "INTRA-SECRET",
    });
    expect((await getSheetSyncStatus(db)).pending).toBe(1);
    await savePostOrRecord(db, {
      caseId: c.case_id, postOpDestinationId: "dest-2", postOpStatus: "STABLE", painScore: 4,
      complicationsPresent: false, icuRequired: true, reoperationRequired: false, mortality: false, notes: "POST-SECRET",
    });
    await completeCase(db, c.case_id);

    const { calls, post } = recorder({ ok: true, status: 200, text: '{"ok":true}' });
    expect((await flushSheetSync(db, post)).sent).toBe(1);
    expect(calls[0].body.rows[0]).toMatchObject({
      case_status: "COMPLETED", anesthesia_type: "General", intra_asa: "III", estimated_blood_loss_ml: 350,
      blood_transfusion: 1, units_transfused: 2, specimen_collected: 1, implant_used: 0,
      post_op_destination: "ICU", post_op_status: "STABLE", pain_score: 4, icu_required: 1,
      complications_present: 0, reoperation_required: 0, mortality: 0,
    });
    const body = JSON.stringify(calls[0].body);
    expect(body).not.toContain("INTRA-SECRET");
    expect(body).not.toContain("POST-SECRET");
  });

  it("first fill includes a case that has only intra-op or post-op records", async () => {
    const patient = await createPatient(db, { firstName: "Bo", lastName: "Reyes", hrn: "HRN-OP", dateOfBirth: "1970-01-01", sex: "MALE" });
    const admission = await createAdmission(db, { patientId: patient.patient_id, admissionDate: "2026-10-07" });
    const c = await createSurgicalCase(db, { patientId: patient.patient_id, admissionId: admission.admission_id, plannedProcedureSummary: "Appendectomy" });
    await saveIntraOrRecord(db, { caseId: c.case_id, estimatedBloodLossMl: 20 });
    await saveSheetSyncConfig(db, { url: URL, token: TOKEN });
    expect(await queueAllForSheet(db)).toBe(1);
  });
});

describe("Apps Script web app (apps-script/Code.gs)", () => {
  function fakeSheet() {
    const grid: string[][] = [];
    const sheet = {
      getLastRow: () => grid.length,
      setFrozenRows: () => {},
      getRange: (row: number, col: number, rows: number, cols: number) => ({
        setValues: (v: string[][]) => v.forEach((line, i) => { grid[row - 1 + i] = line.slice(0, cols); }),
        getValues: () => grid.slice(row - 1, row - 1 + rows).map((l) => l.slice(col - 1, col - 1 + cols)),
      }),
    };
    return { grid, sheet };
  }

  function load(token: string | null) {
    const { grid, sheet } = fakeSheet();
    const ctx: Record<string, unknown> = {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) },
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t: string) => ({ setMimeType: () => t }) },
    };
    runInNewContext(readFileSync("apps-script/Code.gs", "utf8"), ctx);
    const post = (body: unknown) =>
      JSON.parse((ctx.doPost as (e: unknown) => string)({ postData: { contents: JSON.stringify(body) } }));
    return { grid, post };
  }

  const row = { case_number: "CASE-1", hrn: "007", last_name: "Cruz", first_name: "=HYPERLINK(1)", dialysis: "HEMODIALYSIS" };

  it("refuses a missing or wrong token and writes nothing", () => {
    expect(load(null).post({ token: TOKEN, rows: [row] }).ok).toBe(false);
    const { grid, post } = load(TOKEN);
    expect(post({ token: "wrong-token-0123456789abcdefghi", rows: [row] })).toMatchObject({ ok: false });
    expect(post({ rows: [row] }).ok).toBe(false);
    expect(grid.length).toBe(0);
  });

  it("writes one row per case number, updates it in place and blocks formulas", () => {
    const { grid, post } = load(TOKEN);
    expect(post({ token: TOKEN, rows: [row] })).toEqual({ ok: true, count: 1 });
    expect(post({ token: TOKEN, rows: [{ ...row, dialysis: "PERITONEAL_DIALYSIS" }, { ...row, case_number: "CASE-2" }] }).ok).toBe(true);
    expect(grid.length).toBe(3);
    expect(grid[0][0]).toBe("Case Number");
    expect(grid[1].slice(0, 4)).toEqual(["CASE-1", "007", "Cruz", "'=HYPERLINK(1)"]);
    expect(grid[1][7]).toBe("PERITONEAL_DIALYSIS");
    expect(grid[2][0]).toBe("CASE-2");
    expect(post({ token: TOKEN, rows: [{ hrn: "x" }] }).ok).toBe(false);
  });
});
