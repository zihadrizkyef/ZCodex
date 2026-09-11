import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { installDevBridge } from "./devbridge";
import { useStore } from "./store";
import type { AppCommand } from "@zcodex/contracts";

function handleCommand(command: AppCommand): void {
  const store = useStore.getState();
  switch (command) {
    case "new-chat": {
      const projectId = store.selectedProjectId ?? store.projects[0]?.id ?? null;
      if (projectId) void store.newChat(projectId);
      else store.goHome();
      break;
    }
    case "open-project":
      void store.addProject();
      break;
    case "toggle-sidebar":
      store.toggleSidebar();
      break;
    case "focus-search":
      useStore.setState({ sidebarCollapsed: false, searchOpen: true });
      break;
    case "open-codex-home": {
      const home = store.status.codexHome;
      if (home) void window.zcodex.openPath(home);
      else store.setNotice("Folder ~/.codex belum diketahui (server belum jalan).");
      break;
    }
    case "settings":
      store.setNotice("Panel settings belum ada di versi ini — mau ditambah nanti?");
      break;
    case "about":
      store.setNotice("ZCodex — GUI untuk Codex CLI. Desain mengikuti Codex Desktop. Engine: codex app-server (JSON-RPC lewat stdio).");
      break;
    default:
      break;
  }
}

function wireBridge(): void {
  const store = () => useStore.getState();
  window.zcodex.onNotification((notification) => store().handleNotification(notification));
  window.zcodex.onServerRequest((request) => store().handleServerRequest(request));
  window.zcodex.onStatus((status) => store().handleStatus(status));
  window.zcodex.onClaudeStatus((status) => store().handleClaudeStatus(status));
  window.zcodex.onProjectsChanged((projects) => {
    store().setProjects(projects);
    void store().refreshThreads();
  });
  window.zcodex.onCommand(handleCommand);
}

installDevBridge();
wireBridge();
void useStore.getState().bootstrap();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
