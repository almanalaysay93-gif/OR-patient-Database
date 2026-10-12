import React, { useEffect, useState } from "react";
import { Save, Plus, KeyRound } from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  getOrRooms, getSpecialties, addOrRoom, addSpecialty, saveFacilityProfile, type OrRoom, type Specialty,
} from "../services/masterData";
import { changeOwnPassword } from "../services/userAdmin";
import { UsersPanel } from "../components/admin/UsersPanel";
import { BackupPanel } from "../components/admin/BackupPanel";
import { ExportPanel } from "../components/admin/ExportPanel";
import { DemoDataPanel } from "../components/admin/DemoDataPanel";
import { AuditPanel } from "../components/admin/AuditPanel";

export const SettingsView: React.FC = () => {
  const { db, session, can, theme, setTheme, visualEffects, setVisualEffects, notify } = useApp();
  const canManage = can("masterdata.manage");
  const [rooms, setRooms] = useState<OrRoom[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [facilityName, setFacilityName] = useState("Operating Suite");
  const [departmentName, setDepartmentName] = useState("Department of Surgery");
  const [schemaVersion, setSchemaVersion] = useState<number>(2);
  const [newRoom, setNewRoom] = useState("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", repeat: "" });

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
      await saveFacilityProfile(db, { facilityName, departmentName });
      notify("Facility settings updated.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await addOrRoom(db, newRoom);
      setNewRoom("");
      setRooms(await getOrRooms(db, false));
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleAddSpecialty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await addSpecialty(db, newSpecialty);
      setNewSpecialty("");
      setSpecialties(await getSpecialties(db, false));
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    if (passwords.next !== passwords.repeat) {
      notify("The two new passwords do not match.", "error");
      return;
    }
    try {
      await changeOwnPassword(db, passwords.current, passwords.next);
      setPasswords({ current: "", next: "", repeat: "" });
      notify("Password changed.", "success");
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
          Your account, facility profile, staff accounts, backups, exports and the audit log.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* My Account */}
        <form onSubmit={handleChangePassword} className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            My Account
          </h2>
          <div style={{ fontSize: "13px" }}>
            Signed in as <strong>{session?.fullName}</strong> ({session?.username}) &bull; {session?.roleName}
          </div>
          {([["current", "Current password", "current-password"], ["next", "New password (8+ characters)", "new-password"], ["repeat", "Repeat new password", "new-password"]] as const).map(([key, text, auto]) => (
            <div key={key}>
              <label htmlFor={`pw-${key}`} style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>{text}</label>
              <input id={`pw-${key}`} className="glass-input" type="password" autoComplete={auto} value={passwords[key]} onChange={(e) => setPasswords({ ...passwords, [key]: e.target.value })} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="glass-btn glass-btn-primary" style={{ gap: "6px" }} disabled={!passwords.current || !passwords.next}>
              <KeyRound size={14} />
              <span>Change Password</span>
            </button>
          </div>
        </form>

        {/* Facility Profile */}
        <form onSubmit={handleSaveFacility} className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
            Facility Profile
          </h2>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Facility Name
            </label>
            <input className="glass-input" disabled={!canManage} value={facilityName} onChange={(e) => setFacilityName(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
              Department / Unit
            </label>
            <input className="glass-input" disabled={!canManage} value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} />
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Database: SQLite on this workstation, schema v{schemaVersion}
          </div>
          {canManage && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="glass-btn glass-btn-primary" style={{ gap: "6px" }}>
                <Save size={14} />
                <span>Save Facility</span>
              </button>
            </div>
          )}
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
            {canManage && (
              <form onSubmit={handleAddRoom} style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <input className="glass-input" aria-label="New operating room name" placeholder="New room, e.g. OR 3" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
                <button type="submit" className="glass-btn glass-btn-secondary" disabled={!newRoom.trim()} style={{ gap: "6px" }}><Plus size={14} /><span>Add</span></button>
              </form>
            )}
          </div>
          <div style={{ fontSize: "13px", marginTop: "6px" }}>
            <strong>Specialties ({specialties.length}):</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
              {specialties.map((s) => (
                <span key={s.specialty_id} className="badge badge-primary">{s.name}</span>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddSpecialty} style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <input className="glass-input" aria-label="New specialty name" placeholder="New specialty" value={newSpecialty} onChange={(e) => setNewSpecialty(e.target.value)} />
                <button type="submit" className="glass-btn glass-btn-secondary" disabled={!newSpecialty.trim()} style={{ gap: "6px" }}><Plus size={14} /><span>Add</span></button>
              </form>
            )}
          </div>
        </div>

        {(can("export.deidentified") || can("export.identifiable")) && <ExportPanel />}
        {can("users.manage") && <UsersPanel />}
        {(can("db.backup") || can("db.restore")) && <BackupPanel />}
        {can("audit.view") && <AuditPanel />}
        {can("users.manage") && <DemoDataPanel />}
      </div>
    </div>
  );
};
