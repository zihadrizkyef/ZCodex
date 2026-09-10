import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  IPC,
  projectIdForCwd,
  threadToSummary,
  type AccountView,
  type ApprovalResponseRequest,
  type BootstrapPayload,
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
import type { ProjectStore } from "./projects";
import { popupMenu } from "./menu";
import type { MenuId } from "@zcodex/contracts";

export interface IpcContext {
  host: CodexHost;
  store: ProjectStore;
  getWindow: () => BrowserWindow | null;
  broadcastProjects: (projects: ProjectView[]) => void;
}

/** Server-initiated requests waiting for a user decision, keyed by request id. */
const pendingApprovals = new Map<string, ServerRequest>();

export function rememberApproval(request: ServerRequest): void {
  pendingApprovals.set(String(request.id), request);
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

export function registerIpc(ctx: IpcContext): void {
  const { host, store } = ctx;

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
    const recentThreads = await listThreads({ limit: 40 });
    return { status: host.current, account, rateLimit, models, projects, recentThreads, threadProjectHints: hints };
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
    if (!host.isReady) return [];
    const client = host.require();
    const params: Parameters<typeof client.listThreads>[0] = {
      limit: request.limit ?? 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: request.archived ?? false,
    };
    if (request.searchTerm) params.searchTerm = request.searchTerm;
    let threads: Thread[] = [];
    try {
      threads = (await client.listThreads(params)).data ?? [];
    } catch {
      return [];
    }
    const projects = store.list();
    const hints = store.hints();
    const summaries = threads.map((t) => {
      const projectId = projectIdForCwd(t.cwd ?? "", projects, hints) ?? t.projectId ?? null;
      return threadToSummary(t, projectId);
    });
    if (request.projectId !== undefined) {
      if (request.projectId === null) {
        // "Recents": everything that does not belong to a known project.
        return summaries.filter((s) => s.projectId === null);
      }
      return summaries.filter((s) => s.projectId === request.projectId);
    }
    return summaries;
  }

  ipcMain.handle(IPC.listThreads, (_event, request: ListThreadsRequest) => listThreads(request));

  ipcMain.handle(IPC.readThread, async (_event, threadId: string) => {
    const client = host.require();
    const res = await client.readThread(threadId, true);
    return { thread: res.thread };
  });

  ipcMain.handle(IPC.newThread, async (_event, request: NewThreadRequest) => {
    const client = host.require();
    const project = request.projectId ? store.get(request.projectId) : undefined;
    const cwd = request.cwd ?? project?.roots[0];
    if (!cwd) throw new Error("Pilih project dulu sebelum membuat chat baru");
    const res = await client.startThread({
      cwd,
      model: request.model ?? null,
      approvalPolicy: request.approvalPolicy ?? "on-request",
      sandbox: request.sandbox ?? "workspace-write",
    });
    if (project) store.rememberThread(res.thread.id, project.id);
    return { thread: res.thread };
  });

  ipcMain.handle(IPC.renameThread, async (_event, threadId: string, name: string) => {
    await host.require().setThreadName({ threadId, name });
  });

  ipcMain.handle(IPC.archiveThread, async (_event, threadId: string) => {
    await host.require().archiveThread({ threadId });
  });

  ipcMain.handle(IPC.startTurn, async (_event, request: StartTurnRequest) => {
    const client = host.require();
    await client.startTurn({
      threadId: request.threadId,
      model: request.model ?? null,
      input: [{ type: "text", text: request.text, text_elements: [] }],
    });
  });

  ipcMain.handle(IPC.interruptTurn, async (_event, threadId: string, turnId: string) => {
    await host.require().interruptTurn({ threadId, turnId });
  });

  ipcMain.handle(IPC.respondApproval, async (_event, response: ApprovalResponseRequest) => {
    const pending = pendingApprovals.get(String(response.requestId));
    const client = host.require();
    // Nothing pending (already resolved, or the server restarted) — answering would be a no-op.
    if (!pending) return;
    pendingApprovals.delete(String(response.requestId));
    client.answerServerRequest(pending.id, approvalResult(pending, response.decision, response.answers));
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
