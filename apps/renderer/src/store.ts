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
  type ModelOption,
  type ProjectView,
  type RateLimitView,
  type ThreadState,
  type ThreadSummary,
} from "@zcodex/contracts";
import type { ServerNotification, ServerRequest } from "@zcodex/codex-protocol";

const READ_THREADS_KEY = "zcodex.readThreads";

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
  account: AccountView | null;
  rateLimit: RateLimitView | null;
  models: ModelOption[];
  selectedModel: string | null;
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
  account: null,
  rateLimit: null,
  models: [],
  selectedModel: null,
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
        account: payload.account,
        rateLimit: payload.rateLimit,
        models: payload.models,
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
        model: get().selectedModel,
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
      const { thread } = await window.zcodex.readThread(threadId);
      const readThreads = new Set(get().readThreads);
      readThreads.add(threadId);
      persistReadThreads(readThreads);
      set({ view: "thread", thread: hydrateThread(thread), openingThreadId: null, readThreads });
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

  setSelectedProject: (projectId) => set({ selectedProjectId: projectId }),

  setSearchOpen: (open) => set({ searchOpen: open }),

  setAutoApprove: (value) => set({ autoApprove: value }),

  setDraft: (text) => set({ composerDraft: text }),

  setNotice: (text) => set({ notice: text }),
}));
