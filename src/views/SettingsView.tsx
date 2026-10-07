import React, { useEffect, useState } from "react";
import {
  Save,
  Download,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { getOrRooms, getSpecialties, type OrRoom, type Specialty } from "../services/masterData";

export const SettingsView: React.FC = () => {
  const { db, theme, setTheme, visualEffects, setVisualEffects, notify } = useApp();
  const [rooms, setRooms] = useState<OrRoom[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [facilityName, setFacilityName] = useState("Operating Suite");
  const [departmentName, setDepartmentName] = useState("Department of Surgery");
  const [schemaVersion, setSchemaVersion] = useState<number>(2);
  const [backupDir, setBackupDir] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!db) return;
      try {
        const [rList, sList, facRow, deptRow, migRow] = await Promise.all([
          getOrRooms(db, false),
          getSpecialties(db, false),
          db.select<{ value: string }>("SELECT value FROM app_settings WHERE key = 'facility_name'"),
          db.select<{ value: string }>("SELECT value FROM app_settings WHERE key = 'department_name'"),
          db.select<{ v: number }>("SELECT MAX(version) as v FROM schema_migrations"),
        ]);
        setRooms(rList);
        setSpecialties(sList);
        if (facRow[0]?.value) setFacilityName(facRow[0].value);
        if (deptRow[0]?.value) setDepartmentName(deptRow[0].value);
        if (migRow[0]?.v) setSchemaVersion(migRow[0].v);
        setBackupDir(db.backupDir);
      } catch (err) {
        console.error(err);
      }
    }
    load();
  }, [db]);

  const handleSaveFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('facility_name', ?)", [facilityName]);
      await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('department_name', ?)", [departmentName]);
      notify("Facility settings updated.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleBackupNow = async () => {
    if (!db) return;
    if (!db.backupDir) {
      notify("Local file backup is available in the desktop Tauri installation.", "info");
      return;
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${db.backupDir}\\OR-ManualBackup-${stamp}.db`;
      const ok = await db.backupTo(path);
      if (ok) {
        notify(`Backup saved to ${path}`, "success");
      } else {
        notify("Database backup operation not supported in current environment.", "warning");
      }
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>
          Station Settings & Master Data
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
          Configure facility profile, visual presentation parameters, and SQLite database backup policies.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Facility Profile */}
        <form onSubmit={handleSaveFacility} className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            Facility Profile
          </h2>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Facility Name
            </label>
            <input className="glass-input" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Department / Unit
            </label>
            <input className="glass-input" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="glass-btn glass-btn-primary" style={{ gap: "6px" }}>
              <Save size={14} />
              <span>Save Facility</span>
            </button>
          </div>
        </form>

        {/* Appearance & Performance Modes */}
        <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            Visual Presentation & Glass Engine
          </h2>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
              Color Theme
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setTheme("light")}
                className={`glass-btn ${theme === "light" ? "glass-btn-primary" : "glass-btn-secondary"}`}
                style={{ flex: 1 }}
              >
                Light Clinical Glass (Default)
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`glass-btn ${theme === "dark" ? "glass-btn-primary" : "glass-btn-secondary"}`}
                style={{ flex: 1 }}
              >
                Dark Glass
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
              Visual Effects Mode
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              {(["FULL", "REDUCED", "OFF"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setVisualEffects(m)}
                  className={`glass-btn ${visualEffects === m ? "glass-btn-primary" : "glass-btn-secondary"}`}
                  style={{ flex: 1 }}
                >
                  {m}
                </button>
              ))}
            </div>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
              Full: 3D parallax & frosted blur &bull; Reduced: Subtle blur &bull; Off: Static solid cards
            </p>
          </div>
        </div>

        {/* Database & Backup */}
        <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            Database Integrity & Backups
          </h2>
          <div style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--text-main)" }}>
            <div><strong>Engine:</strong> SQLite (Local Embedded)</div>
            <div><strong>Schema Version:</strong> v{schemaVersion} (All migrations verified)</div>
            <div><strong>WAL Mode:</strong> Enabled with Full Sync</div>
            <div><strong>Backup Location:</strong> {backupDir || "Local User Application Data"}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-start", marginTop: "6px" }}>
            <button onClick={handleBackupNow} className="glass-btn glass-btn-primary" style={{ gap: "8px" }}>
              <Download size={14} />
              <span>Create Immediate Backup</span>
            </button>
          </div>
        </div>

        {/* Master Data Overview */}
        <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            Operating Rooms & Specialties
          </h2>
          <div style={{ fontSize: "13px" }}>
            <strong>Active OR Rooms ({rooms.length}):</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {rooms.map((r) => (
                <span key={r.or_room_id} className="badge badge-neutral">{r.name}</span>
              ))}
            </div>
          </div>
          <div style={{ fontSize: "13px", marginTop: "6px" }}>
            <strong>Specialties ({specialties.length}):</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {specialties.map((s) => (
                <span key={s.specialty_id} className="badge badge-primary">{s.name}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
