import type { Db } from "../data/db";
import { requirePermission } from "./session";
import { createAdmission, createPatient, createSurgicalCase } from "./patients";
import {
  addOrRoom, addSpecialty, createDiagnosis, createProcedure, getAnesthesiaTypes, getComplicationTypes,
  getDelayReasons, getDiagnoses, getOrRooms, getPostOpDestinations, getProcedures, getSpecialties,
} from "./masterData";
import { getPreOrChecklist, updateChecklistItem } from "./preOr";
import { savePreopBaseline } from "./preopBaseline";
import { scheduleCase, updateActualTimes } from "./scheduling";
import { getSafetyItems, saveSafetyResponse } from "./safetyPhases";
import { saveCaseEvent, type CaseEventType } from "./caseEvents";
import { addComplication, completeCase, saveIntraOrRecord, savePostOrRecord } from "./intraPostOr";
import { getCaseCoding, saveCaseCoding } from "./caseCoding";
import { addPostoperativeOutcome, ensureFollowup, saveFollowupAssessment } from "./followup";
import { cancelCase, postponeCase } from "./caseStage";
import { archivePatient } from "./patientArchive";

/** Simulated patients are marked with this HRN prefix so they are easy to spot. */
export const DEMO_HRN_PREFIX = "DEMO-";

/** How the simulated patients are spread across the workflow. Adds up to 100. */
export const DEMO_PLAN = {
  PRE_OR: 10,
  NOT_READY: 10,
  READY: 10,
  SCHEDULED: 17,
  IN_OR: 4,
  PACU: 6,
  COMPLETED: 28,
  CANCELLED: 6,
  POSTPONED: 6,
  ARCHIVED: 3,
} as const;

export type DemoStage = keyof typeof DEMO_PLAN;
export type DemoSummary = Record<DemoStage, number> & { total: number };

const FIRST_NAMES = [
  "Amara", "Benito", "Corazon", "Dario", "Elena", "Felipe", "Gloria", "Hector", "Imelda", "Julio",
  "Karina", "Lorenzo", "Marisol", "Nestor", "Ofelia", "Pablo", "Queenie", "Ramon", "Soledad", "Tomas",
];
const LAST_NAMES = [
  "Testcase", "Sample", "Mockwell", "Simulado", "Placeholder", "Demoson", "Fictiva", "Example", "Trialman", "Dryrun",
];
const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const PHYSICIANS = ["Dr. Demo Alvarez", "Dr. Demo Bautista", "Dr. Demo Cruz", "Dr. Demo Dizon"];
/**
 * Each demo procedure carries the clinical facts that have to agree with it: the specialty that
 * performs it, the ward, the usual anesthesia, a plausible age range, and a plausible complication.
 */
interface DemoProcedure {
  name: string;
  diagnosis: string;
  specialty: string;
  ward: string;
  anesthesia: string;
  ages: [number, number];
  specimen: boolean;
  dayCase: boolean;
  complication: string;
}
export const DEMO_PROCEDURES: DemoProcedure[] = [
  { name: "Laparoscopic cholecystectomy", diagnosis: "Symptomatic cholelithiasis", specialty: "General Surgery",
    ward: "Surgical Ward A", anesthesia: "General", ages: [25, 70], specimen: true, dayCase: true,
    complication: "Surgical site infection" },
  { name: "Open appendectomy", diagnosis: "Acute appendicitis", specialty: "General Surgery",
    ward: "Surgical Ward A", anesthesia: "General", ages: [18, 50], specimen: true, dayCase: false,
    complication: "Surgical site infection" },
  { name: "Inguinal hernia repair", diagnosis: "Inguinal hernia", specialty: "General Surgery",
    ward: "Surgical Ward B", anesthesia: "Spinal", ages: [20, 75], specimen: false, dayCase: true,
    complication: "Hematoma" },
  { name: "Total knee arthroplasty", diagnosis: "Osteoarthritis of the knee", specialty: "Orthopedics",
    ward: "Orthopedic Ward", anesthesia: "Spinal", ages: [55, 80], specimen: false, dayCase: false,
    complication: "Deep vein thrombosis" },
  { name: "Cesarean section", diagnosis: "Cephalopelvic disproportion", specialty: "OB-GYN",
    ward: "OB Ward", anesthesia: "Spinal", ages: [20, 40], specimen: false, dayCase: false,
    complication: "Post-operative bleeding" },
  { name: "Transurethral resection of prostate", diagnosis: "Benign prostatic hyperplasia", specialty: "Urology",
    ward: "Surgical Ward B", anesthesia: "Spinal", ages: [55, 85], specimen: true, dayCase: false,
    complication: "Urinary retention" },
  { name: "Open reduction internal fixation, femur", diagnosis: "Closed femoral shaft fracture", specialty: "Orthopedics",
    ward: "Orthopedic Ward", anesthesia: "Spinal", ages: [18, 80], specimen: false, dayCase: false,
    complication: "Deep vein thrombosis" },
  { name: "Total thyroidectomy", diagnosis: "Multinodular goiter", specialty: "General Surgery",
    ward: "Surgical Ward A", anesthesia: "General", ages: [25, 65], specimen: true, dayCase: false,
    complication: "Hematoma" },
];
const PROCEDURES = DEMO_PROCEDURES;
const SLOT_STARTS = ["07:00", "09:15", "11:30", "13:45", "16:00"];
const SLOT_MINUTES = 120;
const ASA = ["I", "II", "III", "II", "I", "IV"];

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date + clock time (plus minutes) as an ISO timestamp with a time zone. */
function stamp(date: string, time: string, plusMinutes = 0): string {
  return new Date(new Date(`${date}T${time}:00`).getTime() + plusMinutes * 60000).toISOString();
}

function stageList(): DemoStage[] {
  const stages: DemoStage[] = [];
  for (const stage of Object.keys(DEMO_PLAN) as DemoStage[]) {
    for (let i = 0; i < DEMO_PLAN[stage]; i++) stages.push(stage);
  }
  return stages;
}

export async function countDemoPatients(db: Db): Promise<number> {
  const rows = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM patients WHERE hrn LIKE ?", [`${DEMO_HRN_PREFIX}%`]);
  return rows[0]?.n ?? 0;
}

/**
 * Removes every simulated patient and the records that hang off them. Shared master data (rooms,
 * specialties, procedures, diagnoses) and the audit trail stay: the audit log is append-only.
 * Returns how many patients were removed.
 */
export async function clearDemoData(db: Db): Promise<number> {
  requirePermission("users.manage");
  if (db.kind !== "sqljs") throw new Error("Demo patients can only be cleared in the browser preview.");
  const count = await countDemoPatients(db);
  if (!count) return 0;

  // Subqueries keep the statements free of bound parameters, so the list length does not matter.
  const patients = `(SELECT patient_id FROM patients WHERE hrn LIKE '${DEMO_HRN_PREFIX}%')`;
  const admissions = `(SELECT admission_id FROM admissions WHERE patient_id IN ${patients})`;
  const cases = `(SELECT case_id FROM surgical_cases WHERE patient_id IN ${patients})`;
  // Children first, so no foreign key is left pointing at a removed row.
  const statements = [
    `DELETE FROM postoperative_outcomes WHERE case_id IN ${cases}`,
    `DELETE FROM case_followup_assessments WHERE case_id IN ${cases}`,
    `DELETE FROM safety_responses WHERE case_id IN ${cases}`,
    `DELETE FROM case_safety_templates WHERE case_id IN ${cases}`,
    `DELETE FROM case_preop_baseline WHERE case_id IN ${cases}`,
    `DELETE FROM case_events WHERE case_id IN ${cases}`,
    `DELETE FROM pre_or_checklist_values WHERE case_id IN ${cases}`,
    `DELETE FROM pre_or_assessments WHERE case_id IN ${cases}`,
    `DELETE FROM or_schedule WHERE case_id IN ${cases}`,
    `DELETE FROM intra_or_records WHERE case_id IN ${cases}`,
    `DELETE FROM post_or_records WHERE case_id IN ${cases}`,
    `DELETE FROM complications WHERE case_id IN ${cases}`,
    `DELETE FROM case_procedures WHERE case_id IN ${cases}`,
    `DELETE FROM case_diagnoses WHERE case_id IN ${cases}`,
    `DELETE FROM case_team WHERE case_id IN ${cases}`,
    `DELETE FROM custom_field_values WHERE patient_id IN ${patients} OR admission_id IN ${admissions} OR case_id IN ${cases}`,
    `DELETE FROM laboratory_results WHERE patient_id IN ${patients} OR admission_id IN ${admissions} OR case_id IN ${cases}`,
    `DELETE FROM patient_lab_results WHERE patient_id IN ${patients} OR case_id IN ${cases}`,
    `DELETE FROM clinical_attachments WHERE patient_id IN ${patients} OR case_id IN ${cases}`,
    `DELETE FROM surgical_cases WHERE patient_id IN ${patients}`,
    `DELETE FROM admissions WHERE patient_id IN ${patients}`,
    `DELETE FROM patients WHERE patient_id IN ${patients}`,
  ];
  await db.transaction(async (tx) => {
    for (const sql of statements) await tx.execute(sql);
  });
  return count;
}

/**
 * Fills the browser preview database with 100 simulated patients spread across every stage.
 * Everything goes through the normal services, so audit entries and status rules match real use.
 * Refused on the desktop database: simulated patients must never mix with real records.
 */
export async function seedDemoData(db: Db, onProgress?: (done: number, total: number) => void): Promise<DemoSummary> {
  requirePermission("users.manage");
  if (db.kind !== "sqljs") throw new Error("Demo patients can only be loaded in the browser preview.");
  if (await countDemoPatients(db)) throw new Error("Demo patients are already loaded.");

  // Master data the screens need.
  let rooms = await getOrRooms(db);
  for (let n = rooms.length + 1; rooms.length < 4; n++) {
    await addOrRoom(db, `Demo OR ${n}`);
    rooms = await getOrRooms(db);
  }
  // Every specialty a demo procedure belongs to, looked up by name so a case never gets an unrelated one.
  const specialtyIds = new Map<string, string>();
  const knownSpecialties = await getSpecialties(db, false);
  for (const name of new Set(PROCEDURES.map((p) => p.specialty))) {
    const existing = knownSpecialties.find((s) => s.name.toLowerCase() === name.toLowerCase());
    specialtyIds.set(name, existing?.specialty_id ?? await addSpecialty(db, name));
  }
  const knownProcedures = await getProcedures(db);
  const knownDiagnoses = await getDiagnoses(db);
  const coding: { procedureId: string; diagnosisId: string }[] = [];
  for (const p of PROCEDURES) {
    const procedure = knownProcedures.find((x) => x.procedure_name === p.name)
      ?? await createProcedure(db, { name: p.name, specialtyId: specialtyIds.get(p.specialty) });
    const diagnosis = knownDiagnoses.find((x) => x.diagnosis_name === p.diagnosis)
      ?? await createDiagnosis(db, { name: p.diagnosis });
    coding.push({ procedureId: procedure.procedure_id, diagnosisId: diagnosis.diagnosis_id });
  }
  const anesthesia = await getAnesthesiaTypes(db);
  const destinations = await getPostOpDestinations(db);
  const complicationTypes = await getComplicationTypes(db);
  const delayReasons = await getDelayReasons(db);
  const byName = <T extends { name: string }>(rows: T[], name: string) => rows.find((r) => r.name === name);
  const thisYear = new Date().getFullYear();

  // One free OR slot per call; days never overlap between rooms.
  const used = new Map<string, number>();
  const nextSlot = (date: string) => {
    const n = used.get(date) ?? 0;
    if (n >= rooms.length * SLOT_STARTS.length) throw new Error(`No free demo OR slot on ${date}.`);
    used.set(date, n + 1);
    return { date, roomId: rooms[n % rooms.length].or_room_id, start: SLOT_STARTS[Math.floor(n / rooms.length)] };
  };

  const today = dayOffset(0);
  const stages = stageList();
  const summary = { total: 0 } as DemoSummary;
  for (const stage of Object.keys(DEMO_PLAN) as DemoStage[]) summary[stage] = 0;
  const seen: Partial<Record<DemoStage, number>> = {};

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const k = seen[stage] = (seen[stage] ?? -1) + 1; // index inside the stage
    const proc = PROCEDURES[i % PROCEDURES.length];
    const done = stage === "COMPLETED" || stage === "ARCHIVED";
    const surgeryDate = done ? dayOffset(-(2 + k * 3))
      : stage === "IN_OR" || stage === "PACU" ? today
      : stage === "SCHEDULED" ? dayOffset(k < 6 ? 0 : 1 + (k % 3))
      : dayOffset(4 + (k % 2));
    const admissionDate = done ? dayOffset(-(3 + k * 3)) : dayOffset(-(i % 3));

    const sex = proc.name === "Cesarean section" ? "FEMALE"
      : proc.name.includes("prostate") ? "MALE" : i % 2 ? "MALE" : "FEMALE";
    const patient = await createPatient(db, {
      hrn: `${DEMO_HRN_PREFIX}${pad(i + 1, 4)}`,
      firstName: FIRST_NAMES[i % FIRST_NAMES.length],
      lastName: `${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]}-${pad(i + 1, 3)}`,
      dateOfBirth: `${thisYear - 1 - proc.ages[0] - ((i * 7) % (proc.ages[1] - proc.ages[0] + 1))}-${pad(1 + (i % 12))}-${pad(1 + ((i * 3) % 28))}`,
      sex,
      address: `${100 + i} Sample Street, Demo City`,
      contactNumber: `0900-000-${pad(i + 1, 4)}`,
      bloodType: BLOOD_TYPES[i % BLOOD_TYPES.length],
    });
    const admission = await createAdmission(db, {
      patientId: patient.patient_id,
      admissionDate,
      ward: i % 10 === 9 ? "Private Wing" : proc.ward,
      room: `${200 + (i % 40)}`,
      bed: i % 2 ? "B" : "A",
      attendingPhysician: PHYSICIANS[i % PHYSICIANS.length],
      admissionDiagnosisText: proc.diagnosis,
    });
    const surgicalCase = await createSurgicalCase(db, {
      patientId: patient.patient_id,
      admissionId: admission.admission_id,
      caseType: i % 9 === 0 ? "EMERGENCY" : i % 5 === 0 ? "URGENT" : "ELECTIVE",
      specialtyId: specialtyIds.get(proc.specialty),
      laterality: proc.name.includes("knee") || proc.name.includes("femur") ? (i % 2 ? "LEFT" : "RIGHT") : undefined,
      plannedProcedureSummary: proc.name,
      preoperativeDiagnosisSummary: proc.diagnosis,
    });
    const caseId = surgicalCase.case_id;

    // Pre-op: every stage except a brand-new case has a baseline and checklist work.
    if (stage !== "PRE_OR") {
      await savePreopBaseline(db, {
        caseId,
        height_cm: 150 + (i % 35),
        weight_kg: 48 + (i % 50),
        measured_at: admissionDate,
        asa_classification: ASA[i % ASA.length],
        tobacco_status: (["NEVER", "FORMER", "CURRENT", "UNKNOWN"] as const)[i % 4],
        functional_status: i % 11 === 0 ? "PARTIALLY_DEPENDENT" : "INDEPENDENT",
        notes: "Simulated baseline.",
      });
      const { items } = await getPreOrChecklist(db, caseId);
      for (let n = 0; n < items.length; n++) {
        const unfinished = stage === "NOT_READY" && n >= items.length - 2;
        if (unfinished && n === items.length - 1) continue; // left pending
        await updateChecklistItem(db, {
          caseId,
          checklistItemId: items[n].checklist_item_id,
          status: unfinished ? "FAILED" : "COMPLETE",
          notes: unfinished ? "Simulated: result still awaited." : null,
        });
      }
    }

    // Booking. Some cancelled and postponed cases never had a slot.
    const booked = ["SCHEDULED", "IN_OR", "PACU", "COMPLETED", "ARCHIVED"].includes(stage)
      || ((stage === "CANCELLED" || stage === "POSTPONED") && k % 2 === 0);
    let slot: ReturnType<typeof nextSlot> | null = null;
    let scheduleId = "";
    if (booked) {
      slot = nextSlot(surgeryDate);
      const result = await scheduleCase(db, {
        caseId, roomId: slot.roomId, date: slot.date, startTime: slot.start,
        estimatedDurationMinutes: SLOT_MINUTES, notes: "Simulated booking.",
      });
      if (!result.scheduleId) throw new Error(`Demo booking conflict: ${result.conflicts[0]?.type ?? slot.date}`);
      scheduleId = result.scheduleId;
    }

    // Intra-op.
    const inTheatre = stage === "IN_OR" || stage === "PACU" || done;
    const leftTheatre = stage === "PACU" || done;
    if (inTheatre && slot) {
      const events: [CaseEventType, number][] = [["ROOM_IN", 0], ["ANESTHESIA_START", 10], ["INCISION", 25]];
      if (leftTheatre) events.push(["CLOSURE", 95], ["ROOM_OUT", 110], ["PACU_IN", 115]);
      if (done) events.push(["PACU_OUT", 175]);
      for (const [eventType, minutes] of events) {
        await saveCaseEvent(db, { caseId, eventType, occurredAt: stamp(slot.date, slot.start, minutes) });
      }
      const safety = await getSafetyItems(db, caseId);
      for (const item of safety) {
        if (!leftTheatre && item.phase === "SIGN_OUT") continue;
        await saveSafetyResponse(db, { caseId, itemId: item.item_id, status: "COMPLETE" });
      }
      const transfused = i % 13 === 0;
      await saveIntraOrRecord(db, {
        caseId,
        anesthesiaTypeId: (byName(anesthesia, proc.anesthesia) ?? anesthesia[0])?.id ?? null,
        asaClassification: ASA[i % ASA.length],
        estimatedBloodLossMl: leftTheatre ? 50 + (i % 9) * 60 : null,
        bloodTransfusion: transfused,
        unitsTransfused: transfused ? 1 + (i % 2) : null,
        specimenCollected: proc.specimen,
        implantUsed: proc.name.includes("arthroplasty") || proc.name.includes("fixation"),
        operativeFindings: leftTheatre ? `Simulated findings consistent with ${proc.diagnosis.toLowerCase()}.` : null,
        operativeNotes: leftTheatre ? "Simulated: procedure completed as planned." : "Simulated: procedure in progress.",
      });
      const late = i % 6 === 0 && delayReasons.length > 0;
      await updateActualTimes(db, {
        scheduleId,
        actualRoomIn: stamp(slot.date, slot.start, 0),
        actualProcedureStart: stamp(slot.date, slot.start, 25),
        actualProcedureEnd: leftTheatre ? stamp(slot.date, slot.start, 95) : null,
        actualRoomOut: leftTheatre ? stamp(slot.date, slot.start, 110) : null,
        delayMinutes: late ? 15 + (i % 4) * 10 : null,
        delayReasonId: late ? delayReasons[i % delayReasons.length].id : null,
      });
    }

    // Post-op.
    const complicated = done && k % 5 === 0 && complicationTypes.length > 0;
    const icu = complicated && k % 10 === 0;
    if (leftTheatre && slot) {
      // Destination follows the case: ICU only when flagged, day cases go home, nobody goes to the morgue.
      const destinationName = icu ? "ICU"
        : proc.dayCase && !complicated ? "Day surgery discharge"
        : i % 2 ? "Ward" : "PACU then ward";
      await savePostOrRecord(db, {
        caseId,
        postOpDestinationId: (byName(destinations, destinationName) ?? byName(destinations, "Ward"))?.id ?? null,
        postOpStatus: done ? "Stable" : "Recovering",
        painScore: i % 8,
        complicationsPresent: complicated,
        icuRequired: icu,
        reoperationRequired: false,
        mortality: false,
        notes: "Simulated recovery note.",
      });
    }

    if (done && slot) {
      if (complicated) {
        await addComplication(db, {
          caseId,
          complicationTypeId: (byName(complicationTypes, proc.complication) ?? complicationTypes[0]).complication_type_id,
          severity: (["MINOR", "MODERATE", "SEVERE"] as const)[k % 3],
          occurredAt: stamp(slot.date, slot.start, 240),
          description: "Simulated complication.",
          intervention: "Simulated management.",
          outcome: "Resolved",
        });
      }
      // A few completed cases stay uncoded so the coding queue has work in it.
      const coded = k % 6 !== 5;
      if (coded) {
        const code = coding[i % coding.length];
        await saveCaseCoding(db, {
          caseId,
          primaryProcedureId: code.procedureId,
          additionalProcedureIds: [],
          diagnoses: [
            { diagnosisId: code.diagnosisId, type: "PRE_OPERATIVE" },
            { diagnosisId: code.diagnosisId, type: "POST_OPERATIVE" },
          ],
        });
      }
      await completeCase(db, caseId);

      // Follow-up: assessed, unreachable, or left pending in the queue.
      const followup = await ensureFollowup(db, caseId, 30).catch(() => null);
      if (followup && k % 3 === 0) {
        await saveFollowupAssessment(db, {
          followupId: followup.followup_id, status: "ASSESSED",
          assessedAt: new Date().toISOString(), method: k % 2 ? "PHONE" : "IN_PERSON",
          notes: "Simulated follow-up: recovering well.",
        });
      } else if (followup && k % 3 === 1 && k % 2 === 0) {
        await saveFollowupAssessment(db, {
          followupId: followup.followup_id, status: "UNREACHABLE", notes: "Simulated: two calls, no answer.",
        });
      }
      if (stage === "COMPLETED" && k % 7 === 3) {
        await addPostoperativeOutcome(db, {
          caseId, followupId: followup?.followup_id ?? null, eventType: "READMISSION",
          occurredAt: stamp(slot.date, slot.start, 6 * 1440), notes: "Simulated readmission.",
        });
      }
      if (stage === "COMPLETED" && coded && k % 7 === 5) {
        const linked = (await getCaseCoding(db, caseId)).procedures[0];
        if (linked) {
          await addPostoperativeOutcome(db, {
            caseId, followupId: followup?.followup_id ?? null, eventType: "SURGICAL_SITE_INFECTION",
            occurredAt: stamp(slot.date, slot.start, 8 * 1440), ssiType: "SUPERFICIAL_INCISIONAL",
            caseProcedureId: linked.case_procedure_id, evidenceSource: "Simulated clinic review",
            notes: "Simulated infection.",
          });
        }
      }
    }

    if (stage === "CANCELLED") await cancelCase(db, caseId, "Simulated: patient withdrew consent.");
    if (stage === "POSTPONED") await postponeCase(db, caseId, "Simulated: awaiting cardiology clearance.");
    if (stage === "ARCHIVED") await archivePatient(db, patient.patient_id, "Simulated: duplicate record.");

    summary[stage]++;
    summary.total++;
    onProgress?.(summary.total, stages.length);
  }
  return summary;
}
