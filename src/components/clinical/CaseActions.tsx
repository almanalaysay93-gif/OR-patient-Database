import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import type { CaseStatus } from "../../services/patients";
import { MOVABLE_STAGES, canCancel, canPostpone, cancelCase, moveCaseStage, postponeCase } from "../../services/caseStage";

type Mode = "cancel" | "postpone" | "move";

const TITLES: Record<Mode, string> = {
  cancel: "Cancel case",
  postpone: "Postpone case",
  move: "Move case to another stage",
};

const HELP: Record<Mode, string> = {
  cancel: "The case is marked cancelled and its OR slot is freed. The record and its history are kept.",
  postpone: "The case is marked postponed and its OR slot is freed. A supervisor can move it back to Pre-Op to rebook it.",
  move: "Use this to correct a case that is in the wrong stage. Records already saved for the case are kept.",
};

interface Props {
  caseId: string;
  status: CaseStatus;
  /** Shown in the dialog so the right case is confirmed, e.g. "CASE-0001 - Santos, Maria". */
  caseLabel: string;
  onDone: () => void | Promise<void>;
}

/** Cancel, postpone and move-stage buttons for one case. Renders nothing the signed-in user may not do. */
export const CaseActions: React.FC<Props> = ({ caseId, status, caseLabel, onDone }) => {
  const { db, can, notify } = useApp();
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<CaseStatus>("PRE_OR");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showCancel = can("cases.edit") && canCancel(status);
  const showPostpone = can("cases.edit") && canPostpone(status);
  const showMove = can("cases.change_stage");
  if (!showCancel && !showPostpone && !showMove) return null;

  const stages = MOVABLE_STAGES.filter((s) => s.status !== status);

  const open = (next: Mode) => {
    setReason("");
    setError(null);
    setTarget(stages[0]?.status ?? "PRE_OR");
    setMode(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !mode || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "cancel") await cancelCase(db, caseId, reason);
      else if (mode === "postpone") await postponeCase(db, caseId, reason);
      else await moveCaseStage(db, caseId, target, reason);
      notify(mode === "cancel" ? "Case cancelled." : mode === "postpone" ? "Case postponed." : "Case moved.", "success");
      setMode(null);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const small: React.CSSProperties = { fontSize: "12px", padding: "6px 10px" };

  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap" }}>
      {showMove && (
        <button type="button" className="glass-btn glass-btn-secondary" style={small} onClick={() => open("move")}>Move stage</button>
      )}
      {showPostpone && (
        <button type="button" className="glass-btn glass-btn-secondary" style={small} onClick={() => open("postpone")}>Postpone</button>
      )}
      {showCancel && (
        <button type="button" className="glass-btn glass-btn-danger" style={small} onClick={() => open("cancel")}>Cancel case</button>
      )}

      {mode && (
        <div
          role="dialog" aria-modal="true" aria-label={TITLES[mode]}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", cursor: "default" }}
        >
          <form onSubmit={submit} className="glass-card" style={{ width: "100%", maxWidth: "480px", padding: "28px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-main)" }}>{TITLES[mode]}</h2>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>{caseLabel}</div>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>{HELP[mode]}</p>

            {mode === "move" && (
              <div>
                <label htmlFor="case-move-target" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                  Move from {status} to
                </label>
                <select id="case-move-target" className="glass-input" value={target} onChange={(e) => setTarget(e.target.value as CaseStatus)}>
                  {stages.map((s) => (
                    <option key={s.status} value={s.status}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="case-action-reason" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                Reason (required, saved in the audit trail)
              </label>
              <textarea
                id="case-action-reason" className="glass-input" autoFocus rows={3} style={{ resize: "vertical" }}
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {error && <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setMode(null)} disabled={busy}>Back</button>
              <button
                type="submit" disabled={busy || reason.trim().length < 3}
                className={`glass-btn ${mode === "cancel" ? "glass-btn-danger" : "glass-btn-primary"}`}
              >
                {busy ? "Saving..." : mode === "cancel" ? "Cancel this case" : mode === "postpone" ? "Postpone this case" : "Move case"}
              </button>
            </div>
          </form>
        </div>
      )}
    </span>
  );
};
