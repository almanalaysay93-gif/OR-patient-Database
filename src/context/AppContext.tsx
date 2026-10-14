import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Db } from "../data/db";
import { openTauriDb, isTauri, tauriBackupHost, getDbStatus, unlockDatabase } from "../data/tauri-adapter";
import { openBrowserDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { UserSession } from "../services/auth";
import { getIdleLockMinutes, login as signIn, unlockSession, recordSessionEvent } from "../services/auth";
import { changeOwnPassword } from "../services/userAdmin";
import { hasPermission, setActiveSession } from "../services/session";
import { runScheduledBackup } from "../services/backup";

export type NavView =
  | "dashboard"
  | "patients"
  | "preor"
  | "schedule"
  | "intraor"
  | "postor"
  | "analytics"
  | "settings";

/** Permission needed to open each screen. Settings is open to everyone; its sections are gated one by one. */
const VIEW_PERMISSION: Record<NavView, string | null> = {
  dashboard: "patients.view",
  patients: "patients.view",
  preor: "patients.view",
  schedule: "patients.view",
  intraor: "patients.view",
  postor: "patients.view",
  analytics: "analytics.access",
  settings: null,
};

export function canOpenView(session: UserSession | null, view: NavView): boolean {
  const needed = VIEW_PERMISSION[view];
  return !!session && (needed === null || hasPermission(session, needed));
}

const VIEW_ORDER = Object.keys(VIEW_PERMISSION) as NavView[];

export type VisualEffectsMode = "FULL" | "REDUCED" | "OFF";

interface AppContextValue {
  db: Db | null;
  loading: boolean;
  /** The encrypted database cannot be opened on this Windows account without the recovery key. */
  needsRecoveryKey: boolean;
  submitRecoveryKey: (key: string) => Promise<void>;
  error: string | null;
  session: UserSession | null;
  /** True while the idle or manual lock screen is up. The session is kept, but nothing can be saved. */
  locked: boolean;
  can: (permission: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  lock: () => void;
  currentView: NavView;
  selectedPatientId: string | null;
  selectedCaseId: string | null;
  theme: "light" | "dark";
  visualEffects: VisualEffectsMode;
  videoGuideOpen: boolean;
  searchOpen: boolean;
  assistantOpen: boolean;
  openRegisterModal: boolean;
  // Actions
  setView: (v: NavView) => void;
  setSelectedPatientId: (id: string | null) => void;
  setSelectedCaseId: (id: string | null) => void;
  setTheme: (t: "light" | "dark") => void;
  setVisualEffects: (mode: VisualEffectsMode) => void;
  setVideoGuideOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setAssistantOpen: (open: boolean) => void;
  setOpenRegisterModal: (open: boolean) => void;
  onLogout: () => void;
  notify: (msg: string, type?: "info" | "success" | "warning" | "error") => void;
  toast: { message: string; type: "info" | "success" | "warning" | "error" } | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<Db | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRecoveryKey, setNeedsRecoveryKey] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const [locked, setLocked] = useState(false);
  const lastActivity = useRef(Date.now());
  const [currentView, setCurrentView] = useState<NavView>("dashboard");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [visualEffects, setVisualEffectsState] = useState<VisualEffectsMode>("FULL");
  const [videoGuideOpen, setVideoGuideOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [openRegisterModal, setOpenRegisterModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "info" | "success" | "warning" | "error" } | null>(null);

  const notify = (message: string, type: "info" | "success" | "warning" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  async function init() {
      try {
        setLoading(true);
        let database: Db;
        if (isTauri()) {
          if ((await getDbStatus()) === "locked") {
            setNeedsRecoveryKey(true);
            return;
          }
          database = await openTauriDb();
        } else {
          // Dev / browser preview fallback using sql.js + IndexedDB (offline local wasm)
          const wasmUrl = `${import.meta.env.BASE_URL}sql-wasm.wasm`;
          database = await openBrowserDb(wasmUrl);
        }

        // Apply migrations
        await runMigrations(database);
        setDb(database);

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

  useEffect(() => {
    init();
  }, []);

  const submitRecoveryKey = async (key: string) => {
    await unlockDatabase(key);
    setNeedsRecoveryKey(false);
    await init();
  };

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

  const startSession = (s: UserSession) => {
    setActiveSession(s);
    lastActivity.current = Date.now();
    setSession(s);
    setLocked(false);
    setSearchOpen(false);
    setAssistantOpen(false);
  };

  const onLoginSuccess = (s: UserSession) => {
    startSession(s);
    setCurrentView((view) => (canOpenView(s, view) ? view : VIEW_ORDER.find((v) => canOpenView(s, v)) ?? "settings"));
    if (!s.mustChangePassword) notify(`Signed in as ${s.fullName} (${s.roleName})`, "success");
  };

  const login = async (username: string, password: string) => {
    if (!db) throw new Error("The database is not ready yet.");
    onLoginSuccess(await signIn(db, username, password));
  };

  const onLogout = async () => {
    if (db && session) await recordSessionEvent(db, session, "LOGOUT").catch(console.error);
    setActiveSession(null);
    setSession(null);
    setLocked(false);
    setSelectedPatientId(null);
    setSelectedCaseId(null);
    setSearchOpen(false);
    setAssistantOpen(false);
    setCurrentView("dashboard");
  };

  const lockWith = useCallback((reason: "IDLE_LOCK" | "MANUAL_LOCK") => {
    if (!db || !session) return;
    // Nothing can be saved while locked: services refuse to run without an active session.
    setActiveSession(null);
    setLocked(true);
    setSearchOpen(false);
    setAssistantOpen(false);
    recordSessionEvent(db, session, reason).catch(console.error);
  }, [db, session]);

  const unlock = async (password: string) => {
    if (!db || !session) throw new Error("Sign in again to continue.");
    startSession(await unlockSession(db, session, password));
  };

  const changePassword = async (current: string, next: string) => {
    if (!db || !session) throw new Error("Sign in again to continue.");
    await changeOwnPassword(db, current, next);
    setSession({ ...session, mustChangePassword: false });
    notify("Password changed.", "success");
  };

  // Idle lock: any pointer or key activity resets the clock; the check also runs when the window regains focus.
  useEffect(() => {
    if (!db || !session || locked) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const touch = () => { lastActivity.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    getIdleLockMinutes(db).catch(() => 60).then((minutes) => {
      if (cancelled) return;
      const check = () => {
        if (Date.now() - lastActivity.current >= minutes * 60_000) lockWith("IDLE_LOCK");
      };
      timer = setInterval(check, 15_000);
      window.addEventListener("focus", check);
      document.addEventListener("visibilitychange", check);
      cleanup = () => {
        window.removeEventListener("focus", check);
        document.removeEventListener("visibilitychange", check);
      };
    });
    let cleanup = () => {};
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      cleanup();
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [db, session, locked, lockWith]);

  // Scheduled backups run whenever the app is open, signed in or not.
  useEffect(() => {
    if (!db || !isTauri()) return;
    const run = () => {
      runScheduledBackup(db, tauriBackupHost)
        .then((result) => {
          if (result.mirrorError) notify(result.mirrorError, "warning");
        })
        .catch((err) => notify(`Automatic backup failed: ${(err as Error).message}`, "error"));
    };
    run();
    const timer = setInterval(run, 15 * 60_000);
    return () => clearInterval(timer);
  }, [db]);

  return (
    <AppContext.Provider
      value={{
        db,
        loading,
        needsRecoveryKey,
        submitRecoveryKey,
        error,
        session,
        locked,
        can: (permission) => hasPermission(session, permission),
        login,
        unlock,
        changePassword,
        lock: () => lockWith("MANUAL_LOCK"),
        currentView,
        selectedPatientId,
        selectedCaseId,
        theme,
        visualEffects,
        videoGuideOpen,
        searchOpen,
        assistantOpen,
        openRegisterModal,
        setView: (v) => { if (canOpenView(session, v)) setCurrentView(v); },
        setSelectedPatientId,
        setSelectedCaseId,
        setTheme,
        setVisualEffects,
        setVideoGuideOpen,
        setSearchOpen,
        setAssistantOpen,
        setOpenRegisterModal,
        onLogout,
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
