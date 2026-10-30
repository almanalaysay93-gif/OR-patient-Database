/**
 * OR Station -> Google Sheet sync (pre-op dialysis and donor assessment).
 *
 * Bind this script to the Sheet (Extensions > Apps Script).
 * Set the script property SYNC_TOKEN to a long random value, and enter the same
 * value in the OR Station Settings. Deploy as a web app: Execute as Me, access Anyone.
 * The web app only writes. It never returns patient data.
 */

var SHEET_NAME = 'Pre-op dialysis and donor';
var COLUMNS = [
  ['case_number', 'Case Number'],
  ['hrn', 'HRN'],
  ['last_name', 'Last Name'],
  ['first_name', 'First Name'],
  ['middle_name', 'Middle Name'],
  ['sex', 'Sex'],
  ['planned_procedure', 'Planned Procedure'],
  ['dialysis', 'Dialysis'],
  ['dialysis_access', 'Dialysis Access'],
  ['years_on_dialysis', 'Years on Dialysis'],
  ['donor', 'Donor'],
  ['type_of_relation', 'Type of Relation'],
  ['assessed_by', 'Assessed By'],
  ['assessed_at', 'Assessed At'],
  ['synced_at', 'Synced At'],
  ['case_status', 'Case Status'],
  ['anesthesia_type', 'Anesthesia Type'],
  ['intra_asa', 'Intra-op ASA'],
  ['estimated_blood_loss_ml', 'Blood Loss (mL)'],
  ['blood_transfusion', 'Blood Transfusion'],
  ['units_transfused', 'Units Transfused'],
  ['specimen_collected', 'Specimen Collected'],
  ['implant_used', 'Implant Used'],
  ['procedure_start', 'Procedure Start'],
  ['procedure_end', 'Procedure End'],
  ['post_op_destination', 'Post-op Destination'],
  ['pacu_admission', 'PACU Admission'],
  ['pacu_discharge', 'PACU Discharge'],
  ['post_op_status', 'Post-op Status'],
  ['pain_score', 'Pain Score (0-10)'],
  ['complications_present', 'Complications'],
  ['icu_required', 'ICU Required'],
  ['reoperation_required', 'Reoperation'],
  ['mortality', 'Mortality'],
];
var MAX_ROWS = 200;

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
    if (!expected || expected.length < 24) return reply_({ ok: false, error: 'The Sheet has no SYNC_TOKEN set.' });
    if (typeof body.token !== 'string' || !sameText_(body.token, expected)) {
      return reply_({ ok: false, error: 'The sync token does not match the Sheet.' });
    }
    var rows = body.rows;
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) return reply_({ ok: false, error: 'Bad row list.' });
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i] || typeof rows[i].case_number !== 'string' || !rows[i].case_number) {
        return reply_({ ok: false, error: 'A row has no case number.' });
      }
    }
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      upsert_(rows);
    } finally {
      lock.releaseLock();
    }
    return reply_({ ok: true, count: rows.length });
  } catch (err) {
    // Detail stays in the Apps Script execution log. The caller gets a generic message only.
    console.error('OR Station sync failed: ' + (err && err.message ? err.message : String(err)));
    return reply_({ ok: false, error: 'The sheet could not save the rows. Check the Apps Script execution log.' });
  }
}

function setup() {
  sheet_();
}

/** Numbers and times are plain values. Only text gets the formula guard, including a leading tab or carriage return. */
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** Writes the header on every call, so a newer column list replaces an older header. */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS.map(function (c) { return c[1]; })]);
  sh.setFrozenRows(1);
  return sh;
}

function upsert_(rows) {
  var sh = sheet_();
  var last = sh.getLastRow();
  var index = {};
  if (last > 1) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var r = 0; r < keys.length; r++) index[String(keys[r][0])] = r + 2;
  }
  var now = new Date().toISOString();
  rows.forEach(function (row) {
    var values = COLUMNS.map(function (c) {
      return c[0] === 'synced_at' ? now : cell_(row[c[0]]);
    });
    var at = index[row.case_number];
    if (!at) {
      at = sh.getLastRow() + 1;
      index[row.case_number] = at;
    }
    sh.getRange(at, 1, 1, COLUMNS.length).setValues([values]);
  });
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
