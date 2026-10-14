import React, { useEffect, useState } from "react";
import {
  Save,
  ArrowRight,
  Plus,
  Trash2,
  Package,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { CaseActions } from "../components/clinical/CaseActions";
import {
  getIntraOrRecord,
  saveIntraOrRecord,
} from "../services/intraPostOr";
import { getCaseById, type SurgicalCase } from "../services/patients";
import { getAnesthesiaTypes, type NamedEntity } from "../services/masterData";
import {
  listCaseImplants,
  addCaseImplant,
  deleteCaseImplant,
  type CaseImplant,
} from "../services/implants";
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

  // Implants tracking
  const [implants, setImplants] = useState<CaseImplant[]>([]);
  const [implantModalOpen, setImplantModalOpen] = useState(false);
  const [implantDeviceName, setImplantDeviceName] = useState("");
  const [implantManufacturer, setImplantManufacturer] = useState("");
  const [implantModel, setImplantModel] = useState("");
  const [implantLot, setImplantLot] = useState("");
  const [implantSerial, setImplantSerial] = useState("");
  const [implantUdi, setImplantUdi] = useState("");
  const [implantExpiry, setImplantExpiry] = useState("");
  const [implantSite, setImplantSite] = useState("");
  const [implantNotes, setImplantNotes] = useState("");

  const reloadImplants = async (cid: string) => {
    if (!db) return;
    try {
      const list = await listCaseImplants(db, cid);
      setImplants(list);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    async function load() {
      if (!db || !selectedCaseId) return;
      try {
        const [c, intra, anes, implantList] = await Promise.all([
          getCaseById(db, selectedCaseId),
          getIntraOrRecord(db, selectedCaseId),
          getAnesthesiaTypes(db),
          listCaseImplants(db, selectedCaseId),
        ]);
        setSurgicalCase(c);
        setAnesthesiaTypes(anes);
        setImplants(implantList);

        // Always reset, so a case with no record yet never shows the previous case's values.
        setAnesthesiaTypeId(intra?.anesthesia_type_id || "");

        // Synchronize ASA from pre-op baseline if not yet recorded in intra-op
        let resolvedAsa = intra?.asa_classification || "";
        if (!resolvedAsa) {
          const preopRows = await db.select<{ asa_classification: string | null }>(
            "SELECT asa_classification FROM case_preop_baseline WHERE case_id = ?",
            [selectedCaseId]
          );
          if (preopRows[0]?.asa_classification) {
            resolvedAsa = preopRows[0].asa_classification;
          }
        }
        setAsaClass(resolvedAsa);

        setBloodLoss(intra?.estimated_blood_loss_ml?.toString() || "");
        setBloodTransfusion(intra?.blood_transfusion === 1);
        setUnitsTransfused(intra?.units_transfused || 0);
        setSpecimenCollected(intra?.specimen_collected === 1);
        setImplantUsed(intra?.implant_used === 1 || implantList.length > 0);
        setFindings(intra?.operative_findings || "");
        setNotes(intra?.operative_notes || "");
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, [db, selectedCaseId]);

  const handleAddImplant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedCaseId || !implantDeviceName.trim()) return;
    try {
      await addCaseImplant(db, {
        caseId: selectedCaseId,
        deviceName: implantDeviceName.trim(),
        manufacturer: implantManufacturer.trim() || null,
        modelNumber: implantModel.trim() || null,
        lotNumber: implantLot.trim() || null,
        serialNumber: implantSerial.trim() || null,
        udiBarcode: implantUdi.trim() || null,
        expiryDate: implantExpiry || null,
        anatomicalSite: implantSite.trim() || null,
        notes: implantNotes.trim() || null,
        userId: session?.userId,
      });
      notify("Surgical implant registered.", "success");
      setImplantModalOpen(false);
      setImplantDeviceName("");
      setImplantManufacturer("");
      setImplantModel("");
      setImplantLot("");
      setImplantSerial("");
      setImplantUdi("");
      setImplantExpiry("");
      setImplantSite("");
      setImplantNotes("");
      setImplantUsed(true);
      await reloadImplants(selectedCaseId);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleDeleteImplant = async (implantId: string) => {
    if (!db || !selectedCaseId) return;
    try {
      await deleteCaseImplant(db, implantId);
      notify("Implant record removed.", "info");
      await reloadImplants(selectedCaseId);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

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
            <CaseActions
              caseId={surgicalCase.case_id} status={surgicalCase.case_status}
              caseLabel={`${surgicalCase.case_number} - ${surgicalCase.patient_name}`}
              onDone={async () => { if (db) setSurgicalCase(await getCaseById(db, surgicalCase.case_id)); }}
            />
            <span className="badge badge-warning">{surgicalCase.status_label || surgicalCase.case_status}</span>
          </div>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
            Procedure: <strong>{surgicalCase.planned_procedure_summary || "Unspecified"}</strong> &bull; Specialty: {surgicalCase.specialty_name || "Not set"} &bull; Priority: {surgicalCase.case_type} &bull; Laterality: {surgicalCase.laterality || "N/A"}
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
              <option value="">Not assessed</option>
              <option value="I">ASA I - Normal healthy patient</option>
              <option value="II">ASA II - Mild systemic disease</option>
              <option value="III">ASA III - Severe systemic disease</option>
              <option value="IV">ASA IV - Severe systemic disease that is a constant threat to life</option>
              <option value="V">ASA V - Moribund patient not expected to survive</option>
              <option value="IE">ASA I-E (Emergency)</option>
              <option value="IIE">ASA II-E (Emergency)</option>
              <option value="IIIE">ASA III-E (Emergency)</option>
              <option value="IVE">ASA IV-E (Emergency)</option>
              <option value="VE">ASA V-E (Emergency)</option>
              <option value="VI">ASA VI - Declared brain-dead organ donor</option>
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

        {/* Implant / Prosthesis Details Section */}
        {implantUsed && (
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "16px", background: "rgba(99, 102, 241, 0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Package size={18} color="var(--primary)" />
                <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
                  Documented Surgical Implants ({implants.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setImplantModalOpen(true)}
                className="glass-btn glass-btn-primary"
                style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
              >
                <Plus size={14} />
                <span>Add Implant / Device</span>
              </button>
            </div>

            {implants.length === 0 ? (
              <div style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic", padding: "10px 0" }}>
                No implants recorded yet. Click "Add Implant / Device" to log manufacturer, lot/serial, UDI, or anatomical site.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-glass)", color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "8px" }}>Device Name</th>
                      <th style={{ padding: "8px" }}>Manufacturer</th>
                      <th style={{ padding: "8px" }}>Model / Lot / Serial</th>
                      <th style={{ padding: "8px" }}>Site</th>
                      <th style={{ padding: "8px" }}>UDI Barcode</th>
                      <th style={{ padding: "8px" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {implants.map((imp) => (
                      <tr key={imp.implant_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "8px", fontWeight: 600 }}>{imp.device_name}</td>
                        <td style={{ padding: "8px" }}>{imp.manufacturer || "-"}</td>
                        <td style={{ padding: "8px" }}>
                          {[imp.model_number, imp.lot_number, imp.serial_number].filter(Boolean).join(" / ") || "-"}
                        </td>
                        <td style={{ padding: "8px" }}>{imp.anatomical_site || "-"}</td>
                        <td style={{ padding: "8px", fontFamily: "var(--font-mono)", fontSize: "11px" }}>{imp.udi_barcode || "-"}</td>
                        <td style={{ padding: "8px" }}>
                          <button
                            type="button"
                            onClick={() => handleDeleteImplant(imp.implant_id)}
                            className="glass-btn glass-btn-danger"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            aria-label={`Remove implant ${imp.device_name}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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

      {/* Modal: Add Implant */}
      {implantModalOpen && (
        <div role="dialog" aria-modal="true" aria-label="Add Surgical Implant" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "4px" }}>Add Surgical Implant / Prosthesis</h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Track medical device tracking identifiers, lot numbers, and UDI for patient safety.
            </p>
            <form onSubmit={handleAddImplant} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Device / Implant Name *</label>
                  <input
                    className="glass-input"
                    required
                    placeholder="e.g. Titanium Mesh Plate 2.0"
                    value={implantDeviceName}
                    onChange={(e) => setImplantDeviceName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Manufacturer</label>
                  <input
                    className="glass-input"
                    placeholder="e.g. Stryker, DePuy Synthes"
                    value={implantManufacturer}
                    onChange={(e) => setImplantManufacturer(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Model / Ref #</label>
                  <input
                    className="glass-input"
                    placeholder="e.g. 04.111.520"
                    value={implantModel}
                    onChange={(e) => setImplantModel(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Lot Number</label>
                  <input
                    className="glass-input"
                    placeholder="e.g. L982341"
                    value={implantLot}
                    onChange={(e) => setImplantLot(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Serial Number</label>
                  <input
                    className="glass-input"
                    placeholder="e.g. SN-88310"
                    value={implantSerial}
                    onChange={(e) => setImplantSerial(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>UDI Barcode / Data</label>
                  <input
                    className="glass-input"
                    placeholder="(01)0088... / barcode scan"
                    value={implantUdi}
                    onChange={(e) => setImplantUdi(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Expiration Date</label>
                  <input
                    type="date"
                    className="glass-input"
                    value={implantExpiry}
                    onChange={(e) => setImplantExpiry(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Anatomical Site / Placement</label>
                <input
                  className="glass-input"
                  placeholder="e.g. Distal right radius, L4-L5 intervertebral space"
                  value={implantSite}
                  onChange={(e) => setImplantSite(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Notes / Dimensions</label>
                <textarea
                  rows={2}
                  className="glass-input"
                  placeholder="Size, screws used, sterile packaging verification..."
                  value={implantNotes}
                  onChange={(e) => setImplantNotes(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setImplantModalOpen(false)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-primary">
                  Save Implant Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
