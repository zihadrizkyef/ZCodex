import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import {
  IPC,
  projectIdForCwd,
  threadToSummary,
  type AccountView,
  type ApprovalResponseRequest,
  type BootstrapPayload,
  type EngineId,
  type ListThreadsRequest,
  type ModelOption,
  type NewThreadRequest,
  type ProjectView,
  type RateLimitView,
  type StartTurnRequest,
  type ThreadSummary,
} from "@zcodex/contracts";
import type {
  Account,
  Model,
  RateLimitSnapshot,
  ServerRequest,
  Thread,
} from "@zcodex/codex-protocol";
import type { CodexHost } from "./codex-host";
import type { ClaudeHost } from "./claude-host";
import {
  claudeSessionMeta,
  claudeSessionSummary,
  hydrateClaudeThread,
  isClaudeThreadId,
  listClaudeSessions,
} from "./claude-sessions";
import type { ProjectStore } from "./projects";
import { popupMenu } from "./menu";
import type { MenuId } from "@zcodex/contracts";

/**
 * Model aliases accepted by `claude --model` when the CLI catalogue cannot be read (fallback only;
 * the real list — with names like "Sonnet 5" and per-model effort levels — comes from the CLI's
 * `initialize` handshake, see ClaudeHost.modelOptions()).
 */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: "sonnet", name: "Claude Sonnet", description: "Seimbang, default", hidden: false, isDefault: true, reasoningEfforts: [], defaultReasoningEffort: null },
  { id: "opus", name: "Claude Opus", description: "Paling kuat", hidden: false, isDefault: false, reasoningEfforts: [], defaultReasoningEffort: null },
  { id: "haiku", name: "Claude Haiku", description: "Cepat & murah", hidden: false, isDefault: false, reasoningEfforts: [], defaultReasoningEffort: null },
];

export interface IpcContext {
  host: CodexHost;
  claude: ClaudeHost;
  store: ProjectStore;
  getWindow: () => BrowserWindow | null;
  broadcastProjects: (projects: ProjectView[]) => void;
}

/** Server-initiated requests waiting for a user decision, keyed by request id. */
const pendingApprovals = new Map<string, { request: ServerRequest; engine: EngineId }>();

export function rememberApproval(request: ServerRequest, engine: EngineId = "codex"): void {
  pendingApprovals.set(String(request.id), { request, engine });
}

function accountView(account: Account | null): AccountView | null {
  if (!account) return null;
  if (account.type === "chatgpt") {
    return { type: account.type, email: account.email ?? null, planType: account.planType ?? null, requiresOpenaiAuth: false };
  }
  return { type: account.type, email: null, planType: null, requiresOpenaiAuth: false };
}

function rateLimitView(snapshot: RateLimitSnapshot | null | undefined): RateLimitView | null {
  if (!snapshot?.primary) return null;
  return {
    usedPercent: snapshot.primary.usedPercent ?? 0,
    windowDurationMins: snapshot.primary.windowDurationMins ?? null,
    resetsAt: snapshot.primary.resetsAt ?? null,
    planType: snapshot.planType ?? null,
    hasCredits: snapshot.credits?.hasCredits ?? false,
  };
}

function modelOption(model: Model): ModelOption {
  return {
    id: model.model ?? model.id,
    name: model.displayName ?? model.model ?? model.id,
    description: model.description ?? "",
    hidden: Boolean(model.hidden),
    isDefault: Boolean(model.isDefault),
    reasoningEfforts: (model.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
    defaultReasoningEffort: model.defaultReasoningEffort ?? null,
  };
}

/** Translate a UI decision into the exact result shape the originating RPC expects. */
function approvalResult(request: ServerRequest, decision: string, answers?: Record<string, string[]>): unknown {
  const legacy = (d: string): string =>
    d === "accept" ? "approved" : d === "acceptForSession" ? "approved_for_session" : d === "cancel" ? "abort" : "denied";
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: legacy(decision) };
    case "item/tool/requestUserInput": {
      const map: Record<string, { answers: string[] }> = {};
      for (const [key, value] of Object.entries(answers ?? {})) map[key] = { answers: value };
      return { answers: map };
    }
    case "mcpServer/elicitation/request":
      return { action: decision === "accept" ? "accept" : decision === "cancel" ? "cancel" : "decline", content: null, _meta: null };
    case "item/permissions/requestApproval": {
      if (decision === "accept") {
        const params = request.params as { requestedProfile?: unknown };
        return { permissions: params.requestedProfile ?? {}, scope: "turn" };
      }
      return { permissions: {}, scope: "turn" };
    }
    default:
      return { decision: legacy(decision) };
  }
}

/** Minimal codex-shaped Thread describing a fresh Claude session, for `newThread`/`startTurn`. */
function claudeThreadPayload(threadId: string, cwd: string, sessionId: string | null, effort: string | null): { thread: Thread; effort: string | null } {
  const now = Math.floor(Date.now() / 1000);
  return {
    effort,
    thread: {
      id: threadId,
      sessionId: sessionId ?? threadId,
      forkedFromId: null,
      parentThreadId: null,
      preview: "",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      historyMode: "paginated",
      modelProvider: "anthropic",
      model: null,
      reasoningEffort: null,
      createdAt: now,
      updatedAt: now,
      recencyAt: now,
      status: { type: "idle" },
      path: null,
      cwd,
      cliVersion: "",
      originator: null,
      source: { custom: "claude" },
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    },
  };
}

function engineOfThreadId(threadId: string, ctx: IpcContext): EngineId {
  if (isClaudeThreadId(threadId) || ctx.claude.owns(threadId)) return "claude";
  return "codex";
}

export function registerIpc(ctx: IpcContext): void {
  const { host, claude, store } = ctx;

  ipcMain.handle(IPC.bootstrap, async (): Promise<BootstrapPayload> => {
    await host.ensureStarted();
    const projects = store.list();
    const hints = store.hints();
    let account: AccountView | null = null;
    let rateLimit: RateLimitView | null = null;
    let models: ModelOption[] = [];
    if (host.isReady) {
      const client = host.require();
      try {
        const [accountRes, limits] = await Promise.all([client.getAccount(), client.readRateLimits().catch(() => null)]);
        account = accountView(accountRes.account);
        rateLimit = rateLimitView((limits as { rateLimits?: RateLimitSnapshot } | null)?.rateLimits);
      } catch {
        /* account info is best-effort */
      }
      try {
        const modelList = await client.listModels({ limit: 50 });
        models = (modelList.data ?? []).map(modelOption);
      } catch {
        /* model list is best-effort; the composer falls back to the CLI default */
      }
    }
    await claude.probe();
    const recentThreads = await listThreads({ limit: 40 });
    const claudeModels = claude.isReady ? claude.modelOptions() : CLAUDE_MODELS;
    return {
      status: host.current,
      account,
      rateLimit,
      models,
      claudeModels,
      engines: [
        { id: "codex", label: "Codex", available: host.isReady, version: host.info?.version ?? null },
        {
          id: "claude",
          label: "Claude",
          available: claude.isReady,
          version: claude.info?.version ?? null,
          ...(claude.current.state === "error" ? { detail: claude.current.message } : {}),
        },
      ],
      projects,
      recentThreads,
      threadProjectHints: hints,
    };
  });

  ipcMain.handle(IPC.pickProject, async (): Promise<ProjectView | null> => {
    const win = ctx.getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Pilih folder project",
      properties: ["openDirectory"],
      buttonLabel: "Tambah project",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const project = store.add(result.filePaths[0]);
    ctx.broadcastProjects(store.list());
    return project;
  });

  ipcMain.handle(IPC.addProject, (_event, root: string): ProjectView => {
    const project = store.add(root);
    ctx.broadcastProjects(store.list());
    return project;
  });

  ipcMain.handle(IPC.removeProject, (_event, id: string): ProjectView[] => {
    const projects = store.remove(id);
    ctx.broadcastProjects(projects);
    return projects;
  });

  async function listThreads(request: ListThreadsRequest = {}): Promise<ThreadSummary[]> {
    const projects = store.list();
    const hints = store.hints();

    // --- codex (server-owned threads)
    let summaries: ThreadSummary[] = [];
    if (host.isReady) {
      const client = host.require();
      const params: Parameters<typeof client.listThreads>[0] = {
        limit: request.limit ?? 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: request.archived ?? false,
      };
      if (request.searchTerm) params.searchTerm = request.searchTerm;
      try {
        const threads: Thread[] = (await client.listThreads(params)).data ?? [];
        summaries = threads.map((t) => {
          const projectId = projectIdForCwd(t.cwd ?? "", projects, hints) ?? t.projectId ?? null;
          return threadToSummary(t, projectId);
        });
      } catch {
        /* codex down — sidebar still shows Claude */
      }
    }

    // --- claude (sessions from ~/.claude/projects)
    const claudeSessions = listClaudeSessions(500).map((meta) => {
      const summary = claudeSessionSummary(meta);
      return { ...summary, projectId: projectIdForCwd(meta.cwd, projects, hints) };
    });

    const merged = [...summaries, ...claudeSessions].sort((a, b) => b.updatedAt - a.updatedAt);
    let filtered = merged;
    if (request.searchTerm) {
      const q = request.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name?.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
      );
    }
    if (request.projectId !== undefined) {
      if (request.projectId === null) return filtered.filter((s) => s.projectId === null);
      return filtered.filter((s) => s.projectId === request.projectId);
    }
    return filtered.slice(0, request.limit ?? 100);
  }

  ipcMain.handle(IPC.listThreads, (_event, request: ListThreadsRequest) => listThreads(request));

  ipcMain.handle(IPC.readThread, async (_event, threadId: string) => {
    const claudeThread = hydrateClaudeThread(threadId);
    if (claudeThread) return { thread: claudeThread, effort: claude.effortOf(threadId) };
    const client = host.require();
    const res = await client.readThread(threadId, true);
    return { thread: res.thread };
  });

  ipcMain.handle(IPC.newThread, async (_event, request: NewThreadRequest) => {
    const project = request.projectId ? store.get(request.projectId) : undefined;
    const cwd = request.cwd ?? project?.roots[0];
    if (!cwd) throw new Error("Pilih project dulu sebelum membuat chat baru");
    if (request.engine === "claude") {
      const mode = request.approvalPolicy === "untrusted" ? "default" : "auto";
      const res = await claude.startThread({
        cwd,
        model: request.model ?? null,
        effort: request.effort ?? null,
        permissionMode: mode,
      });
      if (project) store.rememberThread(res.id, project.id);
      return claudeThreadPayload(res.id, cwd, res.sessionId, claude.effortOf(res.id));
    }
    const res = await host.require().startThread({
      cwd,
      model: request.model ?? null,
      approvalPolicy: request.approvalPolicy ?? "on-request",
      sandbox: request.sandbox ?? "workspace-write",
    });
    if (project) store.rememberThread(res.thread.id, project.id);
    return { thread: res.thread };
  });

  ipcMain.handle(IPC.renameThread, async (_event, threadId: string, name: string) => {
    if (engineOfThreadId(threadId, ctx) === "claude") return; // nama sesi Claude diatur sendiri oleh CLI
    await host.require().setThreadName({ threadId, name });
  });

  ipcMain.handle(IPC.archiveThread, async (_event, threadId: string) => {
    if (engineOfThreadId(threadId, ctx) === "claude") return; // arsip sesi Claude belum didukung
    await host.require().archiveThread({ threadId });
  });

  ipcMain.handle(IPC.startTurn, async (_event, request: StartTurnRequest) => {
    const engine = engineOfThreadId(request.threadId, ctx);
    if (engine === "claude") {
      const meta = claudeSessionMeta(request.threadId);
      await claude.resumeThread(request.threadId, {
        cwd: meta?.cwd ?? homedir(),
        model: meta?.model ?? null,
        permissionMode: "default",
      });
      claude.send(request.threadId, request.text);
      return;
    }
    const client = host.require();
    await client.startTurn({
      threadId: request.threadId,
      model: request.model ?? null,
      input: [{ type: "text", text: request.text, text_elements: [] }],
    });
  });

  ipcMain.handle(IPC.setEffort, async (_event, threadId: string, level: string) => {
    if (engineOfThreadId(threadId, ctx) !== "claude") return; // codex effort is part of the model choice
    claude.setEffort(threadId, level);
  });

  ipcMain.handle(IPC.interruptTurn, async (_event, threadId: string, turnId: string) => {
    if (engineOfThreadId(threadId, ctx) === "claude") {
      await claude.interrupt(threadId);
      return;
    }
    await host.require().interruptTurn({ threadId, turnId });
  });

  ipcMain.handle(IPC.respondApproval, async (_event, response: ApprovalResponseRequest) => {
    const pending = pendingApprovals.get(String(response.requestId));
    // Nothing pending (already resolved, or the server restarted) — answering would be a no-op.
    if (!pending) return;
    pendingApprovals.delete(String(response.requestId));
    if (pending.engine === "claude") {
      const threadId = (pending.request.params as { threadId?: string }).threadId ?? "";
      claude.respondApproval(threadId, String(response.requestId), response.decision);
      return;
    }
    const client = host.require();
    client.answerServerRequest(pending.request.id, approvalResult(pending.request, response.decision, response.answers));
  });

  ipcMain.handle(IPC.popupMenu, (_event, menu: MenuId, x: number, y: number) => {
    popupMenu(menu, x, y);
  });

  ipcMain.handle(IPC.openPath, async (_event, target: string) => {
    await shell.openPath(target);
  });

  ipcMain.handle(IPC.revealPath, (_event, target: string) => {
    shell.showItemInFolder(target);
  });
}