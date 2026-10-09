# OR data plan: F1 to F5

Date: 2026-10-09  
Project: `or-patient-management`  
Status: Implementation plan  

## Purpose and starting point

This plan adds structured data for procedures, preoperative baseline, safety checks, operating room events, and postoperative follow-up.
It applies to the local Tauri and SQLite application.
The current schema is in `src/data/migrations/001_initial.ts`.
The migration list ends at version 4 in `src/data/migrations/index.ts`.
Version 4 removes assistant settings, despite the older imaging design that calls its proposed migration version 4.
Use new migration versions 5 through 9.
Never edit a migration that has shipped because the application checks its checksum.

This plan assumes the application serves both daily OR work and research.
The facility must approve the clinical field definitions and local safety policy before release.
Do not add a risk score or claim WHO, ACS, or CDC compliance from the presence of fields alone.

## Rules for all five changes

1. Back up the current SQLite database with its supported backup method before each schema upgrade.
   Stop the upgrade if a required backup fails.
2. Keep old values and old records.
   Use `NULL` for data that nobody recorded.
   Use an explicit `UNKNOWN` or `NOT_ASSESSED` choice where staff must state that status.
3. Remove clinical defaults that look like observations.
   Start patient date of birth, sex, and blood type blank.
   Start ASA class, blood loss, postoperative status, pain score, and complication outcome blank.
   These defaults now appear in `PatientsView.tsx`, `IntraOrView.tsx`, and `PostOrView.tsx`.
4. Record the author, entry time, event time, and correction reason for clinical changes.
   Use the existing audit service and the `audit_log` table.
   Do not treat an empty field as a negative finding.
5. Validate values in the form and in the service or database.
   Keep database writes for each case change in one transaction.
6. Restrict clinical edits and identifiable exports through the existing permission model.
   Show the source and definition of each reported measure.

## F1: Structured procedures and diagnoses

**Current state:** `procedures`, `diagnoses`, `case_procedures`, and `case_diagnoses` already exist.
`PatientsView.tsx` creates a case from `planned_procedure_summary`.
`analytics.ts` groups procedures by this free text.

**Migration 5:** Add an optional `code_system` to each catalog if the facility uses more than one code set.
Add a partial unique index that permits one primary procedure per case.
Add indexes for case diagnosis type and catalog code.
Keep the summary fields for narrative text and old records.

**Service and UI:** Add case procedure and diagnosis operations in `src/services/patients.ts` or a focused case coding service.
Use the existing catalog readers in `src/services/masterData.ts`.
Let staff select one primary procedure, optional additional procedures, preoperative diagnoses, postoperative diagnoses, and comorbidities.
Allow a documented “not yet coded” state while a case is still being prepared.
Require a primary coded procedure and a postoperative diagnosis at the locally approved completion point.
Keep archived catalog terms visible on historical cases.
Do not delete a catalog term that a case uses.

**Old records:** Show a review queue for cases with a summary but no linked procedure.
Offer possible matches, but require a person to approve each link.
Never turn free text into a code without review.

**Reports:** Group by `procedure_id` and `diagnosis_id`, not by summary text.
Show uncoded cases as a separate count.
Count cases and procedures separately because one case can contain several procedures.

**Done when:** A case can save and reopen multiple coded procedures and diagnoses.
Two text spellings of one coded procedure produce one procedure group.
An uncoded historical case remains visible and does not appear as a coded case.

## F2: Preoperative baseline

**Current state:** The case stores type and specialty.
The intraoperative record stores ASA class.
The current schema has no case-level baseline for height, weight, tobacco status, or functional status.
`case_diagnoses` can hold coded comorbidities.

**Migration 6:** Add `case_preop_baseline` with one row per case.
Include `assessed_at`, `assessed_by`, height in centimeters, weight in kilograms, preoperative ASA class, tobacco status, and functional status.
Use explicit `YES`, `NO`, and `UNKNOWN` values for any approved risk factor that is not represented by a coded comorbidity.
Store the measurement date for height and weight.
Calculate BMI from the recorded values and units when needed.
Keep intraoperative ASA class as a separate observation.

**Service and UI:** Add a baseline section to `PreOrView.tsx`.
Use `case_diagnoses` with type `COMORBIDITY` for coded diabetes, hypertension, kidney disease, and other locally approved conditions.
Show who assessed each value and when.
Do not calculate a clinical risk prediction.

**Reports:** Show baseline completeness and the number of unknown values.
Use the baseline captured for the case, not a later patient value.
Calculate age at the operation date.
The current `analytics.ts` calls `calculateAge` without that reference date and must be corrected.

**Done when:** A saved baseline reopens with its assessment date and author.
The form distinguishes “No” from “Unknown”.
Analytics calculates age from the operation date and reports missing baseline values.

## F3: Sign-in, time-out, and sign-out

**Current state:** `pre_or_checklist_definitions` and `pre_or_checklist_values` support readiness.
They do not record the three distinct surgical safety phases.

**Migration 7:** Add versioned checklist templates, template items, and case responses.
Each item needs a phase: `SIGN_IN`, `TIME_OUT`, or `SIGN_OUT`.
Each response needs a status, author, event time, entry time, and note.
Freeze the selected template version for a case so later template edits cannot change its history.
Use a unique constraint for one current response per case and template item.
Preserve corrections through the audit log.

**Service and UI:** Add a safety section beside the existing readiness work in `PreOrView.tsx` and `IntraOrView.tsx`.
Show each phase at its point in the workflow.
Keep readiness and safety phase completion separate.
Record any local-policy override with a reason and author.
Have the facility approve which failed or incomplete items warn, block, or allow an override.
Do not silently advance a phase from a percentage.

**Reports:** Count eligible cases, completed phases, incomplete phases, and overrides.
Keep `NOT_APPLICABLE` separate from completed.
Report the checklist template version with each case.

**Done when:** Staff can complete each phase at a different time.
An incomplete phase remains visible.
A template change does not change a recorded case.
Every override appears in the audit history.

## F4: Dated operating room events

**Current state:** `or_schedule` has actual room and procedure time fields.
`ScheduleView.tsx`, `IntraOrView.tsx`, and `PostOrView.tsx` use time-only inputs.
Time-only values cannot identify the date of an overnight event.

**Migration 8:** Add `case_events` with `case_id`, `event_type`, `occurred_at`, `recorded_at`, `recorded_by`, and correction metadata.
Use full ISO 8601 timestamps with an offset.
Support `ROOM_IN`, `ANESTHESIA_START`, `INCISION`, `CLOSURE`, `ROOM_OUT`, `PACU_IN`, and `PACU_OUT`.
Index events by case and event type.
Define one current value per case and event type.

**Service and UI:** Add a case event service.
Use date and time inputs or a “record now” action that shows the exact timestamp before save.
Validate event order while allowing an authorized correction with a reason.
Use the event service as the source of actual times.
Keep old schedule fields readable during the transition, but do not create two independent write paths.
Update `scheduling.ts`, `intraPostOr.ts`, and the three affected views.

**Old records:** Migrate a legacy time only when its date is known and the result is unambiguous.
Send overnight or conflicting times to a review queue.
Leave unresolved values unknown.

**Reports:** Derive delay, procedure duration, PACU stay, and room turnover from full timestamps.
Define delay threshold in facility settings.
Do not store a derived duration as the only evidence.

**Done when:** An operation that crosses midnight shows correct event order and duration.
A corrected timestamp keeps its prior value in the audit log.
Turnover uses the previous case in the same room.

## F5: Outcomes after discharge

**Current state:** `post_or_records` captures PACU data and immediate outcome flags.
`complications` stores case events.
There is no follow-up assessment with a known observation window.

**Migration 9:** Add `case_followup_assessments` for a case, target window, due date, assessment date, method, assessor, and status.
Use statuses such as `PENDING`, `ASSESSED`, `UNREACHABLE`, and `DECEASED`.
Add dated outcome events for readmission, unplanned reoperation, and death.
Extend the existing complications model with the information needed to link an event to follow-up.
For surgical site infection, record type, detection date, evidence source, and the linked procedure when a case has multiple procedures.
Keep “no event found after assessment” distinct from “no follow-up”.

**Service and UI:** Add a follow-up queue and case follow-up form.
Keep case completion separate from follow-up completion.
Allow a later assessment and correction without deleting earlier evidence.
Apply a facility-approved definition for each outcome.
If the facility uses CDC/NHSN surgical site infection surveillance, use the current procedure-specific 30- or 90-day window and its criteria.
Do not label a local follow-up count as an NHSN rate unless the full NHSN method applies.

**Reports:** Show eligible cases, assessed cases, lost cases, and events with explicit denominators.
Show the follow-up window and outcome definition.
Never count an absent assessment as “no complication”.

**Done when:** A case appears in the queue after discharge.
Staff can record an assessment or an unsuccessful contact.
Reports separate missing follow-up from confirmed absence of an event.

## Build order and release checks

1. Capture a baseline copy of the database and record the current schema version.
   Confirm restore works before schema work.
2. Remove false clinical form defaults.
   Complete F1 through F5 in order, with one migration and one user workflow per phase.
3. For each phase, write a failing test that reproduces the missing behavior.
   Confirm it fails before implementation.
   Then run the affected service and migration tests.
4. Test a copy of an existing database and a new database.
   Check migration checksums, row counts, foreign keys, audit entries, and rollback after a forced migration error.
5. Run `npm run test`, `npm run typecheck`, and `npm run build`.
   Test the installed Windows application with offline use and restart persistence.
6. Test one case through patient entry, scheduling, all safety phases, OR events, PACU, follow-up, and reports.
   Include an overnight case, an uncoded old case, unknown baseline values, a missed follow-up, and a corrected event.
7. Release only after the facility approves the field definitions, checklist policy, follow-up windows, and report denominators.

## Main files

| Area | Files |
| --- | --- |
| Schema and migrations | `src/data/migrations/005_*.ts` through `009_*.ts`, `src/data/migrations/index.ts` |
| Case data | `src/services/patients.ts`, `src/services/masterData.ts`, `src/views/PatientsView.tsx` |
| Baseline and safety | `src/services/preOr.ts`, new focused services, `src/views/PreOrView.tsx`, `src/views/IntraOrView.tsx` |
| Events | `src/services/scheduling.ts`, `src/services/intraPostOr.ts`, new event service, `src/views/ScheduleView.tsx`, `src/views/PostOrView.tsx` |
| Follow-up and reports | New follow-up service and view, `src/services/analytics.ts`, `src/views/AnalyticsView.tsx` |
| Evidence | Migration tests, service tests, and installed-app workflow checks |

## Clinical references

- [WHO Surgical Safety Checklist implementation manual](https://www.who.int/publications/i/item/9789241598590). Use the three phases and adapt the checklist to local practice.
- [ACS NSQIP overview](https://www.facs.org/quality-programs/data-and-registries/acs-nsqip/). It describes a registry based on 30-day outcomes.
- [ACS risk calculator information](https://riskcalculator.facs.org/RiskCalculator/about.html). It lists examples of preoperative predictors. This plan does not implement its calculator.
- [CDC/NHSN surgical site infection FAQ](https://www.cdc.gov/nhsn/faqs/faq-ssi.html). It explains procedure-dependent 30- and 90-day surveillance.
