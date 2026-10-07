import React, { useState, useEffect } from "react";
import { Search, X, User, FileText, ArrowRight } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { searchGlobal, type Patient, type SurgicalCase } from "../../services/patients";

export const GlobalSearchModal: React.FC = () => {
  const { db, searchOpen, setSearchOpen, setSelectedPatientId, setSelectedCaseId, setView } = useApp();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [cases, setCases] = useState<SurgicalCase[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  useEffect(() => {
    if (!db || !query.trim() || !searchOpen) {
      setPatients([]);
      setCases([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchGlobal(db, query);
        setPatients(res.patients);
        setCases(res.cases);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [db, query, searchOpen]);

  if (!searchOpen) return null;

  const onSelectPatient = (patientId: string) => {
    setSelectedPatientId(patientId);
    setView("patients");
    setSearchOpen(false);
  };

  const onSelectCase = (caseId: string, patientId: string) => {
    setSelectedPatientId(patientId);
    setSelectedCaseId(caseId);
    setView("intraor");
    setSearchOpen(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "100px",
      }}
      onClick={() => setSearchOpen(false)}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "680px",
          background: "var(--bg-card)",
          borderRadius: "20px",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Bar Input */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-glass)", display: "flex", alignItems: "center", gap: "12px" }}>
          <Search size={20} color="var(--primary)" />
          <input
            autoFocus
            type="text"
            placeholder="Search by patient name, HRN, case #, procedure..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "16px",
              color: "var(--text-main)",
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* Results Area */}
        <div style={{ maxHeight: "420px", overflowY: "auto", padding: "14px 20px" }}>
          {loading && <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>Searching...</div>}

          {!loading && !query && (
            <div style={{ padding: "30px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
              Type a patient name, Hospital Record Number (HRN), or surgical procedure.
            </div>
          )}

          {!loading && query && patients.length === 0 && cases.length === 0 && (
            <div style={{ padding: "30px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
              No patients or surgical cases matched "{query}".
            </div>
          )}

          {patients.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px" }}>
                Patients ({patients.length})
              </div>
              {patients.map((p) => (
                <div
                  key={p.patient_id}
                  onClick={() => onSelectPatient(p.patient_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    marginBottom: "6px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--primary-light)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-card)")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--primary-light)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <User size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-main)" }}>
                        {p.full_name}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        HRN: {p.hrn || "None"} &bull; Age: {p.calculated_age ?? "Unknown"} &bull; Sex: {p.sex || "Unknown"}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={16} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          )}

          {cases.length > 0 && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "8px" }}>
                Surgical Cases ({cases.length})
              </div>
              {cases.map((c) => (
                <div
                  key={c.case_id}
                  onClick={() => onSelectCase(c.case_id, c.patient_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    marginBottom: "6px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--primary-light)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-card)")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "var(--warning-light)", color: "var(--warning)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <FileText size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-main)" }}>
                        {c.case_number}: {c.planned_procedure_summary || "Procedure"}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        Patient: {c.patient_name} &bull; Status: {c.case_status}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={16} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
