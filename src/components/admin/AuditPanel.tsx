import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DataTable } from "../common/DataTable";
import { useApp } from "../../context/AppContext";
import { getAuditHistory, type AuditEntry } from "../../services/audit";


export const AuditPanel: React.FC = () => {
  const { db, notify } = useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  const reload = useCallback(async () => {
    if (!db) return;
    setEntries(await getAuditHistory(db, { limit: 300 }));
  }, [db]);

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [reload]);

  const who = (e: AuditEntry) => (e.user_full_name ? `${e.user_full_name} (${e.username})` : "System");
  const change = (e: AuditEntry) =>
    e.old_value != null && e.new_value != null ? `${e.old_value} → ${e.new_value}` : e.new_value ?? e.old_value ?? "";

  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, flex: 1 }}>Audit Log (latest {entries.length})</h2>
        <button className="glass-btn glass-btn-secondary" style={{ gap: "6px" }} onClick={() => reload().catch((err) => notify((err as Error).message, "error"))}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>
      <DataTable<AuditEntry>
        caption="Audit log"
        rows={entries}
        rowKey={(e) => e.audit_id}
        searchText={(e) => [e.username, e.user_full_name, e.action, e.entity_type, e.field_name, e.old_value, e.new_value].filter(Boolean).join(" ")}
        searchLabel="Filter audit log"
        searchPlaceholder="Filter by user, action, record or change"
        emptyMessage="No audit entries yet."
        columns={[
          { key: "when", header: "When", nowrap: true, render: (e) => new Date(e.timestamp).toLocaleString() },
          { key: "who", header: "Who", render: who },
          { key: "action", header: "Action", nowrap: true, render: (e) => <span style={{ fontFamily: "var(--font-mono)" }}>{e.action}</span> },
          { key: "record", header: "Record", render: (e) => `${e.entity_type}${e.field_name ? ` / ${e.field_name}` : ""}` },
          { key: "change", header: "Change", render: change },
        ]}
      />
    </div>
  );
};
