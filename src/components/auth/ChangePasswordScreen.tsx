import React, { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { useApp } from "../../context/AppContext";

/** Shown instead of the app while the account still has a password someone else chose. */
export const ChangePasswordScreen: React.FC = () => {
  const { session, changePassword, onLogout } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const labelStyle: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Choose a new password"
      style={{ position: "fixed", inset: 0, zIndex: 20000, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-app)" }}
    >
      <form onSubmit={submit} className="glass-card" style={{ width: "400px", padding: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <KeyRound size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-main)" }}>Choose a new password</h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {session?.fullName} ({session?.username})
            </p>
          </div>
        </div>

        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Your current password was set by someone else. Replace it with one only you know before you continue.
        </p>

        <div>
          <label htmlFor="change-current" style={labelStyle}>Current password</label>
          <input
            id="change-current" className="glass-input" type="password" autoFocus autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="change-next" style={labelStyle}>New password (at least 8 characters)</label>
          <input
            id="change-next" className="glass-input" type="password" autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="change-confirm" style={labelStyle}>Repeat new password</label>
          <input
            id="change-confirm" className="glass-input" type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && (
          <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{error}</div>
        )}

        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy || !current || !next || !confirm} style={{ justifyContent: "center" }}>
          {busy ? "Saving..." : "Save new password"}
        </button>
        <button type="button" onClick={onLogout} className="glass-btn glass-btn-secondary" style={{ gap: "8px", justifyContent: "center" }}>
          <LogOut size={14} />
          <span>Sign out</span>
        </button>
      </form>
    </div>
  );
};
