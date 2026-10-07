# Clinical Automation & Imaging Architecture Design

**Date:** 2026-10-07  
**Project:** Operating Room Patient Management & Research System  
**Path:** `E:\ai\claude\ALAi\or-patient-management`  
**Status:** Approved  

---

## 1. Executive Summary

This document specifies the technical design for four integrated automation and clinical media subsystems:
1. **Real-time OR Room Turnover & Milestone Automation**: One-tap milestone timestamps (`Wheels In`, `Incision`, `Closure`, `Wheels Out`, `PACU Arrival`), automatic turnover calculations between consecutive room procedures, and automated delay detection via a 60-second wall-clock ticker.
2. **Intelligent Pre-OR Readiness Engine**: Automated case status advancement from `PRE_OR` to `READY` upon complete verification of mandatory checklist milestones, plus hard blocking warnings for critical safety checklist failures (`Consent`, `Surgical Site Mark`, `NPO`).
3. **Clinical Image Attachment Engine**: Local-first image upload and visual gallery for patient profile identification and surgical procedure documentation (`Site Marking`, `Intra-Op Field`, `Pathology Specimen`, `Wound Closure`).
4. **Safe Harbor Research Exporter**: Automated de-identification pipeline producing dual CSV and structured JSON datasets complying with Safe Harbor HIPAA standards for statistical analysis.

---

## 2. Architecture & Data Flow

```
[ User Interaction ]        [ 60s Wall-Clock Ticker ]
        │                               │
        ▼                               ▼
┌──────────────────┐            ┌───────────────────┐
│ Readiness Engine │            │ Live Delay Guard  │
│ (Pre-OR Auto-    │            │ (Schedules vs.    │
│  Status Advance) │            │  Actual Room In)  │
└────────┬─────────┘            └─────────┬─────────┘
         │                                │
         ▼                                ▼
┌───────────────────────────────────────────────────┐
│              SQLite Domain Database               │
│ (Cases, Schedules, Milestones, Attachments, WAL)  │
└────────┬──────────────────────────────────┬───────┘
         │                                  │
         ▼                                  ▼
┌───────────────────────┐          ┌───────────────────────┐
│ Image Attachment      │          │ Safe Harbor Research  │
│ Storage Engine        │          │ Exporter (CSV/JSON)   │
└───────────────────────┘          └───────────────────────┘
```

---

## 3. Database Schema (Migration 004)

### 3.1 Migration `004_attachments_and_automation.ts`

```sql
-- Milestone timestamps table
CREATE TABLE IF NOT EXISTS case_milestones (
  milestone_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  wheels_in TEXT,
  anesthesia_start TEXT,
  incision TEXT,
  closure TEXT,
  wheels_out TEXT,
  pacu_in TEXT,
  pacu_out TEXT,
  turnover_minutes INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_milestones_case ON case_milestones(case_id);

-- Clinical attachments table
CREATE TABLE IF NOT EXISTS case_attachments (
  attachment_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  case_id TEXT REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('PATIENT_ID', 'SITE_MARKING', 'INTRA_OP_FIELD', 'SPECIMEN', 'WOUND_CLOSURE', 'RADIOLOGY', 'OTHER')),
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT,
  data_blob TEXT, -- Base64 fallback for browser preview
  file_size_bytes INTEGER NOT NULL,
  contains_phi INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_case ON case_attachments(case_id);
CREATE INDEX IF NOT EXISTS idx_attachments_patient ON case_attachments(patient_id);
CREATE INDEX IF NOT EXISTS idx_attachments_category ON case_attachments(category);
```

---

## 4. Subsystem Specifications

### 4.1 Real-Time Milestone & Room Turnover Automation
- **File:** `src/services/milestoneService.ts`
- **Milestones:** `Wheels In`, `Incision`, `Closure`, `Wheels Out`, `PACU Arrival`.
- **Chronology Guard:** Enforces logical timestamps (`Incision` >= `Wheels In`; `Closure` >= `Incision`; `Wheels Out` >= `Closure`).
- **Turnover Engine:** When `Wheels In` is logged for a case, queries the preceding case in the same room on the same date with a completed `Wheels Out`. Computes `turnover_minutes = (WheelsIn - PrevWheelsOut) / 60000`.
- **60-Second Delay Ticker:** Runs lightweight client ticker. If `CurrentTime > ScheduledStart + 15 min` and `Wheels In` is null, emits a non-blocking delay event with quick reason picker.

### 4.2 Intelligent Pre-OR Readiness Engine
- **File:** `src/services/readinessEngine.ts`
- **Auto-Advance:** When checklist item status changes, re-evaluates required items (`required_by_default = 1` and `status != 'NOT_APPLICABLE'`). If completion reaches 100%, automatically updates `surgical_cases.status` from `PRE_OR` to `READY` and logs immutable audit trail.
- **Safety Blocker:** If any critical check (`Consent`, `Surgical Site Mark`, `NPO`) is set to `FAILED`, status drops to `NOT_READY` with visual alert banner.

### 4.3 Clinical Image Attachment Engine
- **File:** `src/services/attachmentService.ts`
- **Intake:** Drag-and-drop or file selector supporting JPEG, PNG, and WebP.
- **Processing:** Client-side canvas resize to max 1920x1080 WebP, 85% quality, enforcing max 10MB input limit.
- **Storage:**
  - Desktop (Tauri): Writes to AppData `attachments/` folder with UUID filename; stores path in SQLite.
  - Browser preview: Stores compressed base64 / blob in `data_blob` column with IndexedDB persistence.
- **Privacy Flag:** Categorizes `PATIENT_ID` and consent scans with `contains_phi = 1`.

### 4.4 Safe Harbor Research Exporter
- **File:** `src/services/researchExportService.ts`
- **Sanitization:** Removes all 18 direct HIPAA identifiers (names, HRNs, contact info).
- **Date Normalization:** Converts surgical dates to relative study timeline (`study_day = 0`, duration offsets in minutes).
- **Format:** Outputs dual clean CSV and structured JSON files with one-click download in Analytics.
- **Image Policy:** Excludes `contains_phi = 1` images. De-identified operative and pathology specimen captures exportable by toggle.

---

## 5. UI Integration Map

1. **`PatientsView.tsx`**: Patient photo avatar with upload trigger; "Clinical Media" gallery tab for longitudinal image inspection.
2. **`PreOrView.tsx`**: Site marking photo upload button on checklist; blocking banner for critical checklist failures.
3. **`ScheduleView.tsx`**: Room turnover duration display; delay warning chip for cases lagging >15 minutes.
4. **`IntraOrView.tsx`**: 1-tap milestone progress strip; specimen and operative screenshot dropzone.
5. **`PostOrView.tsx`**: PACU arrival button; wound closure photo dropzone.
6. **`AnalyticsView.tsx`**: "Export Research Cohort (Safe Harbor)" modal for date range selection, CSV and JSON generation.

---

## 6. Testing Strategy

1. `milestones.test.ts`: Asserts chronological milestone saving, sequence validation, and turnover duration calculation.
2. `readinessEngine.test.ts`: Asserts automated transition from `PRE_OR` to `READY` and safety blocker flags.
3. `attachments.test.ts`: Asserts image compression, metadata persistence, category queries, and PHI flag assignment.
4. `researchExport.test.ts`: Sabotages test dataset with mock PHI and verifies Safe Harbor exporter completely scrubs names, HRNs, and relative date offsets.
