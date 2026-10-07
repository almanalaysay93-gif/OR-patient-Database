import React, { useEffect, useState } from "react";
import {
  Users,
  Calendar,
  ClipboardList,
  CheckCircle,
  ArrowRight,
  Plus,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { getAnalyticsSummary, type AnalyticsSummary } from "../services/analytics";
import { getScheduleByDate, type ScheduleItem } from "../services/scheduling";
import { getOrRooms, type OrRoom } from "../services/masterData";

export const DashboardView: React.FC = () => {
  const { db, setView, setSelectedPatientId, setSelectedCaseId } = useApp();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [rooms, setRooms] = useState<OrRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const todayStr = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function loadData() {
      if (!db) return;
      try {
        setLoading(true);
        const [sumRes, schedRes, roomsRes] = await Promise.all([
          getAnalyticsSummary(db),
          getScheduleByDate(db, todayStr),
          getOrRooms(db),
        ]);
        setSummary(sumRes);
        setSchedule(schedRes);
        setRooms(roomsRes);
      } catch (err) {
        console.error("Dashboard data load error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [db, todayStr]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
        Loading Operating Room Dashboard...
      </div>
    );
  }

  const kpis = [
    {
      label: "Unique Patients",
      value: summary?.uniquePatients ?? 0,
      sub: `${summary?.totalAdmissions ?? 0} admissions recorded`,
      icon: Users,
      color: "#0284c7",
      view: "patients" as const,
    },
    {
      label: "Scheduled Today",
      value: schedule.length,
      sub: "Across active OR rooms",
      icon: Calendar,
      color: "#0d9488",
      view: "schedule" as const,
    },
    {
      label: "Pre-OR Pipeline",
      value: (summary?.totalCases ?? 0) - (summary?.completedCases ?? 0),
      sub: "Active preparation queue",
      icon: ClipboardList,
      color: "#d97706",
      view: "preor" as const,
    },
    {
      label: "Completed Cases",
      value: summary?.completedCases ?? 0,
      sub: `${summary?.totalCases ? Math.round(((summary.completedCases) / summary.totalCases) * 100) : 0}% completion rate`,
      icon: CheckCircle,
      color: "#059669",
      view: "analytics" as const,
    },
  ];

  return (
    <div style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Title & Quick Actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)" }}>
            Operating Room Operational Dashboard
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
            Real-time surgical case tracking, room occupancy, and readiness pipeline.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => setView("patients")}
            className="glass-btn glass-btn-primary"
            style={{ gap: "8px" }}
          >
            <Plus size={16} />
            <span>New Patient Case</span>
          </button>
        </div>
      </div>

      {/* KPI Glass Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px" }}>
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="glass-card"
              style={{
                padding: "22px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
              onClick={() => setView(kpi.view)}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
                  {kpi.label}
                </span>
                <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${kpi.color}18`, color: kpi.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={18} />
                </div>
              </div>
              <div style={{ fontSize: "36px", fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.02em" }}>
                {kpi.value}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {kpi.sub}
              </div>
            </div>
          );
        })}
      </div>

      {/* Operating Room Status Grid */}
      <div className="glass-card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-main)" }}>
              Operating Suite Allocation ({todayStr})
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Live room readiness and active scheduled cases
            </p>
          </div>
          <button onClick={() => setView("schedule")} className="glass-btn glass-btn-secondary" style={{ fontSize: "12px", gap: "6px" }}>
            <span>Full Schedule Board</span>
            <ArrowRight size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(rooms.length, 3)}, 1fr)`, gap: "16px" }}>
          {rooms.map((room) => {
            const roomSchedules = schedule.filter((s) => s.or_room_id === room.or_room_id);
            const activeNow = roomSchedules.find((s) => s.actual_room_in && !s.actual_room_out);

            return (
              <div
                key={room.or_room_id}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-glass)",
                  borderRadius: "14px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--text-main)" }}>
                    {room.name}
                  </span>
                  <span className={`badge ${activeNow ? "badge-primary" : "badge-success"}`}>
                    {activeNow ? "IN USE" : "AVAILABLE"}
                  </span>
                </div>

                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {roomSchedules.length} case(s) scheduled today
                </div>

                {roomSchedules.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                    {roomSchedules.slice(0, 3).map((s) => (
                      <div
                        key={s.schedule_id}
                        onClick={() => {
                          if (s.case_id && s.patient_id) {
                            setSelectedPatientId(s.patient_id);
                            setSelectedCaseId(s.case_id);
                            setView("intraor");
                          }
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "8px",
                          background: "rgba(148, 163, 184, 0.08)",
                          border: "1px solid var(--border-subtle)",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                          <span>{s.scheduled_start} - {s.scheduled_end}</span>
                          <span style={{ color: "var(--primary)" }}>{s.case_number}</span>
                        </div>
                        <div style={{ color: "var(--text-muted)", marginTop: "2px" }}>
                          {s.patient_name} &bull; {s.planned_procedure_summary || "Procedure"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "14px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                    No pending cases
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
