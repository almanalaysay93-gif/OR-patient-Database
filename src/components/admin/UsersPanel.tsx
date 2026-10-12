import React, { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  MASTER_ADMIN_ID, createUser, listRoles, listUsers, resetUserPassword, setUserActive, setUserRole,
  type RoleOption, type StaffAccount,
} from "../../services/userAdmin";

const label: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" };
const cell: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: "13px", borderBottom: "1px solid var(--border-glass)" };

export const UsersPanel: React.FC = () => {
  const { db, session, notify } = useApp();
  const [users, setUsers] = useState<StaffAccount[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [form, setForm] = useState({ username: "", fullName: "", roleId: "role-nurse", password: "" });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!db) return;
    const [u, r] = await Promise.all([listUsers(db), listRoles(db)]);
    setUsers(u);
    setRoles(r);
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
      setForm({ username: "", fullName: "", roleId: form.roleId, password: "" });
    }
  };

  const handleReset = async (e: React.FormEvent, user: StaffAccount) => {
    e.preventDefault();
    if (!db) return;
    if (await run(() => resetUserPassword(db, user.user_id, newPassword), `Password reset for ${user.username}.`)) {
      setResetFor(null);
      setNewPassword("");
    }
  };

  return (
    <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", gridColumn: "1 / -1" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Staff Accounts
      </h2>

      <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: "12px", alignItems: "end" }}>
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
          <label htmlFor="new-user-password" style={label}>Starting password (8+ characters)</label>
          <input id="new-user-password" className="glass-input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy} style={{ gap: "6px" }}>
          <UserPlus size={14} />
          <span>Add Account</span>
        </button>
      </form>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Name", "Username", "Role", "Status", "Last sign-in", "Actions"].map((h) => (
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
                  <td style={cell}>{u.full_name}</td>
                  <td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{u.username}</td>
                  <td style={cell}>
                    <select
                      className="glass-input" aria-label={`Role for ${u.username}`} style={{ padding: "4px 8px", fontSize: "12px" }}
                      value={u.role_id} disabled={busy || isMaster || isSelf}
                      onChange={(e) => db && run(() => setUserRole(db, u.user_id, e.target.value), `Role updated for ${u.username}.`)}
                    >
                      {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td style={cell}>
                    <span className={`badge ${u.active ? "badge-success" : "badge-neutral"}`}>{u.active ? "Active" : "Deactivated"}</span>
                  </td>
                  <td style={cell}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                  <td style={cell}>
                    {resetFor === u.user_id ? (
                      <form onSubmit={(e) => handleReset(e, u)} style={{ display: "flex", gap: "6px" }}>
                        <input
                          className="glass-input" type="password" autoFocus autoComplete="new-password" placeholder="New password"
                          aria-label={`New password for ${u.username}`} style={{ padding: "4px 8px", fontSize: "12px", width: "150px" }}
                          value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy} style={{ padding: "4px 10px", fontSize: "12px" }}>Save</button>
                        <button type="button" className="glass-btn glass-btn-secondary" style={{ padding: "4px 10px", fontSize: "12px" }} onClick={() => { setResetFor(null); setNewPassword(""); }}>Cancel</button>
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
      </p>
    </div>
  );
};
