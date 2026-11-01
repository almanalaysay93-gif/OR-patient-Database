import React, { useEffect, useRef, useState } from "react";
import { AppProvider, useApp, type NavView } from "./context/AppContext";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { LoginScreen } from "./components/auth/LoginScreen";
import { LockScreen } from "./components/auth/LockScreen";
import { ChangePasswordScreen } from "./components/auth/ChangePasswordScreen";
import { RecoveryKeyScreen } from "./components/auth/RecoveryKeyScreen";
import { GlobalSearchModal } from "./components/common/GlobalSearchModal";
import { AssistantPanel } from "./components/assistant/AssistantPanel";
import { HyperFramesGuideModal } from "./components/video/HyperFramesGuideModal";

// Views
import { DashboardView } from "./views/DashboardView";
import { PatientsView } from "./views/PatientsView";
import { PreOrView } from "./views/PreOrView";
import { ScheduleView } from "./views/ScheduleView";
import { IntraOrView } from "./views/IntraOrView";
import { PostOrView } from "./views/PostOrView";
import { AnalyticsView } from "./views/AnalyticsView";
import { SettingsView } from "./views/SettingsView";
import { AppMapView } from "./views/AppMapView";

/** Screens where a signed-in user may look but not save unless they hold one of these permissions. */
const EDIT_PERMISSIONS: Partial<Record<NavView, string[]>> = {
  patients: ["patients.create", "patients.edit_demographics", "cases.edit"],
  preor: ["preor.edit"],
  schedule: ["schedule.edit"],
  intraor: ["intraor.edit"],
  postor: ["postor.edit"],
};

const MainLayout: React.FC = () => {
  const { currentView, session, locked, can, loading, needsRecoveryKey, error, toast } = useApp();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navWasOpen = useRef(false);
  useEffect(() => { setMobileNavOpen(false); }, [currentView, locked]);
  useEffect(() => {
    if (mobileNavOpen) document.querySelector<HTMLElement>("#app-navigation nav button")?.focus();
    else if (navWasOpen.current) document.querySelector<HTMLElement>(".mobile-menu-button")?.focus();
    navWasOpen.current = mobileNavOpen;
  }, [mobileNavOpen]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);
  const editPermissions = EDIT_PERMISSIONS[currentView];
  const readOnly = !!editPermissions && !editPermissions.some(can);

  return (
    <div className="app-shell" style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      {!session ? (
        needsRecoveryKey ? (
          <RecoveryKeyScreen />
        ) : loading || error ? (
          <div role={error ? "alert" : "status"} style={{ margin: "auto", color: error ? "var(--danger)" : "var(--text-muted)", fontSize: "14px", maxWidth: "480px", textAlign: "center" }}>
            {error ? `The database could not be opened: ${error}` : "Opening database..."}
          </div>
        ) : (
          <LoginScreen />
        )
      ) : session.mustChangePassword ? (
        // No screen is mounted until the temporary password is replaced: every service refuses to run.
        locked ? <LockScreen /> : <ChangePasswordScreen />
      ) : (
        <>
          {/* Hidden, not unmounted, while locked: unsaved form entries survive the lock. */}
          <div className="app-workspace" inert={locked} style={{ display: locked ? "none" : "flex", flex: 1, minWidth: 0 }}>
            {/* First Tab stop: moves focus past the sidebar and header to the active screen. */}
            <a
              href="#main-content"
              className="skip-link"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("main-content")?.focus();
              }}
            >
              Skip to content
            </a>
            {mobileNavOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
            <Sidebar mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />

            <div className="app-content" style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
              <Header onMenuClick={() => setMobileNavOpen(true)} />

              <main id="main-content" tabIndex={-1} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", outline: "none" }}>
                {readOnly && (
                  <div role="status" className="badge badge-warning" style={{ margin: "16px 32px 0", padding: "8px 12px", fontSize: "13px" }}>
                    View only: your role ({session.roleName}) cannot save changes on this screen.
                  </div>
                )}
                {currentView === "dashboard" && <DashboardView />}
                {currentView === "patients" && <PatientsView />}
                {currentView === "preor" && <PreOrView />}
                {currentView === "schedule" && <ScheduleView />}
                {currentView === "intraor" && <IntraOrView />}
                {currentView === "postor" && <PostOrView />}
                {currentView === "analytics" && <AnalyticsView />}
                {currentView === "settings" && <SettingsView />}
                {currentView === "appmap" && <AppMapView />}
              </main>
            </div>
          </div>

          {!locked && (
            <>
              {/* Both read patient records, so they follow the same permission as the patient screens. */}
              {can("patients.view") && <GlobalSearchModal />}
              {can("patients.view") && <AssistantPanel />}
              <HyperFramesGuideModal />
            </>
          )}
          {locked && <LockScreen />}
        </>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 10001,
            background:
              toast.type === "success"
                ? "var(--success)"
                : toast.type === "error"
                ? "var(--danger)"
                : toast.type === "warning"
                ? "var(--warning)"
                : "var(--primary)",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "12px",
            fontSize: "14px",
            fontWeight: 600,
            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.2)",
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
};

export default App;
