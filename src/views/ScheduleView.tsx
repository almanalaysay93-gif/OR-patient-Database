import React, { useEffect, useState } from "react";
import {
  Clock,
  AlertTriangle,
  Plus,
  Play,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { localDate } from "../data/db";
import { CaseActions } from "../components/clinical/CaseActions";
import type { CaseStatus } from "../services/patients";
import {
  getScheduleByDate,
  scheduleCase,
  checkSchedulingConflicts,
  type ScheduleItem,
  type SchedulingConflict,
} from "../services/scheduling";
import { getOrRooms, type OrRoom } from "../services/masterData";
import { CaseEventsPanel } from "../components/clinical/CaseEventsPanel";
import { DataTable } from "../components/common/DataTable";

export const ScheduleView: React.FC = () => {
  const { db, setView, setSelectedPatientId, selectedCaseId, setSelectedCaseId, notify } = useApp();
  const [date, setDate] = useState(localDate());
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [rooms, setRooms] = useState<OrRoom[]>([]);

  // New Schedule Modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [availableCases, setAvailableCases] = useState<any[]>([]);
  const [selectedCaseToSched, setSelectedCaseToSched] = useState("");
  const [schedRoomId, setSchedRoomId] = useState("");
  const [schedTime, setSchedTime] = useState("08:00");
  const [schedDuration, setSchedDuration] = useState(120);
  const [liveConflicts, setLiveConflicts] = useState<SchedulingConflict[]>([]);

  // Update Timestamps modal
  const [timestampModalItem, setTimestampModalItem] = useState<ScheduleItem | null>(null);

  const loadData = async () => {
    if (!db) return;
    try {
      const [schedList, roomList] = await Promise.all([
        getScheduleByDate(db, date),
        getOrRooms(db),
      ]);
      setSchedules(schedList);
      setRooms(roomList);
      if (roomList.length > 0 && !schedRoomId) setSchedRoomId(roomList[0].or_room_id);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, [db, date]);

  // If a case was pre-selected from Pre-OR or Patient view, open scheduling modal directly
  useEffect(() => {
    if (selectedCaseId) {
      setSelectedCaseToSched(selectedCaseId);
      setScheduleModalOpen(true);
    }
  }, [selectedCaseId]);

  // Load unscheduled cases for modal
  useEffect(() => {
    async function loadCases() {
      if (!db || !scheduleModalOpen) return;
      const rows = await db.select<any>(
        `SELECT c.case_id, c.case_number, c.planned_procedure_summary, p.first_name, p.last_name
         FROM surgical_cases c
         JOIN patients p ON c.patient_id = p.patient_id
         WHERE (c.case_status IN ('PRE_OR', 'NOT_READY', 'READY', 'POSTPONED') OR c.case_id = ?) AND p.is_active = 1`,
        [selectedCaseId || ""]
      );
      setAvailableCases(rows);
      if (selectedCaseId && rows.some((r: any) => r.case_id === selectedCaseId)) {
        setSelectedCaseToSched(selectedCaseId);
      } else if (rows.length > 0 && !selectedCaseToSched) {
        setSelectedCaseToSched(rows[0].case_id);
      }
    }
    loadCases();
  }, [db, scheduleModalOpen, selectedCaseId]);

  // Live conflict validation when modal form values change
  useEffect(() => {
    async function check() {
      if (!db || !scheduleModalOpen || !selectedCaseToSched || !schedRoomId) {
        setLiveConflicts([]);
        return;
      }
      const conflicts = await checkSchedulingConflicts(db, {
        caseId: selectedCaseToSched,
        roomId: schedRoomId,
        date,
        startTime: schedTime,
        durationMinutes: schedDuration,
      });
      setLiveConflicts(conflicts);
    }
    check();
  }, [db, scheduleModalOpen, selectedCaseToSched, schedRoomId, date, schedTime, schedDuration]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    if (!selectedCaseToSched) {
      notify("Please select a surgical case to schedule.", "error");
      return;
    }
    if (!schedRoomId) {
      notify("No Operating Room selected. Please configure OR rooms first.", "error");
      return;
    }

    try {
      const res = await scheduleCase(db, {
        caseId: selectedCaseToSched,
        roomId: schedRoomId,
        date,
        startTime: schedTime,
        estimatedDurationMinutes: schedDuration,
        allowConflictOverride: liveConflicts.length === 0,
      });

      if (res.conflicts.length > 0) {
        notify("Scheduling conflict detected! Case was not scheduled.", "error");
        return;
      }

      notify("Case scheduled successfully!", "success");
      setScheduleModalOpen(false);
      setSelectedCaseId(null);
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const openTimestampModal = (s: ScheduleItem) => {
    setTimestampModalItem(s);
  };

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>
            Operating Room Scheduling Board
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
            Room timeline grid with automated 4-way collision protection.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <input
            type="date"
            className="glass-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: "170px" }}
          />
          <button
            onClick={() => setScheduleModalOpen(true)}
            className="glass-btn glass-btn-primary"
            style={{ gap: "8px" }}
          >
            <Plus size={16} />
            <span>Schedule Case</span>
          </button>
        </div>
      </div>

      {/* Schedule table */}
      {rooms.length === 0 ? (
        <div className="glass-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <AlertTriangle size={36} color="var(--warning)" style={{ margin: "0 auto 12px auto" }} />
          <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "6px" }}>No Operating Rooms Configured</h3>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", maxWidth: "420px", margin: "0 auto 16px auto" }}>
            The schedule board requires active operating rooms to assign cases and check conflicts.
          </p>
          <button onClick={() => setView("settings")} className="glass-btn glass-btn-primary">
            Configure Rooms in Settings
          </button>
        </div>
      ) : (
        <DataTable<ScheduleItem>
          caption="Schedule for the selected date"
          rows={schedules}
          rowKey={(s) => s.schedule_id}
          searchText={(s) => [s.patient_name, s.case_number, s.planned_procedure_summary, s.room_name, s.scheduled_start].filter(Boolean).join(" ")}
          searchLabel="Search schedule"
          searchPlaceholder="Search patient, case, procedure or room"
          emptyMessage="No cases scheduled for this date."
          columns={[
            { key: "time", header: "Time", nowrap: true, render: (s) => (
              <span style={{ fontWeight: 700, color: "var(--primary)" }}>
                {s.scheduled_start} - {s.scheduled_end}
                <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>{s.estimated_duration_minutes} min</span>
              </span>
            ) },
            { key: "room", header: "Room", nowrap: true, render: (s) => s.room_name || "Unassigned" },
            { key: "case", header: "Case", nowrap: true, render: (s) => <span className="badge badge-primary">{s.case_number}</span> },
            { key: "patient", header: "Patient", render: (s) => <strong>{s.patient_name}</strong> },
            { key: "procedure", header: "Procedure", render: (s) => s.planned_procedure_summary || "Procedure" },
            { key: "status", header: "Status", nowrap: true, render: (s) => (
              (s.schedule_status === "CANCELLED" || s.schedule_status === "POSTPONED")
                ? <span className="badge badge-danger">{s.schedule_status}</span>
                : <span style={{ color: "var(--text-muted)" }}>{s.case_status || s.schedule_status}</span>
            ) },
            { key: "actions", header: "Actions", render: (s) => (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button onClick={() => openTimestampModal(s)} className="glass-btn glass-btn-secondary" style={{ fontSize: "11px", padding: "4px 8px" }}>
                    <Clock size={12} /><span>OR events</span>
                  </button>
                  <button
                    onClick={() => {
                      if (s.patient_id && s.case_id) {
                        setSelectedPatientId(s.patient_id);
                        setSelectedCaseId(s.case_id);
                        setView("intraor");
                      }
                    }}
                    className="glass-btn glass-btn-primary"
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                  >
                    <Play size={12} /><span>Intra-OR</span>
                  </button>
                </div>
                {s.case_status && (
                  <CaseActions caseId={s.case_id} status={s.case_status as CaseStatus}
                    caseLabel={`${s.case_number} - ${s.patient_name}`} onDone={loadData} />
                )}
              </div>
            ) },
          ]}
        />
      )}

      {/* Modal: Schedule Case */}
      {scheduleModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "580px", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>Schedule Surgical Case</h2>

            {/* Live Conflict Warning Banner */}
            {liveConflicts.length > 0 && (
              <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger-border)", borderRadius: "12px", padding: "14px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)", fontWeight: 700, fontSize: "13px" }}>
                  <AlertTriangle size={16} />
                  <span>Conflict Guard Warning</span>
                </div>
                {liveConflicts.map((c, i) => (
                  <div key={i} style={{ fontSize: "12px", color: "var(--danger)", marginTop: "4px" }}>
                    &bull; {c.description}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleCreateSchedule} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Select Patient Case</label>
                <select className="glass-input" value={selectedCaseToSched} onChange={(e) => setSelectedCaseToSched(e.target.value)}>
                  {availableCases.map((c) => (
                    <option key={c.case_id} value={c.case_id}>
                      {c.case_number}: {c.last_name}, {c.first_name} - {c.planned_procedure_summary}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600 }}>Operating Room</label>
                <select className="glass-input" value={schedRoomId} onChange={(e) => setSchedRoomId(e.target.value)}>
                  {rooms.map((r) => (
                    <option key={r.or_room_id} value={r.or_room_id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Start Time (24h)</label>
                  <input className="glass-input" type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Estimated Duration (Minutes)</label>
                  <input className="glass-input" type="number" step="15" min="15" value={schedDuration} onChange={(e) => setSchedDuration(parseInt(e.target.value, 10) || 60)} />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setScheduleModalOpen(false)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-primary" disabled={liveConflicts.length > 0}>
                  Confirm Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: dated case events */}
      {timestampModalItem && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "700px", maxHeight: "85vh", overflowY: "auto", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>
              OR events: {timestampModalItem.case_number}
            </h2>
            <CaseEventsPanel caseId={timestampModalItem.case_id} />
            <button type="button" onClick={() => setTimestampModalItem(null)} className="glass-btn glass-btn-secondary"
              style={{ marginTop: 12 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};
