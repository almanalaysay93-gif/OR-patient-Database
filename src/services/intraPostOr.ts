import type { Db } from "../data/db";
import { uuid, nowIso, bool } from "../data/db";
import { logAudit } from "./audit";
import { getCaseById } from "./patients";
import { createFollowupIfDue } from "./followup";

export interface IntraOrRecord {
  intra_or_id: string;
  case_id: string;
  anesthesia_type_id: string | null;
  anesthesia_name?: string | null;
  asa_classification: string | null;
  estimated_blood_loss_ml: number | null;
  blood_transfusion: number | null;
  units_transfused: number | null;
  specimen_collected: number | null;
  implant_used: number | null;
  procedure_start: string | null;
  procedure_end: string | null;
  operative_findings: string | null;
  operative_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostOrRecord {
  post_or_id: string;
  case_id: string;
  pacu_admission: string | null;
  pacu_discharge: string | null;
  post_op_destination_id: string | null;
  destination_name?: string | null;
  post_op_status: string | null;
  pain_score: number | null;
  complications_present: number | null;
  icu_required: number | null;
  reoperation_required: number | null;
  mortality: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplicationRecord {
  complication_id: string;
  case_id: string;
  complication_type_id: string;
  complication_name?: string;
  category?: string;
  severity: "MINOR" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" | "FATAL" | null;
  occurred_at: string | null;
  description: string | null;
  intervention: string | null;
  outcome: string | null;
  created_at: string;
}

export async function getIntraOrRecord(db: Db, caseId: string): Promise<IntraOrRecord | null> {
  const rows = await db.select<any>(
    `SELECT i.*, a.name as anesthesia_name
     FROM intra_or_records i
     LEFT JOIN anesthesia_types a ON i.anesthesia_type_id = a.anesthesia_type_id
     WHERE i.case_id = ?`,
    [caseId]
  );
  return rows[0] || null;
}

export async function saveIntraOrRecord(
  db: Db,
  params: {
    caseId: string;
    anesthesiaTypeId?: string | null;
    asaClassification?: string | null;
    estimatedBloodLossMl?: number | null;
    bloodTransfusion?: boolean | null;
    unitsTransfused?: number | null;
    specimenCollected?: boolean | null;
    implantUsed?: boolean | null;
    procedureStart?: string | null;
    procedureEnd?: string | null;
    operativeFindings?: string | null;
    operativeNotes?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  const now = nowIso();
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Case not found.");

  await db.transaction(async (tx) => {
    const existing = await tx.select<{ intra_or_id: string }>(
      "SELECT intra_or_id FROM intra_or_records WHERE case_id = ?",
      [params.caseId]
    );

    if (existing.length > 0) {
      await tx.execute(
        `UPDATE intra_or_records
         SET anesthesia_type_id = ?, asa_classification = ?, estimated_blood_loss_ml = ?,
             blood_transfusion = ?, units_transfused = ?, specimen_collected = ?,
              implant_used = ?, operative_findings = ?, operative_notes = ?, updated_by = ?, updated_at = ?
         WHERE case_id = ?`,
        [
          params.anesthesiaTypeId || null,
          params.asaClassification || null,
          params.estimatedBloodLossMl ?? null,
          bool(params.bloodTransfusion),
          params.unitsTransfused ?? null,
          bool(params.specimenCollected),
          bool(params.implantUsed),
          params.operativeFindings?.trim() || null,
          params.operativeNotes?.trim() || null,
          params.userId || null,
          now,
          params.caseId,
        ]
      );
    } else {
      await tx.execute(
        `INSERT INTO intra_or_records (
          intra_or_id, case_id, anesthesia_type_id, asa_classification, estimated_blood_loss_ml,
          blood_transfusion, units_transfused, specimen_collected, implant_used,
           operative_findings, operative_notes,
          created_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          params.caseId,
          params.anesthesiaTypeId || null,
          params.asaClassification || null,
          params.estimatedBloodLossMl ?? null,
          bool(params.bloodTransfusion),
          params.unitsTransfused ?? null,
          bool(params.specimenCollected),
          bool(params.implantUsed),
          params.operativeFindings?.trim() || null,
          params.operativeNotes?.trim() || null,
          params.userId || null,
          params.userId || null,
          now,
          now,
        ]
      );
    }

    // Advance status to IN_OR if currently scheduled/ready
    if (["SCHEDULED", "READY"].includes(c.case_status)) {
      await tx.execute(
        "UPDATE surgical_cases SET case_status = 'IN_OR', updated_by = ?, updated_at = ? WHERE case_id = ?",
        [params.userId || null, now, params.caseId]
      );
    }

    await logAudit(tx, {
      userId: params.userId,
      patientId: c.patient_id,
      admissionId: c.admission_id,
      caseId: params.caseId,
      action: "SAVE_INTRA_OR_RECORD",
      entityType: "INTRA_OR",
      recordId: params.caseId,
    });
  });
}

export async function getPostOrRecord(db: Db, caseId: string): Promise<PostOrRecord | null> {
  const rows = await db.select<any>(
    `SELECT p.*, d.name as destination_name
     FROM post_or_records p
     LEFT JOIN post_op_destinations d ON p.post_op_destination_id = d.destination_id
     WHERE p.case_id = ?`,
    [caseId]
  );
  return rows[0] || null;
}

export async function savePostOrRecord(
  db: Db,
  params: {
    caseId: string;
    pacuAdmission?: string | null;
    pacuDischarge?: string | null;
    postOpDestinationId?: string | null;
    postOpStatus?: string | null;
    painScore?: number | null;
    complicationsPresent?: boolean | null;
    icuRequired?: boolean | null;
    reoperationRequired?: boolean | null;
    mortality?: boolean | null;
    notes?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  const now = nowIso();
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Case not found.");

  await db.transaction(async (tx) => {
    const existing = await tx.select<{ post_or_id: string }>(
      "SELECT post_or_id FROM post_or_records WHERE case_id = ?",
      [params.caseId]
    );

    if (existing.length > 0) {
      await tx.execute(
        `UPDATE post_or_records
         SET post_op_destination_id = ?, post_op_status = ?, pain_score = ?, complications_present = ?,
             icu_required = ?, reoperation_required = ?, mortality = ?,
             notes = ?, updated_by = ?, updated_at = ?
         WHERE case_id = ?`,
        [
          params.postOpDestinationId || null,
          params.postOpStatus || null,
          params.painScore ?? null,
          bool(params.complicationsPresent),
          bool(params.icuRequired),
          bool(params.reoperationRequired),
          bool(params.mortality),
          params.notes?.trim() || null,
          params.userId || null,
          now,
          params.caseId,
        ]
      );
    } else {
      await tx.execute(
        `INSERT INTO post_or_records (
           post_or_id, case_id, post_op_destination_id,
          post_op_status, pain_score, complications_present, icu_required,
          reoperation_required, mortality, notes, created_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          params.caseId,
          params.postOpDestinationId || null,
          params.postOpStatus || null,
          params.painScore ?? null,
          bool(params.complicationsPresent),
          bool(params.icuRequired),
          bool(params.reoperationRequired),
          bool(params.mortality),
          params.notes?.trim() || null,
          params.userId || null,
          params.userId || null,
          now,
          now,
        ]
      );
    }

    if (c.case_status === "IN_OR") {
      await tx.execute(
        "UPDATE surgical_cases SET case_status = 'PACU', updated_by = ?, updated_at = ? WHERE case_id = ?",
        [params.userId || null, now, params.caseId]
      );
    }

    await logAudit(tx, {
      userId: params.userId,
      patientId: c.patient_id,
      admissionId: c.admission_id,
      caseId: params.caseId,
      action: "SAVE_POST_OR_RECORD",
      entityType: "POST_OR",
      recordId: params.caseId,
    });
  });
}

export async function addComplication(
  db: Db,
  params: {
    caseId: string;
    complicationTypeId: string;
    severity?: "MINOR" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" | "FATAL" | null;
    occurredAt?: string | null;
    description?: string | null;
    intervention?: string | null;
    outcome?: string | null;
    userId?: string | null;
  }
): Promise<string> {
  const compId = uuid();
  const now = nowIso();
  const c = await getCaseById(db, params.caseId);
  if (!c) throw new Error("Case not found.");

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO complications (
        complication_id, case_id, complication_type_id, severity, occurred_at,
        description, intervention, outcome, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        compId,
        params.caseId,
        params.complicationTypeId,
        params.severity || null,
        params.occurredAt || now,
        params.description?.trim() || null,
        params.intervention?.trim() || null,
        params.outcome?.trim() || null,
        now,
        now,
      ]
    );

    // Ensure complications_present is flagged in post_or_records
    await tx.execute(
      "UPDATE post_or_records SET complications_present = 1, updated_at = ? WHERE case_id = ?",
      [now, params.caseId]
    );

    await logAudit(tx, {
      userId: params.userId,
      patientId: c.patient_id,
      caseId: params.caseId,
      action: "ADD_COMPLICATION",
      entityType: "COMPLICATION",
      recordId: compId,
    });
  });

  return compId;
}

export async function getComplicationsByCase(db: Db, caseId: string): Promise<ComplicationRecord[]> {
  return db.select<ComplicationRecord>(
    `SELECT c.*, ct.name as complication_name, ct.category
     FROM complications c
     JOIN complication_types ct ON c.complication_type_id = ct.complication_type_id
     WHERE c.case_id = ?
     ORDER BY c.occurred_at DESC`,
    [caseId]
  );
}

export async function completeCase(
  db: Db,
  caseId: string,
  userId?: string | null
): Promise<void> {
  const c = await getCaseById(db, caseId);
  if (!c) throw new Error("Case not found.");

  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE surgical_cases SET case_status = 'COMPLETED', updated_by = ?, updated_at = ? WHERE case_id = ?",
      [userId || null, now, caseId]
    );
    await tx.execute(
      "UPDATE or_schedule SET schedule_status = 'COMPLETED', updated_by = ?, updated_at = ? WHERE case_id = ?",
      [userId || null, now, caseId]
    );

    await logAudit(tx, {
      userId,
      patientId: c.patient_id,
      admissionId: c.admission_id,
      caseId,
      action: "COMPLETE_CASE",
      entityType: "SURGICAL_CASE",
      recordId: caseId,
      oldValue: c.case_status,
      newValue: "COMPLETED",
    });

    // Follow-up stays NOT_CREATED in the queue when no surgery event is dated yet.
    await createFollowupIfDue(tx, { caseId, patientId: c.patient_id, userId });
  });
}
