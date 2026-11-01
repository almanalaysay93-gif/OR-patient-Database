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
  Lock,
  Menu,
} from "lucide-react";
import { useApp } from "../../context/AppContext";

export const Header: React.FC<{ menuOpen: boolean; onMenuClick: () => void }> = ({ menuOpen, onMenuClick }) => {
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
    lock,
    can,
  } = useApp();

  const cycleEffects = () => {
    if (visualEffects === "FULL") setVisualEffects("REDUCED");
    else if (visualEffects === "REDUCED") setVisualEffects("OFF");
    else setVisualEffects("FULL");
  };

  return (
    <header className="glass-header" style={{ height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
      <button type="button" className="mobile-menu-button glass-btn glass-btn-secondary" onClick={onMenuClick} aria-label="Open navigation" aria-controls="app-navigation" aria-expanded={menuOpen}><Menu size={20} /></button>
      {/* Global Search Button */}
      <button
        onClick={() => setSearchOpen(true)}
        disabled={!can("patients.view")}
        className="glass-input header-search"
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
        <span className="search-shortcut" style={{
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
      <div className="header-controls" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* AI Assistant */}
        <button
          onClick={() => setAssistantOpen(!assistantOpen)}
          disabled={!can("patients.view")}
          title="Ask the assistant (Ctrl+J)"
          aria-label="Ask the assistant"
          className={`glass-btn header-assistant ${assistantOpen ? "glass-btn-primary" : "glass-btn-secondary"}`}
          style={{ padding: "6px 12px", fontSize: "12px", gap: "6px" }}
        >
          <Bot size={14} />
          <span>Assistant</span>
        </button>

        {/* Performance Mode Switch */}
        <button
          onClick={cycleEffects}
          title={`Visual Effects: ${visualEffects}. Click to cycle.`}
          className="glass-btn glass-btn-secondary header-effects"
          style={{ padding: "6px 12px", fontSize: "12px", gap: "6px" }}
        >
          <Sparkles size={14} color={visualEffects === "FULL" ? "#0284c7" : "#94a3b8"} />
          <span>Effects: {visualEffects}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title="Toggle light/dark theme"
          className="glass-btn glass-btn-secondary header-theme"
          style={{ padding: "8px" }}
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        {/* User Pill */}
        {session ? (
          <div className="header-user" style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-card)", padding: "4px 10px 4px 6px", borderRadius: "20px", border: "1px solid var(--border-glass)" }}>
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
              onClick={lock}
              title="Lock workstation"
              aria-label="Lock workstation"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", marginLeft: "4px" }}
            >
              <Lock size={14} />
            </button>
            <button
              onClick={onLogout}
              title="Sign Out"
              aria-label="Sign out"
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
