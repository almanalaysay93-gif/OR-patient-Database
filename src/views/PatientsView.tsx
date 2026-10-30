import React, { useEffect, useState } from "react";
import {
  Plus,
  Search,
  User,
  ArrowRight,
  X,
  Pencil,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { localDate } from "../data/db";
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
import {
  listPatientAllergies,
  createPatientAllergy,
  deletePatientAllergy,
  type PatientAllergy,
} from "../services/allergies";
import { getSpecialties, type Specialty } from "../services/masterData";
import { getAuditHistory, type AuditEntry } from "../services/audit";
import { CaseCodingPanel } from "../components/clinical/CaseCodingPanel";
import { EditPatientDialog } from "../components/clinical/EditPatientDialog";
import { CaseActions } from "../components/clinical/CaseActions";
import { LaboratoryPanel } from "../components/clinical/LaboratoryPanel";
import {
  EMPTY_PATIENT_DATA, PatientDataFields, PatientDataPanel, toPatientDataInput, type PatientDataForm,
} from "../components/clinical/PatientDataPanel";
import { hasPatientData, savePatientData, validatePatientData } from "../services/patientData";
import { archivePatient, listArchivedPatients, restorePatient, type ArchivedPatient } from "../services/patientArchive";
import { logCatch, logError } from "../services/logger";

export const PatientsView: React.FC = () => {
  const { db, can, selectedPatientId, setSelectedPatientId, setSelectedCaseId, setView, notify, openRegisterModal, setOpenRegisterModal } = useApp();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Active patient longitudinal record
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [cases, setCases] = useState<SurgicalCase[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [allergies, setAllergies] = useState<PatientAllergy[]>([]);
  const [profileTab, setProfileTab] = useState<"cases" | "admissions" | "labs" | "audit">("cases");

  // Allergies modal
  const [addAllergyOpen, setAddAllergyOpen] = useState(false);
  const [allergen, setAllergen] = useState("");
  const [allergyReaction, setAllergyReaction] = useState("");
  const [allergySeverity, setAllergySeverity] = useState<"MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING">("MODERATE");
  const [allergyNotes, setAllergyNotes] = useState("");

  // Archive patient
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archived, setArchived] = useState<ArchivedPatient[]>([]);

  // Create Patient modal
  const [createPatientOpen, setCreatePatientOpen] = useState(false);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [mn, setMn] = useState("");
  const [hrn, setHrn] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState<"MALE" | "FEMALE" | "OTHER" | "UNKNOWN" | "">("");
  const [bloodType, setBloodType] = useState("");
  const [newPatientData, setNewPatientData] = useState<PatientDataForm>(EMPTY_PATIENT_DATA);
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyRel, setEmergencyRel] = useState("");

  // Create Case modal
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [selectedAdmId, setSelectedAdmId] = useState("");
  const [caseType, setCaseType] = useState<"ELECTIVE" | "EMERGENCY" | "URGENT">("ELECTIVE");
  const [specialtyId, setSpecialtyId] = useState("");
  const [procedureSummary, setProcedureSummary] = useState("");
  const [laterality, setLaterality] = useState<"LEFT" | "RIGHT" | "BILATERAL" | "NOT_APPLICABLE">("NOT_APPLICABLE");
  const [codingCaseId, setCodingCaseId] = useState<string | null>(null);

  const loadList = async () => {
    if (!db) return;
    try {
      setLoading(true);
      const res = await listPatients(db, { search });
      setPatients(res.patients);
      setTotal(res.total);
    } catch (err) {
      logError("PatientsView.load", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [db, search]);

  const reloadCases = async () => {
    if (!db || !selectedPatientId) return;
    setCases(await getCasesByPatient(db, selectedPatientId));
    if (can("audit.view")) setAuditLogs(await getAuditHistory(db, { patientId: selectedPatientId }));
  };

  const handleArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !activePatient) return;
    try {
      await archivePatient(db, activePatient.patient_id, archiveReason);
      notify(`${activePatient.full_name} archived.`, "success");
      setArchiveOpen(false);
      setSelectedPatientId(null);
      await loadList();
    } catch (err) {
      setArchiveError((err as Error).message);
    }
  };

  const openArchived = async () => {
    if (!db) return;
    try {
      setArchived(await listArchivedPatients(db));
      setArchivedOpen(true);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleRestore = async (patientId: string) => {
    if (!db) return;
    try {
      await restorePatient(db, patientId);
      notify("Patient restored.", "success");
      setArchived(await listArchivedPatients(db));
      await loadList();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  useEffect(() => {
    if (db) {
      getSpecialties(db).then(setSpecialties).catch(logCatch("PatientsView.specialties"));
    }
  }, [db]);

  useEffect(() => {
    if (openRegisterModal) {
      setCreatePatientOpen(true);
      setOpenRegisterModal(false);
    }
  }, [openRegisterModal]);

  const reloadAllergies = async (pid: string) => {
    if (!db) return;
    try {
      const list = await listPatientAllergies(db, pid);
      setAllergies(list);
    } catch (err) {
      logError("PatientsView.loadDetail", err);
    }
  };

  useEffect(() => {
    async function loadPatientDetails() {
      if (!db || !selectedPatientId) {
        setActivePatient(null);
        setAdmissions([]);
        setCases([]);
        setAuditLogs([]);
        setAllergies([]);
        return;
      }
      try {
        const [p, admList, caseList, logs, allergyList] = await Promise.all([
          getPatientById(db, selectedPatientId),
          getAdmissionsByPatient(db, selectedPatientId),
          getCasesByPatient(db, selectedPatientId),
          can("audit.view") ? getAuditHistory(db, { patientId: selectedPatientId }) : Promise.resolve([]),
          listPatientAllergies(db, selectedPatientId),
        ]);
        setActivePatient(p);
        setAdmissions(admList);
        setCases(caseList);
        setAuditLogs(logs);
        setAllergies(allergyList);
        if (admList.length > 0) setSelectedAdmId(admList[0].admission_id);
      } catch (err) {
        logError("PatientsView.save", err);
      }
    }
    loadPatientDetails();
  }, [db, selectedPatientId]);

  const handleAddAllergy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !activePatient || !allergen.trim()) return;
    try {
      await createPatientAllergy(db, {
        patientId: activePatient.patient_id,
        allergen: allergen.trim(),
        reaction: allergyReaction.trim() || null,
        severity: allergySeverity,
        notes: allergyNotes.trim() || null,
      });
      notify("Allergy added to patient chart.", "success");
      setAddAllergyOpen(false);
      setAllergen("");
      setAllergyReaction("");
      setAllergySeverity("MODERATE");
      setAllergyNotes("");
      await reloadAllergies(activePatient.patient_id);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleDeleteAllergy = async (allergyId: string) => {
    if (!db || !activePatient) return;
    try {
      await deletePatientAllergy(db, allergyId);
      notify("Allergy removed.", "info");
      await reloadAllergies(activePatient.patient_id);
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    if (!fn.trim() || !ln.trim()) {
      notify("First name and last name are required.", "error");
      return;
    }

    try {
      // Check the patient's data first, so a bad entry stops registration before the patient is created.
      const patientData = toPatientDataInput(newPatientData);
      await validatePatientData(db, patientData);
      const p = await createPatient(db, {
        firstName: fn,
        lastName: ln,
        middleName: mn,
        hrn: hrn || null,
        dateOfBirth: dob || null,
        sex: sex || null,
        bloodType: bloodType || null,
        contactNumber: contact,
        address: address || null,
        emergencyContactName: emergencyName || null,
        emergencyContactPhone: emergencyPhone || null,
        emergencyContactRelationship: emergencyRel || null,
      });

      // Auto-create initial admission
      await createAdmission(db, {
        patientId: p.patient_id,
        admissionDate: localDate(),
        ward: "Surgical Inpatient",
      });

      if (hasPatientData(patientData)) await savePatientData(db, p.patient_id, patientData);

      notify(`Patient ${p.full_name} registered!`, "success");
      setCreatePatientOpen(false);
      setFn("");
      setLn("");
      setMn("");
      setContact("");
      setAddress("");
      setEmergencyName("");
      setEmergencyPhone("");
      setEmergencyRel("");
      setHrn("");
      setDob("");
      setSex("");
      setBloodType("");
      setNewPatientData(EMPTY_PATIENT_DATA);
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
      // Clear the whole form so the next case does not inherit this one's specialty or side.
      setProcedureSummary("");
      setSpecialtyId("");
      setCaseType("ELECTIVE");
      setLaterality("NOT_APPLICABLE");

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
        <div style={{ display: "flex", gap: "10px" }}>
          {can("patients.archive") && (
            <button onClick={openArchived} className="glass-btn glass-btn-secondary">Archived patients</button>
          )}
          <button
            onClick={() => setCreatePatientOpen(true)}
            className="glass-btn glass-btn-primary"
            style={{ gap: "8px" }}
          >
            <Plus size={16} />
            <span>Register New Patient</span>
          </button>
        </div>
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
                  <div style={{ display: "flex", gap: "10px", fontSize: "12px", color: "var(--text-muted)", marginTop: "4px", flexWrap: "wrap" }}>
                    <span>Research ID: <strong>{activePatient.research_id}</strong></span>
                    <span>&bull;</span>
                    <span>HRN: <strong>{activePatient.hrn || "None"}</strong></span>
                    <span>&bull;</span>
                    <span>Age: <strong>{activePatient.calculated_age ?? "Unknown"}</strong></span>
                    <span>&bull;</span>
                    <span>Blood: <strong>{activePatient.blood_type || "N/A"}</strong></span>
                  </div>
                  {activePatient.address && (
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                      Address: {activePatient.address}
                    </div>
                  )}
                  {activePatient.emergency_contact_name && (
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                      Emergency Contact: <strong>{activePatient.emergency_contact_name}</strong> {activePatient.emergency_contact_relationship ? `(${activePatient.emergency_contact_relationship})` : ""} &bull; {activePatient.emergency_contact_phone || "No phone"}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {can("patients.edit_demographics") && (
                  <button
                    onClick={() => setEditOpen(true)}
                    className="glass-btn glass-btn-secondary" style={{ fontSize: "12px", padding: "6px 10px", gap: "6px" }}
                  >
                    <Pencil size={13} />
                    <span>Edit details</span>
                  </button>
                )}
                {can("patients.archive") && (
                  <button
                    onClick={() => { setArchiveReason(""); setArchiveError(null); setArchiveOpen(true); }}
                    className="glass-btn glass-btn-danger" style={{ fontSize: "12px", padding: "6px 10px" }}
                  >
                    Archive patient
                  </button>
                )}
                <button onClick={() => setSelectedPatientId(null)} aria-label="Close patient record" className="glass-btn glass-btn-secondary" style={{ padding: "6px" }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Allergies Strip */}
            <div style={{ background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "10px", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", color: allergies.length > 0 ? "#ef4444" : "var(--text-muted)", fontWeight: 700, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <AlertTriangle size={15} />
                  <span>Allergies ({allergies.length}):</span>
                </div>
                {allergies.length === 0 ? (
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>No known allergies recorded (NKA)</span>
                ) : (
                  allergies.map((al) => {
                    const isSevere = al.severity === "LIFE_THREATENING" || al.severity === "SEVERE";
                    const isModerate = al.severity === "MODERATE";
                    const bg = isSevere ? "rgba(239, 68, 68, 0.2)" : isModerate ? "rgba(245, 158, 11, 0.2)" : "rgba(59, 130, 246, 0.2)";
                    const fg = isSevere ? "#ef4444" : isModerate ? "#f59e0b" : "#3b82f6";
                    const border = isSevere ? "1px solid rgba(239, 68, 68, 0.4)" : isModerate ? "1px solid rgba(245, 158, 11, 0.4)" : "1px solid rgba(59, 130, 246, 0.4)";
                    return (
                      <span
                        key={al.allergy_id}
                        style={{
                          background: bg,
                          color: fg,
                          border,
                          borderRadius: "16px",
                          padding: "3px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <strong>{al.allergen}</strong>
                        {al.reaction ? ` (${al.reaction})` : ""}
                        <span style={{ fontSize: "10px", opacity: 0.8, textTransform: "uppercase" }}>[{al.severity}]</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteAllergy(al.allergy_id)}
                          style={{ background: "transparent", border: "none", color: fg, cursor: "pointer", padding: "0 2px", display: "flex", alignItems: "center" }}
                          aria-label={`Remove allergy ${al.allergen}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setAddAllergyOpen(true)}
                className="glass-btn glass-btn-secondary"
                style={{ fontSize: "11px", padding: "4px 8px", gap: "4px" }}
              >
                <Plus size={12} />
                <span>Add Allergy</span>
              </button>
            </div>

            {selectedPatientId && <PatientDataPanel patientId={selectedPatientId} />}

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
                onClick={() => setProfileTab("labs")}
                className={`glass-btn ${profileTab === "labs" ? "glass-btn-primary" : "glass-btn-secondary"}`}
                style={{ fontSize: "13px", padding: "6px 14px" }}
              >
                Labs &amp; Files
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
                        <span className="badge badge-neutral">{c.status_label || c.case_status}</span>
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
                        {c.planned_procedure_summary || "Procedure summary pending"}
                        {" "}&bull; {c.specialty_name || "No specialty set"}
                      </div>
                      {c.status_reason && (
                        <div style={{ fontSize: "12px", color: "var(--text-subtle)", marginTop: "4px" }}>
                          Reason: {c.status_reason}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <CaseActions
                        caseId={c.case_id} status={c.case_status}
                        caseLabel={`${c.case_number} - ${activePatient.full_name}`} onDone={reloadCases}
                      />
                      <button onClick={() => setCodingCaseId(c.case_id)} className="glass-btn glass-btn-secondary"
                        style={{ fontSize: "12px" }}>Code case</button>
                      <button
                        onClick={() => {
                          setSelectedCaseId(c.case_id);
                          setView("schedule");
                        }}
                        className="glass-btn glass-btn-secondary"
                        style={{ fontSize: "12px", gap: "4px" }}
                        title="Open schedule board for this case"
                      >
                        <Calendar size={13} />
                        <span>Schedule to Board</span>
                      </button>
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

            {/* Tab: Labs & Files */}
            {profileTab === "labs" && db && (
              <LaboratoryPanel
                db={db}
                patientId={activePatient.patient_id}
                cases={cases}
              />
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

      {/* Modal: Archive Patient */}
      {archiveOpen && activePatient && (
        <div role="dialog" aria-modal="true" aria-label="Archive patient" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <form onSubmit={handleArchive} className="glass-card" style={{ width: "100%", maxWidth: "480px", padding: "28px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800 }}>Archive patient</h2>
            <div style={{ fontSize: "13px", fontWeight: 600 }}>{activePatient.full_name} &bull; HRN {activePatient.hrn || "None"}</div>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
              The patient is hidden from lists and search. Nothing is deleted: admissions, cases and the audit trail are kept,
              and the patient can be restored from Archived patients.
            </p>
            <div>
              <label htmlFor="archive-reason" style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                Reason (required, saved in the audit trail)
              </label>
              <textarea id="archive-reason" className="glass-input" autoFocus rows={3} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
            </div>
            {archiveError && <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{archiveError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setArchiveOpen(false)}>Back</button>
              <button type="submit" className="glass-btn glass-btn-danger" disabled={archiveReason.trim().length < 3}>Archive patient</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Archived Patients */}
      {archivedOpen && (
        <div role="dialog" aria-modal="true" aria-label="Archived patients" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "640px", maxHeight: "80vh", overflowY: "auto", padding: "28px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 800 }}>Archived patients ({archived.length})</h2>
              <button onClick={() => setArchivedOpen(false)} aria-label="Close" className="glass-btn glass-btn-secondary" style={{ padding: "6px" }}>
                <X size={16} />
              </button>
            </div>
            {archived.length === 0 && (
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>No archived patients.</div>
            )}
            {archived.map((a) => (
              <div key={a.patient_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "12px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>{a.last_name}, {a.first_name} &bull; HRN {a.hrn || "None"}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Archived {a.archived_at ? new Date(a.archived_at).toLocaleString() : ""} by {a.archived_by_name || "unknown"}: {a.archive_reason}
                  </div>
                </div>
                <button onClick={() => handleRestore(a.patient_id)} className="glass-btn glass-btn-primary" style={{ fontSize: "12px" }}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editOpen && activePatient && (
        <EditPatientDialog
          patient={activePatient}
          onClose={() => setEditOpen(false)}
          onSaved={async (saved) => {
            setEditOpen(false);
            setActivePatient(saved);
            await loadList();
            if (db && can("audit.view")) setAuditLogs(await getAuditHistory(db, { patientId: saved.patient_id }));
          }}
        />
      )}

      {/* Modal: Create Patient */}
      {createPatientOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "680px", maxHeight: "90vh", overflowY: "auto", padding: "28px" }}>
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
                    <option value="">Not recorded</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Blood Type</label>
                  <select className="glass-input" value={bloodType} onChange={(e) => setBloodType(e.target.value)}>
                    <option value="">Not recorded</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Contact Number</label>
                  <input className="glass-input" value={contact} onChange={(e) => setContact(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Address</label>
                  <input className="glass-input" placeholder="Street, city, postal" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-color, rgba(255,255,255,0.08))", paddingTop: "12px" }}>
                <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent)", marginBottom: "8px" }}>Emergency Contact</p>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>Name</label>
                    <input className="glass-input" placeholder="Contact person name" value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>Phone</label>
                    <input className="glass-input" placeholder="Phone number" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600 }}>Relationship</label>
                    <input className="glass-input" placeholder="Spouse, Parent..." value={emergencyRel} onChange={(e) => setEmergencyRel(e.target.value)} />
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-glass)", paddingTop: "12px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "10px" }}>Patient's data</h3>
                <PatientDataFields value={newPatientData} onChange={setNewPatientData} idPrefix="register-pd" />
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
      {codingCaseId && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)",
          overflowY: "auto", padding: 24 }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <button type="button" className="glass-btn glass-btn-secondary" onClick={() => setCodingCaseId(null)}>Close coding</button>
            <CaseCodingPanel caseId={codingCaseId} />
          </div>
        </div>
      )}
      {/* Modal: Add Allergy */}
      {addAllergyOpen && activePatient && (
        <div role="dialog" aria-modal="true" aria-label="Add Allergy" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "500px", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "4px" }}>Add Allergy for {activePatient.full_name}</h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Record medication, food, latex, or contact allergies with clinical severity.
            </p>
            <form onSubmit={handleAddAllergy} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label htmlFor="allergy-allergen" style={{ fontSize: "12px", fontWeight: 600 }}>Allergen / Substance *</label>
                <input
                  id="allergy-allergen"
                  className="glass-input"
                  required
                  placeholder="e.g. Penicillin, Latex, Iodine, Peanuts"
                  value={allergen}
                  onChange={(e) => setAllergen(e.target.value)}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label htmlFor="allergy-severity" style={{ fontSize: "12px", fontWeight: 600 }}>Severity *</label>
                  <select
                    id="allergy-severity"
                    className="glass-input"
                    value={allergySeverity}
                    onChange={(e) => setAllergySeverity(e.target.value as any)}
                  >
                    <option value="MILD">Mild</option>
                    <option value="MODERATE">Moderate</option>
                    <option value="SEVERE">Severe</option>
                    <option value="LIFE_THREATENING">Life-Threatening</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="allergy-reaction" style={{ fontSize: "12px", fontWeight: 600 }}>Reaction</label>
                  <input
                    id="allergy-reaction"
                    className="glass-input"
                    placeholder="e.g. Anaphylaxis, Rash, Bronchospasm"
                    value={allergyReaction}
                    onChange={(e) => setAllergyReaction(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="allergy-notes" style={{ fontSize: "12px", fontWeight: 600 }}>Clinical Notes</label>
                <textarea
                  id="allergy-notes"
                  className="glass-input"
                  rows={2}
                  placeholder="Source of history, previous admissions, confirmation details..."
                  value={allergyNotes}
                  onChange={(e) => setAllergyNotes(e.target.value)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setAddAllergyOpen(false)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-primary">
                  Save Allergy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
