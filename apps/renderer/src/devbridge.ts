/**
 * Dev-only bridge.
 *
 * When the renderer runs in a plain browser (`npm run dev` -> http://127.0.0.1:5173) there is no
 * preload, so `window.zcodex` is missing and the UI would render nothing. This installs a mock
 * bridge with a couple of fake projects/threads so the DESIGN can be iterated on without booting
 * Electron. It is stripped from production builds (`import.meta.env.DEV` is false there) and is
 * never used inside the packaged app.
 */
import type {
  ApprovalView,
  BootstrapPayload,
  CodexStatusView,
  ListThreadsRequest,
  RawThreadPayload,
  ZCodexApi,
} from "@zcodex/contracts";
import type { ServerNotification, Thread } from "@zcodex/codex-protocol";

const PROJECTS = [
  { id: "local-demo-catatuang", name: "CatatUang", roots: ["C:\\Users\\you\\StudioProjects\\CatatUang"], createdAt: 1 },
  { id: "local-demo-be", name: "BE CatatUang", roots: ["C:\\Users\\you\\Documents\\BE CatatUang"], createdAt: 2 },
  { id: "local-demo-alarm", name: "AlarmBro", roots: ["C:\\Users\\you\\StudioProjects\\AlarmBro"], createdAt: 3 },
];

interface DemoThread {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  updatedAt: number;
}

const THREADS: DemoThread[] = [
  { id: "t1", name: null, preview: "Jalankan di web Codex", cwd: PROJECTS[0].roots[0], projectId: PROJECTS[0].id, updatedAt: 1_789_000_400 },
  { id: "t2", name: null, preview: "Cari file di atas 100 baris", cwd: PROJECTS[0].roots[0], projectId: PROJECTS[0].id, updatedAt: 1_789_000_300 },
  { id: "t3", name: null, preview: "Pecah main.dart", cwd: PROJECTS[0].roots[0], projectId: PROJECTS[0].id, updatedAt: 1_789_000_200 },
  { id: "t4", name: null, preview: "Kunci orientasi portrait", cwd: PROJECTS[2].roots[0], projectId: PROJECTS[2].id, updatedAt: 1_789_000_100 },
  { id: "t5", name: null, preview: "Daily @cerita_gelas Shopee comic content", cwd: "C:\\Users\\you\\Documents\\codex\\2026-09-01", projectId: null, updatedAt: 1_789_000_050 },
  { id: "t6", name: null, preview: "Buat schedule task", cwd: "C:\\Users\\you\\Documents\\codex\\2026-08-30", projectId: null, updatedAt: 1_789_000_000 },
];

const DEMO_ITEMS = [
  { type: "userMessage", id: "u1", clientId: null, content: [{ type: "text", text: "Cari file di atas 100 baris terus ringkas isinya.", text_elements: [] }] },
  {
    type: "agentMessage",
    id: "a1",
    text: "Oke, saya scan dulu struktur project-nya.\n\nKetemu 3 file yang cukup besar:",
    phase: null,
    memoryCitation: null,
    delivery: null,
    questions: null,
  },
  {
    type: "reasoning",
    id: "r1",
    summary: ["Perlu batasi pencarian ke folder sumber saja supaya tidak kena build output."],
    content: [],
  },
  {
    type: "commandExecution",
    id: "c1",
    command: "rg --files -g '*.dart' | xargs wc -l | sort -rn | head",
    cwd: "C:\\Users\\you\\StudioProjects\\CatatUang",
    processId: "p1",
    source: "agent",
    status: "completed",
    commandActions: [],
    aggregatedOutput: "  412 lib/features/wallet/wallet_screen.dart\n  268 lib/features/home/home_content.dart\n  151 lib/core/format.dart\n",
    exitCode: 0,
    durationMs: 1284,
    pluginId: null,
    scriptPath: null,
  },
  {
    type: "fileChange",
    id: "f1",
    status: "completed",
    changes: [
      {
        path: "lib/features/wallet/wallet_screen.dart",
        kind: { type: "update", move_path: null },
        diff: "@@ -12,6 +12,8 @@ class WalletScreen extends StatelessWidget {\n-  final List<Wallet> wallets;\n+  final List<Wallet> wallets;\n+  final bool isLoading;\n",
      },
    ],
  },
];

function demoThread(): RawThreadPayload {
  const thread = {
    id: "t2",
    sessionId: "t2",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Cari file di atas 100 baris",
    ephemeral: false,
    modelProvider: "openai",
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    createdAt: 1_789_000_000,
    updatedAt: 1_789_000_300,
    status: { type: "idle" },
    cwd: PROJECTS[0].roots[0],
    cliVersion: "0.154.0",
    originator: "demo",
    source: "appServer",
    name: null,
    gitInfo: { sha: null, branch: "main", originUrl: null },
    turns: [
      {
        id: "turn1",
        items: DEMO_ITEMS,
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1_789_000_100,
        completedAt: 1_789_000_300,
        durationMs: 200_000,
      },
    ],
  } as unknown as Thread;
  return { thread };
}

const DEMO_APPROVAL: ServerNotification = {
  method: "turn/diff/updated",
  params: { threadId: "t2", turnId: "turn1", diff: "" },
} as unknown as ServerNotification;

export function installDevBridge(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  if ((window as unknown as { zcodex?: ZCodexApi }).zcodex) return false;

  const status: CodexStatusView = {
    state: "ready",
    version: "0.154.0",
    binaryPath: "C:\\...\\@openai\\codex-win32-x64\\vendor\\...\\bin\\codex.exe",
    binarySource: "npm:C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules",
    codexHome: "C:\\Users\\you\\.codex",
  };

  const bootstrap: BootstrapPayload = {
    status,
    account: { email: "demo@example.com", planType: "free", type: "chatgpt", requiresOpenaiAuth: false },
    rateLimit: { usedPercent: 42, windowDurationMins: 43_200, resetsAt: null, planType: "free", hasCredits: false },
    models: [
      { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", description: "", hidden: false, isDefault: true, reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" },
      { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", description: "", hidden: false, isDefault: false, reasoningEfforts: ["low", "medium"], defaultReasoningEffort: "low" },
    ],
    projects: PROJECTS,
    recentThreads: THREADS.map((t) => ({
      id: t.id,
      name: t.name,
      preview: t.preview,
      cwd: t.cwd,
      projectId: t.projectId,
      createdAt: t.updatedAt - 1000,
      updatedAt: t.updatedAt,
      model: "gpt-5.6-terra",
      source: "appServer",
      status: "idle" as const,
    })),
    threadProjectHints: {},
  };

  const api: ZCodexApi = {
    bootstrap: async () => bootstrap,
    pickProject: async () => null,
    addProject: async () => PROJECTS[0],
    removeProject: async () => PROJECTS,
    listThreads: async (request: ListThreadsRequest) =>
      bootstrap.recentThreads.filter((t) => (request.projectId === undefined ? true : t.projectId === request.projectId)),
    readThread: async () => demoThread(),
    newThread: async () => demoThread(),
    renameThread: async () => undefined,
    archiveThread: async () => undefined,
    startTurn: async () => {
      window.dispatchEvent(new CustomEvent("zcodex:demo-notification", { detail: DEMO_APPROVAL }));
    },
    interruptTurn: async () => undefined,
    respondApproval: async () => undefined,
    popupMenu: async () => undefined,
    openPath: async () => undefined,
    revealPath: async () => undefined,
    onNotification: () => () => undefined,
    onServerRequest: () => () => undefined,
    onStatus: () => () => undefined,
    onProjectsChanged: () => () => undefined,
    onCommand: () => () => undefined,
  };

  (window as unknown as { zcodex: ZCodexApi }).zcodex = api;
  return true;
}

export type { ApprovalView };
