import type { RequestId, ServerNotification, ServerRequest, Thread } from "@zcodex/codex-protocol";
import type { AppCommand, MenuId } from "./channels";

/* ------------------------------------------------------------------ projects */

export interface ProjectView {
  id: string;
  name: string;
  roots: string[];
  createdAt: number;
}

/* ------------------------------------------------------------------- threads */

export interface ThreadSummary {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  source: string;
  status: "notLoaded" | "idle" | "systemError" | "active";
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}

export interface AccountView {
  email: string | null;
  planType: string | null;
  type: string | null;
  requiresOpenaiAuth: boolean;
}

export interface RateLimitView {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
  planType: string | null;
  hasCredits: boolean;
}

export interface CodexStatusView {
  state: "starting" | "ready" | "stopped" | "error";
  message?: string;
  binaryPath?: string;
  binarySource?: string;
  version?: string | null;
  versionWarning?: string | null;
  codexHome?: string | null;
}

export interface BootstrapPayload {
  status: CodexStatusView;
  account: AccountView | null;
  rateLimit: RateLimitView | null;
  models: ModelOption[];
  projects: ProjectView[];
  recentThreads: ThreadSummary[];
  threadProjectHints: Record<string, string>;
}

/* -------------------------------------------------------------- thread views */

export type ThreadPhase = "loading" | "idle" | "working" | "awaiting-approval" | "error";

export interface ChangeView {
  path: string;
  kind: "add" | "delete" | "update";
  movePath: string | null;
  diff: string;
}

export type ItemView =
  | { kind: "user"; id: string; text: string; images: string[] }
  | { kind: "agent"; id: string; text: string; streaming: boolean }
  | { kind: "reasoning"; id: string; text: string; streaming: boolean }
  | { kind: "plan"; id: string; text: string; streaming: boolean }
  | {
      kind: "command";
      id: string;
      command: string;
      cwd: string;
      status: "inProgress" | "completed" | "failed" | "declined";
      output: string;
      exitCode: number | null;
      durationMs: number | null;
      streaming: boolean;
    }
  | {
      kind: "fileChange";
      id: string;
      status: "inProgress" | "completed" | "failed" | "declined";
      changes: ChangeView[];
    }
  | {
      kind: "mcp";
      id: string;
      server: string;
      tool: string;
      status: "inProgress" | "completed" | "failed";
      error: string | null;
      streaming: boolean;
    }
  | { kind: "tool"; id: string; label: string; detail: string; status: string; streaming: boolean }
  | { kind: "notice"; id: string; level: "info" | "warning" | "error"; text: string };

export interface PlanStepView {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

export interface ApprovalView {
  requestId: RequestId;
  /** Which RPC shape this came in as — decides how the answer is serialized. */
  method: ServerRequest["method"];
  kind: "command" | "fileChange" | "permissions" | "userInput" | "elicitation" | "other";
  title: string;
  detail: string;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  /** Free-form questions for `item/tool/requestUserInput`, keyed by question id. */
  questions: Array<{ id: string; header: string; question: string; options: Array<{ label: string; description: string }> }>;
  createdAt: number;
}

export interface TokenUsageView {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  modelContextWindow: number | null;
}

export interface ThreadState {
  threadId: string;
  title: string | null;
  cwd: string;
  phase: ThreadPhase;
  items: ItemView[];
  activeTurnId: string | null;
  plan: PlanStepView[];
  planExplanation: string | null;
  diff: string;
  approvals: ApprovalView[];
  usage: TokenUsageView | null;
  error: string | null;
  lastActivityAt: number;
}

/* ----------------------------------------------------------------------- IPC */

export interface ListThreadsRequest {
  projectId?: string | null;
  searchTerm?: string;
  limit?: number;
  archived?: boolean;
  /** Include threads whose cwd is outside every known project (the "Recents" bucket). */
  loose?: boolean;
}

export interface NewThreadRequest {
  projectId: string | null;
  cwd?: string;
  model?: string | null;
  approvalPolicy?: "untrusted" | "on-request" | "never";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}

export interface StartTurnRequest {
  threadId: string;
  text: string;
  model?: string | null;
}

export interface ApprovalResponseRequest {
  requestId: RequestId;
  /** `accept` | `acceptForSession` | `decline` | `cancel`, or answers for user-input requests. */
  decision: string;
  answers?: Record<string, string[]>;
}

export interface RawThreadPayload {
  thread: Thread;
}

/** The `window.zcodex` bridge exposed by the preload script. */
export interface ZCodexApi {
  bootstrap(): Promise<BootstrapPayload>;
  pickProject(): Promise<ProjectView | null>;
  addProject(path: string): Promise<ProjectView>;
  removeProject(id: string): Promise<ProjectView[]>;
  listThreads(request: ListThreadsRequest): Promise<ThreadSummary[]>;
  readThread(threadId: string): Promise<RawThreadPayload>;
  newThread(request: NewThreadRequest): Promise<RawThreadPayload>;
  renameThread(threadId: string, name: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  startTurn(request: StartTurnRequest): Promise<void>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  respondApproval(request: ApprovalResponseRequest): Promise<void>;
  popupMenu(menu: MenuId, x: number, y: number): Promise<void>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  onNotification(handler: (notification: ServerNotification) => void): () => void;
  onServerRequest(handler: (request: ServerRequest) => void): () => void;
  onStatus(handler: (status: CodexStatusView) => void): () => void;
  onProjectsChanged(handler: (projects: ProjectView[]) => void): () => void;
  onCommand(handler: (command: AppCommand) => void): () => void;
}
