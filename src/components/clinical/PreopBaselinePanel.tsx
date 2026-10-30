import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  DIALYSIS_ACCESSES, DIALYSIS_MODALITIES, DONOR_RELATIONS, getPreopBaseline, savePreopBaseline,
  type DialysisAccess, type DialysisModality, type DonorRelation, type PreopBaseline,
} from "../../services/preopBaseline";
import { getDonorRelationshipTypes, type DonorRelationshipType } from "../../services/donorRelationships";
import { flushSheetSync } from "../../services/sheetSync";

const MODALITY_LABELS: Record<DialysisModality, string> = {
  NONE: "None (not on dialysis)", HEMODIALYSIS: "Hemodialysis", PERITONEAL_DIALYSIS: "Peritoneal dialysis", UNKNOWN: "Unknown",
};
const ACCESS_LABELS: Record<DialysisAccess, string> = {
  AV_FISTULA: "AV fistula", AV_GRAFT: "AV graft", TUNNELED_CATHETER: "Tunneled catheter",
  NON_TUNNELED_CATHETER: "Non-tunneled catheter", PD_CATHETER: "PD catheter", OTHER: "Other",
};
const DONOR_LABELS: Record<DonorRelation, string> = { RELATED: "Related donor", NON_RELATED: "Non-related donor" };

export function PreopBaselinePanel({ caseId }: { caseId: string }) {
  const { db, session, notify } = useApp();
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");
  const [asa, setAsa] = useState("");
  const [tobacco, setTobacco] = useState<NonNullable<PreopBaseline["tobacco_status"]> | "">("");
  const [functional, setFunctional] = useState<NonNullable<PreopBaseline["functional_status"]> | "">("");
  const [modality, setModality] = useState<DialysisModality | "">("");
  const [access, setAccess] = useState<DialysisAccess | "">("");
  const [years, setYears] = useState("");
  const [donor, setDonor] = useState<DonorRelation | "">("");
  const [relationshipType, setRelationshipType] = useState("");
  const [relationshipTypes, setRelationshipTypes] = useState<DonorRelationshipType[]>([]);
  const [notes, setNotes] = useState("");
  const onDialysis = modality !== "" && modality !== "NONE";

  useEffect(() => {
    if (!db) return;
    getDonorRelationshipTypes(db, false).then(setRelationshipTypes).catch((err) => notify((err as Error).message, "error"));
  }, [db]);

  useEffect(() => {
    if (!db) return;
    getPreopBaseline(db, caseId).then((r) => {
      setHeight(r?.height_cm?.toString() || "");
      setWeight(r?.weight_kg?.toString() || "");
      setMeasuredAt(r?.measured_at || "");
      setAsa(r?.asa_classification || "");
      setTobacco(r?.tobacco_status || "");
      setFunctional(r?.functional_status || "");
      setModality(r?.dialysis_modality || "");
      setAccess(r?.dialysis_access || "");
      setYears(r?.dialysis_years?.toString() || "");
      setDonor(r?.donor_relation || "");
      setRelationshipType(r?.donor_relationship_type_id || "");
      setNotes(r?.notes || "");
    }).catch((err) => notify((err as Error).message, "error"));
  }, [db, caseId]);

  const save = async () => {
    if (!db) return;
    try {
      await savePreopBaseline(db, {
        caseId, userId: session?.userId, height_cm: height ? Number(height) : null,
        weight_kg: weight ? Number(weight) : null, measured_at: measuredAt || null,
        asa_classification: asa || null,
        tobacco_status: tobacco || null, functional_status: functional || null,
        dialysis_modality: modality || null,
        dialysis_access: onDialysis ? access || null : null,
        dialysis_years: onDialysis && years ? Number(years) : null,
        donor_relation: donor || null,
        donor_relationship_type_id: donor ? relationshipType || null : null, notes,
      });
      notify("Preoperative baseline saved.", "success");
      flushSheetSync(db).then((r) => {
        if (r.error) notify(`Saved on this workstation. Google Sheet not updated yet: ${r.error}`, "error");
      }).catch((err) => notify((err as Error).message, "error"));
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <section className="glass-card" style={{ padding: 20, display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>Preoperative baseline</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>Height (cm)<input className="glass-input" type="number" min="1" max="299" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
        <label>Weight (kg)<input className="glass-input" type="number" min="1" max="699" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
        <label>Measurement date<input className="glass-input" type="date" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} /></label>
      </div>
      <label>Preoperative ASA class
        <select className="glass-input" value={asa} onChange={(e) => setAsa(e.target.value)}>
          <option value="">Not assessed</option>
          {["I", "II", "III", "IV", "V", "VI", "IE", "IIE", "IIIE", "IVE", "VE"].map((v) => <option key={v}>{v}</option>)}
        </select>
      </label>
      <label>Tobacco status
        <select className="glass-input" value={tobacco}
          onChange={(e) => setTobacco(e.target.value as NonNullable<PreopBaseline["tobacco_status"]> | "")}>
          <option value="">Not assessed</option>
          {["NEVER", "FORMER", "CURRENT", "UNKNOWN"].map((v) => <option key={v}>{v}</option>)}
        </select>
      </label>
      <label>Functional status
        <select className="glass-input" value={functional}
          onChange={(e) => setFunctional(e.target.value as NonNullable<PreopBaseline["functional_status"]> | "")}>
          <option value="">Not assessed</option>
          {["INDEPENDENT", "PARTIALLY_DEPENDENT", "TOTALLY_DEPENDENT", "UNKNOWN"].map((v) =>
            <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <fieldset style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 12, display: "grid", gap: 10, margin: 0 }}>
        <legend style={{ fontSize: 14, fontWeight: 600, padding: "0 6px" }}>Dialysis and donor</legend>
        <label>Dialysis
          <select className="glass-input" value={modality} onChange={(e) => setModality(e.target.value as DialysisModality | "")}>
            <option value="">Not assessed</option>
            {DIALYSIS_MODALITIES.map((v) => <option key={v} value={v}>{MODALITY_LABELS[v]}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label>Dialysis access
            <select className="glass-input" value={onDialysis ? access : ""} disabled={!onDialysis}
              onChange={(e) => setAccess(e.target.value as DialysisAccess | "")}>
              <option value="">Not assessed</option>
              {DIALYSIS_ACCESSES.map((v) => <option key={v} value={v}>{ACCESS_LABELS[v]}</option>)}
            </select>
          </label>
          <label>Years on dialysis
            <input className="glass-input" type="number" min="0" max="60" step="0.1" disabled={!onDialysis}
              value={onDialysis ? years : ""} onChange={(e) => setYears(e.target.value)} />
          </label>
        </div>
        <label>Donor
          <select className="glass-input" value={donor} onChange={(e) => {
            setDonor(e.target.value as DonorRelation | "");
            setRelationshipType("");
          }}>
            <option value="">Not assessed</option>
            {DONOR_RELATIONS.map((v) => <option key={v} value={v}>{DONOR_LABELS[v]}</option>)}
          </select>
        </label>
        <label>Type of relation
          <select className="glass-input" value={donor ? relationshipType : ""} disabled={!donor}
            onChange={(e) => setRelationshipType(e.target.value)}>
            <option value="">Not specified</option>
            {relationshipTypes
              .filter((t) => t.donor_relation === donor && (t.active || t.relationship_type_id === relationshipType))
              .map((t) => <option key={t.relationship_type_id} value={t.relationship_type_id}>{t.name}</option>)}
          </select>
        </label>
      </fieldset>
      <label>Notes<textarea className="glass-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button type="button" className="glass-btn glass-btn-primary" onClick={save}>Save baseline</button>
    </section>
  );
}
