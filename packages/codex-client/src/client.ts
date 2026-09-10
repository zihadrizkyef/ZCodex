import { spawn, type ChildProcess } from "node:child_process";
import type {
  Account,
  AccountRateLimitsUpdatedNotification,
  GetAccountResponse,
  ListMcpServerStatusResponse,
  ModelListParams,
  ModelListResponse,
  ReviewStartParams,
  ReviewStartResponse,
  ServerNotification,
  ServerRequest,
  SkillsListResponse,
  ThreadArchiveParams,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadSetNameParams,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnarchiveParams,
  TurnInterruptParams,
  TurnStartParams,
  TurnStartResponse,
} from "@zcodex/codex-protocol";
import { JsonRpcConnection } from "./rpc";
import { getCodexVersion, resolveCodexBinary, MIN_SUPPORTED_CODEX_VERSION, compareVersions } from "./resolve";
export interface CodexClientOptions {
  /** Working directory handed to the app-server process itself (threads override this per thread). */
  cwd?: string;
  /** Explicit CLI binary; otherwise resolved from PATH / npm global / Codex Desktop bundle. */
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  /** Opt into experimental RPCs/fields (default true — this app needs them). */
  experimentalApi?: boolean;
}

export interface CodexClientInfo {
  binaryPath: string;
  binarySource: string;
  version: string | null;
  versionWarning: string | null;
  codexHome: string | null;
  userAgent: string | null;
  /** Other runnable Codex binaries on this machine (older ones are ignored). */
  alternatives: Array<{ path: string; source: string; version: string | null }>;
}

export interface CodexStatus {
  state: "starting" | "ready" | "stopped" | "error";
  message?: string;
}

/**
 * One Codex app-server process, spoken to over stdio.
 *
 * Lifecycle is owned by the caller (the Electron main process): `CodexClient.start()` spawns the
 * server, `dispose()` tears it down. Every conversation lives in a *thread* on that server.
 */
export class CodexClient {
  private readonly rpc: JsonRpcConnection;
  private readonly child: ChildProcess;
  private readonly notificationHandlers = new Set<(n: ServerNotification) => void>();
  public readonly info: CodexClientInfo;

  private constructor(child: ChildProcess, rpc: JsonRpcConnection, info: CodexClientInfo) {
    this.child = child;
    this.rpc = rpc;
    this.info = info;
    rpc.onNotification((n) => {
      for (const h of this.notificationHandlers) h(n);
    });
  }

  static async start(options: CodexClientOptions = {}): Promise<CodexClient> {
    const resolved = options.binaryPath
      ? {
          path: options.binaryPath,
          source: "explicit",
          version: getCodexVersion(options.binaryPath),
          alternatives: [] as CodexClientInfo["alternatives"],
        }
      : resolveCodexBinary();
    if (!resolved) {
      throw new Error(
        "Codex CLI tidak ditemukan. Install dulu: npm i -g @openai/codex@latest",
      );
    }
    const version = resolved.version;
    const versionWarning =
      version && compareVersions(version, MIN_SUPPORTED_CODEX_VERSION) < 0
        ? `Codex CLI ${version} lebih tua dari ${MIN_SUPPORTED_CODEX_VERSION} — model baru akan ditolak server. Update: npm i -g @openai/codex@latest`
        : null;

    const child = spawn(resolved.path, ["app-server", "--listen", "stdio://"], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.on("error", () => {
      /* surfaced through the exit handler + spawn throw */
    });

    const rpc = new JsonRpcConnection(child, options.requestTimeoutMs ?? 60_000);
    const clientName = options.clientName ?? "zcodex";
    const clientVersion = options.clientVersion ?? "0.1.0";

    const init = await rpc.request<{ codexHome?: string; userAgent?: string }>("initialize", {
      clientInfo: { name: clientName, title: "ZCodex", version: clientVersion },
      capabilities: {
        experimentalApi: options.experimentalApi !== false,
        requestAttestation: false,
      },
    });
    rpc.notify("initialized");

    return new CodexClient(child, rpc, {
      binaryPath: resolved.path,
      binarySource: resolved.source,
      version,
      versionWarning,
      codexHome: init?.codexHome ?? null,
      userAgent: init?.userAgent ?? null,
      alternatives: resolved.alternatives,
    });
  }

  // ---------------------------------------------------------------- plumbing

  onNotification(handler: (n: ServerNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: (r: ServerRequest) => void): () => void {
    return this.rpc.onServerRequest(handler);
  }

  onStderr(handler: (chunk: string) => void): () => void {
    return this.rpc.onStderr(handler);
  }

  onExit(handler: (code: number | null, signal: string | null) => void): () => void {
    return this.rpc.onExit(handler);
  }

  /** Escape hatch for RPCs this app has not wrapped yet. */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.rpc.request<T>(method, params);
  }

  answerServerRequest(id: ServerRequest["id"], result: unknown): void {
    this.rpc.respond(id, result);
  }

  rejectServerRequest(id: ServerRequest["id"], message: string, code = -32603): void {
    this.rpc.respondError(id, code, message);
  }

  dispose(): void {
    this.rpc.dispose();
    if (!this.child.killed) this.child.kill();
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  // ------------------------------------------------------------------- RPCs

  getAccount(refreshToken = false): Promise<GetAccountResponse> {
    return this.rpc.request<GetAccountResponse>("account/read", { refreshToken });
  }

  readRateLimits(): Promise<AccountRateLimitsUpdatedNotification> {
    return this.rpc.request<AccountRateLimitsUpdatedNotification>("account/rateLimits/read", undefined);
  }

  listModels(params: ModelListParams = {}): Promise<ModelListResponse> {
    return this.rpc.request<ModelListResponse>("model/list", params);
  }

  listThreads(params: ThreadListParams = {}): Promise<ThreadListResponse> {
    return this.rpc.request<ThreadListResponse>("thread/list", params);
  }

  readThread(threadId: string, includeTurns = true): Promise<ThreadReadResponse> {
    return this.rpc.request<ThreadReadResponse>("thread/read", { threadId, includeTurns });
  }

  startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.rpc.request<ThreadStartResponse>("thread/start", params);
  }

  resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.rpc.request<ThreadResumeResponse>("thread/resume", params);
  }

  forkThread(params: ThreadForkParams): Promise<ThreadForkResponse> {
    return this.rpc.request<ThreadForkResponse>("thread/fork", params);
  }

  setThreadName(params: ThreadSetNameParams): Promise<unknown> {
    return this.rpc.request("thread/name/set", params);
  }

  archiveThread(params: ThreadArchiveParams): Promise<unknown> {
    return this.rpc.request("thread/archive", params);
  }

  unarchiveThread(params: ThreadUnarchiveParams): Promise<unknown> {
    return this.rpc.request("thread/unarchive", params);
  }

  startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.rpc.request<TurnStartResponse>("turn/start", params);
  }

  interruptTurn(params: TurnInterruptParams): Promise<unknown> {
    return this.rpc.request("turn/interrupt", params);
  }

  startReview(params: ReviewStartParams): Promise<ReviewStartResponse> {
    return this.rpc.request<ReviewStartResponse>("review/start", params);
  }

  listSkills(): Promise<SkillsListResponse> {
    return this.rpc.request<SkillsListResponse>("skills/list", {});
  }

  listMcpServers(): Promise<ListMcpServerStatusResponse> {
    return this.rpc.request<ListMcpServerStatusResponse>("mcpServerStatus/list", {});
  }
}

export type { Account };
