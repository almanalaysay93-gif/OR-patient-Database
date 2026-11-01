import React, { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { CaseActions } from "../components/clinical/CaseActions";
import {
  getPreOrBoardCases,
  getPreOrChecklist,
  updateChecklistItem,
  type ChecklistItemValue,
  type ReadinessCalculation,
} from "../services/preOr";
import { PatientDataPanel } from "../components/clinical/PatientDataPanel";
import { filterBoardRows, pageBoardRows } from "../services/preOrBoardTable";
import type { CaseStatus } from "../services/patients";
import { logError } from "../services/logger";

export const PreOrView: React.FC = () => {
  const { db, session, selectedCaseId, setSelectedCaseId, setSelectedPatientId, setView, notify } = useApp();
  const [boardCases, setBoardCases] = useState<any[]>([]);
  const [activeChecklistCase, setActiveChecklistCase] = useState<any | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItemValue[]>([]);
  const [readiness, setReadiness] = useState<ReadinessCalculation | null>(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<CaseStatus | null>(null);
  const [page, setPage] = useState(1);

  const loadBoard = async () => {
    if (!db) return;
    try {
      const rows = await getPreOrBoardCases(db);
      setBoardCases(rows);
    } catch (err) {
      logError("PreOrView.load", err);
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
        logError("PreOrView.save", err);
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
        userId: session?.userId,
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

  const stages: { value: CaseStatus | null; label: string }[] = [
    { value: null, label: "All" },
    { value: "PRE_OR", label: "Not Started" },
    { value: "NOT_READY", label: "Incomplete / Blocked" },
    { value: "READY", label: "Ready for OR" },
    { value: "SCHEDULED", label: "Scheduled" },
  ];
  const stageCount = (value: CaseStatus | null) =>
    value ? boardCases.filter((c) => c.case_status === value).length : boardCases.length;
  const matches = filterBoardRows(boardCases, query, stage);
  const selectedCasePatientId: string | undefined = boardCases.find((b) => b.case_id === selectedCaseId)?.patient_id;
  const pageData = pageBoardRows(matches, page);
  const readinessClass = (p: number) => (p >= 100 ? "badge-success" : p > 50 ? "badge-warning" : "badge-danger");

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>
          Pre-OR Safety & Readiness Board
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
          Search, filter and open a case to complete its checklist. Non-applicable items do not penalize readiness.
        </p>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: "480px" }}>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-subtle)" }} />
          <input
            className="glass-input"
            type="search"
            aria-label="Search cases by patient, HRN, case number, procedure or room"
            placeholder="Search patient, HRN, case, procedure or room"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            style={{ width: "100%", paddingLeft: 36 }}
          />
        </div>
        <div role="group" aria-label="Filter by stage" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {stages.map((s) => (
            <button
              key={s.label}
              type="button"
              aria-pressed={stage === s.value}
              onClick={() => { setStage(s.value); setPage(1); }}
              className={stage === s.value ? "glass-btn glass-btn-primary" : "glass-btn glass-btn-secondary"}
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              {s.label} <span style={{ opacity: 0.75 }}>({stageCount(s.value)})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="mobile-record-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", borderBottom: "1px solid var(--border-glass)" }}>
                {["Patient", "HRN", "Case", "Procedure", "Stage", "Room", "Readiness", "Actions"].map((h) => (
                  <th key={h} scope="col" style={{ padding: "12px 14px", fontWeight: 700, fontSize: "12px", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.rows.map((c) => (
                <tr
                  key={c.case_id}
                  onClick={() => { setSelectedCaseId(c.case_id); setSelectedPatientId(c.patient_id); }}
                  style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <td data-label="Patient" style={{ padding: "12px 14px", fontWeight: 700, color: "var(--text-main)", whiteSpace: "nowrap" }}>{c.patient_name}</td>
                  <td data-label="HRN" style={{ padding: "12px 14px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{c.hrn || "-"}</td>
                  <td data-label="Case" style={{ padding: "12px 14px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{c.case_number}</td>
                  <td data-label="Procedure" style={{ padding: "12px 14px", color: "var(--text-main)", minWidth: 200 }}>{c.planned_procedure_summary || "Procedure"}</td>
                  <td data-label="Stage" style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    {stages.find((s) => s.value === c.case_status)?.label || c.case_status}
                  </td>
                  <td data-label="Room" style={{ padding: "12px 14px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{c.room_name || "Unassigned"}</td>
                  <td data-label="Readiness" style={{ padding: "12px 14px" }}>
                    <span className={`badge ${readinessClass(c.readiness_percentage)}`} style={{ fontSize: "11px" }}>
                      {c.readiness_percentage}%
                    </span>
                  </td>
                  <td data-label="Actions" style={{ padding: "12px 14px" }} onClick={(e) => e.stopPropagation()}>
                    <CaseActions
                      caseId={c.case_id} status={c.case_status}
                      caseLabel={`${c.case_number} - ${c.patient_name}`} onDone={loadBoard}
                    />
                  </td>
                </tr>
              ))}
              {pageData.rows.length === 0 && (
                <tr>
                  <td className="table-empty" colSpan={8} style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>
                    {boardCases.length === 0 ? "No cases on the Pre-OR board." : "No cases match this search or stage."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <nav aria-label="Board pages" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "12px 14px", borderTop: "1px solid var(--border-glass)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }} aria-live="polite">
            {pageData.total === 0 ? "0 cases" : `Showing ${pageData.from}-${pageData.to} of ${pageData.total}`}
          </span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button type="button" className="glass-btn glass-btn-secondary" disabled={pageData.page <= 1}
              onClick={() => setPage(pageData.page - 1)} style={{ padding: "6px 10px" }} aria-label="Previous page">
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: "12px", color: "var(--text-main)" }}>Page {pageData.page} of {pageData.pageCount}</span>
            <button type="button" className="glass-btn glass-btn-secondary" disabled={pageData.page >= pageData.pageCount}
              onClick={() => setPage(pageData.page + 1)} style={{ padding: "6px 10px" }} aria-label="Next page">
              <ChevronRight size={14} />
            </button>
          </div>
        </nav>
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
                      "Pre-OR milestones complete. Review surgical safety phases separately."
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

            {selectedCasePatientId && <PatientDataPanel patientId={selectedCasePatientId} />}

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
