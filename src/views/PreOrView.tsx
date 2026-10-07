import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  getPreOrBoardCases,
  getPreOrChecklist,
  updateChecklistItem,
  type ChecklistItemValue,
  type ReadinessCalculation,
} from "../services/preOr";

export const PreOrView: React.FC = () => {
  const { db, selectedCaseId, setSelectedCaseId, setSelectedPatientId, setView, notify } = useApp();
  const [boardCases, setBoardCases] = useState<any[]>([]);
  const [activeChecklistCase, setActiveChecklistCase] = useState<any | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItemValue[]>([]);
  const [readiness, setReadiness] = useState<ReadinessCalculation | null>(null);

  const loadBoard = async () => {
    if (!db) return;
    try {
      const rows = await getPreOrBoardCases(db);
      setBoardCases(rows);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadBoard();
  }, [db]);

  useEffect(() => {
    async function loadChecklist() {
      if (!db || !selectedCaseId) {
        setActiveChecklistCase(null);
        setChecklistItems([]);
        setReadiness(null);
        return;
      }
      try {
        const c = boardCases.find((b) => b.case_id === selectedCaseId);
        if (c) setActiveChecklistCase(c);
        const res = await getPreOrChecklist(db, selectedCaseId);
        setChecklistItems(res.items);
        setReadiness(res.readiness);
      } catch (err) {
        console.error(err);
      }
    }
    loadChecklist();
  }, [db, selectedCaseId, boardCases]);

  const handleStatusChange = async (itemId: string, status: any) => {
    if (!db || !selectedCaseId) return;
    try {
      const updated = await updateChecklistItem(db, {
        caseId: selectedCaseId,
        checklistItemId: itemId,
        status,
      });
      setReadiness(updated);
      const res = await getPreOrChecklist(db, selectedCaseId);
      setChecklistItems(res.items);
      notify(`Milestone updated. Readiness is now ${updated.readinessPercentage}%.`, "success");
      await loadBoard();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const columns = [
    { title: "Not Started", status: "PRE_OR", color: "var(--text-muted)" },
    { title: "Incomplete / Blocked", status: "NOT_READY", color: "var(--warning)" },
    { title: "Ready for OR", status: "READY", color: "var(--success)" },
    { title: "Scheduled", status: "SCHEDULED", color: "var(--primary)" },
  ];

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Title */}
      <div>
        <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>
          Pre-OR Safety & Readiness Board
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
          Dynamic checklist tracking with readiness calculations. Non-applicable items do not penalize readiness.
        </p>
      </div>

      {/* Kanban Columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px" }}>
        {columns.map((col) => {
          const colCases = boardCases.filter((c) => c.case_status === col.status);
          return (
            <div
              key={col.status}
              className="glass-card"
              style={{
                background: "rgba(255, 255, 255, 0.55)",
                padding: "18px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                minHeight: "560px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
                <span style={{ fontWeight: 700, fontSize: "14px", color: col.color }}>
                  {col.title}
                </span>
                <span className="badge badge-neutral" style={{ fontSize: "11px" }}>
                  {colCases.length}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {colCases.map((c) => (
                  <div
                    key={c.case_id}
                    onClick={() => {
                      setSelectedCaseId(c.case_id);
                      setSelectedPatientId(c.patient_id);
                    }}
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "12px",
                      padding: "14px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      boxShadow: "var(--shadow-sm)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--primary) ")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-main)" }}>
                        {c.patient_name}
                      </span>
                      <span
                        className={`badge ${
                          c.readiness_percentage >= 100
                            ? "badge-success"
                            : c.readiness_percentage > 50
                            ? "badge-warning"
                            : "badge-danger"
                        }`}
                        style={{ fontSize: "11px" }}
                      >
                        {c.readiness_percentage}% Ready
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      {c.planned_procedure_summary || "Procedure"}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-subtle)", borderTop: "1px solid var(--border-subtle)", paddingTop: "6px" }}>
                      <span>Case: {c.case_number}</span>
                      <span>{c.room_name || "Unassigned"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Checklist Assessment Modal / Drawer */}
      {selectedCaseId && activeChecklistCase && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => setSelectedCaseId(null)}
        >
          <div
            className="glass-card"
            style={{
              width: "100%",
              maxWidth: "760px",
              maxHeight: "85vh",
              overflowY: "auto",
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border-glass)", paddingBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h2 style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-main)" }}>
                    Pre-OR Checklist: {activeChecklistCase.patient_name}
                  </h2>
                  <span className="badge badge-primary">{activeChecklistCase.case_number}</span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
                  {activeChecklistCase.planned_procedure_summary}
                </div>
              </div>
              <button onClick={() => setSelectedCaseId(null)} className="glass-btn glass-btn-secondary" style={{ padding: "6px" }}>
                <X size={16} />
              </button>
            </div>

            {/* Readiness Score Banner */}
            {readiness && (
              <div
                style={{
                  background: readiness.isReady ? "var(--success-light)" : "var(--warning-light)",
                  border: `1px solid ${readiness.isReady ? "var(--success-border)" : "var(--warning-border)"}`,
                  borderRadius: "14px",
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: readiness.isReady ? "var(--success)" : "var(--warning)" }}>
                    Readiness: {readiness.readinessPercentage}% ({readiness.completedItems} / {readiness.applicableItems} milestones)
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-main)", marginTop: "2px" }}>
                    {readiness.isReady ? (
                      "All applicable pre-operative milestones verified. Patient cleared for OR."
                    ) : (
                      <span>Missing: <strong>{readiness.missingItems.join(", ") || "None"}</strong></span>
                    )}
                  </div>
                </div>
                <span className={`badge ${readiness.isReady ? "badge-success" : "badge-warning"}`} style={{ fontSize: "13px", padding: "6px 14px" }}>
                  {readiness.isReady ? "CLEARED" : "INCOMPLETE"}
                </span>
              </div>
            )}

            {/* Checklist Items Table */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {checklistItems.map((item) => (
                <div
                  key={item.checklist_item_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderRadius: "10px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-main)" }}>
                      {item.item_name}
                    </div>
                    {item.description && (
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                        {item.description}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "6px" }}>
                    {(["COMPLETE", "PENDING", "NOT_APPLICABLE", "FAILED"] as const).map((st) => (
                      <button
                        key={st}
                        onClick={() => handleStatusChange(item.checklist_item_id, st)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--border-subtle)",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                          background:
                            item.status === st
                              ? st === "COMPLETE"
                                ? "var(--success)"
                                : st === "PENDING"
                                ? "var(--warning)"
                                : st === "FAILED"
                                ? "var(--danger)"
                                : "var(--primary)"
                              : "transparent",
                          color: item.status === st ? "#fff" : "var(--text-muted)",
                        }}
                      >
                        {st.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-glass)", paddingTop: "16px" }}>
              <button
                onClick={() => {
                  setView("schedule");
                }}
                className="glass-btn glass-btn-primary"
                style={{ gap: "6px" }}
              >
                <span>Proceed to Schedule</span>
                <ArrowRight size={14} />
              </button>
              <button onClick={() => setSelectedCaseId(null)} className="glass-btn glass-btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
