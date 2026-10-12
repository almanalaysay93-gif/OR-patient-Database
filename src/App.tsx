import React from "react";
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
  const editPermissions = EDIT_PERMISSIONS[currentView];
  const readOnly = !!editPermissions && !editPermissions.some(can);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
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
          <div inert={locked} style={{ display: locked ? "none" : "flex", flex: 1, minWidth: 0 }}>
            <Sidebar />

            <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
              <Header />

              <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
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
