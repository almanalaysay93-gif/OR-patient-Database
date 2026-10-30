import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  DIALYSIS_ACCESSES, DIALYSIS_MODALITIES, DONOR_RELATIONS, getPatientData, savePatientData,
  type DialysisAccess, type DialysisModality, type DonorRelation, type PatientData, type PatientDataInput,
} from "../../services/patientData";
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

/** Form values as typed. Empty string means "not entered". */
export interface PatientDataForm {
  height: string;
  weight: string;
  measuredAt: string;
  asa: string;
  tobacco: NonNullable<PatientData["tobacco_status"]> | "";
  functional: NonNullable<PatientData["functional_status"]> | "";
  modality: DialysisModality | "";
  access: DialysisAccess | "";
  years: string;
  donor: DonorRelation | "";
  relationshipType: string;
  notes: string;
}

export const EMPTY_PATIENT_DATA: PatientDataForm = {
  height: "", weight: "", measuredAt: "", asa: "", tobacco: "", functional: "",
  modality: "", access: "", years: "", donor: "", relationshipType: "", notes: "",
};

export function toPatientDataForm(r: PatientData | null): PatientDataForm {
  if (!r) return EMPTY_PATIENT_DATA;
  return {
    height: r.height_cm?.toString() || "", weight: r.weight_kg?.toString() || "", measuredAt: r.measured_at || "",
    asa: r.asa_classification || "", tobacco: r.tobacco_status || "", functional: r.functional_status || "",
    modality: r.dialysis_modality || "", access: r.dialysis_access || "", years: r.dialysis_years?.toString() || "",
    donor: r.donor_relation || "", relationshipType: r.donor_relationship_type_id || "", notes: r.notes || "",
  };
}

export function toPatientDataInput(f: PatientDataForm): PatientDataInput {
  const onDialysis = f.modality !== "" && f.modality !== "NONE";
  return {
    height_cm: f.height ? Number(f.height) : null,
    weight_kg: f.weight ? Number(f.weight) : null,
    measured_at: f.measuredAt || null,
    asa_classification: f.asa || null,
    tobacco_status: f.tobacco || null,
    functional_status: f.functional || null,
    dialysis_modality: f.modality || null,
    dialysis_access: onDialysis ? f.access || null : null,
    dialysis_years: onDialysis && f.years ? Number(f.years) : null,
    donor_relation: f.donor || null,
    donor_relationship_type_id: f.donor ? f.relationshipType || null : null,
    notes: f.notes.trim() || null,
  };
}

/** The Patient's data fields. Used inside the registration form and inside PatientDataPanel. */
export function PatientDataFields({ value, onChange, idPrefix }: {
  value: PatientDataForm;
  onChange: (next: PatientDataForm) => void;
  idPrefix: string;
}) {
  const { db, notify } = useApp();
  const [relationshipTypes, setRelationshipTypes] = useState<DonorRelationshipType[]>([]);
  const set = <K extends keyof PatientDataForm>(key: K, v: PatientDataForm[K]) => onChange({ ...value, [key]: v });
  const onDialysis = value.modality !== "" && value.modality !== "NONE";
  const id = (name: string) => `${idPrefix}-${name}`;
  const label: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13, fontWeight: 600, flex: "1 1 160px", minWidth: 0 };

  useEffect(() => {
    if (!db) return;
    getDonorRelationshipTypes(db, false).then(setRelationshipTypes).catch((err) => notify((err as Error).message, "error"));
  }, [db]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={label} htmlFor={id("height")}>Height (cm)
          <input id={id("height")} className="glass-input" type="number" min="1" max="299" value={value.height} onChange={(e) => set("height", e.target.value)} />
        </label>
        <label style={label} htmlFor={id("weight")}>Weight (kg)
          <input id={id("weight")} className="glass-input" type="number" min="1" max="699" value={value.weight} onChange={(e) => set("weight", e.target.value)} />
        </label>
        <label style={label} htmlFor={id("measured")}>Measurement date
          <input id={id("measured")} className="glass-input" type="date" value={value.measuredAt} onChange={(e) => set("measuredAt", e.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={label} htmlFor={id("asa")}>ASA class
          <select id={id("asa")} className="glass-input" value={value.asa} onChange={(e) => set("asa", e.target.value)}>
            <option value="">Not assessed</option>
            {["I", "II", "III", "IV", "V", "VI", "IE", "IIE", "IIIE", "IVE", "VE"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label style={label} htmlFor={id("tobacco")}>Tobacco status
          <select id={id("tobacco")} className="glass-input" value={value.tobacco} onChange={(e) => set("tobacco", e.target.value as PatientDataForm["tobacco"])}>
            <option value="">Not assessed</option>
            {["NEVER", "FORMER", "CURRENT", "UNKNOWN"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label style={label} htmlFor={id("functional")}>Functional status
          <select id={id("functional")} className="glass-input" value={value.functional} onChange={(e) => set("functional", e.target.value as PatientDataForm["functional"])}>
            <option value="">Not assessed</option>
            {["INDEPENDENT", "PARTIALLY_DEPENDENT", "TOTALLY_DEPENDENT", "UNKNOWN"].map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>
      <fieldset style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 12, display: "grid", gap: 10, margin: 0, minWidth: 0 }}>
        <legend style={{ fontSize: 14, fontWeight: 600, padding: "0 6px" }}>Dialysis and donor</legend>
        <label style={label} htmlFor={id("modality")}>Dialysis
          <select id={id("modality")} className="glass-input" value={value.modality} onChange={(e) => set("modality", e.target.value as PatientDataForm["modality"])}>
            <option value="">Not assessed</option>
            {DIALYSIS_MODALITIES.map((v) => <option key={v} value={v}>{MODALITY_LABELS[v]}</option>)}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={label} htmlFor={id("access")}>Dialysis access
            <select id={id("access")} className="glass-input" value={onDialysis ? value.access : ""} disabled={!onDialysis}
              onChange={(e) => set("access", e.target.value as PatientDataForm["access"])}>
              <option value="">Not assessed</option>
              {DIALYSIS_ACCESSES.map((v) => <option key={v} value={v}>{ACCESS_LABELS[v]}</option>)}
            </select>
          </label>
          <label style={label} htmlFor={id("years")}>Years on dialysis
            <input id={id("years")} className="glass-input" type="number" min="0" max="60" step="0.1" disabled={!onDialysis}
              value={onDialysis ? value.years : ""} onChange={(e) => set("years", e.target.value)} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={label} htmlFor={id("donor")}>Donor
            <select id={id("donor")} className="glass-input" value={value.donor}
              onChange={(e) => onChange({ ...value, donor: e.target.value as PatientDataForm["donor"], relationshipType: "" })}>
              <option value="">Not assessed</option>
              {DONOR_RELATIONS.map((v) => <option key={v} value={v}>{DONOR_LABELS[v]}</option>)}
            </select>
          </label>
          <label style={label} htmlFor={id("relation")}>Type of relation
            <select id={id("relation")} className="glass-input" value={value.donor ? value.relationshipType : ""} disabled={!value.donor}
              onChange={(e) => set("relationshipType", e.target.value)}>
              <option value="">Not specified</option>
              {relationshipTypes
                .filter((t) => t.donor_relation === value.donor && (t.active || t.relationship_type_id === value.relationshipType))
                .map((t) => <option key={t.relationship_type_id} value={t.relationship_type_id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      <label style={label} htmlFor={id("notes")}>Notes
        <textarea id={id("notes")} className="glass-input" value={value.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
    </div>
  );
}

/** Loads and saves one patient's data. Shown on the patient record and in the Pre-OR checklist. */
export function PatientDataPanel({ patientId }: { patientId: string }) {
  const { db, can, notify } = useApp();
  const [form, setForm] = useState<PatientDataForm>(EMPTY_PATIENT_DATA);
  const [busy, setBusy] = useState(false);
  const canEdit = can("patients.create") || can("patients.edit_demographics") || can("preor.edit");

  useEffect(() => {
    if (!db) return;
    setForm(EMPTY_PATIENT_DATA);
    getPatientData(db, patientId).then((r) => setForm(toPatientDataForm(r))).catch((err) => notify((err as Error).message, "error"));
  }, [db, patientId]);

  const save = async () => {
    if (!db || busy) return;
    setBusy(true);
    try {
      await savePatientData(db, patientId, toPatientDataInput(form));
      notify("Patient's data saved.", "success");
      flushSheetSync(db).then((r) => {
        if (r.error) notify(`Saved on this workstation. Google Sheet not updated yet: ${r.error}`, "error");
      }).catch((err) => notify((err as Error).message, "error"));
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass-card" style={{ padding: 20, display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>Patient's data</h2>
      <fieldset disabled={!canEdit} style={{ border: "none", padding: 0, margin: 0, minWidth: 0 }}>
        <PatientDataFields value={form} onChange={setForm} idPrefix={`pd-${patientId}`} />
      </fieldset>
      {canEdit && (
        <button type="button" className="glass-btn glass-btn-primary" onClick={save} disabled={busy} style={{ justifySelf: "start" }}>
          {busy ? "Saving..." : "Save patient's data"}
        </button>
      )}
    </section>
  );
}
