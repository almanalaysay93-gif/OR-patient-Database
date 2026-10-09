import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import { getPreopBaseline, savePreopBaseline, type PreopBaseline } from "../../services/preopBaseline";

export function PreopBaselinePanel({ caseId }: { caseId: string }) {
  const { db, session, notify } = useApp();
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");
  const [asa, setAsa] = useState("");
  const [tobacco, setTobacco] = useState<NonNullable<PreopBaseline["tobacco_status"]> | "">("");
  const [functional, setFunctional] = useState<NonNullable<PreopBaseline["functional_status"]> | "">("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!db) return;
    getPreopBaseline(db, caseId).then((r) => {
      setHeight(r?.height_cm?.toString() || "");
      setWeight(r?.weight_kg?.toString() || "");
      setMeasuredAt(r?.measured_at || "");
      setAsa(r?.asa_classification || "");
      setTobacco(r?.tobacco_status || "");
      setFunctional(r?.functional_status || "");
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
        tobacco_status: tobacco || null, functional_status: functional || null, notes,
      });
      notify("Preoperative baseline saved.", "success");
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
      <label>Notes<textarea className="glass-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button type="button" className="glass-btn glass-btn-primary" onClick={save}>Save baseline</button>
    </section>
  );
}
