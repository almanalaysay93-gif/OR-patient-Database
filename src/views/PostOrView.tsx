import React, { useEffect, useState } from "react";
import {
  Save,
  Plus,
  CheckCheck,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { CaseActions } from "../components/clinical/CaseActions";
import {
  getPostOrRecord,
  savePostOrRecord,
  getComplicationsByCase,
  addComplication,
  completeCase,
  type ComplicationRecord,
} from "../services/intraPostOr";
import { getCaseById, type SurgicalCase } from "../services/patients";
import {
  getPostOpDestinations,
  getComplicationTypes,
  type NamedEntity,
} from "../services/masterData";
import { CaseEventsPanel } from "../components/clinical/CaseEventsPanel";
import { FollowupPanel } from "../components/clinical/FollowupPanel";
import { getFollowupQueue } from "../services/followup";
import { DataTable } from "../components/common/DataTable";

export const PostOrView: React.FC = () => {
  const { db, session, selectedCaseId, setSelectedCaseId, notify } = useApp();
  const [surgicalCase, setSurgicalCase] = useState<SurgicalCase | null>(null);
  const [destinations, setDestinations] = useState<NamedEntity[]>([]);
  const [complicationTypes, setComplicationTypes] = useState<any[]>([]);
  const [complications, setComplications] = useState<ComplicationRecord[]>([]);

  // Post-OR record form
  const [destinationId, setDestinationId] = useState("");
  const [postOpStatus, setPostOpStatus] = useState("");
  const [painScore, setPainScore] = useState("");
  const [complicationsPresent, setComplicationsPresent] = useState(false);
  const [icuRequired, setIcuRequired] = useState(false);
  const [reopRequired, setReopRequired] = useState(false);
  const [mortality, setMortality] = useState(false);
  const [notes, setNotes] = useState("");

  // Add complication modal
  const [compModalOpen, setCompModalOpen] = useState(false);
  const [compTypeId, setCompTypeId] = useState("");
  const [compSeverity, setCompSeverity] = useState<"MINOR" | "MODERATE" | "SEVERE" | "LIFE_THREATENING">("MINOR");
  const [compDesc, setCompDesc] = useState("");
  const [compIntervention, setCompIntervention] = useState("");
  const [compOutcome, setCompOutcome] = useState("");
  const [followupQueue, setFollowupQueue] = useState<Awaited<ReturnType<typeof getFollowupQueue>>>([]);

  useEffect(() => {
    if (db) getFollowupQueue(db).then(setFollowupQueue).catch(console.error);
  }, [db, selectedCaseId]);

  useEffect(() => {
    async function load() {
      if (!db || !selectedCaseId) return;
      try {
        const [c, post, destList, typesList, compList] = await Promise.all([
          getCaseById(db, selectedCaseId),
          getPostOrRecord(db, selectedCaseId),
          getPostOpDestinations(db),
          getComplicationTypes(db),
          getComplicationsByCase(db, selectedCaseId),
        ]);
        setSurgicalCase(c);
        setDestinations(destList);
        setComplicationTypes(typesList);
        setComplications(compList);

        // Always reset, so a case with no record yet never shows the previous case's values.
        setDestinationId(post?.post_op_destination_id || "");
        setPostOpStatus(post?.post_op_status || "");
        setPainScore(post?.pain_score?.toString() || "");
        setComplicationsPresent(post?.complications_present === 1 || compList.length > 0);
        setIcuRequired(post?.icu_required === 1);
        setReopRequired(post?.reoperation_required === 1);
        setMortality(post?.mortality === 1);
        setNotes(post?.notes || "");
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, [db, selectedCaseId]);

  const handleSavePostOr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedCaseId) return;

    try {
      await savePostOrRecord(db, {
        caseId: selectedCaseId,
        postOpDestinationId: destinationId || null,
        postOpStatus: postOpStatus || null,
        painScore: painScore ? Number(painScore) : null,
        complicationsPresent: complicationsPresent || complications.length > 0,
        icuRequired,
        reoperationRequired: reopRequired,
        mortality,
        notes,
        userId: session?.userId,
      });

      notify("Post-OR / PACU record updated.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleAddComplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedCaseId || !compTypeId) return;

    try {
      await addComplication(db, {
        caseId: selectedCaseId,
        complicationTypeId: compTypeId,
        severity: compSeverity,
        description: compDesc,
        intervention: compIntervention,
        outcome: compOutcome,
        userId: session?.userId,
      });

      setCompModalOpen(false);
      setCompTypeId("");
      setCompSeverity("MINOR");
      setCompDesc("");
      setCompIntervention("");
      setCompOutcome("");
      setComplicationsPresent(true);

      const compList = await getComplicationsByCase(db, selectedCaseId);
      setComplications(compList);
      notify("Complication logged in case audit.", "warning");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleCompleteCase = async () => {
    if (!db || !selectedCaseId) return;
    if (!confirm("Are you sure you want to mark this surgical case as COMPLETED? This locks operative records and completes the schedule.")) {
      return;
    }

    try {
      await completeCase(db, selectedCaseId, session?.userId);
      notify("Surgical case successfully completed!", "success");
      const c = await getCaseById(db, selectedCaseId);
      setSurgicalCase(c);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  if (!selectedCaseId || !surgicalCase) {
    return (
      <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>Postoperative follow-up queue</h1>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
            Open a case to record its post-OR and PACU data. Select a case from Patients or Schedule to start a new record.
          </p>
        </div>
        <DataTable<any>
          caption="Postoperative follow-up queue"
          rows={followupQueue}
          rowKey={(item) => item.case_id}
          searchText={(item) => [item.case_number, item.patient_name, item.status].filter(Boolean).join(" ")}
          searchLabel="Search follow-up queue"
          searchPlaceholder="Search case, patient or status"
          onRowClick={(item) => setSelectedCaseId(item.case_id)}
          emptyMessage="No follow-up cases. Select a case from Patients or Schedule."
          columns={[
            { key: "case", header: "Case", nowrap: true, render: (item) => <span className="badge badge-primary">{item.case_number}</span> },
            { key: "patient", header: "Patient", render: (item) => <strong>{item.patient_name}</strong> },
            { key: "status", header: "Status", nowrap: true, render: (item) => item.status },
            { key: "due", header: "Follow-up due", nowrap: true, render: (item) => item.due_date || <span style={{ color: "var(--warning)" }}>Date needed</span> },
            { key: "open", header: "", align: "right", render: () => <span className="glass-btn glass-btn-secondary" style={{ fontSize: "11px", padding: "4px 10px" }}>Open</span> },
          ]}
        />
      </div>
    );
  }

  const isCompleted = surgicalCase.case_status === "COMPLETED";

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Banner */}
      <div
        className="glass-card"
        style={{
          padding: "20px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderLeft: `4px solid ${isCompleted ? "var(--success)" : "var(--primary)"}`,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-main)" }}>
              Post-OR & PACU: {surgicalCase.patient_name}
            </h1>
            <span className="badge badge-primary">{surgicalCase.case_number}</span>
            <CaseActions
              caseId={surgicalCase.case_id} status={surgicalCase.case_status}
              caseLabel={`${surgicalCase.case_number} - ${surgicalCase.patient_name}`}
              onDone={async () => { if (db) setSurgicalCase(await getCaseById(db, surgicalCase.case_id)); }}
            />
            <span className={`badge ${isCompleted ? "badge-success" : "badge-warning"}`}>
              {surgicalCase.status_label || surgicalCase.case_status}
            </span>
          </div>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
            Procedure: <strong>{surgicalCase.planned_procedure_summary || "Unspecified"}</strong> &bull; Specialty: {surgicalCase.specialty_name || "Not set"}
          </p>
        </div>

        {!isCompleted ? (
          <button
            onClick={handleCompleteCase}
            className="glass-btn glass-btn-primary"
            style={{ gap: "8px", background: "var(--success)" }}
          >
            <CheckCheck size={16} />
            <span>Mark Case Completed</span>
          </button>
        ) : (
          <div className="badge badge-success" style={{ fontSize: "13px", padding: "6px 14px" }}>
            Case Successfully Completed
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "24px" }}>
        {/* Left: PACU & Outcomes Form */}
        <form onSubmit={handleSavePostOr} className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            PACU Recovery & Disposition
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                Post-Op Destination
              </label>
              <select className="glass-input" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                <option value="">Select Destination</option>
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                Post-Op Clinical Status
              </label>
              <input className="glass-input" value={postOpStatus} onChange={(e) => setPostOpStatus(e.target.value)} />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Pain Score (0 - 10)</label>
              <span style={{ fontWeight: 800, fontSize: "14px", color: Number(painScore) > 6 ? "var(--danger)" : "var(--primary)" }}>
                {painScore ? `${painScore} / 10` : "Not assessed"}
              </span>
            </div>
            <input
              type="number"
              min="0"
              max="10"
              value={painScore}
              onChange={(e) => setPainScore(e.target.value)}
              className="glass-input"
            />
          </div>

          {/* Outcome Flags */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "rgba(148, 163, 184, 0.08)", padding: "14px", borderRadius: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600 }}>
              <input type="checkbox" checked={icuRequired} onChange={(e) => setIcuRequired(e.target.checked)} />
              <span>ICU Admission Required</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600 }}>
              <input type="checkbox" checked={reopRequired} onChange={(e) => setReopRequired(e.target.checked)} />
              <span>Unplanned Reoperation</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600 }}>
              <input type="checkbox" checked={mortality} onChange={(e) => setMortality(e.target.checked)} />
              <span>Patient Died (Perioperative Mortality)</span>
            </label>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Post-Op Notes & Handoff
            </label>
            <textarea
              rows={3}
              className="glass-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Recovery observations, vital stability, post-op orders..."
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="glass-btn glass-btn-primary" style={{ gap: "8px" }}>
              <Save size={16} />
              <span>Save Post-OR Record</span>
            </button>
          </div>
        </form>

        {/* Right: Complications Log */}
        <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)" }}>
                Complications Log ({complications.length})
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Research-grade complication surveillance
              </p>
            </div>
            <button
              onClick={() => setCompModalOpen(true)}
              className="glass-btn glass-btn-primary"
              style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
            >
              <Plus size={14} />
              <span>Add Event</span>
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {complications.map((c) => (
              <div
                key={c.complication_id}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                  <span style={{ color: "var(--danger)" }}>{c.complication_name}</span>
                  <span className="badge badge-danger">{c.severity}</span>
                </div>
                <div style={{ color: "var(--text-muted)", marginTop: "4px" }}>
                  Category: {c.category} &bull; Outcome: {c.outcome || "N/A"}
                </div>
                {c.intervention && (
                  <div style={{ marginTop: "4px", color: "var(--text-main)" }}>
                    <strong>Intervention:</strong> {c.intervention}
                  </div>
                )}
              </div>
            ))}

            {complications.length === 0 && (
              <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                No complications recorded for this case.
              </div>
            )}
          </div>
        </div>
      </div>
      <CaseEventsPanel caseId={selectedCaseId} />
      <FollowupPanel caseId={selectedCaseId} />

      {/* Modal: Add Complication */}
      {compModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "540px", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>Record Complication</h2>
            <form onSubmit={handleAddComplication} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Complication Type *</label>
                <select className="glass-input" required value={compTypeId} onChange={(e) => setCompTypeId(e.target.value)}>
                  <option value="">Select Complication</option>
                  {complicationTypes.map((t) => (
                    <option key={t.complication_type_id} value={t.complication_type_id}>
                      [{t.category}] {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Severity</label>
                <select className="glass-input" value={compSeverity} onChange={(e) => setCompSeverity(e.target.value as any)}>
                  <option value="MINOR">Minor</option>
                  <option value="MODERATE">Moderate</option>
                  <option value="SEVERE">Severe</option>
                  <option value="LIFE_THREATENING">Life Threatening</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Clinical Intervention</label>
                <input className="glass-input" placeholder="e.g. Reintubation, blood transfusion..." value={compIntervention} onChange={(e) => setCompIntervention(e.target.value)} />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Outcome</label>
                <input className="glass-input" value={compOutcome} onChange={(e) => setCompOutcome(e.target.value)} />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setCompModalOpen(false)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-danger">
                  Save Complication
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
