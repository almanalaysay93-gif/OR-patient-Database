import type { NavView } from "../context/AppContext";

/** Box kinds on the App Map. Each kind maps to one app color token in AppMapView. */
export type MapKind = "security" | "shell" | "clinical" | "admin" | "data" | "outside";

export interface MapNode {
  id: string;
  kind: MapKind;
  /** Grid row (lane) and column. */
  row: number;
  col: number;
  title: string;
  sub: string;
  about: string;
  /** [button label, what it does] */
  buttons: [string, string][];
  /** The screen this box opens, when the box is a screen the user can visit. */
  view?: NavView;
}

export interface MapEdge {
  from: string;
  to: string;
  label: string;
  /** Part of the patient journey from registration to a completed case. */
  journey?: boolean;
}

export const LANE_TITLES = ["GET IN", "APP FRAME", "CLINICAL", "ADMIN", "DATA"];

export const MAP_NODES: MapNode[] = [
  {
    id: "recovery", kind: "security", row: 0, col: 0, title: "Recovery key", sub: "only when the key is unreadable",
    about: "Shown instead of sign-in when this PC cannot unseal the database key, for example after a restore on another PC.",
    buttons: [["Open database", "Unlocks the encrypted database with the recovery key, then goes to Sign in."]],
  },
  {
    id: "login", kind: "security", row: 0, col: 1, title: "Sign in", sub: "user name + password",
    about: "First screen. Shows the Authorized use only notice.",
    buttons: [
      ["Sign In", "Checks the user name and password. Repeated failures lock sign-in for a while, and the lockout survives a reload."],
      ["Eye icon", "Shows or hides the password."],
    ],
  },
  {
    id: "changepw", kind: "security", row: 0, col: 2, title: "Change password", sub: "forced on first use or reset",
    about: "Every screen stays closed until the temporary password is replaced.",
    buttons: [
      ["Save new password", "Needs 12 or more characters and must differ from the user name."],
      ["Sign out", "Leaves without changing the password."],
      ["Eye icon", "Shows or hides the password."],
    ],
  },
  {
    id: "lock", kind: "security", row: 0, col: 3, title: "Lock screen", sub: "idle or Lock workstation",
    about: "Covers the app. Open forms stay filled underneath.",
    buttons: [
      ["Unlock", "Re-enter your password to return to the same screen."],
      ["Sign out (unsaved work is lost)", "Ends the session and drops unsaved entries."],
    ],
  },
  {
    id: "sidebar", kind: "shell", row: 1, col: 0, title: "Sidebar", sub: "screens, filtered by role",
    about: "Main navigation. A screen your role cannot open is not listed.",
    buttons: [
      ["Dashboard", "Opens the Dashboard."],
      ["Patients", "Opens the patient registry."],
      ["Pre-OR", "Opens the Pre-OR readiness table."],
      ["OR Schedule", "Opens the schedule board."],
      ["Intra-OR", "Opens intra-op documentation for the selected case."],
      ["Post-OR / PACU", "Opens post-op documentation for the selected case."],
      ["Analytics", "Opens the 3D charts."],
      ["Settings", "Opens settings and admin panels."],
      ["App Map", "Opens this map."],
      ["Interactive Guide", "Plays the video guide (Play / Pause, Replay, Close)."],
    ],
  },
  {
    id: "header", kind: "shell", row: 1, col: 3, title: "Header bar", sub: "top of every screen",
    about: "Tools that work from any screen.",
    buttons: [
      ["Search patient", "Opens global search."],
      ["Assistant", "Opens or closes the assistant panel."],
      ["Effects", "Cycles the background visual effect level."],
      ["Theme", "Switches light and dark."],
      ["Lock workstation", "Locks the screen now."],
      ["Sign out", "Ends the session."],
    ],
  },
  {
    id: "search", kind: "shell", row: 1, col: 4, title: "Global search", sub: "name, HRN, case",
    about: "Finds a patient or case from anywhere.",
    buttons: [
      ["Type in the box", "Lists matching patients and cases."],
      ["Click a result", "Opens that patient record."],
      ["Clear (x)", "Empties the search box."],
    ],
  },
  {
    id: "assistant", kind: "shell", row: 1, col: 5, title: "Assistant", sub: "answers from local data",
    about: "Side panel that answers questions about the records in this database.",
    buttons: [
      ["Send (Enter)", "Asks the question."],
      ["Suggested question", "Sends that question."],
      ["Open (record chip)", "Opens the patient or case named in the answer."],
      ["New chat", "Clears the conversation."],
      ["Close (Esc)", "Hides the panel."],
    ],
  },
  {
    id: "dashboard", kind: "clinical", row: 2, col: 0, title: "Dashboard", sub: "today at a glance", view: "dashboard",
    about: "Counts and today's list, with shortcuts into the workflow.",
    buttons: [
      ["New Patient Case", "Opens Patients with the Register form already open."],
      ["Full Schedule Board", "Opens OR Schedule."],
    ],
  },
  {
    id: "patients", kind: "clinical", row: 2, col: 1, title: "Patients", sub: "registry + patient record", view: "patients",
    about: "Register, edit and archive patients. The patient record has tabs: Surgical Cases, Admissions, Labs & Files, Audit Trail.",
    buttons: [
      ["Register New Patient", "Opens the form. Save Patient Record creates the patient."],
      ["Archived patients", "Lists archived patients. Restore brings one back."],
      ["Edit details", "Edits demographics. Save changes writes them."],
      ["Archive patient", "Hides the patient. A reason is required."],
      ["Add Allergy", "Records an allergy. Save Allergy writes it, the x removes it."],
      ["Schedule New Case", "Opens the case form. Create Surgical Case adds a case at Pre-OR."],
      ["Code case", "Opens case coding: Add diagnosis, Add procedure term, Add diagnosis term, Remove, Save case coding, Close coding."],
      ["Schedule to Board", "Selects the case and opens OR Schedule."],
      ["Pre-OR Check", "Selects the case and opens its Pre-OR checklist."],
      ["Add Laboratory Result", "Labs tab. Save Lab Result writes it, Delete removes it."],
      ["Upload Image / File", "Labs tab. Browse files, then Upload File. PNG, JPEG or PDF up to 10 MB. View opens a preview."],
      ["Close patient record", "Returns to the registry list."],
    ],
  },
  {
    id: "preor", kind: "clinical", row: 2, col: 2, title: "Pre-OR", sub: "checklist + readiness", view: "preor",
    about: "Searchable, paged table of cases before surgery. Opening a row shows its checklist, pre-op baseline and safety phases.",
    buttons: [
      ["Stage filter", "Not Started, Incomplete / Blocked, Ready for OR, Scheduled. Counts in brackets."],
      ["Previous / Next page", "Pages the table."],
      ["Click a row", "Opens that case's checklist."],
      ["Checklist status", "Sets each item. Readiness is recalculated, and N/A items do not lower it."],
      ["Save baseline", "Saves dialysis type, access, years on dialysis and donor relation. Queues the case for the Google Sheet."],
      ["Save note", "Saves a note on a safety phase item."],
      ["Move stage", "Moves the case to another stage by hand. Reason required."],
      ["Postpone", "Postpones a case not yet in the OR. Reason required."],
      ["Cancel case", "Cancels the case. Reason required."],
      ["Proceed to Schedule", "Opens OR Schedule for this case."],
      ["Close", "Closes the checklist."],
    ],
  },
  {
    id: "schedule", kind: "clinical", row: 2, col: 3, title: "OR Schedule", sub: "rooms + times", view: "schedule",
    about: "Searchable, paged board of booked cases.",
    buttons: [
      ["Schedule Case", "Opens the booking form. Confirm Schedule books room and time, and the case becomes Scheduled."],
      ["Configure Rooms in Settings", "Shown when no rooms exist. Opens Settings."],
      ["OR events", "Records the case's OR event times. Save event writes them."],
      ["Intra-OR", "Opens the case in Intra-OR."],
      ["Open (row)", "Selects the patient and case."],
    ],
  },
  {
    id: "intraor", kind: "clinical", row: 2, col: 4, title: "Intra-OR", sub: "in-theatre record", view: "intraor",
    about: "Documentation during surgery for the selected case.",
    buttons: [
      ["Save Intra-OR Record", "Writes the intra-op record. Queues the case for the Google Sheet."],
      ["Add Implant / Device", "Opens the implant form. Save Implant Record writes it, Delete removes it."],
      ["Advance to Post-OR", "Opens Post-OR / PACU for this case."],
    ],
  },
  {
    id: "postor", kind: "clinical", row: 2, col: 5, title: "Post-OR / PACU", sub: "recovery + outcome", view: "postor",
    about: "Recovery, disposition, complications and follow-up.",
    buttons: [
      ["Save Post-OR Record", "Writes PACU and disposition. Queues the case for the Google Sheet."],
      ["Add Event", "Opens the complication form. Save Complication writes it."],
      ["Mark Case Completed", "Sets the case to Completed. Queues the case for the Google Sheet."],
      ["Save assessment", "Saves the follow-up assessment."],
      ["Create 30-day follow-up", "Adds a 30-day follow-up."],
      ["Add 90-day follow-up", "Adds one when the procedure needs it."],
      ["Add outcome", "Records a follow-up outcome."],
    ],
  },
  {
    id: "analytics", kind: "clinical", row: 2, col: 6, title: "Analytics", sub: "3D charts, view only", view: "analytics",
    about: "Read-only charts built from the stored cases.",
    buttons: [["(no action buttons)", "Charts read the database. Nothing is changed here."]],
  },
  {
    id: "settings", kind: "admin", row: 3, col: 1, title: "Settings", sub: "panels shown by role", view: "settings",
    about: "Personal settings for everyone. Admin panels appear only for roles that hold the permission.",
    buttons: [
      ["Change Password", "Changes your own password (12 or more characters)."],
      ["Save Facility", "Saves the facility details."],
      ["Light / Dark", "Sets the theme."],
      ["Visual effects", "Picks the effect level."],
      ["Add (rooms)", "Adds an OR room for scheduling."],
      ["Donor relationship: Add / badge", "Adds a donor relation type. Clicking a badge turns it on or off."],
      ["Export to Excel", "Writes an .xlsx export, de-identified or identifiable by permission."],
      ["Save connection", "Saves the Google Sheet web app address and token."],
      ["Send waiting cases", "Sends queued cases to the Sheet now."],
      ["Send all cases", "Re-sends every case."],
      ["Add Account", "Creates a user with a role."],
      ["Reset password", "Sets a temporary password. Save writes it, Cancel stops."],
      ["Activate / Deactivate", "Turns a user account on or off."],
      ["Back Up Now", "Writes an encrypted backup file."],
      ["Save Schedule", "Saves the automatic backup schedule."],
      ["Show Recovery Key", "Shows the database recovery key. Hide Key hides it."],
      ["Restore This Backup", "Replaces the database with a backup after you type the confirmation."],
      ["Refresh (audit)", "Reloads the audit log."],
      ["Load 100 demo patients", "Adds demo records for training."],
      ["Clear demo patients", "Removes the demo records."],
    ],
  },
  {
    id: "roles", kind: "admin", row: 3, col: 0, title: "Roles", sub: "6 roles gate buttons",
    about: "Administrator, OR Supervisor, Doctor, Nurse, Research User, Read Only. A screen without edit permission opens read-only.",
    buttons: [["(no buttons)", "Set per user in Settings > Users. Each save checks the role again."]],
  },
  {
    id: "db", kind: "data", row: 4, col: 1, title: "Encrypted database", sub: "SQLCipher on this PC",
    about: "Every save on every screen writes here. Desktop: an encrypted file with a DPAPI-sealed key. Web preview: browser storage only.",
    buttons: [["(stores)", "Patients, cases, checklists, records, users and settings."]],
  },
  {
    id: "audit", kind: "data", row: 4, col: 2, title: "Audit log", sub: "who changed what",
    about: "Each change writes the old and new values with the user and the time.",
    buttons: [["Seen in", "Settings > Audit log, and the patient record Audit Trail tab."]],
  },
  {
    id: "queue", kind: "data", row: 4, col: 3, title: "Sheet send queue", sub: "timeout + retry wait",
    about: "Cases waiting to go to the Sheet. One send at a time, 30 s timeout, and failures wait 30 s doubling to 15 min. Send now skips the wait.",
    buttons: [["(automatic)", "Filled by baseline, intra-op, post-op and completion saves."]],
  },
  {
    id: "sheet", kind: "outside", row: 4, col: 4, title: "Google Sheet", sub: "Apps Script + token",
    about: "One row per case with name, HRN, case number, dialysis, donor, intra-op and post-op fields. Needs the sync token.",
    buttons: [["(outside the app)", "Owned by the SHARE account."]],
  },
  {
    id: "files", kind: "outside", row: 4, col: 5, title: "Files on disk", sub: "Excel + backups",
    about: "Excel exports and encrypted backup files.",
    buttons: [["(outside the app)", "Restore reads a backup back into the database."]],
  },
];

export const MAP_EDGES: MapEdge[] = [
  { from: "recovery", to: "login", label: "key accepted" },
  { from: "login", to: "changepw", label: "temporary password" },
  { from: "login", to: "sidebar", label: "signed in" },
  { from: "changepw", to: "sidebar", label: "password saved" },
  { from: "header", to: "lock", label: "Lock workstation" },
  { from: "lock", to: "sidebar", label: "Unlock" },
  { from: "header", to: "search", label: "Search" },
  { from: "header", to: "assistant", label: "Assistant" },
  { from: "search", to: "patients", label: "open result" },
  { from: "assistant", to: "patients", label: "open record" },
  { from: "sidebar", to: "dashboard", label: "" },
  { from: "sidebar", to: "settings", label: "" },
  { from: "dashboard", to: "patients", label: "New Patient Case" },
  { from: "dashboard", to: "schedule", label: "Full Schedule Board" },
  { from: "patients", to: "preor", label: "Pre-OR Check", journey: true },
  { from: "preor", to: "schedule", label: "Proceed to Schedule", journey: true },
  { from: "schedule", to: "intraor", label: "Intra-OR", journey: true },
  { from: "intraor", to: "postor", label: "Advance to Post-OR", journey: true },
  { from: "patients", to: "schedule", label: "Schedule to Board" },
  { from: "schedule", to: "settings", label: "Configure Rooms" },
  { from: "patients", to: "db", label: "save" },
  { from: "preor", to: "db", label: "save", journey: true },
  { from: "schedule", to: "db", label: "save" },
  { from: "intraor", to: "db", label: "save" },
  { from: "postor", to: "db", label: "Mark Case Completed", journey: true },
  { from: "settings", to: "db", label: "save" },
  { from: "db", to: "audit", label: "every change" },
  { from: "db", to: "analytics", label: "read" },
  { from: "preor", to: "queue", label: "Save baseline" },
  { from: "intraor", to: "queue", label: "Save record" },
  { from: "postor", to: "queue", label: "Save / Complete" },
  { from: "settings", to: "queue", label: "Send now" },
  { from: "queue", to: "sheet", label: "POST rows" },
  { from: "settings", to: "files", label: "Export / Back up" },
  { from: "files", to: "db", label: "Restore" },
  { from: "roles", to: "settings", label: "Users panel" },
];

export const JOURNEY_STEPS: [string, string][] = [
  ["Patients", "Register New Patient, then Schedule New Case. The case starts at Pre-OR."],
  ["Pre-OR", "Work the checklist and Save baseline. The case shows Ready for OR when required items are done."],
  ["OR Schedule", "Schedule Case, then Confirm Schedule. Record OR events on the day."],
  ["Intra-OR", "Save Intra-OR Record and implants. Advance to Post-OR."],
  ["Post-OR / PACU", "Save Post-OR Record, add complications, then Mark Case Completed."],
  ["Google Sheet", "Baseline, intra-op, post-op and completion saves queue the case and send it."],
];

/**
 * Every box reachable from `id` by following edges forward. `edges` maps each reached edge
 * to its step count from `id` (0 for the edges leaving `id`), which sets its animation delay.
 */
export function downstream(id: string): { nodes: Set<string>; edges: Map<number, number> } {
  const nodes = new Set([id]);
  const edges = new Map<number, number>();
  let frontier = [id];
  for (let depth = 0; frontier.length; depth++) {
    const next: string[] = [];
    MAP_EDGES.forEach((e, i) => {
      if (!frontier.includes(e.from) || edges.has(i)) return;
      edges.set(i, depth);
      if (!nodes.has(e.to)) {
        nodes.add(e.to);
        next.push(e.to);
      }
    });
    frontier = next;
  }
  return { nodes, edges };
}

/** Boxes with at least one button whose label or description contains the query. */
export function findButton(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return MAP_NODES.filter((n) => n.buttons.some(([label, what]) => `${label} ${what}`.toLowerCase().includes(q))).map((n) => n.id);
}
