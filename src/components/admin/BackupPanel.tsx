import React, { useCallback, useEffect, useState } from "react";
import { Download, KeyRound, RotateCcw, Save } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { isTauri, tauriBackupHost } from "../../data/tauri-adapter";
import {
  createManualBackup, getBackupSettings, getRecoveryKey, listBackups, restoreBackup, saveBackupSettings,
  AUTO_PREFIX, SAFETY_PREFIX, type BackupFile,
} from "../../services/backup";

const label: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" };
const cell: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: "13px", borderBottom: "1px solid var(--border-glass)" };

const kindOf = (name: string) =>
  name.startsWith(AUTO_PREFIX) ? "Automatic" : name.startsWith(SAFETY_PREFIX) ? "Before restore" : "Manual";

const sizeOf = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const BackupPanel: React.FC = () => {
  const { db, can, notify } = useApp();
  const desktop = isTauri();
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [settings, setSettings] = useState({ enabled: true, intervalHours: 24, keep: 14, mirrorDir: "" });
  const [lastAuto, setLastAuto] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [otherPcKey, setOtherPcKey] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!db) return;
    const s = await getBackupSettings(db);
    setSettings({ enabled: s.enabled, intervalHours: s.intervalHours, keep: s.keep, mirrorDir: s.mirrorDir });
    setLastAuto(s.lastAutoBackup);
    if (desktop) setFiles(await listBackups(tauriBackupHost));
  }, [db, desktop]);

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [reload]);

  const handleBackupNow = async () => {
    if (!db || busy) return;
    setBusy(true);
    try {
      const result = await createManualBackup(db, tauriBackupHost);
      notify(result.mirrorError ?? `Backup saved: ${result.name}`, result.mirrorError ? "warning" : "success");
      await reload();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || busy) return;
    setBusy(true);
    try {
      await saveBackupSettings(db, settings);
      notify("Backup schedule saved.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !restoreTarget || busy || confirmText !== "RESTORE") return;
    setBusy(true);
    try {
      await restoreBackup(db, tauriBackupHost, restoreTarget, new Date(), otherPcKey);
      // Every screen holds data from the replaced database, so start again from the sign-in screen.
      window.location.reload();
    } catch (err) {
      notify(`Restore failed, the current data was not changed: ${(err as Error).message}`, "error");
      setBusy(false);
    }
  };

  const handleShowRecoveryKey = async () => {
    if (!db || busy) return;
    try {
      setRecoveryKey(await getRecoveryKey(db, tauriBackupHost));
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px", gridColumn: "1 / -1" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Backups & Restore
      </h2>

      {!desktop && (
        <p role="status" style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Backup files and restore work in the installed desktop app only. This browser preview keeps its data in the browser.
        </p>
      )}

      <div style={{ fontSize: "13px", lineHeight: 1.6 }}>
        <div><strong>Backup folder:</strong> {db?.backupDir || "Not available"}</div>
        <div><strong>Last automatic backup:</strong> {lastAuto ? new Date(lastAuto).toLocaleString() : "None yet"}</div>
        {desktop && <div><strong>Encryption:</strong> the database and every backup file are encrypted (AES-256). Excel exports are not.</div>}
      </div>

      {desktop && can("db.restore") && (
        <div style={{ border: "1px solid var(--border-glass)", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <strong style={{ fontSize: "14px" }}>Recovery key</strong>
          <p style={{ fontSize: "13px", lineHeight: 1.5 }}>
            This PC opens the database by itself. On a replacement PC, or after Windows is reinstalled, the database and its backups
            open only with this key. Write it on paper and keep it locked away, apart from the backup drive.
            Without the key and without this PC, the records cannot be recovered by anyone. Anyone who has the key and a backup file can read every record.
          </p>
          {recoveryKey ? (
            <>
              <output aria-label="Recovery key" style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 600, userSelect: "all", wordBreak: "break-all" }}>
                {recoveryKey}
              </output>
              <div>
                <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setRecoveryKey(null)}>Hide Key</button>
              </div>
            </>
          ) : (
            <div>
              <button type="button" className="glass-btn glass-btn-secondary" disabled={busy} style={{ gap: "8px" }} onClick={handleShowRecoveryKey}>
                <KeyRound size={14} />
                <span>Show Recovery Key</span>
              </button>
            </div>
          )}
        </div>
      )}

      {can("db.backup") && (
        <form onSubmit={handleSaveSettings} style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 2fr auto", gap: "12px", alignItems: "end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, paddingBottom: "10px" }}>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
            Automatic backups
          </label>
          <div>
            <label htmlFor="backup-interval" style={label}>Every (hours)</label>
            <input id="backup-interval" className="glass-input" type="number" min={1} max={168} value={settings.intervalHours} onChange={(e) => setSettings({ ...settings, intervalHours: Number(e.target.value) })} />
          </div>
          <div>
            <label htmlFor="backup-keep" style={label}>Keep newest</label>
            <input id="backup-keep" className="glass-input" type="number" min={1} max={365} value={settings.keep} onChange={(e) => setSettings({ ...settings, keep: Number(e.target.value) })} />
          </div>
          <div>
            <label htmlFor="backup-mirror" style={label}>Second copy folder (USB or other drive, optional)</label>
            <input id="backup-mirror" className="glass-input" placeholder="E:\OR-Backups" value={settings.mirrorDir} onChange={(e) => setSettings({ ...settings, mirrorDir: e.target.value })} />
          </div>
          <button type="submit" className="glass-btn glass-btn-secondary" disabled={busy} style={{ gap: "6px" }}>
            <Save size={14} />
            <span>Save Schedule</span>
          </button>
        </form>
      )}

      {can("db.backup") && (
        <div>
          <button onClick={handleBackupNow} className="glass-btn glass-btn-primary" disabled={busy || !desktop} style={{ gap: "8px" }}>
            <Download size={14} />
            <span>Back Up Now</span>
          </button>
        </div>
      )}

      {desktop && (
        <div style={{ overflowX: "auto" }}>
          <table className="mobile-record-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Backup file", "Type", "Created", "Size", ""].map((h) => (
                  <th key={h} style={{ ...cell, fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.length === 0 && (
                <tr><td className="table-empty" colSpan={5} style={{ ...cell, color: "var(--text-muted)" }}>No backups yet. The first automatic backup is taken when the app starts.</td></tr>
              )}
              {files.map((f) => (
                <tr key={f.name}>
                  <td data-label="Backup file" style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: "12px" }}>{f.name}</td>
                  <td data-label="Type" style={cell}>{kindOf(f.name)}</td>
                  <td data-label="Created" style={cell}>{new Date(f.modified).toLocaleString()}</td>
                  <td data-label="Size" style={cell}>{sizeOf(f.size)}</td>
                  <td data-label="Action" style={cell}>
                    {can("db.restore") && (
                      <button className="glass-btn glass-btn-secondary" disabled={busy} style={{ padding: "4px 10px", fontSize: "12px", gap: "6px" }} onClick={() => { setRestoreTarget(f.name); setConfirmText(""); setOtherPcKey(""); }}>
                        <RotateCcw size={12} />
                        <span>Restore</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoreTarget && (
        <form onSubmit={handleRestore} role="alertdialog" aria-label="Confirm restore" style={{ border: "1px solid var(--danger)", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <strong style={{ fontSize: "14px", color: "var(--danger)" }}>Restore {restoreTarget}?</strong>
          <p style={{ fontSize: "13px", lineHeight: 1.5 }}>
            All current records are replaced with the contents of this backup. Anything entered after it was made will no longer show.
            A copy of the current data is saved first as an "OR-PreRestore" backup, so this can be undone. Everyone is signed out afterwards.
          </p>
          <div>
            <label htmlFor="restore-key" style={label}>Recovery key of the PC that made this backup (leave empty for backups made on this PC)</label>
            <input id="restore-key" className="glass-input" autoComplete="off" spellCheck={false} style={{ fontFamily: "var(--font-mono)" }} value={otherPcKey} onChange={(e) => setOtherPcKey(e.target.value)} />
          </div>
          <label htmlFor="restore-confirm" style={label}>Type RESTORE to confirm</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input id="restore-confirm" className="glass-input" autoFocus style={{ width: "200px" }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <button type="submit" className="glass-btn glass-btn-danger" disabled={busy || confirmText !== "RESTORE"}>
              {busy ? "Restoring..." : "Restore This Backup"}
            </button>
            <button type="button" className="glass-btn glass-btn-secondary" disabled={busy} onClick={() => setRestoreTarget(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
};
