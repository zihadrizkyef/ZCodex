import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { IPC, type AppCommand, type ProjectView } from "@zcodex/contracts";
import { CodexHost } from "./codex-host";
import { ClaudeHost } from "./claude-host";
import { ProjectStore } from "./projects";
import { installApplicationMenu } from "./menu";
import { registerIpc, rememberApproval } from "./ipc";

const DEV_URL = process.env.ZCODEX_DEV_URL;

let mainWindow: BrowserWindow | null = null;
const host = new CodexHost();
const claude = new ClaudeHost();
let store: ProjectStore | null = null;

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function sendCommand(command: AppCommand): void {
  broadcast(IPC.onCommand, command);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#20252d",
    title: "ZCodex",
    // Codex Desktop look: the app draws its own title bar (nav + menus), Windows draws the
    // minimise/maximise/close buttons over the same strip.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#20252d",
      symbolColor: "#c8d1e0",
      height: 35,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  installApplicationMenu(win, { send: sendCommand });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "..", "renderer", "dist", "index.html"));
  }
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.setAppUserModelId("com.zcodex.desktop");

void app.whenReady().then(async () => {
  store = new ProjectStore(app.getPath("userData"));

  registerIpc({
    host,
    claude,
    store,
    getWindow: () => mainWindow,
    broadcastProjects: (projects: ProjectView[]) => broadcast(IPC.onProjectsChanged, projects),
  });

  host.onNotification((notification) => broadcast(IPC.onNotification, notification));
  host.onServerRequest((request) => {
    rememberApproval(request, "codex");
    broadcast(IPC.onServerRequest, request);
  });
  host.onStatus((status) => broadcast(IPC.onStatus, status));

  // Claude engine: same frames, same channels — the renderer cannot tell the engines apart.
  claude.onNotification((notification) => broadcast(IPC.onNotification, notification));
  claude.onServerRequest((request) => {
    rememberApproval(request, "claude");
    broadcast(IPC.onServerRequest, request);
  });
  claude.onStatus((status) => broadcast(IPC.onClaudeStatus, status));

  mainWindow = createWindow();

  // Start the Codex app-server without blocking the first paint; the renderer subscribes to
  // status events and shows a banner until it is ready.
  void host.ensureStarted();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  host.dispose();
  claude.dispose();
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
    if (url.startsWith("http")) void shell.openExternal(url);
  });
});
