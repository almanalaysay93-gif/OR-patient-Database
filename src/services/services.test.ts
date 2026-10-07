import { describe, it, expect, beforeEach } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import {
  createPatient,
  createAdmission,
  createSurgicalCase,
  calculateAge,
} from "./patients";
import {
  getPreOrChecklist,
  updateChecklistItem,
} from "./preOr";
import {
  scheduleCase,
  checkSchedulingConflicts,
} from "./scheduling";
import {
  saveIntraOrRecord,
  savePostOrRecord,
  completeCase,
  getIntraOrRecord,
  getPostOrRecord,
} from "./intraPostOr";
import { getAnalyticsSummary } from "./analytics";

describe("Services & Domain Logic Suite", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openMemoryDb();
    await runMigrations(db);

    // Seed test room & specialty
    await db.execute("INSERT INTO or_rooms (or_room_id, name, active, display_order) VALUES ('room-1', 'OR 1', 1, 1)");
    await db.execute("INSERT INTO or_rooms (or_room_id, name, active, display_order) VALUES ('room-2', 'OR 2', 1, 2)");
    await db.execute("INSERT INTO specialties (specialty_id, name, active, display_order) VALUES ('spec-uro', 'Urology', 1, 1)");
    await db.execute("INSERT INTO staff (staff_id, full_name, professional_role, active, created_at, updated_at) VALUES ('staff-surg', 'Dr. Smith', 'Surgeon', 1, '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')");
    await db.execute("INSERT INTO staff (staff_id, full_name, professional_role, active, created_at, updated_at) VALUES ('staff-anes', 'Dr. Adams', 'Anesthesiologist', 1, '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')");
  });

  describe("Age Calculation", () => {
    it("calculates age accurately from DOB and surgery reference date", () => {
      expect(calculateAge("2000-05-15", "2026-05-14")).toBe(25);
      expect(calculateAge("2000-05-15", "2026-05-15")).toBe(26);
      expect(calculateAge("2000-05-15", "2026-10-07")).toBe(26);
      expect(calculateAge(null)).toBeNull();
    });
  });

  describe("Patient, Admission & Surgical Case Lifecycle", () => {
    it("creates patient with sequential research ID and prevents duplicate HRN", async () => {
      const p1 = await createPatient(db, {
        firstName: "Juan",
        lastName: "Dela Cruz",
        hrn: "HRN-1001",
        dateOfBirth: "1990-01-01",
        sex: "MALE",
      });

      expect(p1.research_id).toBe("OR-000001");
      expect(p1.calculated_age).toBe(36);

      // Duplicate HRN should throw
      await expect(
        createPatient(db, {
          firstName: "Maria",
          lastName: "Santos",
          hrn: "HRN-1001",
        })
      ).rejects.toThrow(/already exists/);

      // Second patient gets sequential research ID
      const p2 = await createPatient(db, {
        firstName: "Maria",
        lastName: "Santos",
        hrn: "HRN-1002",
        sex: "FEMALE",
      });
      expect(p2.research_id).toBe("OR-000002");
    });

    it("supports longitudinal multiple admissions and multiple cases per patient", async () => {
      const p = await createPatient(db, {
        firstName: "Patient",
        lastName: "One",
        hrn: "HRN-2001",
        dateOfBirth: "1985-06-20",
        sex: "FEMALE",
      });

      const adm1 = await createAdmission(db, {
        patientId: p.patient_id,
        admissionDate: "2026-01-10",
        ward: "Surgical Ward 3",
      });

      const case1 = await createSurgicalCase(db, {
        patientId: p.patient_id,
        admissionId: adm1.admission_id,
        caseType: "ELECTIVE",
        specialtyId: "spec-uro",
        plannedProcedureSummary: "Left Nephrectomy",
      });

      const case2 = await createSurgicalCase(db, {
        patientId: p.patient_id,
        admissionId: adm1.admission_id,
        caseType: "ELECTIVE",
        specialtyId: "spec-uro",
        plannedProcedureSummary: "Stent Removal",
      });

      expect(case1.case_id).not.toBe(case2.case_id);
      expect(case1.patient_id).toBe(p.patient_id);
      expect(case2.patient_id).toBe(p.patient_id);
    });
  });

  describe("Pre-OR Readiness Calculation", () => {
    it("does not penalize readiness percentage for NOT_APPLICABLE items", async () => {
      const p = await createPatient(db, { firstName: "Test", lastName: "Patient" });
      const adm = await createAdmission(db, { patientId: p.patient_id, admissionDate: "2026-10-07" });
      const c = await createSurgicalCase(db, { patientId: p.patient_id, admissionId: adm.admission_id });

      const { items } = await getPreOrChecklist(db, c.case_id);
      expect(items.length).toBeGreaterThanOrEqual(9);

      // Mark first item NOT_APPLICABLE
      await updateChecklistItem(db, {
        caseId: c.case_id,
        checklistItemId: items[0].checklist_item_id,
        status: "NOT_APPLICABLE",
      });

      // Mark second item COMPLETE
      const readiness = await updateChecklistItem(db, {
        caseId: c.case_id,
        checklistItemId: items[1].checklist_item_id,
        status: "COMPLETE",
      });

      // 1 item complete out of (total - 1) applicable
      const applicableCount = items.length - 1;
      const expectedPct = Math.round((1 / applicableCount) * 100);
      expect(readiness.applicableItems).toBe(applicableCount);
      expect(readiness.completedItems).toBe(1);
      expect(readiness.readinessPercentage).toBe(expectedPct);
      expect(readiness.isReady).toBe(false);
    });
  });

  describe("OR Scheduling & Conflict Detection", () => {
    it("detects room overlap conflicts correctly", async () => {
      const p1 = await createPatient(db, { firstName: "A", lastName: "One" });
      const p2 = await createPatient(db, { firstName: "B", lastName: "Two" });
      const adm1 = await createAdmission(db, { patientId: p1.patient_id, admissionDate: "2026-10-07" });
      const adm2 = await createAdmission(db, { patientId: p2.patient_id, admissionDate: "2026-10-07" });
      const c1 = await createSurgicalCase(db, { patientId: p1.patient_id, admissionId: adm1.admission_id });
      const c2 = await createSurgicalCase(db, { patientId: p2.patient_id, admissionId: adm2.admission_id });

      // Schedule Case 1: 08:00 to 10:00 (120 mins) in Room 1
      const res1 = await scheduleCase(db, {
        caseId: c1.case_id,
        roomId: "room-1",
        date: "2026-10-08",
        startTime: "08:00",
        estimatedDurationMinutes: 120,
      });
      expect(res1.conflicts.length).toBe(0);

      // Attempt Case 2 in same Room 1 at 09:00 (overlapping!)
      const conflicts = await checkSchedulingConflicts(db, {
        caseId: c2.case_id,
        roomId: "room-1",
        date: "2026-10-08",
        startTime: "09:00",
        durationMinutes: 60,
      });

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe("ROOM_OVERLAP");

      // Non-overlapping at 10:30 in same room has 0 conflicts
      const nonOverlap = await checkSchedulingConflicts(db, {
        caseId: c2.case_id,
        roomId: "room-1",
        date: "2026-10-08",
        startTime: "10:30",
        durationMinutes: 60,
      });
      expect(nonOverlap.length).toBe(0);
    });
  });

  describe("Intra-OR, Post-OR & Analytics", () => {
    it("tracks clinical workflow and calculates patient vs case analytics correctly", async () => {
      const p1 = await createPatient(db, {
        firstName: "Carlos",
        lastName: "Vega",
        dateOfBirth: "1980-05-10",
        sex: "MALE",
      });
      const adm1 = await createAdmission(db, { patientId: p1.patient_id, admissionDate: "2026-10-07" });
      const c1 = await createSurgicalCase(db, {
        patientId: p1.patient_id,
        admissionId: adm1.admission_id,
        caseType: "ELECTIVE",
        plannedProcedureSummary: "Laparoscopic Cholecystectomy",
      });

      await saveIntraOrRecord(db, {
        caseId: c1.case_id,
        asaClassification: "II",
        estimatedBloodLossMl: 150,
        specimenCollected: true,
      });

      const intra = await getIntraOrRecord(db, c1.case_id);
      expect(intra?.asa_classification).toBe("II");
      expect(intra?.estimated_blood_loss_ml).toBe(150);

      await savePostOrRecord(db, {
        caseId: c1.case_id,
        painScore: 3,
        icuRequired: false,
      });

      const post = await getPostOrRecord(db, c1.case_id);
      expect(post?.pain_score).toBe(3);

      await completeCase(db, c1.case_id);

      const summary = await getAnalyticsSummary(db);
      expect(summary.uniquePatients).toBe(1);
      expect(summary.totalCases).toBe(1);
      expect(summary.completedCases).toBe(1);
      expect(summary.sexDistribution.male).toBe(1);
      expect(summary.sexDistribution.female).toBe(0);
      expect(summary.ageStats.mean).toBe(46);
    });
  });
});
