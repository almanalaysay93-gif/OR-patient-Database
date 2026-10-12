import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { useApp } from "../../context/AppContext";

/** Shown before sign-in when the encrypted database cannot be opened by this Windows account. */
export const RecoveryKeyScreen: React.FC = () => {
  const { submitRecoveryKey } = useApp();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitRecoveryKey(key);
    } catch (err) {
      setError(typeof err === "string" ? err : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Enter the recovery key"
      style={{ position: "fixed", inset: 0, zIndex: 20000, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-app)" }}
    >
      <form onSubmit={submit} className="glass-card" style={{ width: "520px", padding: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <KeyRound size={20} />
          </div>
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-main)" }}>Enter the recovery key</h1>
        </div>

        <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
          The patient database is encrypted and this Windows account cannot open it. This happens after the database is moved
          to another PC, Windows is reinstalled, or a different Windows user signs in. Enter the recovery key the administrator
          wrote down from Settings, Backups &amp; Restore. No data has been changed.
        </p>

        <div>
          <label htmlFor="recovery-key" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
            Recovery key (64 characters, 0-9 and A-F)
          </label>
          <textarea
            id="recovery-key" className="glass-input" autoFocus rows={3} autoComplete="off" spellCheck={false}
            style={{ fontFamily: "var(--font-mono)", resize: "none" }}
            value={key} onChange={(e) => setKey(e.target.value)}
          />
        </div>

        {error && (
          <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{error}</div>
        )}

        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy || !key.trim()} style={{ justifyContent: "center" }}>
          {busy ? "Opening..." : "Open database"}
        </button>
      </form>
    </div>
  );
};
