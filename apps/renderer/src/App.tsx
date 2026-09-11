import { AlertTriangle, Plus } from "lucide-react";
import { useStore } from "./store";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./components/HomeView";
import { ThreadView } from "./components/ThreadView";

function ContentHeader(): React.ReactElement {
  const account = useStore((s) => s.account);
  const status = useStore((s) => s.status);
  const setNotice = useStore((s) => s.setNotice);

  const showUpsell = account?.planType === "free" || account?.planType === null || account?.planType === undefined;

  return (
    <div className="content-header">
      {showUpsell ? (
        <button
          type="button"
          className="plan-pill"
          onClick={() => setNotice("Limit / upgrade plan diatur di akun ChatGPT-mu, bukan di ZCodex.")}
        >
          <Plus size={13} />
          Rejoin Plus
        </button>
      ) : (
        <span className="plan-pill" style={{ cursor: "default" }}>
          {account?.planType} plan
        </span>
      )}
      <span className="status-chip">
        <span className={`status-dot ${status.state}`} />
        {status.state === "ready"
          ? `codex ${status.version ?? "?"}`
          : status.state === "starting"
            ? "menyalakan codex…"
            : status.state === "error"
              ? "codex error"
              : "codex berhenti"}
      </span>
    </div>
  );
}

function Banners(): React.ReactElement | null {
  const status = useStore((s) => s.status);
  const claudeStatus = useStore((s) => s.claudeStatus);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);

  const showError = status.state === "error" || status.state === "stopped";
  const showClaudeError = claudeStatus.state === "error" || claudeStatus.state === "stopped";
  if (!showError && !status.versionWarning && !showClaudeError && !notice) return null;

  return (
    <>
      {showError ? (
        <div className="banner">
          <AlertTriangle size={14} />
          <div>
            {status.message ?? "Codex app-server tidak jalan."}
            <div style={{ opacity: 0.85, marginTop: 2 }}>
              Pastikan CLI terpasang & terbaru: <code>npm i -g @openai/codex@latest</code>
            </div>
          </div>
        </div>
      ) : null}
      {status.versionWarning ? (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <div>
            {status.versionWarning}
            {status.binaryPath ? <div style={{ opacity: 0.8, marginTop: 2 }}>{status.binaryPath}</div> : null}
          </div>
        </div>
      ) : null}
      {showClaudeError ? (
        <div className="banner warn">
          <AlertTriangle size={14} />
          <div>
            {claudeStatus.message ?? "Claude tidak tersedia."}
            <div style={{ opacity: 0.85, marginTop: 2 }}>
              Pastikan CLI terpasang & sudah login: <code>claude</code> lalu <code>/login</code>
            </div>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div className="banner">
          <AlertTriangle size={14} />
          <div style={{ flex: 1 }}>{notice}</div>
          <div className="actions">
            <button type="button" className="action" onClick={() => setNotice(null)}>
              Tutup
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function App(): React.ReactElement {
  const view = useStore((s) => s.view);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);

  return (
    <div className="app">
      <TitleBar />
      <div className={`body${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <Sidebar />
        <main className="content">
          <ContentHeader />
          <Banners />
          {view === "home" ? <HomeView /> : <ThreadView />}
        </main>
      </div>
    </div>
  );
}
