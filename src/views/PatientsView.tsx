import React, { useEffect, useState } from "react";
import {
  Plus,
  Search,
  User,
  ArrowRight,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  listPatients,
  createPatient,
  getPatientById,
  getAdmissionsByPatient,
  getCasesByPatient,
  createAdmission,
  createSurgicalCase,
  type Patient,
  type Admission,
  type SurgicalCase,
} from "../services/patients";
import { getSpecialties, type Specialty } from "../services/masterData";
import { getAuditHistory, type AuditEntry } from "../services/audit";

export const PatientsView: React.FC = () => {
  const { db, selectedPatientId, setSelectedPatientId, setSelectedCaseId, setView, notify } = useApp();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Active patient longitudinal record
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [cases, setCases] = useState<SurgicalCase[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [profileTab, setProfileTab] = useState<"cases" | "admissions" | "audit">("cases");

  // Create Patient modal
  const [createPatientOpen, setCreatePatientOpen] = useState(false);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [mn, setMn] = useState("");
  const [hrn, setHrn] = useState("");
  const [dob, setDob] = useState("1985-05-15");
  const [sex, setSex] = useState<"MALE" | "FEMALE">("MALE");
  const [bloodType, setBloodType] = useState("O+");
  const [contact, setContact] = useState("");

  // Create Case modal
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [selectedAdmId, setSelectedAdmId] = useState("");
  const [caseType, setCaseType] = useState<"ELECTIVE" | "EMERGENCY" | "URGENT">("ELECTIVE");
  const [specialtyId, setSpecialtyId] = useState("");
  const [procedureSummary, setProcedureSummary] = useState("");
  const [laterality, setLaterality] = useState<"LEFT" | "RIGHT" | "BILATERAL" | "NOT_APPLICABLE">("NOT_APPLICABLE");

  const loadList = async () => {
    if (!db) return;
    try {
      setLoading(true);
      const res = await listPatients(db, { search });
      setPatients(res.patients);
      setTotal(res.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [db, search]);

  useEffect(() => {
    if (db) {
      getSpecialties(db).then(setSpecialties).catch(console.error);
    }
  }, [db]);

  useEffect(() => {
    async function loadPatientDetails() {
      if (!db || !selectedPatientId) {
        setActivePatient(null);
        setAdmissions([]);
        setCases([]);
        setAuditLogs([]);
        return;
      }
      try {
        const [p, admList, caseList, logs] = await Promise.all([
          getPatientById(db, selectedPatientId),
          getAdmissionsByPatient(db, selectedPatientId),
          getCasesByPatient(db, selectedPatientId),
          getAuditHistory(db, { patientId: selectedPatientId }),
        ]);
        setActivePatient(p);
        setAdmissions(admList);
        setCases(caseList);
        setAuditLogs(logs);
        if (admList.length > 0) setSelectedAdmId(admList[0].admission_id);
      } catch (err) {
        console.error(err);
      }
    }
    loadPatientDetails();
  }, [db, selectedPatientId]);

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    if (!fn.trim() || !ln.trim()) {
      notify("First name and last name are required.", "error");
      return;
    }

    try {
      const p = await createPatient(db, {
        firstName: fn,
        lastName: ln,
        middleName: mn,
        hrn: hrn || null,
        dateOfBirth: dob || null,
        sex,
        bloodType,
        contactNumber: contact,
      });

      // Auto-create initial admission
      await createAdmission(db, {
        patientId: p.patient_id,
        admissionDate: new Date().toISOString().split("T")[0],
        ward: "Surgical Inpatient",
      });

      notify(`Patient ${p.full_name} registered!`, "success");
      setCreatePatientOpen(false);
      setFn("");
      setLn("");
      setHrn("");
      await loadList();
      setSelectedPatientId(p.patient_id);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !activePatient) return;
    if (!selectedAdmId) {
      notify("Select an admission for this case.", "error");
      return;
    }

    try {
      const newCase = await createSurgicalCase(db, {
        patientId: activePatient.patient_id,
        admissionId: selectedAdmId,
        caseType,
        specialtyId: specialtyId || null,
        laterality,
        plannedProcedureSummary: procedureSummary,
      });

      notify(`Surgical case ${newCase.case_number} created!`, "success");
      setCreateCaseOpen(false);
      setProcedureSummary("");

      // Refresh patient cases
      const caseList = await getCasesByPatient(db, activePatient.patient_id);
      setCases(caseList);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>
            Patient Longitudinal Registry
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
            Single persistent record per patient with multiple admissions and surgical procedures.
          </p>
        </div>
        <button
          onClick={() => setCreatePatientOpen(true)}
          className="glass-btn glass-btn-primary"
          style={{ gap: "8px" }}
        >
          <Plus size={16} />
          <span>Register New Patient</span>
        </button>
      </div>

      {/* Main Grid: Patients Table + Profile Details Pane */}
      <div style={{ display: "grid", gridTemplateColumns: activePatient ? "1fr 1fr" : "1fr", gap: "24px" }}>
        {/* Left: Patient List */}
        <div className="glass-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Search Bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={16} color="var(--text-muted)" style={{ position: "absolute", left: "14px", top: "12px" }} />
              <input
                type="text"
                placeholder="Search by name, HRN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-input"
                style={{ paddingLeft: "38px" }}
              />
            </div>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {total} total
            </span>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-glass)", color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "10px" }}>Research ID</th>
                  <th style={{ padding: "10px" }}>Patient Name</th>
                  <th style={{ padding: "10px" }}>HRN</th>
                  <th style={{ padding: "10px" }}>Age</th>
                  <th style={{ padding: "10px" }}>Sex</th>
                  <th style={{ padding: "10px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  const isSelected = selectedPatientId === p.patient_id;
                  return (
                    <tr
                      key={p.patient_id}
                      onClick={() => setSelectedPatientId(p.patient_id)}
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                        cursor: "pointer",
                        background: isSelected ? "var(--primary-light)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "12px 10px", fontFamily: "var(--font-mono)", color: "var(--primary)", fontWeight: 600 }}>
                        {p.research_id}
                      </td>
                      <td style={{ padding: "12px 10px", fontWeight: 600, color: "var(--text-main)" }}>
                        {p.full_name}
                      </td>
                      <td style={{ padding: "12px 10px", color: "var(--text-muted)" }}>
                        {p.hrn || "None"}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        {p.calculated_age ?? "-"}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        {p.sex || "-"}
                      </td>
                      <td style={{ padding: "12px 10px" }}>
                        <ArrowRight size={14} color="var(--primary)" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {patients.length === 0 && !loading && (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
              No patients found.
            </div>
          )}
        </div>

        {/* Right: Selected Patient Profile */}
        {activePatient && (
          <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Header info */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "1px solid var(--border-glass)", paddingBottom: "16px" }}>
              <div style={{ display: "flex", gap: "14px" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--primary-light)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <User size={24} />
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-main)" }}>
                    {activePatient.full_name}
                  </h2>
                  <div style={{ display: "flex", gap: "10px", fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                    <span>Research ID: <strong>{activePatient.research_id}</strong></span>
                    <span>&bull;</span>
                    <span>HRN: <strong>{activePatient.hrn || "None"}</strong></span>
                    <span>&bull;</span>
                    <span>Age: <strong>{activePatient.calculated_age ?? "Unknown"}</strong></span>
                    <span>&bull;</span>
                    <span>Blood: <strong>{activePatient.blood_type || "N/A"}</strong></span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedPatientId(null)} className="glass-btn glass-btn-secondary" style={{ padding: "6px" }}>
                <X size={16} />
              </button>
            </div>

            {/* Profile Tabs */}
            <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
              <button
                onClick={() => setProfileTab("cases")}
                className={`glass-btn ${profileTab === "cases" ? "glass-btn-primary" : "glass-btn-secondary"}`}
                style={{ fontSize: "13px", padding: "6px 14px" }}
              >
                Surgical Cases ({cases.length})
              </button>
              <button
                onClick={() => setProfileTab("admissions")}
                className={`glass-btn ${profileTab === "admissions" ? "glass-btn-primary" : "glass-btn-secondary"}`}
                style={{ fontSize: "13px", padding: "6px 14px" }}
              >
                Admissions ({admissions.length})
              </button>
              <button
                onClick={() => setProfileTab("audit")}
                className={`glass-btn ${profileTab === "audit" ? "glass-btn-primary" : "glass-btn-secondary"}`}
                style={{ fontSize: "13px", padding: "6px 14px" }}
              >
                Audit Trail ({auditLogs.length})
              </button>
            </div>

            {/* Tab: Surgical Cases */}
            {profileTab === "cases" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)" }}>
                    Procedures & OR Workflow
                  </span>
                  <button
                    onClick={() => setCreateCaseOpen(true)}
                    className="glass-btn glass-btn-primary"
                    style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
                  >
                    <Plus size={14} />
                    <span>Schedule New Case</span>
                  </button>
                </div>

                {cases.map((c) => (
                  <div
                    key={c.case_id}
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "12px",
                      padding: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "14px" }}>
                          {c.case_number}
                        </span>
                        <span className="badge badge-primary">{c.case_type}</span>
                        <span className="badge badge-neutral">{c.case_status}</span>
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
                        {c.planned_procedure_summary || "Procedure summary pending"}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedCaseId(c.case_id);
                        setView("preor");
                      }}
                      className="glass-btn glass-btn-secondary"
                      style={{ fontSize: "12px" }}
                    >
                      Pre-OR Check &rarr;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Admissions */}
            {profileTab === "admissions" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {admissions.map((a) => (
                  <div
                    key={a.admission_id}
                    style={{
                      padding: "12px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "10px",
                      background: "var(--bg-card)",
                      fontSize: "13px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <span>Admission #{a.admission_number}</span>
                      <span className="badge badge-success">{a.status}</span>
                    </div>
                    <div style={{ color: "var(--text-muted)", marginTop: "4px" }}>
                      Date: {a.admission_date} &bull; Ward: {a.ward || "General"} &bull; Room/Bed: {a.room || "-"}/{a.bed || "-"}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Audit History */}
            {profileTab === "audit" && (
              <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                {auditLogs.map((log) => (
                  <div
                    key={log.audit_id}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: "rgba(148, 163, 184, 0.08)",
                      fontSize: "12px",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                      <span style={{ color: "var(--primary)" }}>{log.action}</span>
                      <span style={{ color: "var(--text-muted)" }}>{log.timestamp.replace("T", " ").slice(0, 19)}</span>
                    </div>
                    {log.new_value && (
                      <div style={{ color: "var(--text-muted)", marginTop: "2px", wordBreak: "break-all" }}>
                        {log.new_value}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Create Patient */}
      {createPatientOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "560px", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>Register Patient</h2>
            <form onSubmit={handleCreatePatient} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>First Name *</label>
                  <input className="glass-input" required value={fn} onChange={(e) => setFn(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Last Name *</label>
                  <input className="glass-input" required value={ln} onChange={(e) => setLn(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Middle Name</label>
                  <input className="glass-input" value={mn} onChange={(e) => setMn(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Hospital Record No. (HRN)</label>
                  <input className="glass-input" placeholder="e.g. HRN-998822" value={hrn} onChange={(e) => setHrn(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Date of Birth</label>
                  <input className="glass-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Sex</label>
                  <select className="glass-input" value={sex} onChange={(e) => setSex(e.target.value as any)}>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Blood Type</label>
                  <input className="glass-input" value={bloodType} onChange={(e) => setBloodType(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Contact Number</label>
                <input className="glass-input" value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setCreatePatientOpen(false)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-primary">
                  Save Patient Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Surgical Case */}
      {createCaseOpen && activePatient && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "560px", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>New Surgical Case for {activePatient.full_name}</h2>
            <form onSubmit={handleCreateCase} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Select Admission</label>
                <select className="glass-input" value={selectedAdmId} onChange={(e) => setSelectedAdmId(e.target.value)}>
                  {admissions.map((a) => (
                    <option key={a.admission_id} value={a.admission_id}>
                      #{a.admission_number} ({a.admission_date}) - {a.ward || "Ward"}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Priority / Case Type</label>
                  <select className="glass-input" value={caseType} onChange={(e) => setCaseType(e.target.value as any)}>
                    <option value="ELECTIVE">Elective</option>
                    <option value="EMERGENCY">Emergency</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Specialty</label>
                  <select className="glass-input" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
                    <option value="">Select Specialty</option>
                    {specialties.map((s) => (
                      <option key={s.specialty_id} value={s.specialty_id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Planned Procedure Summary</label>
                <input
                  className="glass-input"
                  required
                  placeholder="e.g. Laparoscopic Cholecystectomy"
                  value={procedureSummary}
                  onChange={(e) => setProcedureSummary(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Laterality</label>
                <select className="glass-input" value={laterality} onChange={(e) => setLaterality(e.target.value as any)}>
                  <option value="NOT_APPLICABLE">Not Applicable / Midline</option>
                  <option value="LEFT">Left</option>
                  <option value="RIGHT">Right</option>
                  <option value="BILATERAL">Bilateral</option>
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setCreateCaseOpen(false)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-primary">
                  Create Surgical Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
