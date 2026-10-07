import React, { useState } from "react";
import { Hospital, Film, CheckCircle2 } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { createInitialAdmin } from "../../services/auth";
import { seedInitialFacilityData } from "../../services/masterData";

export const SetupWizard: React.FC = () => {
  const { db, refreshSetupStatus, onLoginSuccess, setVideoGuideOpen, notify } = useApp();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Form states
  const [facilityName, setFacilityName] = useState("Davao Regional Medical Center");
  const [departmentName, setDepartmentName] = useState("Operating Room Complex");
  const [roomsText, setRoomsText] = useState("OR 1 (General)\nOR 2 (Urology & Endo)\nOR 3 (Vascular)\nOR 4 (Transplant)");
  const [specialtiesText, setSpecialtiesText] = useState("Urology\nVascular Surgery\nTransplant\nGeneral Surgery\nNeurosurgery\nOrthopedics");

  const [fullName, setFullName] = useState("Clinical Administrator");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("Admin@1234");
  const [confirmPassword, setConfirmPassword] = useState("Admin@1234");

  const handleFinish = async () => {
    if (!db) return;
    if (password !== confirmPassword) {
      notify("Passwords do not match.", "error");
      return;
    }
    if (password.length < 8) {
      notify("Password must be at least 8 characters.", "error");
      return;
    }

    setLoading(true);
    try {
      // 1. Seed facility master data
      const rooms = roomsText.split("\n").map((s) => s.trim()).filter(Boolean);
      const specs = specialtiesText.split("\n").map((s) => s.trim()).filter(Boolean);
      await seedInitialFacilityData(db, {
        facilityName,
        departmentName,
        orRooms: rooms,
        specialties: specs,
        staffMembers: [
          { name: "Dr. Roberto Santos", role: "Surgeon" },
          { name: "Dr. Elena Navarro", role: "Anesthesiologist" },
          { name: "Nurse John Reyes", role: "Scrub Nurse" },
        ],
      });

      // 2. Create initial admin account
      const session = await createInitialAdmin(db, {
        fullName,
        username,
        password,
      });

      await refreshSetupStatus();
      onLoginSuccess(session);
      notify("Facility and Administrator configured successfully!", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "radial-gradient(circle at 50% 10%, #e0f2fe 0%, #f8fafc 40%, #f1f5f9 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "760px",
          background: "rgba(255, 255, 255, 0.88)",
          backdropFilter: "blur(24px)",
          borderRadius: "24px",
          padding: "36px",
          boxShadow: "0 25px 60px rgba(15, 23, 42, 0.12)",
        }}
      >
        {/* Wizard Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "28px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #0284c7, #0d9488)",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Hospital size={26} />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.02em" }}>
              OR Patient Management Setup Wizard
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              Step {step} of 3: {step === 1 ? "Facility & Operating Rooms" : step === 2 ? "Administrator Account" : "Video Guide & Confirmation"}
            </p>
          </div>
        </div>

        {/* Step 1: Facility & Rooms */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Facility Name
              </label>
              <input
                className="glass-input"
                type="text"
                value={facilityName}
                onChange={(e) => setFacilityName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Department / Unit Name
              </label>
              <input
                className="glass-input"
                type="text"
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  Operating Rooms (One per line)
                </label>
                <textarea
                  className="glass-input"
                  rows={4}
                  value={roomsText}
                  onChange={(e) => setRoomsText(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  Surgical Specialties (One per line)
                </label>
                <textarea
                  className="glass-input"
                  rows={4}
                  value={specialtiesText}
                  onChange={(e) => setSpecialtiesText(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <button onClick={() => setStep(2)} className="glass-btn glass-btn-primary" style={{ padding: "10px 24px" }}>
                Continue to Account Setup &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Administrator Account */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Administrator Full Name
              </label>
              <input
                className="glass-input"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                Username
              </label>
              <input
                className="glass-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  Password (Argon2id Hashed)
                </label>
                <input
                  className="glass-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                  Confirm Password
                </label>
                <input
                  className="glass-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
              <button onClick={() => setStep(1)} className="glass-btn glass-btn-secondary">
                &larr; Back
              </button>
              <button onClick={() => setStep(3)} className="glass-btn glass-btn-primary" style={{ padding: "10px 24px" }}>
                Review & Confirm &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Confirmation & Video Preview */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                background: "var(--primary-light)",
                border: "1px solid var(--primary-border)",
                borderRadius: "16px",
                padding: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--primary)" }}>
                  Offline Interactive Video Guide Ready
                </h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Learn how Pre-OR readiness scoring and 4-way scheduling conflict protection operate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVideoGuideOpen(true)}
                className="glass-btn glass-btn-primary"
                style={{ gap: "8px", fontSize: "13px" }}
              >
                <Film size={16} />
                <span>Play Guide</span>
              </button>
            </div>

            <div style={{ fontSize: "13px", color: "var(--text-main)", lineHeight: "1.6", background: "var(--bg-card)", padding: "16px", borderRadius: "12px", border: "1px solid var(--border-glass)" }}>
              <div><strong>Facility:</strong> {facilityName} ({departmentName})</div>
              <div><strong>Admin:</strong> {fullName} (@{username})</div>
              <div><strong>Database:</strong> Local SQLite with WAL mode & strict foreign key constraints</div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
              <button onClick={() => setStep(2)} className="glass-btn glass-btn-secondary" disabled={loading}>
                &larr; Back
              </button>
              <button
                onClick={handleFinish}
                className="glass-btn glass-btn-primary"
                style={{ padding: "10px 28px", gap: "8px" }}
                disabled={loading}
              >
                <CheckCircle2 size={18} />
                <span>{loading ? "Initializing..." : "Complete Setup & Launch"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
