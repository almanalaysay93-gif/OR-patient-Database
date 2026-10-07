import React from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { SetupWizard } from "./components/setup/SetupWizard";
import { GlobalSearchModal } from "./components/common/GlobalSearchModal";
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

const MainLayout: React.FC = () => {
  const { currentView, setupComplete, toast } = useApp();

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <Header />

        <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
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

      {/* Setup Wizard Modal on First Run */}
      {!setupComplete && <SetupWizard />}

      {/* Global Modals */}
      <GlobalSearchModal />
      <HyperFramesGuideModal />

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
