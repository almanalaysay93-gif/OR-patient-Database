import React, { useState } from "react";
import { ShieldCheck, LogIn } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { PasswordInput } from "./PasswordInput";

export const LoginScreen: React.FC = () => {
  const { db, login } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-app)" }}>
      <form onSubmit={submit} className="glass-card" style={{ width: "380px", padding: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-main)" }}>OR Station</h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Sign in to continue</p>
          </div>
        </div>

        <div>
          <label htmlFor="login-username" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Username</label>
          <input
            id="login-username" className="glass-input" autoFocus autoComplete="username" autoCapitalize="none"
            value={username} onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="login-password" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Password</label>
          <PasswordInput
            id="login-password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{error}</div>
        )}

        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy || !db || !username.trim() || !password} style={{ gap: "8px", justifyContent: "center" }}>
          <LogIn size={16} />
          <span>{busy ? "Signing in..." : !db ? "Opening database..." : "Sign In"}</span>
        </button>

        <p style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Accounts are created by the administrator. Ask them if you need one or forgot your password.
        </p>

        {/* DRAFT notice: wording needs approval by the hospital data protection officer before release. */}
        <section aria-labelledby="login-notice-title" style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5, borderTop: "1px solid var(--border-glass)", paddingTop: "12px" }}>
          <h2 id="login-notice-title" style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
            Authorized use only
          </h2>
          <p>
            This station holds personal and health information of patients.
            Sign in only with your own account and only for patient care or approved hospital work.
            Data is handled under the Data Privacy Act of 2012 (Republic Act No. 10173) and hospital policy.
            Actions are recorded in an audit log.
          </p>
        </section>
      </form>
    </div>
  );
};
