import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  createDiagnosis, createProcedure, getDiagnoses, getProcedures, type Diagnosis, type Procedure,
} from "../../services/masterData";
import { getCaseCoding, saveCaseCoding, type DiagnosisType } from "../../services/caseCoding";

const TYPES: DiagnosisType[] = ["PRE_OPERATIVE", "POST_OPERATIVE", "COMORBIDITY", "OTHER"];

export function CaseCodingPanel({ caseId }: { caseId: string }) {
  const { db, session, notify } = useApp();
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [primary, setPrimary] = useState("");
  const [additional, setAdditional] = useState<string[]>([]);
  const [selectedDiagnoses, setSelectedDiagnoses] = useState<{ diagnosisId: string; type: DiagnosisType }[]>([]);
  const [diagnosisId, setDiagnosisId] = useState("");
  const [diagnosisType, setDiagnosisType] = useState<DiagnosisType>("PRE_OPERATIVE");
  const [saving, setSaving] = useState(false);
  const [newProcedure, setNewProcedure] = useState("");
  const [newDiagnosis, setNewDiagnosis] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newSystem, setNewSystem] = useState("");

  useEffect(() => {
    if (!db) return;
    Promise.all([getProcedures(db, false), getDiagnoses(db, false), getCaseCoding(db, caseId)])
      .then(([proc, dx, coding]) => {
        setProcedures(proc);
        setDiagnoses(dx);
        setPrimary(coding.procedures.find((p) => p.is_primary)?.procedure_id || "");
        setAdditional(coding.procedures.filter((p) => !p.is_primary).map((p) => p.procedure_id));
        setSelectedDiagnoses(coding.diagnoses.map((d) => ({ diagnosisId: d.diagnosis_id, type: d.diagnosis_type })));
      })
      .catch((err) => notify((err as Error).message, "error"));
  }, [db, caseId]);

  const save = async () => {
    if (!db) return;
    setSaving(true);
    try {
      await saveCaseCoding(db, {
        caseId, primaryProcedureId: primary || null,
        additionalProcedureIds: additional.filter((id) => id !== primary),
        diagnoses: selectedDiagnoses, userId: session?.userId,
      });
      notify("Case coding saved.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const addCatalogItem = async (kind: "procedure" | "diagnosis") => {
    if (!db) return;
    try {
      if (kind === "procedure") {
        const item = await createProcedure(db, {
          name: newProcedure, code: newCode, codeSystem: newSystem, userId: session?.userId,
        });
        setProcedures((old) => [...old, item].sort((a, b) => a.procedure_name.localeCompare(b.procedure_name)));
        setPrimary(item.procedure_id);
        setNewProcedure("");
      } else {
        const item = await createDiagnosis(db, {
          name: newDiagnosis, code: newCode, codeSystem: newSystem, userId: session?.userId,
        });
        setDiagnoses((old) => [...old, item].sort((a, b) => a.diagnosis_name.localeCompare(b.diagnosis_name)));
        setDiagnosisId(item.diagnosis_id);
        setNewDiagnosis("");
      }
      setNewCode("");
      setNewSystem("");
      notify("Catalog term added. Save case coding to link it.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <section className="glass-card" style={{ padding: 20, display: "grid", gap: 14 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>Procedures and diagnoses</h2>
      <div style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0 }}>Add a local catalog term when the correct term is missing.</p>
        <input className="glass-input" aria-label="New procedure name" placeholder="New procedure name"
          value={newProcedure} onChange={(e) => setNewProcedure(e.target.value)} />
        <input className="glass-input" aria-label="New diagnosis name" placeholder="New diagnosis name"
          value={newDiagnosis} onChange={(e) => setNewDiagnosis(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <input className="glass-input" aria-label="Catalog code" placeholder="Code (optional)"
            value={newCode} onChange={(e) => setNewCode(e.target.value)} />
          <input className="glass-input" aria-label="Code system" placeholder="Code system (optional)"
            value={newSystem} onChange={(e) => setNewSystem(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="glass-btn glass-btn-secondary" disabled={!newProcedure.trim()}
            onClick={() => addCatalogItem("procedure")}>Add procedure term</button>
          <button type="button" className="glass-btn glass-btn-secondary" disabled={!newDiagnosis.trim()}
            onClick={() => addCatalogItem("diagnosis")}>Add diagnosis term</button>
        </div>
      </div>
      <label>
        Primary procedure
        <select className="glass-input" value={primary} onChange={(e) => setPrimary(e.target.value)}>
          <option value="">Not yet coded</option>
          {procedures.map((p) => <option key={p.procedure_id} value={p.procedure_id} disabled={!p.active && p.procedure_id !== primary}>
            {p.procedure_name}{p.active ? "" : " (archived)"}
          </option>)}
        </select>
      </label>
      <div>
        <div>Additional procedures</div>
        {procedures.filter((p) => p.procedure_id !== primary).map((p) => (
          <label key={p.procedure_id} style={{ display: "block", marginTop: 6 }}>
            <input type="checkbox" checked={additional.includes(p.procedure_id)}
              disabled={!p.active && !additional.includes(p.procedure_id)}
              onChange={(e) => setAdditional((old) => e.target.checked
                ? [...old, p.procedure_id] : old.filter((id) => id !== p.procedure_id))} /> {p.procedure_name}
          </label>
        ))}
        {procedures.length === 0 && <p>No procedure catalog entries. Add them in master data first.</p>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="glass-input" aria-label="Diagnosis type" value={diagnosisType}
          onChange={(e) => setDiagnosisType(e.target.value as DiagnosisType)}>
          {TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
        </select>
        <select className="glass-input" aria-label="Diagnosis" value={diagnosisId}
          onChange={(e) => setDiagnosisId(e.target.value)}>
          <option value="">Select diagnosis</option>
          {diagnoses.map((d) => <option key={d.diagnosis_id} value={d.diagnosis_id} disabled={!d.active}>
            {d.diagnosis_name}{d.active ? "" : " (archived)"}
          </option>)}
        </select>
        <button type="button" className="glass-btn glass-btn-secondary" disabled={!diagnosisId}
          onClick={() => {
            if (!selectedDiagnoses.some((d) => d.diagnosisId === diagnosisId && d.type === diagnosisType)) {
              setSelectedDiagnoses((old) => [...old, { diagnosisId, type: diagnosisType }]);
            }
            setDiagnosisId("");
          }}>Add diagnosis</button>
      </div>
      {selectedDiagnoses.map((item) => (
        <div key={`${item.type}:${item.diagnosisId}`} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{item.type.replace(/_/g, " ")}: {diagnoses.find((d) => d.diagnosis_id === item.diagnosisId)?.diagnosis_name || item.diagnosisId}</span>
          <button type="button" className="glass-btn glass-btn-secondary"
            onClick={() => setSelectedDiagnoses((old) => old.filter((d) => d !== item))}>Remove</button>
        </div>
      ))}
      <button type="button" className="glass-btn glass-btn-primary" disabled={saving} onClick={save}>Save case coding</button>
    </section>
  );
}
