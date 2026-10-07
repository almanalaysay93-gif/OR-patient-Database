# OR Patient Management & Research System

## Master V1 Build Specification for a Vibe-Coding Agent

**Target:** Windows desktop application\
**Deployment:** Single computer per installation\
**Connectivity:** Fully offline for core operation\
**Architecture:** Tauri + React + TypeScript + SQLite\
**Primary purpose:** Track surgical patients from Pre-OR through
Post-OR, manage OR schedules, provide patient-based analytics for
research, and export structured datasets to Excel.

------------------------------------------------------------------------

## 1. Product Goal

Build a professional-grade Windows desktop application for
operating-room patient management.

The application must:

1.  Maintain a single longitudinal patient record.
2.  Track admissions and multiple surgical cases per patient.
3.  Track Pre-OR preparation and readiness.
4.  Schedule cases by date, time, and OR room.
5.  Record Intra-OR information.
6.  Record Post-OR/PACU information and outcomes.
7.  Allow administrators to create and edit data fields/metrics without
    modifying source code.
8.  Generate patient-based analytics from structured clinical data.
9.  Provide a research query builder for creating cohorts.
10. Export research datasets and reports to `.xlsx`.
11. Support de-identified research exports.
12. Store all V1 data locally.
13. Work without an internet connection.
14. Include local user accounts, role-based access, audit trails,
    backup/restore, and database migrations.
15. Be packaged as an installable Windows application.
16. Use a premium glassmorphism interface with fluid, professional
    animation.
17. Use richer 3D/parallax presentation primarily on Dashboard and
    Analytics without compromising clinical usability.

------------------------------------------------------------------------

# 2. Core Architecture

``` text
Windows PC
│
├── OR Patient Management App
│   ├── Dashboard
│   ├── Patients
│   ├── Pre-OR
│   ├── OR Schedule
│   ├── Intra-OR
│   ├── Post-OR
│   ├── Analytics
│   ├── Research Builder
│   ├── Reports
│   └── Settings
│
├── Local SQLite Database
│   ├── Patient records
│   ├── Admissions
│   ├── Surgical cases
│   ├── Clinical records
│   ├── Custom fields
│   ├── Users
│   ├── Audit history
│   └── Saved research queries
│
├── Backups
└── Excel Exports
```

Use a clean service/repository abstraction around SQLite so the
persistence layer can later be replaced with a network database without
rewriting the entire UI.

Do not build V1 around cloud services, Supabase, Firebase, or a
browser-hosted database.

------------------------------------------------------------------------

# 3. Recommended Technology Stack

## Desktop

-   Tauri
-   React
-   TypeScript
-   Vite

## Database

-   SQLite
-   Foreign keys enabled
-   Database migrations
-   Transactions for multi-record clinical operations
-   Appropriate indexes for search, scheduling, analytics, and joins

## UI

Use a mature accessible component system, but customize it to the
application's visual language.

Recommended capabilities:

-   data tables
-   command/search palette
-   dialogs
-   drawers
-   date/time controls
-   dropdowns
-   tooltips
-   tabs
-   forms
-   calendars
-   charts

## Animation

Use performant CSS transforms and/or a production-grade React animation
library.

Animations must:

-   target smooth 60 FPS where hardware allows
-   use spring-like easing
-   avoid unnecessary layout reflow
-   respect Reduced Motion
-   degrade gracefully on older computers

## Excel

Generate actual `.xlsx` workbooks.

Exports must not simply rename CSV files to `.xlsx`.

------------------------------------------------------------------------

# 4. Core Data Model

The central relationship is:

``` text
PATIENT
   │
   └── ADMISSION
          │
          └── SURGICAL CASE
                  ├── OR Schedule
                  ├── Pre-OR Assessment
                  ├── Procedures
                  ├── Diagnoses
                  ├── Team Members
                  ├── Intra-OR Record
                  ├── Post-OR Record
                  ├── Complications
                  ├── Laboratory Results
                  └── Custom Field Values
```

A patient must never be duplicated merely because the patient has
another admission or operation.

A patient can have many admissions.

An admission can have many surgical cases.

A surgical case can contain multiple procedures and diagnoses.

------------------------------------------------------------------------

# 5. Database Schema

Use UUIDs or another collision-resistant application-generated ID
strategy for primary identifiers where practical.

Every clinically relevant table should include timestamps and, where
appropriate, the user responsible for creation/update.

## 5.1 patients

``` text
patient_id
hrn
first_name
middle_name
last_name
suffix
date_of_birth
sex
address
contact_number
blood_type
is_active
created_at
updated_at
```

Requirements:

-   HRN should be searchable.
-   HRN should be unique when populated unless administrator
    configuration explicitly allows otherwise.
-   Do not store current age as the source of truth.
-   Calculate age from date of birth and the relevant reference date,
    such as surgery date.

## 5.2 admissions

``` text
admission_id
patient_id
admission_number
admission_date
discharge_date
ward
room
bed
attending_physician
admission_diagnosis_text
discharge_diagnosis_text
status
created_at
updated_at
```

## 5.3 surgical_cases

``` text
case_id
patient_id
admission_id
case_number
case_type
specialty_id
priority
laterality
planned_procedure_summary
preoperative_diagnosis_summary
postoperative_diagnosis_summary
case_status
created_at
updated_at
```

Recommended case statuses:

``` text
PRE_OR
NOT_READY
READY
SCHEDULED
IN_OR
PACU
POST_OR
COMPLETED
POSTPONED
CANCELLED
```

Do not hard-code display labels so tightly that labels cannot later be
configured.

## 5.4 specialties

``` text
specialty_id
name
code
active
display_order
```

Examples may include Urology, Vascular, Transplant, General Surgery, and
others, but the administrator must be able to maintain this master list.

## 5.5 procedures

``` text
procedure_id
procedure_code
procedure_name
specialty_id
category
active
created_at
updated_at
```

## 5.6 case_procedures

``` text
case_procedure_id
case_id
procedure_id
is_primary
notes
```

Never rely only on free-text procedure names for analytics.

## 5.7 diagnoses

``` text
diagnosis_id
diagnosis_code
diagnosis_name
category
active
created_at
updated_at
```

Allow future use of standardized coding such as ICD-10 without requiring
it in V1.

## 5.8 case_diagnoses

``` text
case_diagnosis_id
case_id
diagnosis_id
diagnosis_type
notes
```

Suggested diagnosis types:

``` text
PRE_OPERATIVE
POST_OPERATIVE
COMORBIDITY
OTHER
```

## 5.9 or_rooms

``` text
or_room_id
name
description
active
display_order
```

## 5.10 or_schedule

``` text
schedule_id
case_id
or_room_id
scheduled_date
scheduled_start
estimated_duration_minutes
actual_room_in
actual_procedure_start
actual_procedure_end
actual_room_out
schedule_status
delay_minutes
delay_reason_id
cancellation_reason_id
notes
created_at
updated_at
```

The system must detect:

-   overlapping cases in the same OR
-   duplicate schedules for the same patient/case
-   overlapping surgeon assignments
-   overlapping anesthesiologist assignments

Warnings should not silently alter records.

## 5.11 delay_reasons

``` text
delay_reason_id
name
active
display_order
```

## 5.12 cancellation_reasons

``` text
cancellation_reason_id
name
active
display_order
```

## 5.13 pre_or_assessments

``` text
assessment_id
case_id
npo_status
consent_complete
site_marked
allergy_checked
blood_available
laboratory_complete
imaging_complete
medical_clearance
anesthesia_clearance
readiness_status
readiness_percentage
assessed_by
assessed_at
notes
created_at
updated_at
```

Do not make readiness a purely manually typed percentage.

Readiness should be derived from configurable checklist requirements
where possible.

## 5.14 pre_or_checklist_definitions

``` text
checklist_item_id
name
description
required_by_default
active
display_order
```

## 5.15 pre_or_checklist_values

``` text
value_id
case_id
checklist_item_id
status
value_text
completed_by
completed_at
notes
```

Possible statuses:

``` text
PENDING
COMPLETE
NOT_APPLICABLE
FAILED
```

## 5.16 intra_or_records

``` text
intra_or_id
case_id
anesthesia_type_id
asa_classification
estimated_blood_loss_ml
blood_transfusion
units_transfused
specimen_collected
implant_used
procedure_start
procedure_end
operative_findings
operative_notes
created_by
created_at
updated_at
```

## 5.17 anesthesia_types

``` text
anesthesia_type_id
name
active
display_order
```

## 5.18 post_or_records

``` text
post_or_id
case_id
pacu_admission
pacu_discharge
post_op_destination_id
post_op_status
pain_score
complications_present
icu_required
reoperation_required
mortality
notes
created_by
created_at
updated_at
```

## 5.19 post_op_destinations

``` text
destination_id
name
active
display_order
```

## 5.20 complications

``` text
complication_id
case_id
complication_type_id
severity
occurred_at
description
intervention
outcome
created_at
updated_at
```

## 5.21 complication_types

``` text
complication_type_id
name
category
active
display_order
```

Complication categories must be structured enough for research and
reporting.

## 5.22 staff

``` text
staff_id
employee_code
full_name
professional_role
specialty
active
created_at
updated_at
```

## 5.23 case_team

``` text
case_team_id
case_id
staff_id
role
created_at
```

Example roles:

-   Primary Surgeon
-   Assistant Surgeon
-   Anesthesiologist
-   Scrub Nurse
-   Circulating Nurse
-   Other

Role lists should be configurable.

## 5.24 laboratory_results

Design this to support both standard and configurable laboratory
variables.

``` text
lab_result_id
patient_id
admission_id
case_id
test_definition_id
result_value_text
result_value_numeric
unit
reference_range
result_date_time
notes
created_at
updated_at
```

## 5.25 laboratory_test_definitions

``` text
test_definition_id
test_name
test_code
default_unit
data_type
analytics_enabled
research_enabled
active
display_order
```

------------------------------------------------------------------------

# 6. Dynamic Custom Field System

This is a critical requirement.

Administrators must be able to add fields without source-code changes.

## custom_field_definitions

``` text
field_id
field_name
field_key
description
scope
section
data_type
required
analytics_enabled
research_enabled
export_enabled
active
display_order
validation_json
options_json
created_at
updated_at
```

Supported scopes:

``` text
PATIENT
ADMISSION
SURGICAL_CASE
PRE_OR
INTRA_OR
POST_OR
```

Supported data types:

-   short text
-   long text
-   integer
-   decimal
-   date
-   date/time
-   yes/no
-   checkbox
-   single-select dropdown
-   multi-select
-   status
-   staff/person
-   structured option list

## custom_field_values

``` text
value_id
field_id
patient_id
admission_id
case_id
text_value
number_value
boolean_value
date_value
datetime_value
json_value
created_at
updated_at
```

Enforce appropriate scope.

An administrator must be able to:

-   add a field
-   rename its display label
-   edit description
-   reorder it
-   change whether it is required
-   enable/disable analytics
-   enable/disable research
-   enable/disable export
-   archive it
-   manage dropdown choices

Avoid destructive schema changes for ordinary custom-field
modifications.

If a field already contains historical data, warn before changes that
could invalidate or reinterpret existing values.

------------------------------------------------------------------------

# 7. Main Navigation

Desktop navigation:

``` text
Dashboard
Patients
Pre-OR
OR Schedule
Intra-OR
Post-OR
Analytics
Research
Reports
Settings
```

Provide global patient/case search.

Search should support at least:

-   HRN
-   patient name
-   case number
-   admission number
-   procedure

------------------------------------------------------------------------

# 8. Dashboard

The Dashboard is an operational overview.

Show:

-   patients today
-   scheduled cases today
-   Pre-OR cases
-   ready cases
-   cases currently in OR
-   PACU/Post-OR cases
-   completed cases
-   delayed cases
-   cancelled cases
-   emergency cases
-   OR utilization
-   upcoming cases
-   alerts requiring attention

Dashboard cards must be interactive.

Selecting a metric should open or filter the relevant patient/case list.

------------------------------------------------------------------------

# 9. Patient Profile

The patient profile should behave as the central longitudinal record.

Recommended sections:

``` text
Overview
Admissions
Surgical Cases
Diagnoses
Procedures
Laboratory Results
Documents/Notes
History
Audit Trail
```

Header should clearly display:

-   patient name
-   HRN
-   DOB
-   calculated age
-   sex
-   blood type
-   current admission
-   current surgical status

Avoid displaying unnecessary sensitive information on list screens.

------------------------------------------------------------------------

# 10. Pre-OR Module

Provide both:

1.  patient list/board
2.  detailed Pre-OR assessment

Board columns may include:

``` text
Not Started
Incomplete
Ready
Scheduled
```

Each patient card should show only high-value operational information.

Example:

``` text
Juan Dela Cruz
Kidney Transplant
OR 2 • 08:00

Readiness: 86%
1 required item incomplete
```

Pre-OR readiness must be calculated from applicable required checklist
items.

`NOT_APPLICABLE` items must not incorrectly reduce readiness.

Users must be able to see exactly why a patient is not ready.

------------------------------------------------------------------------

# 11. OR Scheduling

Provide:

-   day view
-   week view
-   OR-room view
-   chronological list view

OR-room view should resemble a professional scheduling board.

Example:

``` text
OR 1
07:00  Patient A — Procedure
10:00  Patient B — Procedure
13:00  Available

OR 2
08:00  Patient C — Procedure
11:30  Patient D — Procedure
```

Allow controlled drag-and-drop rescheduling.

Before saving a schedule change, validate conflicts.

Record:

-   planned date
-   planned start
-   estimated duration
-   room
-   surgical team
-   actual room-in
-   actual procedure start
-   actual procedure end
-   actual room-out
-   delays
-   cancellation/postponement

All meaningful schedule edits must be audited.

------------------------------------------------------------------------

# 12. Intra-OR Module

Provide a focused documentation interface.

Clinical data-entry screens should prioritize:

-   readability
-   speed
-   keyboard navigation
-   large click/touch targets
-   minimal animation during active documentation

Do not allow visual effects to interfere with data entry.

------------------------------------------------------------------------

# 13. Post-OR Module

Track:

-   PACU admission/discharge
-   post-operative status
-   destination
-   complications
-   pain score
-   ICU requirement
-   reoperation
-   mortality
-   notes
-   configurable Post-OR fields

Cases should progress to completed only through an explicit action.

------------------------------------------------------------------------

# 14. Analytics System

Analytics must be based primarily on patient and surgical-case data.

The system should answer questions such as:

-   How many male and female patients?
-   What is the age distribution?
-   How many patients underwent each procedure?
-   What diagnoses are most common?
-   How many procedures were performed per specialty?
-   What percentage were elective versus emergency?
-   What anesthesia types were used?
-   What were the most common complications?
-   What were the post-operative destinations?
-   How many cases were completed, cancelled, delayed, or postponed?
-   What is the average procedure duration?
-   What is the average PACU duration?
-   How have patient volumes changed over time?

## Core analytics

Include:

### Demographics

-   total unique patients
-   sex distribution
-   age distribution
-   mean age
-   median age
-   age range
-   configurable age groups

### Procedures

-   procedures by type
-   procedures by specialty
-   procedure trends over time
-   primary versus additional procedures

### Diagnoses

-   pre-operative diagnoses
-   post-operative diagnoses
-   comorbidities
-   diagnosis trends

### OR

-   scheduled cases
-   completed cases
-   cancelled cases
-   postponed cases
-   delayed cases
-   emergency/elective distribution
-   utilization by OR room
-   procedure duration
-   delays and reasons
-   cancellation reasons

### Outcomes

-   complication frequency
-   complication type
-   post-op destination
-   ICU requirement
-   reoperation
-   mortality where recorded
-   PACU duration

Do not calculate misleading statistics when required data is missing.

Show missing-data counts where relevant.

------------------------------------------------------------------------

# 15. Analytics Interaction

Analytics filters should apply across the page.

Global filters:

-   date range
-   sex
-   age/age group
-   procedure
-   diagnosis
-   specialty
-   case type
-   priority
-   surgeon
-   anesthesia
-   OR room
-   outcome
-   complication
-   custom research-enabled fields

Clicking a chart segment should optionally add it as a filter.

Example:

``` text
Female
→ Kidney Transplant
→ Age 30–50
```

All compatible cards and charts should update using the same active
cohort.

Always display the active filters clearly.

Provide:

``` text
Clear All Filters
```

------------------------------------------------------------------------

# 16. Analytics Visual Design

The Analytics page should be the visual centerpiece.

Use a premium 3D landing-page-inspired layout with restrained parallax.

Suggested depth:

``` text
Layer 1: atmospheric background
Layer 2: subtle abstract medical/OR shapes
Layer 3: visualization layer
Layer 4: glass KPI cards
Layer 5: interactions/tooltips
```

Charts may use tasteful dimensional effects but must preserve accurate
visual interpretation.

Never distort bar height, pie proportion, axis scale, or values to
create a 3D effect.

Use:

-   bar charts
-   line charts
-   area charts
-   donut charts
-   utilization rings
-   heatmaps
-   timelines
-   KPI cards
-   patient-flow visualizations

Avoid excessive motion.

------------------------------------------------------------------------

# 17. Research Query Builder

Create a dedicated Research module.

Workflow:

``` text
Research
→ New Research Query
→ Define Population
→ Add Conditions
→ Select Variables
→ Preview Cohort
→ Analyze
→ Export
```

Example:

``` text
Date: Jan 1, 2026 – Dec 31, 2026

Age >= 18
AND Sex = Female
AND Procedure = Kidney Transplant
AND Case Status = Completed
```

Immediately show:

``` text
Matching patients: 47
Matching surgical cases: 52
```

Do not confuse unique patient count with surgical-case count.

## Supported operators

Depending on field type:

``` text
=
!=
>
>=
<
<=
contains
does not contain
is empty
is not empty
is one of
is not one of
between
```

Support grouped AND/OR logic.

Example:

``` text
Sex = Female
AND
(
  Procedure = Kidney Transplant
  OR
  Procedure = Nephrectomy
)
```

------------------------------------------------------------------------

# 18. Saved Research Queries

Tables:

## research_queries

``` text
query_id
name
description
created_by
created_at
updated_at
```

## research_filter_groups

``` text
group_id
query_id
parent_group_id
logical_operator
display_order
```

## research_filters

``` text
filter_id
group_id
field_source
field_identifier
operator
value_json
display_order
```

Save query definitions, not copies of patient records.

Opening a saved query should run it against the current database unless
the user explicitly creates a frozen export.

------------------------------------------------------------------------

# 19. Research Variables

Research variables may come from:

-   patient fields
-   admission fields
-   surgical-case fields
-   procedures
-   diagnoses
-   laboratory results
-   Pre-OR
-   Intra-OR
-   Post-OR
-   complications
-   custom fields

The user should be able to choose columns for a research dataset.

Example:

``` text
☑ Research ID
☑ Age at Surgery
☑ Sex
☑ Diagnosis
☑ Procedure
☑ Specialty
☑ Surgery Date
☑ Anesthesia
☑ Procedure Duration
☑ Complication
☑ Outcome
☐ Name
☐ HRN
```

------------------------------------------------------------------------

# 20. Research Statistics

V1 should include reliable descriptive statistics.

For numeric variables:

-   count
-   missing
-   mean
-   median
-   minimum
-   maximum
-   standard deviation where appropriate

For categorical variables:

-   count
-   frequency
-   percentage
-   missing

Do not automatically present inferential statistical tests as clinically
meaningful conclusions.

The application is a data and research-support tool, not an autonomous
research interpretation engine.

------------------------------------------------------------------------

# 21. De-identification

Research export should default to de-identified data.

Provide a generated research identifier such as:

``` text
OR-000001
OR-000002
OR-000003
```

Default de-identified exports should exclude direct identifiers
including:

-   patient name
-   HRN
-   address
-   phone/contact information

Provide a clear warning before identifiable export.

Identifiable export must require an authorized role.

Do not claim that simply removing direct identifiers guarantees complete
anonymity. Dates, rare diagnoses, ages, and combinations of variables
may still permit re-identification.

------------------------------------------------------------------------

# 22. Excel Export

Support `.xlsx`.

Export the current filtered cohort or saved research query.

Recommended workbook:

``` text
OR_Research_2026.xlsx

Sheets:
1. Research Summary
2. Patient Dataset
3. Demographics
4. Procedures
5. Diagnoses
6. Outcomes
7. Complications
8. Data Dictionary
```

## Research Summary

Include:

-   research query name
-   generated date/time
-   date range
-   filters
-   unique patient count
-   surgical case count
-   whether data is de-identified

## Patient Dataset

One analysis-ready table.

The export process must define the row grain clearly.

Examples:

``` text
One row per patient
```

or:

``` text
One row per surgical case
```

The user must choose or clearly see which grain is being exported.

This prevents accidental duplication when a patient has multiple
procedures or admissions.

## Data Dictionary

Columns:

``` text
Variable Name
Display Name
Definition
Source
Data Type
Allowed Values
Unit
Missing Value Meaning
Built-in / Custom
Research Enabled
```

This sheet is required.

------------------------------------------------------------------------

# 23. Dynamic Analytics

When an administrator creates a custom field such as:

``` text
Smoking History
Type: Yes/No
Analytics: Enabled
Research: Enabled
```

the field should automatically become available in:

-   Analytics filters
-   Research Query Builder
-   Dataset Builder
-   Excel export
-   Data Dictionary

Do not require a code change.

------------------------------------------------------------------------

# 24. Reports

Provide report generation for operational and research use.

Examples:

-   Daily OR Census
-   Daily Schedule
-   Completed Cases
-   Cancelled Cases
-   Delayed Cases
-   Procedure Census
-   Specialty Census
-   Patient Demographics
-   Complications
-   OR Utilization
-   Research Dataset

Reports should respect active filters.

Allow export to Excel.

PDF/printing can be added if implemented cleanly, but Excel is the
required V1 structured export.

------------------------------------------------------------------------

# 25. Users and Roles

Local authentication only for V1.

Suggested roles:

``` text
Administrator
OR Supervisor
Nurse
Doctor
Research User
Read Only
```

Permissions must be role-based and configurable.

Permission examples:

-   view patients
-   create patients
-   edit demographics
-   edit Pre-OR
-   edit schedule
-   edit Intra-OR
-   edit Post-OR
-   manage master data
-   access analytics
-   build research cohorts
-   export de-identified data
-   export identifiable data
-   manage users
-   backup database
-   restore database
-   view audit logs

Passwords must never be stored as plain text.

Use a modern password-hashing algorithm with appropriate parameters.

------------------------------------------------------------------------

# 26. Audit Trail

Clinical and administrative changes must be auditable.

## audit_log

``` text
audit_id
user_id
patient_id
admission_id
case_id
action
entity_type
record_id
field_name
old_value
new_value
timestamp
device_identifier
```

Audit events should include:

-   patient creation
-   demographic edits
-   surgical-case edits
-   schedule changes
-   status changes
-   clinical field changes
-   custom field changes
-   exports
-   backup/restore events
-   user/permission changes

Audit logs must not be casually editable through the normal UI.

------------------------------------------------------------------------

# 27. Data Validation

Implement both UI validation and database-level constraints where
appropriate.

Examples:

-   DOB cannot normally be in the future.
-   Procedure end cannot precede procedure start.
-   PACU discharge cannot precede PACU admission.
-   Scheduled end calculations must use estimated duration.
-   Required fields must be enforced before relevant workflow
    transitions.
-   Duplicate HRNs should trigger warnings/prevention according to
    configuration.
-   Numeric fields must reject invalid text.
-   Dropdown-backed research variables should use standardized values.

Clinical workflows should not silently discard invalid data.

------------------------------------------------------------------------

# 28. Backup and Restore

The application must make local backup simple.

Provide:

``` text
Settings
→ Database
→ Backup Now
→ Restore Backup
```

Support configurable automatic backups.

Suggested default:

-   automatic daily backup when the application is used
-   retain a configurable number of backups

Example:

``` text
Backups/
  OR-Backup-2026-10-07.db
  OR-Backup-2026-10-06.db
  OR-Backup-2026-10-05.db
```

Before restore:

1.  validate backup integrity
2.  warn the user
3.  create a safety backup of the current database
4.  require administrator authorization
5.  log the restore event

Use safe SQLite backup procedures rather than blindly copying a database
during an active write.

------------------------------------------------------------------------

# 29. Database Migrations

Database versioning is mandatory.

Maintain a migration history table.

``` text
schema_migrations

migration_id
version
name
applied_at
checksum
```

Rules:

-   never delete the production database during an application upgrade
-   migrations must run in a transaction when possible
-   make a pre-migration backup
-   validate migration success
-   rollback safely on failure where possible
-   never silently discard historical patient data

The installer/updater must recognize an existing database.

------------------------------------------------------------------------

# 30. Application Installation

Produce a normal Windows installer.

Desired result:

``` text
OR-Patient-Management-Setup.exe
```

First-run workflow:

``` text
Install
→ Launch
→ Initialize local database
→ Create first Administrator
→ Configure facility
→ Configure OR rooms
→ Configure specialties
→ Configure initial master data
→ Start
```

Do not require:

-   Node.js
-   Python
-   database server
-   internet
-   command line

on the end-user computer.

------------------------------------------------------------------------

# 31. Local File Locations

Use Windows-appropriate application data locations rather than writing
sensitive data beside the executable.

The application should manage:

``` text
Application Data
Database
Backups
Exports
Logs
```

Provide settings to choose an approved backup/export location.

Do not expose the raw database as the normal workflow for staff.

------------------------------------------------------------------------

# 32. Visual Design System

Design direction:

**Premium professional medical workstation + glassmorphism + restrained
dimensional depth.**

Do not make it look like a gaming dashboard.

## Glassmorphism

Use:

-   translucent surfaces
-   background blur
-   thin subtle borders
-   layered depth
-   soft shadows
-   restrained highlights
-   generous spacing
-   rounded cards
-   clear typography

Clinical data must always have sufficient contrast.

## Navigation

Use a persistent desktop sidebar:

``` text
Dashboard
Patients
Pre-OR
OR Schedule
Intra-OR
Post-OR
Analytics
Research
Reports
Settings
```

Allow collapse to icons.

------------------------------------------------------------------------

# 33. Motion System

Target Apple-like fluidity without copying proprietary UI.

Use:

-   spring-based transitions
-   subtle hover elevation
-   button compression
-   smooth drawers
-   animated tab indicators
-   shared-layout transitions where useful
-   smooth chart transitions
-   restrained parallax

Avoid:

-   constant floating elements
-   excessive glow
-   long blocking transitions
-   animations during rapid clinical data entry
-   motion that obscures values

Provide:

``` text
Visual Effects
Full
Reduced
Off
```

Respect operating-system Reduced Motion where available.

------------------------------------------------------------------------

# 34. Performance Modes

## Full

-   glass blur
-   parallax
-   richer transitions
-   dimensional analytics
-   animated chart changes

## Reduced

-   reduced blur
-   minimal parallax
-   shorter animations

## Off

-   no parallax
-   minimal transitions
-   reduced transparency where needed

The application must remain fully functional in every mode.

------------------------------------------------------------------------

# 35. Accessibility

At minimum:

-   keyboard navigation
-   visible focus states
-   sufficient contrast
-   labels for icon-only controls
-   scalable text
-   Reduced Motion
-   do not encode clinical status by color alone
-   descriptive status text
-   usable tab order

------------------------------------------------------------------------

# 36. Search, Sorting and Filtering

Large tables must support:

-   search
-   sorting
-   filters
-   column selection
-   pagination or efficient virtualization
-   saved view preferences where appropriate

Patient lists should remain responsive with large local datasets.

------------------------------------------------------------------------

# 37. Safety Against Accidental Data Loss

Use confirmation dialogs for destructive operations.

Prefer archival/deactivation over deleting referenced master data.

Patient and clinical records should not be casually hard-deleted.

If deletion is allowed for administrator correction, require
authorization, reason entry, and audit logging.

------------------------------------------------------------------------

# 38. Data Quality

Analytics are only useful if data is standardized.

Use controlled master lists for:

-   procedures
-   diagnoses
-   specialties
-   anesthesia
-   complications
-   OR rooms
-   destinations
-   cancellation reasons
-   delay reasons
-   staff roles

Allow free-text notes in addition to structured data, not instead of
structured data.

------------------------------------------------------------------------

# 39. Important Analytics Rules

## Unique patients vs cases

Always distinguish:

``` text
Unique Patients
Surgical Cases
Procedures
```

These are not interchangeable.

A single patient can have:

-   multiple admissions
-   multiple surgical cases
-   multiple procedures

## Age

For surgical research, calculate age at the surgical-case reference
date.

Do not use a permanently stored current-age field.

## Missing data

Analytics must display missing/unknown data instead of silently
excluding it where exclusion could mislead.

## Percentages

Clearly state denominators.

Example:

``` text
Female: 48 / 100 patients = 48%
```

not simply:

``` text
Female: 48%
```

when the denominator is ambiguous.

------------------------------------------------------------------------

# 40. Example Research Workflow

``` text
Research
→ New Query

Date:
Jan 1, 2026 – Dec 31, 2026

Filters:
Age >= 18
AND
Sex = Female
AND
Procedure = Kidney Transplant
AND
Case Status = Completed

Results:
47 unique patients
49 admissions
52 surgical cases

Variables:
Research ID
Age at Surgery
Sex
Diagnosis
Procedure
Surgery Date
Anesthesia
Procedure Duration
Complication
Outcome

→ Analyze
→ De-identify
→ Export Excel
```

------------------------------------------------------------------------

# 41. Example Analytics Landing Page

``` text
OPERATING ROOM PATIENT ANALYTICS

Jan 1 – Dec 31, 2026

┌─────────────────┐
│ UNIQUE PATIENTS │
│      1,248      │
└─────────────────┘

┌──────────────┐  ┌──────────────┐
│ MALE         │  │ FEMALE       │
│ 654 • 52.4%  │  │ 594 • 47.6%  │
└──────────────┘  └──────────────┘

AGE DISTRIBUTION
[interactive chart]

PROCEDURES
[interactive chart]

DIAGNOSES
[interactive chart]

OUTCOMES
[interactive chart]

COMPLICATIONS
[interactive chart]
```

Values shown above are illustrative UI examples only. Do not seed them
as real clinical statistics.

------------------------------------------------------------------------

# 42. Settings

Settings should include:

## Facility

-   facility name
-   department/unit
-   optional logo
-   local preferences

## OR Configuration

-   OR rooms
-   specialties
-   procedure master list
-   diagnosis master list
-   anesthesia types
-   complications
-   delay reasons
-   cancellation reasons
-   destinations

## Custom Fields

-   create
-   edit
-   reorder
-   archive
-   analytics/research/export settings

## Users & Roles

-   accounts
-   permissions
-   password reset by authorized administrator

## Database

-   database information
-   backup
-   restore
-   backup location
-   migration/schema version

## Appearance

-   light/dark/system if implemented
-   Full/Reduced/Off effects
-   text scaling if implemented

------------------------------------------------------------------------

# 43. Initial Setup Wizard

On first run:

1.  Welcome
2.  Create administrator account
3.  Enter facility information
4.  Create OR rooms
5.  Add specialties
6.  Review initial master data
7.  Configure backup location
8.  Finish

Allow all setup values to be changed later.

------------------------------------------------------------------------

# 44. Error Handling

Errors must be understandable.

Bad:

``` text
SQLITE_CONSTRAINT_FOREIGNKEY
```

Good:

``` text
This procedure cannot be removed because it is already linked to patient records. Archive it instead.
```

Technical details may be available in a diagnostic log but should not be
the primary user message.

------------------------------------------------------------------------

# 45. Logging

Maintain local diagnostic logs.

Do not place unnecessary patient identifiers or full clinical records in
diagnostic logs.

Provide log rotation to avoid unlimited file growth.

------------------------------------------------------------------------

# 46. Future V2 Compatibility

V1 is single-computer.

However, structure the application so V2 can support:

``` text
Multiple OR computers
        ↓
Hospital LAN
        ↓
Central database/server
```

Keep:

-   UI
-   domain models
-   analytics definitions
-   validation logic
-   export logic

as independent as practical from direct SQLite calls.

Do not implement LAN synchronization in V1.

------------------------------------------------------------------------

# 47. Out of Scope for V1

Do not add unless specifically requested later:

-   cloud synchronization
-   public internet patient portal
-   hospital API integration
-   multi-computer live synchronization
-   AI clinical recommendations
-   automatic medical decision-making
-   autonomous diagnosis
-   automatic research conclusions

Keep V1 focused and reliable.

------------------------------------------------------------------------

# 48. Required User Experience

The application should feel:

-   premium
-   modern
-   responsive
-   calm
-   clinical
-   data-dense without feeling cluttered

Dashboard and Analytics may be visually expressive.

Patient entry, Pre-OR, Intra-OR, and Post-OR screens must prioritize
clarity and speed over decoration.

------------------------------------------------------------------------

# 49. Acceptance Criteria

V1 is not complete until all of the following work.

## Installation

-   Installer works on a clean supported Windows computer.
-   App launches without internet.
-   No separate database server is required.
-   First administrator can be created.

## Patients

-   Create patient.
-   Search patient.
-   Edit patient.
-   Create multiple admissions.
-   Create multiple surgical cases.

## Pre-OR

-   Complete configurable checklist.
-   Calculate readiness.
-   Clearly show missing required items.

## Scheduling

-   Schedule a case.
-   Move/reschedule a case.
-   Detect room conflicts.
-   Detect team conflicts.
-   Record planned and actual times.

## Intra-OR

-   Record structured operative data.
-   Save safely.
-   Audit edits.

## Post-OR

-   Record PACU and outcome data.
-   Record complications.
-   Complete a case.

## Custom Metrics

-   Administrator creates a new field.
-   Field appears in the selected clinical section.
-   Data can be entered.
-   Field can appear in analytics.
-   Field can be used in Research Builder.
-   Field can be exported to Excel.

## Analytics

-   Filter by date.
-   Show unique patient counts.
-   Show male/female distribution.
-   Show age statistics.
-   Show procedures.
-   Show diagnoses.
-   Show outcomes.
-   Show complications.
-   Cross-filter charts.
-   Clearly display active cohort.

## Research

-   Build AND/OR cohort.
-   Show unique patients separately from cases.
-   Select variables.
-   Preview dataset.
-   Save query.
-   Reopen query.

## Excel

-   Export valid `.xlsx`.
-   Export de-identified dataset.
-   Include Data Dictionary.
-   Preserve numeric/date data types where practical.
-   Clearly identify row grain.

## Security

-   Passwords are hashed.
-   Permissions are enforced.
-   Audit log records important edits.
-   Identifiable export is restricted.

## Backup

-   Manual backup works.
-   Automatic backup works.
-   Restore validates the backup.
-   Restore creates a safety backup.

## Migration

-   Application upgrades preserve existing records.
-   Migration version is tracked.
-   Failed migration does not silently destroy data.

## UI

-   Glassmorphism design is consistent.
-   Analytics supports richer 3D/parallax presentation.
-   Clinical forms remain highly readable.
-   Reduced Motion works.
-   Visual Effects can be reduced or disabled.

------------------------------------------------------------------------

# 50. Development Order

Build in this order:

``` text
Phase 1
Project foundation
SQLite
Migrations
Authentication
Roles
Audit framework

Phase 2
Patients
Admissions
Surgical cases
Master data

Phase 3
Pre-OR
OR scheduling
Conflict detection

Phase 4
Intra-OR
Post-OR
Complications

Phase 5
Custom Field Builder

Phase 6
Patient Analytics
Cross-filtering

Phase 7
Research Query Builder
Dataset Builder
De-identification

Phase 8
Excel exports
Data Dictionary
Reports

Phase 9
Glassmorphism design refinement
3D analytics
Parallax
Animation
Performance modes

Phase 10
Backup/restore
Installer
Migration testing
Performance testing
Acceptance testing
```

Do not begin with visual polish before the database, validation, audit,
and clinical workflows are stable.

------------------------------------------------------------------------

# 51. Engineering Rules for the Coding Agent

1.  Do not invent clinical decision rules.
2.  Keep structured research variables normalized.
3.  Avoid free text when a controlled vocabulary is appropriate.
4.  Never use current age as stored source-of-truth data.
5.  Distinguish patients, admissions, cases, and procedures.
6.  Use database transactions for multi-step writes.
7.  Enforce foreign keys.
8.  Add useful indexes.
9.  Never store passwords in plain text.
10. Audit important clinical and administrative edits.
11. Do not silently delete patient data.
12. Do not silently overwrite backups.
13. Do not make cloud connectivity a V1 dependency.
14. Do not let animation reduce clinical usability.
15. Do not use fake 3D effects that distort analytical values.
16. Do not claim de-identification guarantees anonymity.
17. Keep the persistence layer abstract enough for a future LAN/server
    version.
18. Build reusable validation and form components.
19. Add tests for calculations, filters, exports, conflicts, migrations,
    and permissions.
20. Treat data integrity as more important than visual effects.

------------------------------------------------------------------------

# 52. Final Product Definition

The finished V1 should be a standalone Windows application that a user
can install on one computer and use as an offline OR patient database.

It should combine:

``` text
Patient Registry
+
Pre-OR Tracking
+
OR Scheduling
+
Intra-OR Documentation
+
Post-OR Tracking
+
Patient Analytics
+
Research Query Builder
+
Excel Research Export
+
Custom Metrics
+
Security / Audit Trail
+
Backup / Restore
```

The system must be designed so that its clinical data remains structured
enough to support reliable patient-based analytics and future research
while still allowing administrators to add new metrics without
rebuilding the application.

The visual experience should be premium and modern, but data accuracy,
patient privacy, usability, recoverability, and research-quality
structure take priority over visual effects.
