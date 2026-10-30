import React, { useEffect, useState } from "react";
import { Save, Send } from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  flushSheetSync, getSheetSyncConfig, getSheetSyncStatus, queueAllForSheet, saveSheetSyncConfig,
} from "../../services/sheetSync";

export const GoogleSheetPanel: React.FC = () => {
  const { db, notify } = useApp();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [pending, setPending] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!db) return;
    const [cfg, status] = await Promise.all([getSheetSyncConfig(db), getSheetSyncStatus(db)]);
    setUrl(cfg.url);
    setTokenSet(cfg.tokenSet);
    setPending(status.pending);
    setLastError(status.lastError);
  };

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [db]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await saveSheetSyncConfig(db, { url, token });
      setToken("");
      notify(url.trim() ? "Google Sheet connection saved." : "Google Sheet sync turned off.", "success");
      await reload();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const send = async (all: boolean) => {
    if (!db) return;
    setBusy(true);
    try {
      if (all) await queueAllForSheet(db);
      const r = await flushSheetSync(db, undefined, { force: true });
      if (r.error) notify(`Google Sheet not updated: ${r.error}`, "error");
      else notify(`${r.sent} case(s) sent to the Google Sheet.`, "success");
      await reload();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const connected = !!url && tokenSet;

  return (
    <form onSubmit={handleSave} className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Google Sheet Sync
      </h2>
      <p style={{ fontSize: "13px", margin: 0 }}>
        Each save of patient's data sends the patient name, HRN, case number, dialysis and donor details to the Google Sheet.
        These rows identify the patient. Share the Sheet only with staff who may see them.
        Saves made offline wait here and go out at the next save or sign-in.
      </p>
      <label style={{ fontSize: "13px" }}>Apps Script web app address
        <input className="glass-input" type="url" placeholder="https://script.google.com/macros/s/.../exec"
          value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label style={{ fontSize: "13px" }}>Sync token {tokenSet && <span className="badge badge-neutral">saved</span>}
        <input className="glass-input" type="password" autoComplete="off"
          placeholder={tokenSet ? "Leave empty to keep the saved token" : "Same value as SYNC_TOKEN in the Apps Script"}
          value={token} onChange={(e) => setToken(e.target.value)} />
      </label>
      <div style={{ fontSize: "13px" }} role="status">
        {connected ? `Connected. Cases waiting to send: ${pending}.` : "Not connected."}
        {connected && lastError && <div style={{ color: "var(--danger, #b42318)", marginTop: 4 }}>Last error: {lastError}</div>}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button type="submit" className="glass-btn glass-btn-primary" style={{ gap: "6px" }}><Save size={14} /><span>Save connection</span></button>
        <button type="button" className="glass-btn glass-btn-secondary" disabled={!connected || busy || !pending}
          onClick={() => send(false)} style={{ gap: "6px" }}><Send size={14} /><span>Send waiting cases</span></button>
        <button type="button" className="glass-btn glass-btn-secondary" disabled={!connected || busy}
          onClick={() => send(true)} style={{ gap: "6px" }}><Send size={14} /><span>Send all cases</span></button>
      </div>
    </form>
  );
};
