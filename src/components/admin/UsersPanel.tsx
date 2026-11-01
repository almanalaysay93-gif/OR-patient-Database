import React, { useCallback, useEffect, useState } from "react";
import { UserPlus, Wand2, Copy, Eye, EyeOff } from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  MASTER_ADMIN_ID, createUser, forgetSavedPassword, getSavedPassword, listRoles, listUsers, resetUserPassword,
  setUserActive, setUserRole, type RoleOption, type StaffAccount,
} from "../../services/userAdmin";
import { generatePassword } from "../../services/passwordGenerator";

const label: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" };
const cell: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: "13px", borderBottom: "1px solid var(--border-glass)" };
const small: React.CSSProperties = { padding: "4px 10px", fontSize: "12px", gap: "4px" };

/** Copies text inside the click handler. Returns false when the clipboard is not available. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Password box with Show, Generate and Copy. A generated password is shown so it can be read out or copied. */
const PasswordField: React.FC<{
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onCopied: (ok: boolean) => void;
  compact?: boolean;
}> = ({ id, label: ariaLabel, value, onChange, onCopied, compact }) => {
  const [visible, setVisible] = useState(false);
  const btn = compact ? small : { ...small, padding: "6px 10px" };
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
      <input
        id={id}
        className="glass-input"
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        spellCheck={false}
        aria-label={ariaLabel}
        placeholder={compact ? "New password" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: "1 1 140px", minWidth: 0, fontFamily: visible ? "var(--font-mono)" : undefined, ...(compact ? { padding: "4px 8px", fontSize: "12px" } : {}) }}
      />
      <button type="button" className="glass-btn glass-btn-secondary" style={btn} onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-controls={id} title={visible ? "Hide password" : "Show password"}>
        {visible ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
        <span>{visible ? "Hide" : "Show"}</span>
      </button>
      <button type="button" className="glass-btn glass-btn-secondary" style={btn} onClick={() => { onChange(generatePassword()); setVisible(true); }} title="Fill in a strong random password">
        <Wand2 size={13} aria-hidden="true" />
        <span>Generate</span>
      </button>
      <button type="button" className="glass-btn glass-btn-secondary" style={btn} disabled={!value} onClick={async () => onCopied(await copyText(value))}>
        <Copy size={13} aria-hidden="true" />
        <span>Copy</span>
      </button>
    </div>
  );
};

export const UsersPanel: React.FC = () => {
  const { db, session, notify } = useApp();
  const [users, setUsers] = useState<StaffAccount[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [form, setForm] = useState({ username: "", fullName: "", roleId: "role-nurse", password: "", savePassword: true });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [keepReset, setKeepReset] = useState(true);
  /** Saved passwords the admin chose to show, by account. Cleared when the list reloads. */
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!db) return;
    const [u, r] = await Promise.all([listUsers(db), listRoles(db)]);
    setUsers(u);
    setRoles(r);
    setShown({});
  }, [db]);

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [reload]);

  /** Runs one account change, then refreshes the list. */
  const run = async (action: () => Promise<unknown>, done: string) => {
    if (!db || busy) return false;
    setBusy(true);
    try {
      await action();
      await reload();
      notify(done, "success");
      return true;
    } catch (err) {
      notify((err as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    if (await run(() => createUser(db, form), `Account created for ${form.fullName.trim()}.`)) {
      setForm({ username: "", fullName: "", roleId: form.roleId, password: "", savePassword: form.savePassword });
    }
  };

  const handleReset = async (e: React.FormEvent, user: StaffAccount) => {
    e.preventDefault();
    if (!db) return;
    if (await run(() => resetUserPassword(db, user.user_id, newPassword, keepReset), `Password reset for ${user.username}.`)) {
      setResetFor(null);
      setNewPassword("");
    }
  };

  const copied = (ok: boolean) =>
    notify(ok ? "Password copied." : "Copy is blocked here. Select the password and copy it by hand.", ok ? "success" : "warning");

  const showSaved = async (user: StaffAccount) => {
    if (!db) return;
    try {
      const pw = await getSavedPassword(db, user.user_id);
      if (pw === null) {
        notify(`No saved password for ${user.username}.`, "warning");
        await reload();
      } else {
        setShown((s) => ({ ...s, [user.user_id]: pw }));
      }
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const hideSaved = (userId: string) =>
    setShown((s) => {
      const next = { ...s };
      delete next[userId];
      return next;
    });

  return (
    <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", gridColumn: "1 / -1" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Staff Accounts
      </h2>

      <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr)) minmax(0, 2fr) auto", gap: "12px", alignItems: "end" }}>
        <div>
          <label htmlFor="new-user-name" style={label}>Full name</label>
          <input id="new-user-name" className="glass-input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </div>
        <div>
          <label htmlFor="new-user-username" style={label}>Username</label>
          <input id="new-user-username" className="glass-input" autoComplete="off" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div>
          <label htmlFor="new-user-role" style={label}>Role</label>
          <select id="new-user-role" className="glass-input" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
            {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="new-user-password" style={label}>Starting password (12+ characters)</label>
          <PasswordField id="new-user-password" value={form.password} onChange={(password) => setForm({ ...form, password })} onCopied={copied} />
        </div>
        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy} style={{ gap: "6px" }}>
          <UserPlus size={14} />
          <span>Add Account</span>
        </button>
        <label style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
          <input type="checkbox" id="new-user-save" checked={form.savePassword} onChange={(e) => setForm({ ...form, savePassword: e.target.checked })} />
          Save this password so an administrator can look it up later
        </label>
      </form>

      <div style={{ overflowX: "auto" }}>
        <table className="mobile-record-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Name", "Username", "Role", "Status", "Last sign-in", "Saved password", "Actions"].map((h) => (
                <th key={h} style={{ ...cell, fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMaster = u.user_id === MASTER_ADMIN_ID;
              const isSelf = u.user_id === session?.userId;
              return (
                <tr key={u.user_id}>
                  <td data-label="Name" style={cell}>{u.full_name}</td>
                  <td data-label="Username" style={{ ...cell, fontFamily: "var(--font-mono)" }}>{u.username}</td>
                  <td data-label="Role" style={cell}>
                    <select
                      className="glass-input" aria-label={`Role for ${u.username}`} style={{ padding: "4px 8px", fontSize: "12px" }}
                      value={u.role_id} disabled={busy || isMaster || isSelf}
                      onChange={(e) => db && run(() => setUserRole(db, u.user_id, e.target.value), `Role updated for ${u.username}.`)}
                    >
                      {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td data-label="Status" style={cell}>
                    <span className={`badge ${u.active ? "badge-success" : "badge-neutral"}`}>{u.active ? "Active" : "Deactivated"}</span>
                  </td>
                  <td data-label="Last sign-in" style={cell}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                  <td data-label="Saved password" style={cell}>
                    {!u.password_saved_at ? (
                      <span style={{ color: "var(--text-subtle)" }}>None</span>
                    ) : shown[u.user_id] !== undefined ? (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: "12px", userSelect: "all", padding: "2px 6px", borderRadius: "6px", background: "var(--primary-light)" }}>
                          {shown[u.user_id]}
                        </code>
                        <button type="button" className="glass-btn glass-btn-secondary" style={small} onClick={async () => copied(await copyText(shown[u.user_id]))}>
                          <Copy size={12} aria-hidden="true" /><span>Copy</span>
                        </button>
                        <button type="button" className="glass-btn glass-btn-secondary" style={small} onClick={() => hideSaved(u.user_id)}>
                          <EyeOff size={12} aria-hidden="true" /><span>Hide</span>
                        </button>
                        <button
                          type="button" className="glass-btn glass-btn-danger" style={small} disabled={busy}
                          onClick={() => db && run(() => forgetSavedPassword(db, u.user_id), `Saved password for ${u.username} deleted.`)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="glass-btn glass-btn-secondary" style={small} onClick={() => showSaved(u)} title={`Saved ${new Date(u.password_saved_at).toLocaleString()}`}>
                        <Eye size={12} aria-hidden="true" /><span>Show</span>
                      </button>
                    )}
                  </td>
                  <td data-label="Actions" style={cell}>
                    {resetFor === u.user_id ? (
                      <form onSubmit={(e) => handleReset(e, u)} style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "320px" }}>
                        <PasswordField
                          id={`reset-password-${u.user_id}`} label={`New password for ${u.username}`}
                          value={newPassword} onChange={setNewPassword} onCopied={copied} compact
                        />
                        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-muted)", marginRight: "auto" }}>
                            <input type="checkbox" id={`reset-save-${u.user_id}`} checked={keepReset} onChange={(e) => setKeepReset(e.target.checked)} />
                            Save for lookup
                          </label>
                          <button type="submit" className="glass-btn glass-btn-primary" disabled={busy} style={small}>Save</button>
                          <button type="button" className="glass-btn glass-btn-secondary" style={small} onClick={() => { setResetFor(null); setNewPassword(""); }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button className="glass-btn glass-btn-secondary" style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => { setResetFor(u.user_id); setNewPassword(""); }}>
                          Reset password
                        </button>
                        {!isMaster && !isSelf && (
                          <button
                            className={`glass-btn ${u.active ? "glass-btn-danger" : "glass-btn-secondary"}`} disabled={busy}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                            onClick={() => db && run(() => setUserActive(db, u.user_id, !u.active), `${u.username} ${u.active ? "deactivated" : "reactivated"}.`)}
                          >
                            {u.active ? "Deactivate" : "Reactivate"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>
        Deactivated staff cannot sign in. Their past entries stay in the audit log under their name.
        A saved password is deleted when the staff member chooses their own password at first sign-in, so it only works until then.
        Every Show is recorded in the audit log.
      </p>
    </div>
  );
};
