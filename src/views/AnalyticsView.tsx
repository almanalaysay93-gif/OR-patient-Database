import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Filter } from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  getAnalyticsSummary,
  type AnalyticsSummary,
} from "../services/analytics";
import { getSpecialties, type Specialty } from "../services/masterData";

export const AnalyticsView: React.FC = () => {
  const { db, visualEffects } = useApp();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!db) return;
      try {
        setLoading(true);
        const [sumRes, specList] = await Promise.all([
          getAnalyticsSummary(db, {
            specialtyId: selectedSpecialty || undefined,
          }),
          getSpecialties(db),
        ]);
        setSummary(sumRes);
        setSpecialties(specList);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [db, selectedSpecialty]);

  if (loading || !summary) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
        Generating surgical analytics & cohort distributions...
      </div>
    );
  }

  const sexPieData = [
    { name: "Male", value: summary.sexDistribution.male, color: "#0284c7" },
    { name: "Female", value: summary.sexDistribution.female, color: "#ec4899" },
    { name: "Other", value: summary.sexDistribution.other, color: "#8b5cf6" },
  ].filter((d) => d.value > 0);

  return (
    <div
      style={{
        padding: "36px",
        display: "flex",
        flexDirection: "column",
        gap: "28px",
        perspective: visualEffects === "FULL" ? "1200px" : "none",
      }}
    >
      {/* 3D Glass Header */}
      <div
        className="glass-card"
        style={{
          padding: "28px 36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, rgba(2, 132, 199, 0.08) 0%, rgba(13, 148, 136, 0.06) 100%), var(--bg-card)",
          boxShadow: visualEffects === "FULL" ? "0 20px 40px rgba(2, 132, 199, 0.08)" : "var(--shadow-md)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="badge badge-primary" style={{ fontSize: "11px", letterSpacing: "0.08em" }}>
              RESEARCH INTELLIGENCE
            </span>
            <span className="badge badge-neutral" style={{ fontSize: "11px" }}>
              Local SQLite Engine
            </span>
          </div>
          <h1 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text-main)", marginTop: "6px" }}>
            Patient-Based Surgical Analytics
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
            Normative demographics, procedural volume, and complication tracking with strict patient vs case grain distinction.
          </p>
        </div>

        {/* Specialty Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Filter size={16} color="var(--primary)" />
          <select
            className="glass-input"
            value={selectedSpecialty}
            onChange={(e) => setSelectedSpecialty(e.target.value)}
            style={{ width: "200px" }}
          >
            <option value="">All Surgical Specialties</option>
            {specialties.map((s) => (
              <option key={s.specialty_id} value={s.specialty_id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Cohort Core Distinction: Unique Patients vs Surgical Cases */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px" }}>
        <div className="glass-card" style={{ padding: "22px", borderTop: "4px solid #0284c7" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Unique Patients
          </div>
          <div style={{ fontSize: "38px", fontWeight: 800, color: "var(--text-main)", margin: "4px 0" }}>
            {summary.uniquePatients}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Distinct biological individuals in cohort
          </div>
        </div>

        <div className="glass-card" style={{ padding: "22px", borderTop: "4px solid #0d9488" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Surgical Cases
          </div>
          <div style={{ fontSize: "38px", fontWeight: 800, color: "var(--text-main)", margin: "4px 0" }}>
            {summary.totalCases}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            {summary.uniquePatients > 0 ? (summary.totalCases / summary.uniquePatients).toFixed(2) : "0.00"} operations per patient
          </div>
        </div>

        <div className="glass-card" style={{ padding: "22px", borderTop: "4px solid #d97706" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Age at Surgery (Mean)
          </div>
          <div style={{ fontSize: "38px", fontWeight: 800, color: "var(--text-main)", margin: "4px 0" }}>
            {summary.ageStats.mean} <span style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-muted)" }}>yrs</span>
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Median: {summary.ageStats.median} yrs (Range {summary.ageStats.min} - {summary.ageStats.max})
          </div>
        </div>

        <div className="glass-card" style={{ padding: "22px", borderTop: "4px solid #059669" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Complication Rate
          </div>
          <div style={{ fontSize: "38px", fontWeight: 800, color: "var(--text-main)", margin: "4px 0" }}>
            {summary.complicationsSummary.complicationRatePct}%
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            {summary.complicationsSummary.casesWithComplications} / {summary.totalCases} cases ({summary.complicationsSummary.totalComplications} events)
          </div>
        </div>
      </div>

      {/* Row 2: Demographics Section (Age Curve + Sex Distribution) */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "24px" }}>
        {/* Age Distribution Chart */}
        <div className="glass-card" style={{ padding: "26px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-main)" }}>
                Patient Age Distribution at Surgery
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Calculated dynamically from date of birth relative to surgery date
              </p>
            </div>
            {summary.ageStats.missingCount > 0 && (
              <span className="badge badge-warning" style={{ fontSize: "11px" }}>
                {summary.ageStats.missingCount} unknown DOB
              </span>
            )}
          </div>

          <div style={{ height: "240px", width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.ageStats.distribution}>
                <XAxis dataKey="group" stroke="var(--text-muted)" fontSize={12} />
                <YAxis stroke="var(--text-muted)" fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-glass)",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="count" fill="#0284c7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sex Distribution Donut Chart */}
        <div className="glass-card" style={{ padding: "26px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-main)" }}>
              Sex Distribution (Unique Patients)
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Denominator: {summary.uniquePatients} unique patients
            </p>
          </div>

          <div style={{ height: "180px", width: "100%", display: "flex", alignItems: "center" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sexPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  dataKey="value"
                  paddingAngle={4}
                >
                  {sexPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", borderTop: "1px solid var(--border-glass)", paddingTop: "12px", fontSize: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#0284c7" }} />
              <span>Male: {summary.sexDistribution.male} ({summary.sexDistribution.malePct}%)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ec4899" }} />
              <span>Female: {summary.sexDistribution.female} ({summary.sexDistribution.femalePct}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Procedural Census & Priority */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "24px" }}>
        {/* Top Procedures Horizontal Ranking */}
        <div className="glass-card" style={{ padding: "26px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-main)" }}>
              Top Surgical Procedures by Volume
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Normalized case count across cohort
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {summary.topProcedures.map((proc, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 600 }}>
                  <span style={{ color: "var(--text-main)" }}>{proc.name}</span>
                  <span style={{ color: "var(--primary)" }}>{proc.count} cases ({proc.pct}%)</span>
                </div>
                <div style={{ width: "100%", height: "8px", background: "rgba(148, 163, 184, 0.15)", borderRadius: "4px", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${proc.pct}%`,
                      background: "linear-gradient(90deg, #0284c7, #0d9488)",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>
            ))}

            {summary.topProcedures.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                No procedure records in cohort.
              </div>
            )}
          </div>
        </div>

        {/* Priority & Post-Op Disposition */}
        <div className="glass-card" style={{ padding: "26px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text-main)" }}>
              Case Urgency & Destinations
            </h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Elective vs Emergency and PACU disposition
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Case Priority
            </span>
            <div style={{ display: "flex", gap: "10px" }}>
              {summary.caseTypes.map((t) => (
                <div
                  key={t.type}
                  style={{
                    flex: 1,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "10px",
                    padding: "10px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--primary)" }}>
                    {t.count}
                  </div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", marginTop: "2px" }}>
                    {t.type} ({t.pct}%)
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Post-Op Destinations
            </span>
            {summary.destinations.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span style={{ color: "var(--text-main)" }}>{d.destination}</span>
                <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{d.count} ({d.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
