import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { getAuditHistory, type AuditEntry } from "../../services/audit";

const cell: React.CSSProperties = { padding: "6px 10px", textAlign: "left", fontSize: "12px", borderBottom: "1px solid var(--border-glass)", verticalAlign: "top" };

export const AuditPanel: React.FC = () => {
  const { db, notify } = useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");

  const reload = useCallback(async () => {
    if (!db) return;
    setEntries(await getAuditHistory(db, { limit: 300 }));
  }, [db]);

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [reload]);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? entries.filter((e) => [e.username, e.user_full_name, e.action, e.entity_type].some((v) => v?.toLowerCase().includes(needle)))
    : entries;

  return (
    <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "14px", gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, flex: 1 }}>Audit Log (latest {entries.length})</h2>
        <input className="glass-input" aria-label="Filter audit log" placeholder="Filter by user or action" style={{ width: "240px" }} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="glass-btn glass-btn-secondary" style={{ gap: "6px" }} onClick={() => reload().catch((err) => notify((err as Error).message, "error"))}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>
      <div style={{ maxHeight: "360px", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["When", "Who", "Action", "Record", "Change"].map((h) => (
                <th key={h} style={{ ...cell, fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", position: "sticky", top: 0, background: "var(--bg-card)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={5} style={{ ...cell, color: "var(--text-muted)" }}>No matching entries.</td></tr>
            )}
            {shown.map((e) => (
              <tr key={e.audit_id}>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>{new Date(e.timestamp).toLocaleString()}</td>
                <td style={cell}>{e.user_full_name ? `${e.user_full_name} (${e.username})` : "System"}</td>
                <td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{e.action}</td>
                <td style={cell}>{e.entity_type}{e.field_name ? ` / ${e.field_name}` : ""}</td>
                <td style={{ ...cell, maxWidth: "360px", wordBreak: "break-word" }}>
                  {e.old_value != null && e.new_value != null ? `${e.old_value} → ${e.new_value}` : e.new_value ?? e.old_value ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
