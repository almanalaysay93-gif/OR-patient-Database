import { describe, it, expect, beforeEach } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { createPatient, updatePatient, createAdmission, createSurgicalCase } from "./patients";
import { listPatientAllergies, createPatientAllergy, deletePatientAllergy } from "./allergies";
import { listCaseImplants, addCaseImplant, deleteCaseImplant } from "./implants";
import { scheduleCase } from "./scheduling";
import { saveCaseEvent } from "./caseEvents";
import { setActiveSession } from "./session";
import { ADMIN_SESSION } from "../test/setup";

describe("Clinical Fixes & Features Suite", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openMemoryDb();
    await runMigrations(db);
    setActiveSession(ADMIN_SESSION);

    await db.execute("INSERT INTO or_rooms (or_room_id, name, active, display_order) VALUES ('room-1', 'OR 1', 1, 1)");
    await db.execute("INSERT INTO specialties (specialty_id, name, active, display_order) VALUES ('spec-uro', 'Urology', 1, 1)");
  });

  describe("Patient Demographics & Emergency Contacts", () => {
    it("creates and updates patient with emergency contacts and blood type", async () => {
      const p = await createPatient(db, {
        firstName: "Maria",
        lastName: "Santos",
        hrn: "HRN-EMER-01",
        dateOfBirth: "1988-04-12",
        sex: "FEMALE",
        bloodType: "O+",
        address: "742 Evergreen Terrace",
        emergencyContactName: "Juan Santos",
        emergencyContactPhone: "+63 917 555 1234",
        emergencyContactRelationship: "Spouse",
      });

      expect(p.blood_type).toBe("O+");
      expect(p.address).toBe("742 Evergreen Terrace");
      expect(p.emergency_contact_name).toBe("Juan Santos");
      expect(p.emergency_contact_phone).toBe("+63 917 555 1234");
      expect(p.emergency_contact_relationship).toBe("Spouse");

      // Update emergency contact
      const updated = await updatePatient(db, p.patient_id, {
        firstName: "Maria",
        lastName: "Santos",
        bloodType: "O+",
        emergencyContactName: "Carlos Santos",
        emergencyContactPhone: "+63 917 555 9999",
        emergencyContactRelationship: "Brother",
      });

      expect(updated.emergency_contact_name).toBe("Carlos Santos");
      expect(updated.emergency_contact_phone).toBe("+63 917 555 9999");
      expect(updated.emergency_contact_relationship).toBe("Brother");
    });
  });

  describe("Structured Allergies", () => {
    it("records, lists and deletes patient allergies with severity classification", async () => {
      const p = await createPatient(db, {
        firstName: "Test",
        lastName: "Allergy",
        dateOfBirth: "1995-02-10",
      });

      const a1 = await createPatientAllergy(db, {
        patientId: p.patient_id,
        allergen: "Penicillin",
        reaction: "Anaphylaxis",
        severity: "LIFE_THREATENING",
        notes: "Prior ER admission 2024",
      });

      expect(a1.allergen).toBe("Penicillin");
      expect(a1.severity).toBe("LIFE_THREATENING");
      expect(a1.reaction).toBe("Anaphylaxis");

      const a2 = await createPatientAllergy(db, {
        patientId: p.patient_id,
        allergen: "Latex",
        reaction: "Contact dermatitis",
        severity: "MODERATE",
      });

      const list = await listPatientAllergies(db, p.patient_id);
      expect(list.length).toBe(2);

      await deletePatientAllergy(db, a1.allergy_id);
      const remaining = await listPatientAllergies(db, p.patient_id);
      expect(remaining.length).toBe(1);
      expect(remaining[0].allergen).toBe("Latex");
    });
  });

  describe("Surgical Implants & Prosthetics", () => {
    it("logs implants with UDI tracking and synchronizes intra_or_records.implant_used", async () => {
      const p = await createPatient(db, { firstName: "Device", lastName: "Patient" });
      const adm = await createAdmission(db, { patientId: p.patient_id, admissionDate: "2026-10-14" });
      const c = await createSurgicalCase(db, {
        patientId: p.patient_id,
        admissionId: adm.admission_id,
        caseType: "ELECTIVE",
        plannedProcedureSummary: "ORIF Right Radius",
      });

      // Add implant
      const imp = await addCaseImplant(db, {
        caseId: c.case_id,
        deviceName: "Titanium Volar Plate 2.4",
        manufacturer: "Synthes",
        modelNumber: "02.111.520",
        lotNumber: "LOT-99882",
        serialNumber: "SN-1029",
        udiBarcode: "(01)00887766554433",
        expiryDate: "2030-12-31",
        anatomicalSite: "Distal right radius",
      });

      expect(imp.device_name).toBe("Titanium Volar Plate 2.4");
      expect(imp.udi_barcode).toBe("(01)00887766554433");

      const implants = await listCaseImplants(db, c.case_id);
      expect(implants.length).toBe(1);

      // Verify intra_or_records implant_used flag was synchronized
      const intra = await db.select<{ implant_used: number }>(
        "SELECT implant_used FROM intra_or_records WHERE case_id = ?",
        [c.case_id]
      );
      expect(intra[0]?.implant_used).toBe(1);

      // Delete implant
      await deleteCaseImplant(db, imp.implant_id);
      const afterDel = await listCaseImplants(db, c.case_id);
      expect(afterDel.length).toBe(0);

      const intraAfter = await db.select<{ implant_used: number }>(
        "SELECT implant_used FROM intra_or_records WHERE case_id = ?",
        [c.case_id]
      );
      expect(intraAfter[0]?.implant_used).toBe(0);
    });
  });

  describe("Case Events Clock Synchronization with or_schedule", () => {
    it("synchronizes room_in, incision, closure and room_out timestamps to or_schedule", async () => {
      const p = await createPatient(db, { firstName: "Sync", lastName: "Patient" });
      const adm = await createAdmission(db, { patientId: p.patient_id, admissionDate: "2026-10-14" });
      const c = await createSurgicalCase(db, {
        patientId: p.patient_id,
        admissionId: adm.admission_id,
        caseType: "ELECTIVE",
        plannedProcedureSummary: "Laparoscopic Cholecystectomy",
      });

      await scheduleCase(db, {
        caseId: c.case_id,
        roomId: "room-1",
        date: "2026-10-14",
        startTime: "08:00",
        estimatedDurationMinutes: 120,
      });

      const tRoomIn = "2026-10-14T08:05:00.000Z";
      const tIncision = "2026-10-14T08:30:00.000Z";
      const tClosure = "2026-10-14T09:45:00.000Z";
      const tRoomOut = "2026-10-14T10:00:00.000Z";

      await saveCaseEvent(db, { caseId: c.case_id, eventType: "ROOM_IN", occurredAt: tRoomIn });
      await saveCaseEvent(db, { caseId: c.case_id, eventType: "INCISION", occurredAt: tIncision });
      await saveCaseEvent(db, { caseId: c.case_id, eventType: "CLOSURE", occurredAt: tClosure });
      await saveCaseEvent(db, { caseId: c.case_id, eventType: "ROOM_OUT", occurredAt: tRoomOut });

      const schedRows = await db.select<{
        actual_room_in: string | null;
        actual_procedure_start: string | null;
        actual_procedure_end: string | null;
        actual_room_out: string | null;
      }>("SELECT actual_room_in, actual_procedure_start, actual_procedure_end, actual_room_out FROM or_schedule WHERE case_id = ?", [c.case_id]);

      expect(schedRows[0].actual_room_in).toBe(tRoomIn);
      expect(schedRows[0].actual_procedure_start).toBe(tIncision);
      expect(schedRows[0].actual_procedure_end).toBe(tClosure);
      expect(schedRows[0].actual_room_out).toBe(tRoomOut);
    });
  });
});
