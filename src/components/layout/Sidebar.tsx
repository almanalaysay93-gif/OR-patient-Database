import React from "react";
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  CalendarDays,
  Activity,
  HeartPulse,
  BarChart3,
  Settings,
  ShieldCheck,
  Film,
} from "lucide-react";
import { useApp, type NavView } from "../../context/AppContext";

interface NavItem {
  id: NavView;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "patients", label: "Patients", icon: Users },
  { id: "preor", label: "Pre-OR", icon: ClipboardCheck },
  { id: "schedule", label: "OR Schedule", icon: CalendarDays },
  { id: "intraor", label: "Intra-OR", icon: Activity },
  { id: "postor", label: "Post-OR / PACU", icon: HeartPulse },
  { id: "analytics", label: "Analytics", icon: BarChart3, badge: "3D" },
  { id: "settings", label: "Settings", icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { currentView, setView, setVideoGuideOpen } = useApp();

  return (
    <aside className="glass-sidebar" style={{ width: "240px", display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Brand Header */}
      <div style={{ padding: "20px 18px", borderBottom: "1px solid var(--border-glass)", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          background: "linear-gradient(135deg, #0284c7, #0d9488)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)"
        }}>
          <ShieldCheck size={20} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14px", letterSpacing: "-0.01em", color: "var(--text-main)" }}>
            OR Station
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>
            Offline Workstation
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <nav style={{ flex: 1, padding: "14px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                width: "100%",
                padding: "10px 14px",
                borderRadius: "10px",
                border: "none",
                background: isActive ? "var(--primary-light)" : "transparent",
                color: isActive ? "var(--primary)" : "var(--text-main)",
                fontWeight: isActive ? 600 : 500,
                fontSize: "14px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                textAlign: "left",
              }}
            >
              <Icon size={18} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span className="badge badge-primary" style={{ fontSize: "10px", padding: "1px 6px" }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Video Guide Launcher */}
      <div style={{ padding: "14px", borderTop: "1px solid var(--border-glass)" }}>
        <button
          onClick={() => setVideoGuideOpen(true)}
          className="glass-btn glass-btn-secondary"
          style={{ width: "100%", justifyContent: "flex-start", gap: "10px", fontSize: "13px" }}
        >
          <Film size={16} color="#0284c7" />
          <span>Interactive Guide</span>
        </button>
      </div>
    </aside>
  );
};
