import React from "react";
import {
  Search,
  Bot,
  Sun,
  Moon,
  Sparkles,
  User,
  Shield,
  LogOut,
} from "lucide-react";
import { useApp } from "../../context/AppContext";

export const Header: React.FC = () => {
  const {
    session,
    theme,
    setTheme,
    visualEffects,
    setVisualEffects,
    setSearchOpen,
    assistantOpen,
    setAssistantOpen,
    onLogout,
  } = useApp();

  const cycleEffects = () => {
    if (visualEffects === "FULL") setVisualEffects("REDUCED");
    else if (visualEffects === "REDUCED") setVisualEffects("OFF");
    else setVisualEffects("FULL");
  };

  return (
    <header className="glass-header" style={{ height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
      {/* Global Search Button */}
      <button
        onClick={() => setSearchOpen(true)}
        className="glass-input"
        style={{
          width: "320px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          cursor: "pointer",
          padding: "8px 14px",
          color: "var(--text-muted)",
        }}
      >
        <Search size={16} />
        <span style={{ fontSize: "13px" }}>Search patient, HRN, case...</span>
        <span style={{
          marginLeft: "auto",
          fontSize: "11px",
          background: "var(--border-subtle)",
          padding: "2px 6px",
          borderRadius: "4px",
          fontFamily: "var(--font-mono)",
        }}>
          Ctrl+K
        </span>
      </button>

      {/* Right Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* AI Assistant */}
        <button
          onClick={() => setAssistantOpen(!assistantOpen)}
          title="Ask the assistant (Ctrl+J)"
          className={`glass-btn ${assistantOpen ? "glass-btn-primary" : "glass-btn-secondary"}`}
          style={{ padding: "6px 12px", fontSize: "12px", gap: "6px" }}
        >
          <Bot size={14} />
          <span>Assistant</span>
        </button>

        {/* Performance Mode Switch */}
        <button
          onClick={cycleEffects}
          title={`Visual Effects: ${visualEffects}. Click to cycle.`}
          className="glass-btn glass-btn-secondary"
          style={{ padding: "6px 12px", fontSize: "12px", gap: "6px" }}
        >
          <Sparkles size={14} color={visualEffects === "FULL" ? "#0284c7" : "#94a3b8"} />
          <span>Effects: {visualEffects}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title="Toggle light/dark theme"
          className="glass-btn glass-btn-secondary"
          style={{ padding: "8px" }}
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        {/* User Pill */}
        {session ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-card)", padding: "4px 10px 4px 6px", borderRadius: "20px", border: "1px solid var(--border-glass)" }}>
            <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "var(--primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <User size={14} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.1" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main)" }}>
                {session.fullName}
              </span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                {session.roleName}
              </span>
            </div>
            <button
              onClick={onLogout}
              title="Sign Out"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", marginLeft: "4px" }}
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <div className="badge badge-warning" style={{ fontSize: "12px" }}>
            <Shield size={12} />
            <span>Local Session</span>
          </div>
        )}
      </div>
    </header>
  );
};
