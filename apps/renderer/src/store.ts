import { create } from "zustand";
import {
  addApproval,
  applyNotification,
  approvalFromRequest,
  hydrateThread,
  removeApproval,
  type AccountView,
  type ApprovalView,
  type BootstrapPayload,
  type CodexStatusView,
  type EngineId,
  type EngineStatusView,
  type ModelOption,
  type ProjectView,
  type RateLimitView,
  type ThreadState,
  type ThreadSummary,
} from "@zcodex/contracts";
import type { ServerNotification, ServerRequest } from "@zcodex/codex-protocol";

const READ_THREADS_KEY = "zcodex.readThreads";

/**
 * Pick a Claude model id that exists in the current catalogue.
 *
 * Threads remember the alias they were started with, and the catalogue's alias set is not stable
 * (the CLI drops redundant aliases — a thread started with `default` finds no such row once the
 * `default`/`sonnet` duplicate is collapsed). Falling back to the default row keeps the composer
 * chip and the effort dial working for those threads instead of going blank.
 */
function claudeModelFor(models: ModelOption[], wanted: string | null): string | null {
  if (wanted && models.some((m) => m.id === wanted)) return wanted;
  return models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? wanted;
}

function loadReadThreads(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_THREADS_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function persistReadThreads(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_THREADS_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* storage full/disabled — unread dots are cosmetic */
  }
}

export type MainView = "home" | "thread";

interface State {
  booted: boolean;
  bootError: string | null;
  status: CodexStatusView;
  claudeStatus: CodexStatusView;
  engines: EngineStatusView[];
  account: AccountView | null;
  rateLimit: RateLimitView | null;
  models: ModelOption[];
  claudeModels: ModelOption[];
  selectedModel: string | null;
  selectedEngine: EngineId;
  /** Manual effort level for the next Claude chat (null = the CLI's own default). */
  selectedEffort: string | null;
  projects: ProjectView[];
  threads: ThreadSummary[];
  threadProjectHints: Record<string, string>;
  expandedProjects: Record<string, boolean>;
  searchTerm: string;
  searchResults: ThreadSummary[] | null;
  view: MainView;
  sidebarCollapsed: boolean;
  selectedProjectId: string | null;
  searchOpen: boolean;
  autoApprove: boolean;
  thread: ThreadState | null;
  openingThreadId: string | null;
  readThreads: Set<string>;
  composerDraft: string;
  notice: string | null;

  handleNotification: (notification: ServerNotification) => void;
  handleServerRequest: (request: ServerRequest) => void;
  handleStatus: (status: CodexStatusView) => void;
  handleClaudeStatus: (status: CodexStatusView) => void;
  setProjects: (projects: ProjectView[]) => void;
  bootstrap: () => Promise<void>;
  refreshThreads: (searchTerm?: string) => Promise<void>;
  addProject: () => Promise<ProjectView | null>;
  removeProject: (id: string) => Promise<void>;
  toggleProject: (id: string) => void;
  toggleSidebar: () => void;
  setSearch: (term: string) => void;
  goHome: () => void;
  newChat: (projectId: string | null) => Promise<void>;
  openThread: (threadId: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  answerApproval: (approval: ApprovalView, decision: string, answers?: Record<string, string[]>) => Promise<void>;
  setSelectedModel: (model: string) => void;
  setSelectedEngine: (engine: EngineId) => void;
  /** Set the effort level for the open Claude thread (applies live) or for the next chat. */
  applyEffort: (level: string) => Promise<void>;
  setSelectedProject: (projectId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setAutoApprove: (value: boolean) => void;
  setDraft: (text: string) => void;
  setNotice: (text: string | null) => void;
}

export const useStore = create<State>((set, get) => ({
  booted: false,
  bootError: null,
  status: { state: "starting" },
  claudeStatus: { state: "starting" },
  engines: [],
  account: null,
  rateLimit: null,
  models: [],
  claudeModels: [],
  selectedModel: null,
  selectedEngine: "codex",
  selectedEffort: null,
  projects: [],
  threads: [],
  threadProjectHints: {},
  expandedProjects: {},
  searchTerm: "",
  searchResults: null,
  view: "home",
  sidebarCollapsed: false,
  selectedProjectId: null,
  searchOpen: false,
  autoApprove: true,
  thread: null,
  openingThreadId: null,
  readThreads: loadReadThreads(),
  composerDraft: "",
  notice: null,

  handleNotification: (notification) => {
    const { thread } = get();
    if (thread) {
      const next = applyNotification(thread, notification);
      if (next !== thread) set({ thread: next });
    }
    // The sidebar needs a refresh when a thread's title or recency changes.
    if (
      notification.method === "thread/name/updated" ||
      notification.method === "turn/completed" ||
      notification.method === "thread/started"
    ) {
      void get().refreshThreads(get().searchTerm || undefined);
    }
  },

  handleServerRequest: (request) => {
    const approval = approvalFromRequest(request);
    const { thread } = get();
    if (!thread) return;
    set({ thread: addApproval(thread, approval) });
  },

  handleStatus: (status) => {
    set({ status });
    if (status.state === "error") set({ bootError: status.message ?? "Codex gagal dijalankan" });
  },

  handleClaudeStatus: (status) => {
    set({ claudeStatus: status });
    if (status.state === "error") {
      set((s) => ({ engines: s.engines.map((e) => (e.id === "claude" ? { ...e, available: false, detail: status.message } : e)) }));
    }
  },

  setProjects: (projects) => set({ projects }),

  bootstrap: async () => {
    try {
      const payload: BootstrapPayload = await window.zcodex.bootstrap();
      // First run: everything currently on disk is "already seen" so unread dots mean new activity.
      if (localStorage.getItem(READ_THREADS_KEY) === null) {
        persistReadThreads(new Set(payload.recentThreads.map((t) => t.id)));
      }
      set({
        booted: true,
        status: payload.status,
        claudeStatus: claudeStatusFromEngine(payload.engines),
        engines: payload.engines,
        account: payload.account,
        rateLimit: payload.rateLimit,
        models: payload.models,
        claudeModels: payload.claudeModels,
        projects: payload.projects,
        threads: payload.recentThreads,
        threadProjectHints: payload.threadProjectHints,
        bootError: payload.status.state === "error" ? payload.status.message ?? null : null,
        selectedProjectId: get().selectedProjectId ?? payload.projects[0]?.id ?? null,
        selectedModel:
          get().selectedModel ??
          payload.models.find((m) => m.isDefault && !m.hidden)?.id ??
          payload.models.find((m) => !m.hidden)?.id ??
          null,
        expandedProjects: Object.fromEntries(payload.projects.map((p, i) => [p.id, i < 3])),
      });
    } catch (err) {
      set({ booted: true, bootError: err instanceof Error ? err.message : String(err) });
    }
  },

  refreshThreads: async (searchTerm) => {
    try {
      const threads = await window.zcodex.listThreads({ limit: 100 });
      set({ threads, searchResults: null });
      if (searchTerm) {
        const results = await window.zcodex.listThreads({ limit: 50, searchTerm });
        set({ searchResults: results });
      }
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },

  addProject: async () => {
    const project = await window.zcodex.pickProject();
    if (!project) return null;
    await get().refreshThreads();
    return project;
  },

  removeProject: async (id) => {
    const projects = await window.zcodex.removeProject(id);
    set({ projects });
    await get().refreshThreads();
  },

  toggleProject: (id) => {
    set({ expandedProjects: { ...get().expandedProjects, [id]: !get().expandedProjects[id] } });
  },

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

  setSearch: (term) => set({ searchTerm: term }),

  goHome: () => set({ view: "home", thread: null, openingThreadId: null }),

  newChat: async (projectId) => {
    try {
      set({ notice: null });
      const { thread } = await window.zcodex.newThread({
        projectId,
        engine: get().selectedEngine,
        model: get().selectedModel,
        effort: get().selectedEffort,
        approvalPolicy: get().autoApprove ? "on-request" : "untrusted",
        sandbox: "workspace-write",
      });
      set({ view: "thread", thread: hydrateThread(thread), openingThreadId: null });
      await get().refreshThreads();
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },

  openThread: async (threadId) => {
    set({ openingThreadId: threadId, notice: null });
    try {
      const { thread, effort } = await window.zcodex.readThread(threadId);
      const readThreads = new Set(get().readThreads);
      readThreads.add(threadId);
      persistReadThreads(readThreads);
      const hydrated = hydrateThread(thread);
      if (effort) hydrated.effort = effort;
      set({
        view: "thread",
        thread: hydrated,
        openingThreadId: null,
        readThreads,
        selectedEngine: hydrated.engine,
        selectedEffort: effort ?? get().selectedEffort,
        selectedModel:
          hydrated.engine === "claude"
            ? claudeModelFor(get().claudeModels, hydrated.model ?? get().selectedModel)
            : get().selectedModel,
      });
    } catch (err) {
      set({ openingThreadId: null, notice: err instanceof Error ? err.message : String(err) });
    }
  },

  send: async (text) => {
    const { thread } = get();
    if (!thread) return;
    const optimistic: ThreadState = {
      ...thread,
      phase: "working",
      items: [
        ...thread.items,
        { kind: "user", id: `local-${Date.now()}`, text, images: [] },
      ],
    };
    set({ thread: optimistic, composerDraft: "" });
    try {
      await window.zcodex.startTurn({ threadId: thread.threadId, text, model: get().selectedModel });
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },

  interrupt: async () => {
    const { thread } = get();
    if (!thread?.activeTurnId) return;
    try {
      await window.zcodex.interruptTurn(thread.threadId, thread.activeTurnId);
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },

  answerApproval: async (approval, decision, answers) => {
    const { thread } = get();
    if (!thread) return;
    set({ thread: removeApproval(thread, approval.requestId) });
    try {
      await window.zcodex.respondApproval({ requestId: approval.requestId, decision, answers });
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },

  setSelectedModel: (model) => set({ selectedModel: model }),

  setSelectedEngine: (engine) => {
    const s = get();
    if (s.selectedEngine === engine) return;
    const list = engine === "claude" ? s.claudeModels : s.models;
    const nextModel =
      list.find((m) => m.id === (engine === "claude" ? s.selectedModel ?? list[0]?.id : s.selectedModel))?.id ??
      list.find((m) => m.isDefault && !m.hidden)?.id ??
      list[0]?.id ??
      null;
    set({ selectedEngine: engine, selectedModel: nextModel });
  },

  applyEffort: async (level) => {
    const { thread } = get();
    set({ selectedEffort: level });
    if (!thread || thread.engine !== "claude") return;
    set({ thread: { ...thread, effort: level } });
    try {
      await window.zcodex.setEffort(thread.threadId, level);
    } catch (err) {
      set({ notice: err instanceof Error ? err.message : String(err) });
    }
  },

  setSelectedProject: (projectId) => set({ selectedProjectId: projectId }),

  setSearchOpen: (open) => set({ searchOpen: open }),

  setAutoApprove: (value) => set({ autoApprove: value }),

  setDraft: (text) => set({ composerDraft: text }),

  setNotice: (text) => set({ notice: text }),
}));

/** Derive the Claude engine status view from the bootstrap engines list. */
function claudeStatusFromEngine(engines: EngineStatusView[]): CodexStatusView {
  const claude = engines.find((e) => e.id === "claude");
  if (!claude) return { state: "starting" };
  if (!claude.available) {
    return { state: "error", message: claude.detail ?? "Claude tidak tersedia", version: claude.version, binaryPath: undefined };
  }
  return { state: "ready", version: claude.version, binaryPath: undefined };
}
