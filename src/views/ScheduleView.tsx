import React, { useEffect, useState } from "react";
import {
  Clock,
  AlertTriangle,
  Plus,
  Play,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  getScheduleByDate,
  scheduleCase,
  updateActualTimes,
  checkSchedulingConflicts,
  type ScheduleItem,
  type SchedulingConflict,
} from "../services/scheduling";
import { getOrRooms, getDelayReasons, type OrRoom, type NamedEntity } from "../services/masterData";

export const ScheduleView: React.FC = () => {
  const { db, setView, setSelectedPatientId, setSelectedCaseId, notify } = useApp();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [rooms, setRooms] = useState<OrRoom[]>([]);
  const [delayReasons, setDelayReasons] = useState<NamedEntity[]>([]);

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
  const [actualRoomIn, setActualRoomIn] = useState("");
  const [actualProcStart, setActualProcStart] = useState("");
  const [actualProcEnd, setActualProcEnd] = useState("");
  const [actualRoomOut, setActualRoomOut] = useState("");
  const [delayMins, setDelayMins] = useState<number>(0);
  const [delayReasonId, setDelayReasonId] = useState("");

  const loadData = async () => {
    if (!db) return;
    try {
      const [schedList, roomList, delayList] = await Promise.all([
        getScheduleByDate(db, date),
        getOrRooms(db),
        getDelayReasons(db),
      ]);
      setSchedules(schedList);
      setRooms(roomList);
      setDelayReasons(delayList);
      if (roomList.length > 0 && !schedRoomId) setSchedRoomId(roomList[0].or_room_id);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, [db, date]);

  // Load unscheduled cases for modal
  useEffect(() => {
    async function loadCases() {
      if (!db || !scheduleModalOpen) return;
      const rows = await db.select<any>(
        `SELECT c.case_id, c.case_number, c.planned_procedure_summary, p.first_name, p.last_name
         FROM surgical_cases c
         JOIN patients p ON c.patient_id = p.patient_id
         WHERE c.case_status IN ('PRE_OR', 'NOT_READY', 'READY')`
      );
      setAvailableCases(rows);
      if (rows.length > 0) setSelectedCaseToSched(rows[0].case_id);
    }
    loadCases();
  }, [db, scheduleModalOpen]);

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
    if (!db || !selectedCaseToSched || !schedRoomId) return;

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
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const handleSaveTimestamps = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !timestampModalItem) return;

    try {
      await updateActualTimes(db, {
        scheduleId: timestampModalItem.schedule_id,
        actualRoomIn: actualRoomIn || null,
        actualProcedureStart: actualProcStart || null,
        actualProcedureEnd: actualProcEnd || null,
        actualRoomOut: actualRoomOut || null,
        delayMinutes: delayMins || null,
        delayReasonId: delayReasonId || null,
      });

      notify("Operative timestamps recorded.", "success");
      setTimestampModalItem(null);
      await loadData();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const openTimestampModal = (s: ScheduleItem) => {
    setTimestampModalItem(s);
    setActualRoomIn(s.actual_room_in || "");
    setActualProcStart(s.actual_procedure_start || "");
    setActualProcEnd(s.actual_procedure_end || "");
    setActualRoomOut(s.actual_room_out || "");
    setDelayMins(s.delay_minutes || 0);
    setDelayReasonId(s.delay_reason_id || "");
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

      {/* Operating Room Grid Board */}
      <div className="glass-card" style={{ padding: "24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(rooms.length, 1)}, 1fr)`, gap: "20px" }}>
          {rooms.map((room) => {
            const roomSchedules = schedules.filter((s) => s.or_room_id === room.or_room_id);
            return (
              <div
                key={room.or_room_id}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-glass)",
                  borderRadius: "16px",
                  padding: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  minHeight: "500px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
                  <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--text-main)" }}>
                    {room.name}
                  </span>
                  <span className="badge badge-neutral" style={{ fontSize: "11px" }}>
                    {roomSchedules.length} Case(s)
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {roomSchedules.map((s) => (
                    <div
                      key={s.schedule_id}
                      style={{
                        background: "var(--bg-card-hover)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "12px",
                        padding: "14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: "var(--primary)", fontSize: "13px" }}>
                          {s.scheduled_start} - {s.scheduled_end} ({s.estimated_duration_minutes}m)
                        </span>
                        <span className="badge badge-primary">{s.case_number}</span>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-main)" }}>
                        {s.patient_name}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {s.planned_procedure_summary || "Procedure"}
                      </div>

                      {/* Timestamps & Actions */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", marginTop: "4px" }}>
                        <button
                          onClick={() => openTimestampModal(s)}
                          className="glass-btn glass-btn-secondary"
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                        >
                          <Clock size={12} />
                          <span>Times / Delays</span>
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
                          <Play size={12} />
                          <span>Intra-OR</span>
                        </button>
                      </div>
                    </div>
                  ))}

                  {roomSchedules.length === 0 && (
                    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                      No procedures scheduled for this room today.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

      {/* Modal: Update Timestamps & Delays */}
      {timestampModalItem && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div className="glass-card" style={{ width: "100%", maxWidth: "560px", padding: "28px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>
              Room Timestamps & Turnover: {timestampModalItem.case_number}
            </h2>
            <form onSubmit={handleSaveTimestamps} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Actual Room In</label>
                  <input className="glass-input" type="time" value={actualRoomIn} onChange={(e) => setActualRoomIn(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Actual Procedure Start</label>
                  <input className="glass-input" type="time" value={actualProcStart} onChange={(e) => setActualProcStart(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Actual Procedure End</label>
                  <input className="glass-input" type="time" value={actualProcEnd} onChange={(e) => setActualProcEnd(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Actual Room Out</label>
                  <input className="glass-input" type="time" value={actualRoomOut} onChange={(e) => setActualRoomOut(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Delay (Minutes)</label>
                  <input className="glass-input" type="number" min="0" value={delayMins} onChange={(e) => setDelayMins(parseInt(e.target.value, 10) || 0)} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600 }}>Delay Reason</label>
                  <select className="glass-input" value={delayReasonId} onChange={(e) => setDelayReasonId(e.target.value)}>
                    <option value="">None / On Time</option>
                    {delayReasons.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" onClick={() => setTimestampModalItem(null)} className="glass-btn glass-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="glass-btn glass-btn-primary">
                  Save Timestamps
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
