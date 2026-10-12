import React, { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { countDemoPatients, seedDemoData } from "../../services/demoData";

/** Browser preview only: fills the test database with simulated patients. Never shown on the desktop app. */
export const DemoDataPanel: React.FC = () => {
  const { db, notify } = useApp();
  const [loaded, setLoaded] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (db) countDemoPatients(db).then(setLoaded).catch(() => setLoaded(0));
  }, [db]);

  if (!db || db.kind !== "sqljs") return null;

  const handleLoad = async () => {
    if (progress) return;
    setProgress("Starting…");
    try {
      const summary = await seedDemoData(db, (done, total) => setProgress(`${done} of ${total}`));
      setLoaded(summary.total);
      notify(`${summary.total} demo patients loaded.`, "success");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Demo patients (browser preview only)
      </h2>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
        Loads 100 simulated patients spread across every stage: pre-op, scheduled, in the OR, recovery,
        completed, cancelled, postponed and archived. Their record numbers start with DEMO-.
      </p>
      {loaded > 0 ? (
        <p style={{ fontSize: "13px", fontWeight: 600 }}>{loaded} demo patients are loaded.</p>
      ) : (
        <button type="button" className="glass-btn glass-btn-primary" onClick={handleLoad} disabled={!!progress} style={{ gap: "6px", alignSelf: "flex-start" }}>
          <FlaskConical size={14} />
          <span>{progress ? `Loading ${progress}` : "Load 100 demo patients"}</span>
        </button>
      )}
    </div>
  );
};
