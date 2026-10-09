import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  addPostoperativeOutcome, ensureFollowup, getCaseFollowup, saveFollowupAssessment,
  type FollowupAssessment, type OutcomeType, type PostoperativeOutcome,
} from "../../services/followup";
import { getCaseCoding, type CaseCoding } from "../../services/caseCoding";

const OUTCOME_TYPES: OutcomeType[] = [
  "READMISSION", "UNPLANNED_REOPERATION", "DEATH", "SURGICAL_SITE_INFECTION",
];

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function AssessmentEditor({ assessment, onSaved }: { assessment: FollowupAssessment; onSaved: () => Promise<void> }) {
  const { db, session, notify } = useApp();
  const [status, setStatus] = useState<FollowupAssessment["status"]>(assessment.status);
  const [method, setMethod] = useState<NonNullable<FollowupAssessment["method"]>>(assessment.method || "PHONE");
  const [assessedAt, setAssessedAt] = useState(assessment.assessed_at ? toLocalInput(assessment.assessed_at) : "");
  const [notes, setNotes] = useState(assessment.notes || "");
  useEffect(() => {
    setStatus(assessment.status);
    setMethod(assessment.method || "PHONE");
    setAssessedAt(assessment.assessed_at ? toLocalInput(assessment.assessed_at) : "");
    setNotes(assessment.notes || "");
  }, [assessment]);
  const save = async () => {
    if (!db) return;
    try {
      await saveFollowupAssessment(db, {
        followupId: assessment.followup_id, status,
        assessedAt: assessedAt ? new Date(assessedAt).toISOString() : null,
        method: status === "ASSESSED" ? method : null, notes, userId: session?.userId,
      });
      await onSaved();
      notify("Follow-up assessment saved.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };
  return (
    <div style={{ display: "grid", gap: 8, border: "1px solid var(--border-subtle)", padding: 12 }}>
      <div>{assessment.target_day}-day follow-up due {assessment.due_date}. Current status: {assessment.status}.</div>
      <label>Status
        <select className="glass-input" value={status}
          onChange={(e) => setStatus(e.target.value as FollowupAssessment["status"])}>
          {["PENDING", "ASSESSED", "UNREACHABLE", "DECEASED"].map((v) => <option key={v}>{v}</option>)}
        </select>
      </label>
      {status === "ASSESSED" && (
        <>
          <label>Assessment date and time
            <input className="glass-input" type="datetime-local" value={assessedAt}
              onChange={(e) => setAssessedAt(e.target.value)} />
          </label>
          <label>Method
            <select className="glass-input" value={method}
              onChange={(e) => setMethod(e.target.value as NonNullable<FollowupAssessment["method"]>)}>
              {["IN_PERSON", "PHONE", "RECORD_REVIEW", "OTHER"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
        </>
      )}
      <label>Assessment or contact note
        <textarea className="glass-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="button" className="glass-btn glass-btn-primary" onClick={save}>Save assessment</button>
    </div>
  );
}

export function FollowupPanel({ caseId }: { caseId: string }) {
  const { db, session, notify } = useApp();
  const [assessments, setAssessments] = useState<FollowupAssessment[]>([]);
  const [outcomes, setOutcomes] = useState<PostoperativeOutcome[]>([]);
  const [caseProcedures, setCaseProcedures] = useState<CaseCoding["procedures"]>([]);
  const [outcomeType, setOutcomeType] = useState<OutcomeType>("READMISSION");
  const [outcomeAt, setOutcomeAt] = useState("");
  const [ssiType, setSsiType] = useState<NonNullable<PostoperativeOutcome["ssi_type"]>>("SUPERFICIAL_INCISIONAL");
  const [evidence, setEvidence] = useState("");
  const [selectedProcedure, setSelectedProcedure] = useState("");
  const [selectedFollowupId, setSelectedFollowupId] = useState("");

  const reload = async () => {
    if (!db) return;
    const [result, coding] = await Promise.all([getCaseFollowup(db, caseId), getCaseCoding(db, caseId)]);
    setAssessments(result.assessments);
    setOutcomes(result.outcomes);
    setCaseProcedures(coding.procedures);
  };

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [db, caseId]);

  const create = async (targetDay: 30 | 90) => {
    if (!db) return;
    try {
      await ensureFollowup(db, caseId, targetDay);
      await reload();
      notify(`${targetDay}-day follow-up created.`, "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const saveOutcome = async () => {
    if (!db || !outcomeAt) return;
    try {
      await addPostoperativeOutcome(db, {
        caseId, followupId: selectedFollowupId || null,
        eventType: outcomeType, occurredAt: new Date(outcomeAt).toISOString(),
        ssiType: outcomeType === "SURGICAL_SITE_INFECTION" ? ssiType : null,
        caseProcedureId: outcomeType === "SURGICAL_SITE_INFECTION" ? selectedProcedure || null : null,
        evidenceSource: evidence || null, userId: session?.userId,
      });
      setOutcomeAt("");
      setEvidence("");
      await reload();
      notify("Outcome event recorded.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const thirty = assessments.find((a) => a.target_day === 30);
  return (
    <section className="glass-card" style={{ padding: 20, display: "grid", gap: 14 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>Postoperative follow-up</h2>
      {!thirty && <button type="button" className="glass-btn glass-btn-primary" onClick={() => create(30)}>Create 30-day follow-up</button>}
      {thirty && <AssessmentEditor key={thirty.followup_id} assessment={thirty} onSaved={reload} />}
      {!assessments.some((a) => a.target_day === 90) && (
        <button type="button" className="glass-btn glass-btn-secondary" onClick={() => create(90)}>
          Add 90-day follow-up when the procedure requires it
        </button>
      )}
      {assessments.filter((a) => a.target_day === 90).map((a) => (
        <AssessmentEditor key={a.followup_id} assessment={a} onSaved={reload} />
      ))}
      <h3 style={{ fontSize: 15, margin: 0 }}>Outcome events</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="glass-input" aria-label="Outcome type" value={outcomeType}
          onChange={(e) => setOutcomeType(e.target.value as OutcomeType)}>
          {OUTCOME_TYPES.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
        </select>
        <label>Event date and time
          <input className="glass-input" type="datetime-local" value={outcomeAt}
            onChange={(e) => setOutcomeAt(e.target.value)} />
        </label>
      </div>
      <label>Follow-up window
        <select className="glass-input" value={selectedFollowupId} onChange={(e) => setSelectedFollowupId(e.target.value)}>
          <option value="">No linked assessment</option>
          {assessments.map((a) => <option key={a.followup_id} value={a.followup_id}>{a.target_day}-day</option>)}
        </select>
      </label>
      {outcomeType === "SURGICAL_SITE_INFECTION" && (
        <>
          <select className="glass-input" aria-label="Infection type" value={ssiType}
            onChange={(e) => setSsiType(e.target.value as NonNullable<PostoperativeOutcome["ssi_type"]>)}>
            {["SUPERFICIAL_INCISIONAL", "DEEP_INCISIONAL", "ORGAN_SPACE"].map((v) =>
              <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
          </select>
          <select className="glass-input" aria-label="Linked procedure" value={selectedProcedure}
            onChange={(e) => setSelectedProcedure(e.target.value)}>
            <option value="">Procedure not selected</option>
            {caseProcedures.map((p) => <option key={p.case_procedure_id} value={p.case_procedure_id}>
              {p.procedure_name}</option>)}
          </select>
        </>
      )}
      <label>Evidence source
        <input className="glass-input" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </label>
      <button type="button" className="glass-btn glass-btn-secondary" disabled={!outcomeAt} onClick={saveOutcome}>Add outcome</button>
      {outcomes.map((event) => (
        <div key={event.outcome_id}>{event.event_type.replace(/_/g, " ")}: {new Date(event.occurred_at).toLocaleString()}</div>
      ))}
    </section>
  );
}
