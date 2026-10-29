import { useEffect } from "react";
import { useStore, type ViewKey } from "./engine/store";
import { TopBar, TabBar, Sidebar, StatusBar } from "./components/Shell";
import { TerminalPage } from "./pages/TerminalPage";
import { Inspector } from "./pages/Inspector";
import { ProtocolPage } from "./pages/ProtocolPage";
import { RoundTripModal } from "./pages/RoundTripModal";
import { CasePage } from "./pages/CasePage";
import { QuickStart } from "./components/QuickStart";
import { ReportPage } from "./pages/MiscPages";
import { DialogHost } from "./components/Dialog";
import { AiDraftPanel } from "./pages/AiDraftPanel";
import { SelfTestPanel } from "./pages/SelfTestPanel";

const VIEWS: ViewKey[] = ["terminal", "protocol", "case", "report"];

export default function App() {
  const activeView = useStore((s) => s.activeView);
  const setView = useStore((s) => s.setView);
  const activeProtocolId = useStore((s) => s.activeProtocolId);

  useEffect(() => {
    const onHash = () => {
      const k = window.location.hash.replace("#", "") as ViewKey;
      if (VIEWS.includes(k)) setView(k);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [setView]);

  useEffect(() => {
    if (window.location.hash.replace("#", "") !== activeView) {
      window.history.replaceState(null, "", `#${activeView}`);
    }
  }, [activeView]);

  return (
    <div className="app">
      <TopBar />
      <TabBar />
      <QuickStart />
      <div className="main">
        <Sidebar />
        {activeView === "terminal" && (
          <>
            <TerminalPage />
            <Inspector />
          </>
        )}
        {activeView === "protocol" && <ProtocolPage key={activeProtocolId} />}
        {activeView === "case" && <CasePage />}
        {activeView === "report" && <ReportPage />}
      </div>
      <StatusBar />
      <RoundTripModal />
      <DialogHost />
      <AiDraftPanel />
      <SelfTestPanel />
    </div>
  );
}
