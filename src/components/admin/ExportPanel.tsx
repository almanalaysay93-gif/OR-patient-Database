import React, { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { isTauri, writeExportFile } from "../../data/tauri-adapter";
import { exportClinicalWorkbook } from "../../services/exportData";

const label: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" };

function downloadInBrowser(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ExportPanel: React.FC = () => {
  const { db, can, notify } = useApp();
  const mayIdentify = can("export.identifiable");
  const mayDeidentify = can("export.deidentified");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [identifiable, setIdentifiable] = useState(!mayDeidentify);
  const [busy, setBusy] = useState(false);
  const [lastPath, setLastPath] = useState<string | null>(null);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || busy) return;
    setBusy(true);
    try {
      const book = await exportClinicalWorkbook(db, { from: from || undefined, to: to || undefined, identifiable });
      if (isTauri()) {
        const path = await writeExportFile(book.filename, book.bytes);
        setLastPath(path);
      } else {
        downloadInBrowser(book.filename, book.bytes);
        setLastPath(book.filename);
      }
      notify(`Exported ${book.caseCount} case${book.caseCount === 1 ? "" : "s"} to Excel.`, "success");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleExport} className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Excel Export
      </h2>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
        One workbook with Pre-Op, Intra-Op, Post-Op, Complications and Follow-up sheets, one row per case. Leave the dates empty to export everything.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label htmlFor="export-from" style={label}>Surgery date from</label>
          <input id="export-from" className="glass-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="export-to" style={label}>Surgery date to</label>
          <input id="export-to" className="glass-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <fieldset style={{ border: "none", padding: 0, display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
        <legend style={{ ...label, padding: 0 }}>Patient details</legend>
        <label style={{ display: "flex", gap: "8px", opacity: mayDeidentify ? 1 : 0.5 }}>
          <input type="radio" name="export-kind" checked={!identifiable} disabled={!mayDeidentify} onChange={() => setIdentifiable(false)} />
          De-identified: no names, hospital numbers, birth dates or free-text notes
        </label>
        <label style={{ display: "flex", gap: "8px", opacity: mayIdentify ? 1 : 0.5 }}>
          <input type="radio" name="export-kind" checked={identifiable} disabled={!mayIdentify} onChange={() => setIdentifiable(true)} />
          Identifiable: includes names, hospital numbers and notes{mayIdentify ? "" : " (not allowed for your role)"}
        </label>
      </fieldset>
      {identifiable && (
        <p role="note" style={{ fontSize: "12px", color: "var(--danger)", fontWeight: 600 }}>
          This file will contain patient identities and is not encrypted. Store it only where patient records are allowed.
        </p>
      )}
      <div>
        <button type="submit" className="glass-btn glass-btn-primary" disabled={busy} style={{ gap: "8px" }}>
          <FileSpreadsheet size={14} />
          <span>{busy ? "Exporting..." : "Export to Excel"}</span>
        </button>
      </div>
      {lastPath && (
        <p role="status" style={{ fontSize: "12px", color: "var(--text-muted)", wordBreak: "break-all" }}>Saved: {lastPath}</p>
      )}
    </form>
  );
};
