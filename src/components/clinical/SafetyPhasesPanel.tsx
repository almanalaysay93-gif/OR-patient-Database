import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  getSafetyItems, phaseComplete, saveSafetyResponse,
  type SafetyItem, type SafetyPhase, type SafetyStatus,
} from "../../services/safetyPhases";

const PHASES: SafetyPhase[] = ["SIGN_IN", "TIME_OUT", "SIGN_OUT"];
const STATUSES: SafetyStatus[] = ["PENDING", "COMPLETE", "FAILED", "NOT_APPLICABLE"];

export function SafetyPhasesPanel({ caseId }: { caseId: string }) {
  const { db, session, notify } = useApp();
  const [items, setItems] = useState<SafetyItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reload = async () => {
    if (!db) return;
    const rows = await getSafetyItems(db, caseId);
    setItems(rows);
    setNotes(Object.fromEntries(rows.map((item) => [item.item_id, item.notes || ""])));
  };

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [db, caseId]);

  const change = async (item: SafetyItem, status: SafetyStatus) => {
    if (!db) return;
    try {
      await saveSafetyResponse(db, {
        caseId, itemId: item.item_id, status, notes: notes[item.item_id] || null, userId: session?.userId,
      });
      await reload();
      notify("Safety check recorded.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <section className="glass-card" style={{ padding: 20, display: "grid", gap: 16 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>Surgical safety phases</h2>
      <p style={{ margin: 0, fontSize: 12 }}>Draft checklist requires facility review before clinical use. Pre-OR readiness is recorded separately.</p>
      {PHASES.map((phase) => (
        <div key={phase} style={{ display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {phase.replace(/_/g, " ")}: {phaseComplete(items, phase) ? "Complete" : "Incomplete"}
          </h3>
          {items.filter((item) => item.phase === phase).map((item) => (
            <div key={item.item_id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                <select className="glass-input" aria-label={`${item.label} status`} value={item.status}
                  onChange={(e) => change(item, e.target.value as SafetyStatus)}>
                  {STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
                </select>
                <input className="glass-input" aria-label={`${item.label} note`} placeholder="Reason or note"
                  value={notes[item.item_id] || ""}
                  onChange={(e) => setNotes((old) => ({ ...old, [item.item_id]: e.target.value }))} />
                <button type="button" className="glass-btn glass-btn-secondary"
                  onClick={() => change(item, item.status)}>Save note</button>
              </div>
              {item.recorded_at && <small>Recorded {new Date(item.recorded_at).toLocaleString()}</small>}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
