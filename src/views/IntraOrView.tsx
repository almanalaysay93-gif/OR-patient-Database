import React, { useEffect, useState } from "react";
import {
  Save,
  ArrowRight,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  getIntraOrRecord,
  saveIntraOrRecord,
} from "../services/intraPostOr";
import { getCaseById, type SurgicalCase } from "../services/patients";
import { getAnesthesiaTypes, type NamedEntity } from "../services/masterData";
import { CaseEventsPanel } from "../components/clinical/CaseEventsPanel";
import { SafetyPhasesPanel } from "../components/clinical/SafetyPhasesPanel";

export const IntraOrView: React.FC = () => {
  const { db, session, selectedCaseId, setView, notify } = useApp();
  const [surgicalCase, setSurgicalCase] = useState<SurgicalCase | null>(null);
  const [anesthesiaTypes, setAnesthesiaTypes] = useState<NamedEntity[]>([]);

  // Form states
  const [anesthesiaTypeId, setAnesthesiaTypeId] = useState("");
  const [asaClass, setAsaClass] = useState("");
  const [bloodLoss, setBloodLoss] = useState("");
  const [bloodTransfusion, setBloodTransfusion] = useState(false);
  const [unitsTransfused, setUnitsTransfused] = useState<number>(0);
  const [specimenCollected, setSpecimenCollected] = useState(false);
  const [implantUsed, setImplantUsed] = useState(false);
  const [findings, setFindings] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    async function load() {
      if (!db || !selectedCaseId) return;
      try {
        const [c, intra, anes] = await Promise.all([
          getCaseById(db, selectedCaseId),
          getIntraOrRecord(db, selectedCaseId),
          getAnesthesiaTypes(db),
        ]);
        setSurgicalCase(c);
        setAnesthesiaTypes(anes);

        if (intra) {
          setAnesthesiaTypeId(intra.anesthesia_type_id || "");
          setAsaClass(intra.asa_classification || "");
          setBloodLoss(intra.estimated_blood_loss_ml?.toString() || "");
          setBloodTransfusion(intra.blood_transfusion === 1);
          setUnitsTransfused(intra.units_transfused || 0);
          setSpecimenCollected(intra.specimen_collected === 1);
          setImplantUsed(intra.implant_used === 1);
          setFindings(intra.operative_findings || "");
          setNotes(intra.operative_notes || "");
        }
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, [db, selectedCaseId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedCaseId) return;

    try {
      await saveIntraOrRecord(db, {
        caseId: selectedCaseId,
        anesthesiaTypeId: anesthesiaTypeId || null,
        asaClassification: asaClass || null,
        estimatedBloodLossMl: bloodLoss ? Number(bloodLoss) : null,
        bloodTransfusion,
        unitsTransfused: bloodTransfusion ? unitsTransfused : 0,
        specimenCollected,
        implantUsed,
        operativeFindings: findings,
        operativeNotes: notes,
        userId: session?.userId,
      });

      notify("Intra-OR record saved successfully.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  if (!selectedCaseId || !surgicalCase) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
        Select a patient case from the Dashboard, Schedule, or Patients view to record Intra-OR data.
      </div>
    );
  }

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header Case Banner */}
      <div
        className="glass-card"
        style={{
          padding: "20px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderLeft: "4px solid var(--primary)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-main)" }}>
              Intra-OR Documentation: {surgicalCase.patient_name}
            </h1>
            <span className="badge badge-primary">{surgicalCase.case_number}</span>
            <span className="badge badge-warning">{surgicalCase.case_status}</span>
          </div>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
            Procedure: <strong>{surgicalCase.planned_procedure_summary || "Unspecified"}</strong> &bull; Priority: {surgicalCase.case_type} &bull; Laterality: {surgicalCase.laterality || "N/A"}
          </p>
        </div>

        <button
          onClick={() => setView("postor")}
          className="glass-btn glass-btn-secondary"
          style={{ gap: "6px" }}
        >
          <span>Advance to Post-OR</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Clinical Form */}
      <form onSubmit={handleSave} className="glass-card" style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)", borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
          Operative & Anesthesia Details
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Anesthesia Type
            </label>
            <select
              className="glass-input"
              value={anesthesiaTypeId}
              onChange={(e) => setAnesthesiaTypeId(e.target.value)}
            >
              <option value="">Select Anesthesia</option>
              {anesthesiaTypes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              ASA Physical Status Classification
            </label>
            <select
              className="glass-input"
              value={asaClass}
              onChange={(e) => setAsaClass(e.target.value)}
            >
              <option value="I">ASA I - Normal healthy patient</option>
              <option value="II">ASA II - Mild systemic disease</option>
              <option value="III">ASA III - Severe systemic disease</option>
              <option value="IV">ASA IV - Severe systemic disease that is a constant threat to life</option>
              <option value="V">ASA V - Moribund patient not expected to survive</option>
              <option value="IE">ASA I-E (Emergency)</option>
              <option value="IIE">ASA II-E (Emergency)</option>
              <option value="IIIE">ASA III-E (Emergency)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Estimated Blood Loss (ml)
            </label>
            <input
              type="number"
              min="0"
              step="10"
              className="glass-input"
              value={bloodLoss}
              onChange={(e) => setBloodLoss(e.target.value)}
            />
          </div>
        </div>

        {/* Clinical Checkboxes */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px", background: "rgba(148, 163, 184, 0.08)", padding: "16px", borderRadius: "12px" }}>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={bloodTransfusion}
                onChange={(e) => setBloodTransfusion(e.target.checked)}
              />
              <span>Blood Transfusion Administered</span>
            </label>
            {bloodTransfusion && (
              <input
                type="number"
                min="1"
                placeholder="Units transfused"
                className="glass-input"
                style={{ marginTop: "6px" }}
                value={unitsTransfused}
                onChange={(e) => setUnitsTransfused(parseInt(e.target.value, 10) || 1)}
              />
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={specimenCollected}
              onChange={(e) => setSpecimenCollected(e.target.checked)}
            />
            <span>Pathology Specimen Collected</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={implantUsed}
              onChange={(e) => setImplantUsed(e.target.checked)}
            />
            <span>Surgical Implant / Prosthesis Used</span>
          </label>
        </div>

        {/* Findings and Notes */}
        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
            Operative Findings
          </label>
          <textarea
            rows={3}
            className="glass-input"
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            placeholder="Key intra-operative anatomical and pathological findings..."
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
            Operative Notes / Technique Summary
          </label>
          <textarea
            rows={4}
            className="glass-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Surgical approach, incisions, closures, drains..."
          />
        </div>

        {/* Submit */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "10px" }}>
          <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "10px 24px", gap: "8px" }}>
            <Save size={16} />
            <span>Save Intra-OR Record</span>
          </button>
        </div>
      </form>
      <CaseEventsPanel caseId={selectedCaseId} />
      <SafetyPhasesPanel caseId={selectedCaseId} />
    </div>
  );
};
