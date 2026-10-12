import React, { useState } from "react";
import { Lock, LogOut } from "lucide-react";
import { useApp } from "../../context/AppContext";

/** Covers the app while it is locked. Unsaved work underneath is kept and comes back after unlocking. */
export const LockScreen: React.FC = () => {
  const { session, unlock, onLogout } = useApp();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Workstation locked"
      style={{ position: "fixed", inset: 0, zIndex: 20000, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-app)" }}
    >
      <form onSubmit={submit} className="glass-card" style={{ width: "380px", padding: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Lock size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-main)" }}>Workstation locked</h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {session?.fullName} ({session?.username})
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="unlock-password" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Password</label>
          <input
            id="unlock-password" className="glass-input" type="password" autoFocus autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{error}</div>
        )}

        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy || !password} style={{ justifyContent: "center" }}>
          {busy ? "Checking..." : "Unlock"}
        </button>
        <button type="button" onClick={onLogout} className="glass-btn glass-btn-secondary" style={{ gap: "8px", justifyContent: "center" }}>
          <LogOut size={14} />
          <span>Sign out (unsaved work is lost)</span>
        </button>
      </form>
    </div>
  );
};
