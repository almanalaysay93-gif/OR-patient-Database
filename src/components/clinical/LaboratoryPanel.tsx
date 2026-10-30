import React, { useState, useEffect, useRef } from "react";
import {
  FlaskConical,
  Plus,
  Trash2,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Eye,
  X,
  AlertTriangle,
  AlertCircle,
  Filter,
  Download,
} from "lucide-react";
import type { Db } from "../../data/db";
import { useApp } from "../../context/AppContext";
import {
  getLabResultsByPatient,
  createLabResult,
  deleteLabResult,
  createAttachment,
  deleteAttachment,
  getAttachmentsByPatient,
  COMMON_LAB_PRESETS,
  type PatientLabResult,
  type ClinicalAttachment,
  type LabCategory,
  type LabFlag,
  type AttachmentCategory,
} from "../../services/laboratory";
import type { SurgicalCase } from "../../services/patients";
import { logError } from "../../services/logger";

interface LaboratoryPanelProps {
  db: Db;
  patientId: string;
  cases: SurgicalCase[];
}

export const LaboratoryPanel: React.FC<LaboratoryPanelProps> = ({ db, patientId, cases }) => {
  const { can, notify } = useApp();
  const [labs, setLabs] = useState<PatientLabResult[]>([]);
  const [attachments, setAttachments] = useState<ClinicalAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [addLabOpen, setAddLabOpen] = useState(false);
  const [uploadFileOpen, setUploadFileOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<ClinicalAttachment | null>(null);

  // Form states for adding lab
  const [presetKey, setPresetKey] = useState<string>("");
  const [category, setCategory] = useState<LabCategory>("HEMATOLOGY");
  const [testName, setTestName] = useState("");
  const [resultValue, setResultValue] = useState("");
  const [unit, setUnit] = useState("");
  const [referenceRange, setReferenceRange] = useState("");
  const [flag, setFlag] = useState<LabFlag>("NORMAL");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [stagedFiles, setStagedFiles] = useState<
    Array<{ fileName: string; fileType: string; fileSize: number; dataUrl: string; title: string }>
  >([]);
  const [saving, setSaving] = useState(false);

  // Form states for direct file upload
  const [directFileCategory, setDirectFileCategory] = useState<AttachmentCategory>("LAB_RESULT");
  const [directFileTitle, setDirectFileTitle] = useState("");
  const [directFileDesc, setDirectFileDesc] = useState("");
  const [directFileCaseId, setDirectFileCaseId] = useState("");
  const [directStagedFile, setDirectStagedFile] = useState<{
    fileName: string;
    fileType: string;
    fileSize: number;
    dataUrl: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const directFileInputRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [labList, attList] = await Promise.all([
        getLabResultsByPatient(db, patientId),
        getAttachmentsByPatient(db, patientId),
      ]);
      setLabs(labList);
      setAttachments(attList);
    } catch (err) {
      logError("LaboratoryPanel.load", err);
      notify((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [db, patientId]);

  const handlePresetChange = (presetName: string) => {
    setPresetKey(presetName);
    const found = COMMON_LAB_PRESETS.find((p) => p.name === presetName);
    if (found) {
      setCategory(found.category);
      setTestName(found.name);
      setUnit(found.unit);
      setReferenceRange(found.referenceRange);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          setStagedFiles((prev) => [
            ...prev,
            {
              fileName: file.name,
              fileType: file.type || "application/octet-stream",
              fileSize: file.size,
              dataUrl,
              title: file.name,
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const handleDirectFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setDirectStagedFile({
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          dataUrl,
        });
        if (!directFileTitle) setDirectFileTitle(file.name);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSaveLab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testName.trim() || !resultValue.trim() || saving) return;

    try {
      setSaving(true);
      await createLabResult(db, {
        patientId,
        caseId: selectedCaseId || null,
        category,
        testName,
        resultValue,
        unit,
        referenceRange,
        flag,
        notes,
        attachments: stagedFiles.map((f) => ({
          fileName: f.fileName,
          fileType: f.fileType,
          fileSize: f.fileSize,
          dataUrl: f.dataUrl,
          title: f.title,
          category: "LAB_RESULT",
        })),
      });

      notify("Laboratory result recorded successfully.", "success");
      setAddLabOpen(false);
      // Reset form
      setPresetKey("");
      setTestName("");
      setResultValue("");
      setUnit("");
      setReferenceRange("");
      setFlag("NORMAL");
      setSelectedCaseId("");
      setNotes("");
      setStagedFiles([]);
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDirectFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directStagedFile || saving) return;

    try {
      setSaving(true);
      await createAttachment(db, {
        patientId,
        caseId: directFileCaseId || null,
        fileName: directStagedFile.fileName,
        fileType: directStagedFile.fileType,
        fileSize: directStagedFile.fileSize,
        dataUrl: directStagedFile.dataUrl,
        title: directFileTitle.trim() || directStagedFile.fileName,
        description: directFileDesc.trim() || null,
        category: directFileCategory,
      });

      notify("File uploaded successfully.", "success");
      setUploadFileOpen(false);
      setDirectStagedFile(null);
      setDirectFileTitle("");
      setDirectFileDesc("");
      setDirectFileCaseId("");
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLab = async (labId: string, name: string) => {
    if (!window.confirm(`Delete lab result "${name}" and all attached files?`)) return;
    try {
      await deleteLabResult(db, labId);
      notify("Lab result deleted.", "info");
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleDeleteAttachment = async (attachmentId: string, fileName: string) => {
    if (!window.confirm(`Delete attachment "${fileName}"?`)) return;
    try {
      await deleteAttachment(db, attachmentId);
      notify("Attachment deleted.", "info");
      if (previewAttachment?.attachment_id === attachmentId) setPreviewAttachment(null);
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const filteredLabs = selectedCategory === "ALL"
    ? labs
    : labs.filter((l) => l.category === selectedCategory);

  const canEdit = can("cases.edit") || can("patients.create") || can("patients.edit_demographics") || can("preor.edit");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Top action bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Filter size={15} color="var(--text-muted)" />
          <select
            className="glass-input"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{ fontSize: "13px", padding: "6px 12px", width: "auto" }}
          >
            <option value="ALL">All Categories ({labs.length})</option>
            <option value="HEMATOLOGY">Hematology / CBC</option>
            <option value="CHEMISTRY">Clinical Chemistry</option>
            <option value="ELECTROLYTES">Electrolytes</option>
            <option value="COAGULATION">Coagulation (PT/INR, aPTT)</option>
            <option value="BLOOD_BANK">Blood Bank / Crossmatch</option>
            <option value="ABG">Arterial Blood Gas (ABG)</option>
            <option value="URINALYSIS">Urinalysis</option>
            <option value="MICROBIOLOGY">Microbiology / Cultures</option>
            <option value="PATHOLOGY">Pathology / Biopsy</option>
            <option value="OTHER">Other Diagnostics</option>
          </select>
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setUploadFileOpen(true)}
              className="glass-btn glass-btn-secondary"
              style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
            >
              <Paperclip size={14} />
              <span>Upload Image / File</span>
            </button>
            <button
              onClick={() => setAddLabOpen(true)}
              className="glass-btn glass-btn-primary"
              style={{ fontSize: "12px", padding: "6px 14px", gap: "6px" }}
            >
              <Plus size={14} />
              <span>Add Laboratory Result</span>
            </button>
          </div>
        )}
      </div>

      {/* Lab Results Table / Cards */}
      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
          Loading laboratory data...
        </div>
      ) : filteredLabs.length === 0 ? (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px dashed var(--border-glass)",
            borderRadius: "14px",
            padding: "36px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: "var(--primary-light)",
              color: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FlaskConical size={22} />
          </div>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
            No laboratory results recorded
          </span>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "340px", margin: 0 }}>
            Click &quot;Add Laboratory Result&quot; to enter blood panels, chemistry, urinalysis, or upload scanned slips and procedure photos.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {filteredLabs.map((l) => {
            const isAbnormal = l.flag === "ABNORMAL";
            const isCritical = l.flag === "CRITICAL";

            return (
              <div
                key={l.lab_id}
                style={{
                  background: isCritical
                    ? "rgba(239, 68, 68, 0.05)"
                    : isAbnormal
                    ? "rgba(245, 158, 11, 0.04)"
                    : "var(--bg-card)",
                  border: isCritical
                    ? "1px solid rgba(239, 68, 68, 0.3)"
                    : isAbnormal
                    ? "1px solid rgba(245, 158, 11, 0.25)"
                    : "1px solid var(--border-subtle)",
                  borderRadius: "12px",
                  padding: "14px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "10px",
                        background: isCritical
                          ? "rgba(239, 68, 68, 0.15)"
                          : isAbnormal
                          ? "rgba(245, 158, 11, 0.15)"
                          : "var(--primary-light)",
                        color: isCritical
                          ? "var(--danger)"
                          : isAbnormal
                          ? "#d97706"
                          : "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isCritical ? (
                        <AlertTriangle size={18} />
                      ) : isAbnormal ? (
                        <AlertCircle size={18} />
                      ) : (
                        <FlaskConical size={18} />
                      )}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)" }}>
                          {l.test_name}
                        </span>
                        <span
                          className={`badge ${
                            isCritical ? "badge-danger" : isAbnormal ? "badge-warning" : "badge-success"
                          }`}
                          style={{ fontSize: "10px", padding: "2px 8px" }}
                        >
                          {l.flag}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "var(--bg-app)",
                            color: "var(--text-muted)",
                          }}
                        >
                          {l.category}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>
                        <span>Date: <strong>{l.result_date}</strong></span>
                        {l.case_number && (
                          <span>Case: <strong>{l.case_number}</strong></span>
                        )}
                        {l.performed_by && (
                          <span>Tech: <strong>{l.performed_by}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: isCritical ? "var(--danger)" : "var(--text-main)" }}>
                        {l.result_value} <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-muted)" }}>{l.unit}</span>
                      </div>
                      {l.reference_range && (
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          Ref: {l.reference_range}
                        </div>
                      )}
                    </div>

                    {canEdit && (
                      <button
                        onClick={() => handleDeleteLab(l.lab_id, l.test_name)}
                        className="glass-btn glass-btn-secondary"
                        style={{ padding: "6px", color: "var(--danger)" }}
                        title="Delete lab result"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {l.notes && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", background: "var(--bg-app)", padding: "6px 10px", borderRadius: "6px" }}>
                    <strong>Note:</strong> {l.notes}
                  </div>
                )}

                {/* Attached images and files for this lab result */}
                {l.attachments && l.attachments.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                    {l.attachments.map((att) => {
                      const isImage = att.file_type.startsWith("image/");
                      return (
                        <div
                          key={att.attachment_id}
                          onClick={() => setPreviewAttachment(att)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "6px 10px",
                            background: "var(--bg-app)",
                            border: "1px solid var(--border-glass)",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontSize: "12px",
                            maxWidth: "240px",
                          }}
                        >
                          {isImage ? (
                            <img
                              src={att.data_url}
                              alt={att.file_name}
                              style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                            />
                          ) : (
                            <FileText size={16} color="var(--primary)" />
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {att.title || att.file_name}
                          </span>
                          <Eye size={13} color="var(--text-muted)" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Clinical Attachments Gallery (Photos & Files) */}
      <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-glass)", paddingTop: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
              Clinical Files & Images Gallery ({attachments.length})
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Uploaded lab slips, intra-op surgical photos, and clinical documents
            </span>
          </div>
        </div>

        {attachments.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
            No standalone files or photos attached to this patient record.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" }}>
            {attachments.map((att) => {
              const isImage = att.file_type.startsWith("image/");
              return (
                <div
                  key={att.attachment_id}
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "10px",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    onClick={() => setPreviewAttachment(att)}
                    style={{
                      height: "110px",
                      background: "var(--bg-app)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {isImage ? (
                      <img
                        src={att.data_url}
                        alt={att.file_name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        <FileText size={36} color="var(--primary)" />
                        <div style={{ fontSize: "10px", marginTop: "4px" }}>
                          {(att.file_size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                    )}
                    <span
                      style={{
                        position: "absolute",
                        top: "6px",
                        left: "6px",
                        fontSize: "9px",
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "rgba(0,0,0,0.6)",
                        color: "white",
                      }}
                    >
                      {att.category.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {att.title || att.file_name}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {(att.file_size / 1024).toFixed(1)} KB
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        onClick={() => setPreviewAttachment(att)}
                        className="glass-btn glass-btn-secondary"
                        style={{ padding: "4px" }}
                        title="View"
                      >
                        <Eye size={12} />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => handleDeleteAttachment(att.attachment_id, att.file_name)}
                          className="glass-btn glass-btn-secondary"
                          style={{ padding: "4px", color: "var(--danger)" }}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Add Laboratory Result */}
      {addLabOpen && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card" style={{ width: "540px", maxHeight: "90vh", overflowY: "auto", padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FlaskConical size={20} color="var(--primary)" />
                <h2 style={{ fontSize: "17px", fontWeight: 800, margin: 0 }}>Add Laboratory Result</h2>
              </div>
              <button onClick={() => setAddLabOpen(false)} className="glass-btn glass-btn-secondary" style={{ padding: "4px" }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveLab} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Presets */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Quick Preset (Optional)
                </label>
                <select
                  className="glass-input"
                  value={presetKey}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  style={{ fontSize: "13px" }}
                >
                  <option value="">-- Choose standard test preset --</option>
                  {COMMON_LAB_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.unit || "unitless"}) [{p.category}]
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Category *
                  </label>
                  <select
                    className="glass-input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as LabCategory)}
                    style={{ fontSize: "13px" }}
                  >
                    <option value="HEMATOLOGY">Hematology / CBC</option>
                    <option value="CHEMISTRY">Clinical Chemistry</option>
                    <option value="ELECTROLYTES">Electrolytes</option>
                    <option value="COAGULATION">Coagulation (PT/INR, aPTT)</option>
                    <option value="BLOOD_BANK">Blood Bank / Crossmatch</option>
                    <option value="ABG">Arterial Blood Gas (ABG)</option>
                    <option value="URINALYSIS">Urinalysis</option>
                    <option value="MICROBIOLOGY">Microbiology</option>
                    <option value="PATHOLOGY">Pathology</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Link Surgical Case
                  </label>
                  <select
                    className="glass-input"
                    value={selectedCaseId}
                    onChange={(e) => setSelectedCaseId(e.target.value)}
                    style={{ fontSize: "13px" }}
                  >
                    <option value="">-- General Patient Lab --</option>
                    {cases.map((c) => (
                      <option key={c.case_id} value={c.case_id}>
                        {c.case_number} ({c.case_status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Test Name *
                </label>
                <input
                  className="glass-input"
                  required
                  placeholder="e.g. Hemoglobin, Serum Creatinine, Sodium"
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Result Value *
                  </label>
                  <input
                    className="glass-input"
                    required
                    placeholder="e.g. 14.5 or Positive"
                    value={resultValue}
                    onChange={(e) => setResultValue(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Unit
                  </label>
                  <input
                    className="glass-input"
                    placeholder="e.g. g/dL, mg/dL"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Flag
                  </label>
                  <select
                    className="glass-input"
                    value={flag}
                    onChange={(e) => setFlag(e.target.value as LabFlag)}
                    style={{ fontSize: "13px" }}
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="ABNORMAL">Abnormal</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Reference Range
                </label>
                <input
                  className="glass-input"
                  placeholder="e.g. 12.0 - 17.5 g/dL"
                  value={referenceRange}
                  onChange={(e) => setReferenceRange(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Clinical Notes / Specimen Remarks
                </label>
                <textarea
                  className="glass-input"
                  rows={2}
                  placeholder="Notes on fasting status, hemolysis, redraw, or clinical correlation..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Attach Images/Files to this Lab */}
              <div style={{ borderTop: "1px solid var(--border-glass)", paddingTop: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>
                    Attach Lab Slip Photos / Documents ({stagedFiles.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="glass-btn glass-btn-secondary"
                    style={{ fontSize: "11px", padding: "4px 8px", gap: "4px" }}
                  >
                    <Paperclip size={12} />
                    <span>Browse files</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    style={{ display: "none" }}
                    onChange={handleFileUpload}
                  />
                </div>

                {stagedFiles.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {stagedFiles.map((sf, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 8px",
                          background: "var(--bg-app)",
                          borderRadius: "6px",
                          fontSize: "11px",
                        }}
                      >
                        {sf.fileType.startsWith("image/") ? (
                          <img
                            src={sf.dataUrl}
                            alt={sf.fileName}
                            style={{ width: "20px", height: "20px", objectFit: "cover", borderRadius: "3px" }}
                          />
                        ) : (
                          <FileText size={14} />
                        )}
                        <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sf.fileName}
                        </span>
                        <button
                          type="button"
                          onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 0 }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={() => setAddLabOpen(false)}
                  className="glass-btn glass-btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="glass-btn glass-btn-primary"
                  disabled={saving || !testName.trim() || !resultValue.trim()}
                >
                  {saving ? "Saving..." : "Save Lab Result"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Direct File & Image Upload */}
      {uploadFileOpen && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }}>
          <div className="glass-card" style={{ width: "480px", padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ImageIcon size={20} color="var(--primary)" />
                <h2 style={{ fontSize: "17px", fontWeight: 800, margin: 0 }}>Upload Clinical Image / File</h2>
              </div>
              <button onClick={() => setUploadFileOpen(false)} className="glass-btn glass-btn-secondary" style={{ padding: "4px" }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveDirectFile} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Category *
                </label>
                <select
                  className="glass-input"
                  value={directFileCategory}
                  onChange={(e) => setDirectFileCategory(e.target.value as AttachmentCategory)}
                  style={{ fontSize: "13px" }}
                >
                  <option value="LAB_RESULT">Laboratory Slip / Report</option>
                  <option value="PROCEDURE_IMAGE">Procedure / Intra-Op Photo</option>
                  <option value="PATIENT_PHOTO">Patient Clinical Photo</option>
                  <option value="PATHOLOGY">Pathology / Histology Report</option>
                  <option value="OTHER">Other Clinical Document</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Link Surgical Case (Optional)
                </label>
                <select
                  className="glass-input"
                  value={directFileCaseId}
                  onChange={(e) => setDirectFileCaseId(e.target.value)}
                  style={{ fontSize: "13px" }}
                >
                  <option value="">-- General Patient File --</option>
                  {cases.map((c) => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_number} ({c.case_status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Title / Label
                </label>
                <input
                  className="glass-input"
                  placeholder="e.g. Pre-Op Chest X-Ray or Surgical Field Photo"
                  value={directFileTitle}
                  onChange={(e) => setDirectFileTitle(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Description / Clinical Remarks
                </label>
                <textarea
                  className="glass-input"
                  rows={2}
                  placeholder="Clinical notes, orientation, lateral marks..."
                  value={directFileDesc}
                  onChange={(e) => setDirectFileDesc(e.target.value)}
                />
              </div>

              {/* File Drop / Select Area */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Select File (Image or PDF) *
                </label>
                <div
                  onClick={() => directFileInputRef.current?.click()}
                  style={{
                    border: "2px dashed var(--border-glass)",
                    borderRadius: "10px",
                    padding: "24px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: "var(--bg-app)",
                  }}
                >
                  {directStagedFile ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                      {directStagedFile.fileType.startsWith("image/") ? (
                        <img
                          src={directStagedFile.dataUrl}
                          alt="preview"
                          style={{ maxHeight: "120px", maxWidth: "100%", borderRadius: "6px" }}
                        />
                      ) : (
                        <FileText size={32} color="var(--primary)" />
                      )}
                      <span style={{ fontSize: "12px", fontWeight: 600 }}>{directStagedFile.fileName}</span>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {(directStagedFile.fileSize / 1024).toFixed(1)} KB (Click to replace)
                      </span>
                    </div>
                  ) : (
                    <div>
                      <ImageIcon size={32} color="var(--text-muted)" style={{ margin: "0 auto 8px" }} />
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>Click to choose image or PDF</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                        Supports PNG, JPG, WEBP, and PDF
                      </div>
                    </div>
                  )}
                  <input
                    ref={directFileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    style={{ display: "none" }}
                    onChange={handleDirectFileUpload}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={() => setUploadFileOpen(false)}
                  className="glass-btn glass-btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="glass-btn glass-btn-primary"
                  disabled={saving || !directStagedFile}
                >
                  {saving ? "Uploading..." : "Upload File"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Fullscreen Preview & Download */}
      {previewAttachment && (
        <div className="modal-backdrop" style={{ zIndex: 1100 }}>
          <div
            className="glass-card"
            style={{
              maxWidth: "85vw",
              maxHeight: "90vh",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--text-main)" }}>
                  {previewAttachment.title || previewAttachment.file_name}
                </h3>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {previewAttachment.file_name} &bull; {(previewAttachment.file_size / 1024).toFixed(1)} KB &bull; {previewAttachment.created_at}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <a
                  href={previewAttachment.data_url}
                  download={previewAttachment.file_name}
                  className="glass-btn glass-btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 12px", gap: "6px" }}
                >
                  <Download size={14} />
                  <span>Download</span>
                </a>
                <button
                  onClick={() => setPreviewAttachment(null)}
                  className="glass-btn glass-btn-secondary"
                  style={{ padding: "6px" }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: "300px",
                maxHeight: "65vh",
                overflow: "auto",
                background: "var(--bg-app)",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px",
              }}
            >
              {previewAttachment.file_type.startsWith("image/") ? (
                <img
                  src={previewAttachment.data_url}
                  alt={previewAttachment.file_name}
                  style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: "8px" }}
                />
              ) : previewAttachment.file_type === "application/pdf" ? (
                <iframe
                  src={previewAttachment.data_url}
                  title={previewAttachment.file_name}
                  style={{ width: "100%", height: "60vh", border: "none", borderRadius: "8px" }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "40px" }}>
                  <FileText size={48} color="var(--primary)" style={{ margin: "0 auto 12px" }} />
                  <p style={{ fontSize: "14px", fontWeight: 600 }}>File Preview Not Available</p>
                  <a
                    href={previewAttachment.data_url}
                    download={previewAttachment.file_name}
                    className="glass-btn glass-btn-primary"
                    style={{ marginTop: "12px", display: "inline-flex" }}
                  >
                    Download to view
                  </a>
                </div>
              )}
            </div>

            {previewAttachment.description && (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", background: "var(--bg-app)", padding: "8px 12px", borderRadius: "6px" }}>
                <strong>Description:</strong> {previewAttachment.description}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
