import { beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { ADMIN_SESSION } from "../test/setup";
import { setActiveSession, PermissionError } from "./session";
import { createPatient, createAdmission, createSurgicalCase } from "./patients";
import {
  createLabResult,
  getLabResultsByPatient,
  getLabResultsByCase,
  deleteLabResult,
  createAttachment,
  getAttachmentsByPatient,
  getAttachmentsByLab,
  deleteAttachment,
  COMMON_LAB_PRESETS,
  MAX_ATTACHMENT_BYTES,
} from "./laboratory";

let db: Db;
let testPatientId: string;
let testCaseId: string;

beforeEach(async () => {
  db = await openMemoryDb();
  await runMigrations(db);
  setActiveSession(ADMIN_SESSION);

  const patient = await createPatient(db, {
    firstName: "Juan",
    lastName: "Dela Cruz",
    hrn: "HRN-LAB-01",
    dateOfBirth: "1985-04-12",
    sex: "MALE",
  });
  testPatientId = patient.patient_id;

  const adm = await createAdmission(db, {
    patientId: testPatientId,
    admissionDate: "2026-10-10",
  });

  const sCase = await createSurgicalCase(db, {
    patientId: testPatientId,
    admissionId: adm.admission_id,
    caseNumber: "CASE-LAB-01",
    caseType: "ELECTIVE",
  });
  testCaseId = sCase.case_id;
});

describe("Laboratory Results & Attachments Service", () => {
  it("creates a laboratory result with normal values", async () => {
    const lab = await createLabResult(db, {
      patientId: testPatientId,
      caseId: testCaseId,
      category: "HEMATOLOGY",
      testName: "Hemoglobin (Hgb)",
      resultValue: "14.2",
      unit: "g/dL",
      referenceRange: "12.0 - 17.5 g/dL",
      flag: "NORMAL",
      performedBy: "Medical Technologist A",
      notes: "Specimen clear",
    });

    expect(lab.lab_id).toBeDefined();
    expect(lab.test_name).toBe("Hemoglobin (Hgb)");
    expect(lab.result_value).toBe("14.2");
    expect(lab.flag).toBe("NORMAL");
    expect(lab.case_number).toBe("CASE-LAB-01");

    const patientLabs = await getLabResultsByPatient(db, testPatientId);
    expect(patientLabs.length).toBe(1);
    expect(patientLabs[0].lab_id).toBe(lab.lab_id);

    const caseLabs = await getLabResultsByCase(db, testCaseId);
    expect(caseLabs.length).toBe(1);
    expect(caseLabs[0].lab_id).toBe(lab.lab_id);
  });

  it("creates a lab result with attached slip image and retrieves it", async () => {
    const fakeBase64Image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const lab = await createLabResult(db, {
      patientId: testPatientId,
      caseId: testCaseId,
      category: "CHEMISTRY",
      testName: "Serum Creatinine",
      resultValue: "2.4",
      unit: "mg/dL",
      referenceRange: "0.6 - 1.3 mg/dL",
      flag: "ABNORMAL",
      attachments: [
        {
          fileName: "creatinine_slip.png",
          fileType: "image/png",
          fileSize: 1024,
          dataUrl: fakeBase64Image,
          title: "Lab Slip Photo",
          category: "LAB_RESULT",
        },
      ],
    });

    expect(lab.flag).toBe("ABNORMAL");
    expect(lab.attachments?.length).toBe(1);
    expect(lab.attachments?.[0].file_name).toBe("creatinine_slip.png");
    expect(lab.attachments?.[0].data_url).toBe(fakeBase64Image);

    // Verify attachments retrieved by patient and by lab
    const byPatient = await getAttachmentsByPatient(db, testPatientId);
    expect(byPatient.length).toBe(1);

    const byLab = await getAttachmentsByLab(db, lab.lab_id);
    expect(byLab.length).toBe(1);
    expect(byLab[0].file_name).toBe("creatinine_slip.png");
  });

  it("supports standalone clinical file attachments (procedure photos, docs)", async () => {
    const fakeDoc = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const att = await createAttachment(db, {
      patientId: testPatientId,
      caseId: testCaseId,
      fileName: "intraop_photo.jpg",
      fileType: "image/jpeg",
      fileSize: 45000,
      dataUrl: fakeDoc,
      title: "Intra-op Surgical Site",
      description: "Pre-closure inspection",
      category: "PROCEDURE_IMAGE",
    });

    expect(att.attachment_id).toBeDefined();
    expect(att.category).toBe("PROCEDURE_IMAGE");

    const all = await getAttachmentsByPatient(db, testPatientId);
    expect(all.some((a) => a.attachment_id === att.attachment_id)).toBe(true);

    await deleteAttachment(db, att.attachment_id);
    const afterDelete = await getAttachmentsByPatient(db, testPatientId);
    expect(afterDelete.some((a) => a.attachment_id === att.attachment_id)).toBe(false);
  });

  it("deleting a lab result cascades and removes its attached files", async () => {
    const lab = await createLabResult(db, {
      patientId: testPatientId,
      category: "COAGULATION",
      testName: "Prothrombin Time",
      resultValue: "18.5",
      unit: "sec",
      flag: "CRITICAL",
      attachments: [
        {
          fileName: "pt_inr_report.pdf",
          fileType: "application/pdf",
          fileSize: 2048,
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
          category: "LAB_RESULT",
        },
      ],
    });

    const before = await getAttachmentsByLab(db, lab.lab_id);
    expect(before.length).toBe(1);

    await deleteLabResult(db, lab.lab_id);

    const afterLabs = await getLabResultsByPatient(db, testPatientId);
    expect(afterLabs.some((l) => l.lab_id === lab.lab_id)).toBe(false);

    const afterAtts = await getAttachmentsByLab(db, lab.lab_id);
    expect(afterAtts.length).toBe(0);
  });

  it("refuses attachments that are not a real PNG, JPEG or PDF of 10 MB or less", async () => {
    const base = { patientId: testPatientId, caseId: testCaseId, category: "LAB_RESULT" as const };
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")}`;
    await expect(createAttachment(db, { ...base, fileName: "x.svg", fileType: "image/svg+xml", fileSize: 40, dataUrl: svg }))
      .rejects.toThrow("PNG, JPEG or PDF");

    const html = `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script></html>").toString("base64")}`;
    await expect(createAttachment(db, { ...base, fileName: "slip.png", fileType: "image/png", fileSize: 40, dataUrl: html }))
      .rejects.toThrow("PNG, JPEG or PDF");

    const pngHead = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(pngHead);
    await expect(createAttachment(db, { ...base, fileName: "big.png", fileType: "image/png", fileSize: 1, dataUrl: `data:image/png;base64,${b64(big)}` }))
      .rejects.toThrow("larger than 10 MB");

    await expect(createLabResult(db, {
      patientId: testPatientId, category: "CHEMISTRY", testName: "BUN", resultValue: "15",
      attachments: [{ fileName: "slip.png", fileType: "image/png", fileSize: 40, dataUrl: html }],
    })).rejects.toThrow("PNG, JPEG or PDF");
    expect(await getLabResultsByPatient(db, testPatientId)).toHaveLength(0);
    expect(await getAttachmentsByPatient(db, testPatientId)).toHaveLength(0);

    const exact = new Uint8Array(MAX_ATTACHMENT_BYTES);
    exact.set(pngHead);
    const ok = await createAttachment(db, { ...base, fileName: "max.png", fileType: "image/png", fileSize: 1, dataUrl: `data:image/png;base64,${b64(exact)}` });
    expect(ok.file_size).toBe(MAX_ATTACHMENT_BYTES);
  });

  it("enforces permission checks when adding lab results", async () => {
    setActiveSession({
      userId: "usr-readonly",
      username: "reader",
      fullName: "Read Only Staff",
      roleId: "role-readonly",
      roleName: "Read Only",
      permissions: ["patients.view"],
      mustChangePassword: false,
    });

    // Can read
    const labs = await getLabResultsByPatient(db, testPatientId);
    expect(Array.isArray(labs)).toBe(true);

    // Cannot write
    await expect(
      createLabResult(db, {
        patientId: testPatientId,
        category: "CHEMISTRY",
        testName: "BUN",
        resultValue: "15",
      })
    ).rejects.toThrow(PermissionError);
  });

  it("provides common clinical lab presets with reference ranges", () => {
    expect(COMMON_LAB_PRESETS.length).toBeGreaterThanOrEqual(20);
    const hgb = COMMON_LAB_PRESETS.find((p) => p.name.includes("Hemoglobin"));
    expect(hgb).toBeDefined();
    expect(hgb?.category).toBe("HEMATOLOGY");
    expect(hgb?.unit).toBe("g/dL");
  });
});
