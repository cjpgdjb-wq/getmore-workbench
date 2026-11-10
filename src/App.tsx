import AppHeader from "./components/AppHeader";
import { ToastProvider } from "./components/ui";
import DataView from "./features/data/DataView";
import PartnerView from "./features/partner/PartnerView";
import WorkspaceView from "./features/workspace/WorkspaceView";
import { WorkbenchProvider, useWorkbench } from "./state/workbench";

function Shell() {
  const { activeTab } = useWorkbench();
  return (
    <div className="app">
      <AppHeader />
      <div className="app-body">
        <div className="tab-panel" style={{ display: activeTab === "workspace" ? "flex" : "none" }}>
          <WorkspaceView />
        </div>
        <div className="tab-panel" style={{ display: activeTab === "partner" ? "flex" : "none" }}>
          <PartnerView />
        </div>
        <div className="tab-panel" style={{ display: activeTab === "data" ? "flex" : "none" }}>
          <DataView />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <WorkbenchProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </WorkbenchProvider>
  );
}
