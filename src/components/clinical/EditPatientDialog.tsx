import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import { updatePatient, type Patient } from "../../services/patients";

const label: React.CSSProperties = { fontSize: "12px", fontWeight: 600 };
const row = (columns: string): React.CSSProperties => ({ display: "grid", gridTemplateColumns: columns, gap: "12px" });

export const EditPatientDialog: React.FC<{
  patient: Patient;
  onClose: () => void;
  onSaved: (saved: Patient) => void | Promise<void>;
}> = ({ patient, onClose, onSaved }) => {
  const { db, notify } = useApp();
  const [form, setForm] = useState({
    firstName: patient.first_name,
    middleName: patient.middle_name ?? "",
    lastName: patient.last_name,
    suffix: patient.suffix ?? "",
    hrn: patient.hrn ?? "",
    dateOfBirth: patient.date_of_birth ?? "",
    sex: patient.sex ?? "",
    bloodType: patient.blood_type ?? "",
    contactNumber: patient.contact_number ?? "",
    address: patient.address ?? "",
    emergencyContactName: patient.emergency_contact_name ?? "",
    emergencyContactPhone: patient.emergency_contact_phone ?? "",
    emergencyContactRelationship: patient.emergency_contact_relationship ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field = (name: keyof typeof form) => ({
    value: form[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [name]: e.target.value }),
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await updatePatient(db, patient.patient_id, { ...form, sex: (form.sex || null) as Patient["sex"] });
      notify("Patient details saved.", "success");
      await onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit patient details" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div className="glass-card" style={{ width: "100%", maxWidth: "580px", maxHeight: "90vh", overflowY: "auto", padding: "28px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "4px" }}>Edit patient details</h2>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
          Every change is recorded in the audit history with your name.
        </p>
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={row("1fr 1fr")}>
            <div>
              <label style={label} htmlFor="edit-first">First Name *</label>
              <input id="edit-first" className="glass-input" required {...field("firstName")} />
            </div>
            <div>
              <label style={label} htmlFor="edit-last">Last Name *</label>
              <input id="edit-last" className="glass-input" required {...field("lastName")} />
            </div>
          </div>
          <div style={row("1fr 1fr 1fr")}>
            <div>
              <label style={label} htmlFor="edit-middle">Middle Name</label>
              <input id="edit-middle" className="glass-input" {...field("middleName")} />
            </div>
            <div>
              <label style={label} htmlFor="edit-suffix">Suffix</label>
              <input id="edit-suffix" className="glass-input" placeholder="Jr., III" {...field("suffix")} />
            </div>
            <div>
              <label style={label} htmlFor="edit-hrn">Hospital Record No. (HRN)</label>
              <input id="edit-hrn" className="glass-input" {...field("hrn")} />
            </div>
          </div>
          <div style={row("1fr 1fr 1fr")}>
            <div>
              <label style={label} htmlFor="edit-dob">Date of Birth</label>
              <input id="edit-dob" className="glass-input" type="date" {...field("dateOfBirth")} />
            </div>
            <div>
              <label style={label} htmlFor="edit-sex">Sex</label>
              <select id="edit-sex" className="glass-input" {...field("sex")}>
                <option value="">Not recorded</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor="edit-blood">Blood Type</label>
              <select id="edit-blood" className="glass-input" {...field("bloodType")}>
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
          <div style={row("1fr 2fr")}>
            <div>
              <label style={label} htmlFor="edit-contact">Contact Number</label>
              <input id="edit-contact" className="glass-input" {...field("contactNumber")} />
            </div>
            <div>
              <label style={label} htmlFor="edit-address">Address</label>
              <input id="edit-address" className="glass-input" {...field("address")} />
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--border-color, rgba(255,255,255,0.08))", paddingTop: "12px" }}>
            <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent)", marginBottom: "8px" }}>Emergency Contact</p>
            <div style={row("1.2fr 1fr 1fr")}>
              <div>
                <label style={label} htmlFor="edit-emer-name">Name</label>
                <input id="edit-emer-name" className="glass-input" placeholder="Emergency contact name" {...field("emergencyContactName")} />
              </div>
              <div>
                <label style={label} htmlFor="edit-emer-phone">Phone</label>
                <input id="edit-emer-phone" className="glass-input" placeholder="Phone number" {...field("emergencyContactPhone")} />
              </div>
              <div>
                <label style={label} htmlFor="edit-emer-rel">Relationship</label>
                <input id="edit-emer-rel" className="glass-input" placeholder="Spouse, Parent, etc." {...field("emergencyContactRelationship")} />
              </div>
            </div>
          </div>
          {error && <div role="alert" style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
            <button type="button" onClick={onClose} className="glass-btn glass-btn-secondary">Cancel</button>
            <button type="submit" className="glass-btn glass-btn-primary" disabled={busy}>Save changes</button>
          </div>
        </form>
      </div>
    </div>
  );
};
