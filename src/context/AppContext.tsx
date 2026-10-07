import React, { createContext, useContext, useEffect, useState } from "react";
import type { Db } from "../data/db";
import { openTauriDb, isTauri } from "../data/tauri-adapter";
import { openBrowserDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { UserSession } from "../services/auth";
import { getSetupStatus, getOrCreateActiveSession } from "../services/auth";

export type NavView =
  | "dashboard"
  | "patients"
  | "preor"
  | "schedule"
  | "intraor"
  | "postor"
  | "analytics"
  | "settings";

export type VisualEffectsMode = "FULL" | "REDUCED" | "OFF";

interface AppContextValue {
  db: Db | null;
  loading: boolean;
  error: string | null;
  setupComplete: boolean;
  session: UserSession | null;
  currentView: NavView;
  selectedPatientId: string | null;
  selectedCaseId: string | null;
  theme: "light" | "dark";
  visualEffects: VisualEffectsMode;
  videoGuideOpen: boolean;
  searchOpen: boolean;
  assistantOpen: boolean;
  // Actions
  setView: (v: NavView) => void;
  setSelectedPatientId: (id: string | null) => void;
  setSelectedCaseId: (id: string | null) => void;
  setTheme: (t: "light" | "dark") => void;
  setVisualEffects: (mode: VisualEffectsMode) => void;
  setVideoGuideOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setAssistantOpen: (open: boolean) => void;
  onLoginSuccess: (s: UserSession) => void;
  onLogout: () => void;
  refreshSetupStatus: () => Promise<void>;
  notify: (msg: string, type?: "info" | "success" | "warning" | "error") => void;
  toast: { message: string; type: "info" | "success" | "warning" | "error" } | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<Db | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupComplete, setSetupComplete] = useState(true);
  const [session, setSession] = useState<UserSession | null>(null);
  const [currentView, setCurrentView] = useState<NavView>("dashboard");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [visualEffects, setVisualEffectsState] = useState<VisualEffectsMode>("FULL");
  const [videoGuideOpen, setVideoGuideOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "success" | "warning" | "error" } | null>(null);

  const notify = (message: string, type: "info" | "success" | "warning" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        let database: Db;
        if (isTauri()) {
          database = await openTauriDb();
        } else {
          // Dev / browser preview fallback using sql.js + IndexedDB (offline local wasm)
          const wasmUrl = "/sql-wasm.wasm";
          database = await openBrowserDb(wasmUrl);
        }

        // Apply migrations
        await runMigrations(database);
        setDb(database);

        // Auto-login active workstation session (no setup wizard, no password required)
        const activeSession = await getOrCreateActiveSession(database);
        setSession(activeSession);
        setSetupComplete(true);

        // Fetch appearance settings
        const themeRow = await database.select<{ value: string }>(
          "SELECT value FROM app_settings WHERE key = 'theme'"
        );
        if (themeRow[0]?.value === "dark") setThemeState("dark");

        const effectsRow = await database.select<{ value: string }>(
          "SELECT value FROM app_settings WHERE key = 'visual_effects'"
        );
        if (effectsRow[0]?.value) {
          setVisualEffectsState(effectsRow[0].value as VisualEffectsMode);
        }
      } catch (err) {
        console.error("Database initialization failed:", err);
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const setTheme = (t: "light" | "dark") => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    if (db) {
      db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('theme', ?)", [t]).catch(console.error);
    }
  };

  const setVisualEffects = (mode: VisualEffectsMode) => {
    setVisualEffectsState(mode);
    document.documentElement.className = mode === "REDUCED" ? "effects-reduced" : mode === "OFF" ? "effects-off" : "";
    if (db) {
      db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('visual_effects', ?)", [mode]).catch(console.error);
    }
  };

  const refreshSetupStatus = async () => {
    if (!db) return;
    const { setupComplete: isComplete } = await getSetupStatus(db);
    setSetupComplete(isComplete);
  };

  const onLoginSuccess = (s: UserSession) => {
    setSession(s);
    notify(`Signed in as ${s.fullName} (${s.roleName})`, "success");
  };

  const onLogout = async () => {
    if (db) {
      const activeSession = await getOrCreateActiveSession(db);
      setSession(activeSession);
      notify("Workstation session refreshed.", "info");
    }
  };

  return (
    <AppContext.Provider
      value={{
        db,
        loading,
        error,
        setupComplete,
        session,
        currentView,
        selectedPatientId,
        selectedCaseId,
        theme,
        visualEffects,
        videoGuideOpen,
        searchOpen,
        assistantOpen,
        setView: setCurrentView,
        setSelectedPatientId,
        setSelectedCaseId,
        setTheme,
        setVisualEffects,
        setVideoGuideOpen,
        setSearchOpen,
        setAssistantOpen,
        onLoginSuccess,
        onLogout,
        refreshSetupStatus,
        notify,
        toast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};
