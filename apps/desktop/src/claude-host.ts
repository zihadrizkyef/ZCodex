import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import crypto from "node:crypto";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerNotification, ServerRequest, ThreadItem, Turn, TurnError } from "@zcodex/codex-protocol";
import type { CodexStatusView } from "@zcodex/contracts";
import { isClaudeThreadId } from "./claude-sessions";

const WIN = process.platform === "win32";

/* ---------------------------------------------------------------- binary */

export interface ClaudeBinaryInfo {
  path: string;
  source: string;
  version: string | null;
}

function probeVersion(binaryPath: string): string | null {
  try {
    const res = spawnSync(binaryPath, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    const m = String(res.stdout || res.stderr || "").match(/(\d+\.\d+\.\d+[\w.-]*)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Find the Claude Code CLI to spawn. Node cannot exec the extensionless npm shims, so we look for
 * real `claude.exe` inside the npm package and the standalone install, newest working one first
 * (same discipline as Codex: a machine can hold an old copy next to a new one).
 */
export function resolveClaudeBinary(): ClaudeBinaryInfo | null {
  const exe = WIN ? "claude.exe" : "claude";
  const candidates: Array<{ path: string; source: string }> = [];
  const push = (p: string, source: string) => {
    try {
      if (p && existsSync(p) && statSync(p).isFile() && !candidates.some((c) => c.path === p)) {
        candidates.push({ path: p, source });
      }
    } catch {
      /* unreadable */
    }
  };

  if (process.env.CLAUDE_BIN) push(process.env.CLAUDE_BIN, "CLAUDE_BIN env");
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    if (entry) push(path.join(entry, exe), `PATH:${entry}`);
  }
  for (const npmRoot of [
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin"),
    path.join(process.env.LOCALAPPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin"),
  ]) {
    push(path.join(npmRoot, exe), `npm:${npmRoot}`);
  }
  push(path.join(os.homedir(), ".local", "bin", exe), "~/.local/bin");

  const probed = candidates.map((c) => ({ ...c, version: probeVersion(c.path) }));
  const runnable = probed.filter((c) => c.version);
  const pool = runnable.length > 0 ? runnable : probed;
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => compareVersions(b.version ?? "0", a.version ?? "0"));
  return { path: sorted[0].path, source: sorted[0].source, version: sorted[0].version };
}

/* ------------------------------------------------------------------ host */

export type ClaudePermissionMode = "default" | "auto" | "plan" | "acceptEdits";

/** One entry of the CLI's own model catalogue (returned by the `initialize` handshake). */
export interface ClaudeModelInfo {
  /** Alias accepted by `--model` (e.g. "sonnet", "opus", "haiku", "default"). */
  value: string;
  /** Display name the CLI uses (e.g. "Sonnet"), version lives in `description`. */
  displayName: string;
  /** Marketing line, e.g. "Sonnet 5 · Efficient for routine tasks". */
  description: string;
  /** Concrete model id resolved for this alias, e.g. "claude-sonnet-5". */
  resolvedModel: string | null;
  supportsEffort: boolean;
  effortLevels: string[];
}

export interface ClaudeCatalogue {
  models: ClaudeModelInfo[];
  /** Settings the CLI reports as applied for a fresh session (model + effort). */
  applied: { model: string | null; effort: string | null };
}

/** Fallback when the catalogue cannot be read (CLI missing / handshake failed). */
const FALLBACK_CATALOGUE: ClaudeCatalogue = {
  models: [
    { value: "default", displayName: "Default", description: "Best for everyday tasks", resolvedModel: null, supportsEffort: true, effortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "sonnet", displayName: "Sonnet", description: "Efficient for routine tasks", resolvedModel: null, supportsEffort: true, effortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "opus", displayName: "Opus", description: "Most capable for complex work", resolvedModel: null, supportsEffort: true, effortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "haiku", displayName: "Haiku", description: "Fastest for quick answers", resolvedModel: null, supportsEffort: false, effortLevels: [] },
  ],
  applied: { model: null, effort: null },
};

/**
 * Derive the composer label for one CLI catalogue entry.
 *
 * The CLI's `displayName` is the bare family ("Sonnet", "Fable"), while `description` opens with
 * the marketed name including the version ("Sonnet 5 · Efficient for routine tasks"), so prefer
 * that head — but only when it really is a name, so a description that happens to open with prose
 * keeps the CLI's own display name.
 *
 * The check is deliberately family-agnostic. A whitelist of families (sonnet|opus|haiku) silently
 * dropped the version of every family the CLI added later (first seen with Fable 5), which is
 * exactly the "nama model tanpa versi" bug.
 */
export function claudeModelLabel(model: ClaudeModelInfo): { name: string; description: string } {
  const parts = String(model.description ?? "").split(" · ");
  const head = (parts[0] ?? "").trim();
  const family = (model.displayName || model.value).split(/\s+/)[0];
  const looksLikeName =
    head.length > 0 &&
    head.length <= 24 &&
    (head.toLowerCase().startsWith(family.toLowerCase()) || /^[A-Za-z][\w.-]*\s+\d/.test(head));
  const name = looksLikeName ? head : model.displayName || model.value;
  const description = parts.length > 1 ? parts.slice(1).join(" · ") : looksLikeName ? "" : model.description || "";
  return { name, description };
}


type Handler<T> = (value: T) => void;

interface PendingToolItem {
  itemId: string;
  tool: string;
}

interface ClaudeThreadCtx {
  threadId: string;
  sessionId: string | null;
  cwd: string;
  proc: ChildProcess;
  turnId: string | null;
  currentMessageId: string | null;
  /** messageId -> accumulated text (from stream deltas) */
  partialText: Map<string, string>;
  /** messageId -> accumulated thinking */
  partialReasoning: Map<string, string>;
  pendingTools: PendingToolItem[];
  pendingApproval: { requestId: string; tool: string; input: Record<string, unknown>; threadId: string } | null;
  initSeen: boolean;
  exited: boolean;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

function agentItemId(id: string): string {
  return `agent-${safeId(id)}`;
}

function toolItemId(id: string): string {
  return `tool-${safeId(id)}`;
}

function turnError(message: string): TurnError {
  return { message, codexErrorInfo: null, additionalDetails: null, misalignment: null };
}

function fullTurn(id: string, status: Turn["status"], error: TurnError | null = null): Turn {
  return {
    id,
    items: [],
    itemsView: "full",
    status,
    error,
    startedAt: null,
    completedAt: status === "inProgress" ? null : Math.floor(Date.now() / 1000),
    durationMs: null,
  };
}

/** One boundary where Claude events become codex-shaped notifications — the renderer can't tell. */
function asNotification(method: ServerNotification["method"], params: Record<string, unknown>): ServerNotification {
  return { method, params } as unknown as ServerNotification;
}

/**
 * Claude engine host: one `claude -p --input-format stream-json --output-format stream-json`
 * process per thread. No daemon exists for Claude — unlike Codex, each thread is its own process,
 * resumed via `claude-<sessionId>` thread ids.
 *
 * Events are translated into the same codex-shaped `ServerNotification`s the renderer already
 * understands, so the UI and reducer stay engine-agnostic:
 *   stream deltas  -> item/agentMessage/delta (+ item/reasoning/textDelta for thinking)
 *   assistant text -> item/completed (authoritative)
 *   tool calls     -> item/started + item/completed (commandExecution / fileChange / tool)
 *   permission     -> ServerRequest (item/commandExecution|fileChange|permissions/requestApproval)
 *   result         -> turn/completed + thread/tokenUsage/updated + thread/status/changed
 */
export class ClaudeHost {
  private statusView: CodexStatusView = { state: "starting" };
  private binary: ClaudeBinaryInfo | null = null;
  private catalogue: ClaudeCatalogue = FALLBACK_CATALOGUE;
  private readonly threads = new Map<string, ClaudeThreadCtx>();
  private readonly effortByThread = new Map<string, string>();
  /** In-flight control requests we are waiting an answer for (settings reads, etc.). */
  private readonly pendingControl = new Map<string, (body: Record<string, unknown> | null) => void>();
  private readonly stderrRing: string[] = [];

  private readonly notificationHandlers = new Set<Handler<ServerNotification>>();
  private readonly requestHandlers = new Set<Handler<ServerRequest>>();
  private readonly statusHandlers = new Set<Handler<CodexStatusView>>();

  get current(): CodexStatusView {
    return this.statusView;
  }

  get info(): ClaudeBinaryInfo | null {
    return this.binary;
  }

  get isReady(): boolean {
    return this.binary !== null;
  }

  /** Resolve the CLI (cheap — no long-lived process is started) and read its model catalogue. */
  async probe(): Promise<void> {
    this.setStatus({ state: "starting" });
    const binary = resolveClaudeBinary();
    if (!binary) {
      this.binary = null;
      this.setStatus({
        state: "error",
        message: "Claude Code CLI tidak ditemukan. Install: npm i -g @anthropic-ai/claude-code",
      });
      return;
    }
    this.binary = binary;
    this.catalogue = await this.fetchCatalogue(binary);
    this.setStatus({
      state: "ready",
      binaryPath: binary.path,
      binarySource: binary.source,
      version: binary.version,
    });
  }

  /** Model entries for the composer, with the CLI's real names and per-model effort levels. */
  modelOptions(): Array<{
    id: string;
    name: string;
    description: string;
    hidden: boolean;
    isDefault: boolean;
    reasoningEfforts: string[];
    defaultReasoningEffort: string | null;
    effortLevels: string[];
    supportsEffort: boolean;
    hint: string | null;
  }> {
    // The catalogue lists more than one alias for a single model — `default` and `sonnet` both
    // resolve to claude-sonnet-5 — which showed up as two identical rows in the composer. Keep one
    // row per resolved model, preferring the explicit alias (`sonnet`) over `default`; the default
    // alias only tracks upstream, so it must not become a row of its own. If the default alias ever
    // points at a different model, that model is not a duplicate and keeps its own row.
    const representative = new Map<string, ClaudeModelInfo>();
    for (const m of this.catalogue.models) {
      const key = m.resolvedModel ?? m.value;
      const kept = representative.get(key);
      if (!kept || (kept.value === "default" && m.value !== "default")) representative.set(key, m);
    }
    const seen = this.catalogue.models.filter((m) => representative.get(m.resolvedModel ?? m.value) === m);
    const defaultKeys = new Set(
      this.catalogue.models.filter((m) => m.value === "default").map((m) => m.resolvedModel ?? m.value),
    );

    return seen.map((m, index) => {
      const label = claudeModelLabel(m);
      const context = m.value.match(/\[(\d+)m\]/i);
      return {
        id: m.value,
        name: label.name,
        description: label.description,
        hidden: false,
        isDefault: defaultKeys.has(m.resolvedModel ?? m.value) || (index === 0 && defaultKeys.size === 0),
        reasoningEfforts: [],
        // For Claude this field carries the level the CLI currently resolves to, so the effort
        // dial starts where the session actually is instead of guessing.
        defaultReasoningEffort: this.catalogue.applied.effort ?? null,
        effortLevels: m.effortLevels ?? [],
        supportsEffort: Boolean(m.supportsEffort && (m.effortLevels ?? []).length > 0),
        // The CLI offers some models only in a long-context variant (`claude-fable-5[1m]`); that
        // detail is the whole reason the row stands apart, so surface it next to the name.
        hint: context ? `${context[1]}M context` : null,
      };
    });
  }

  /** Effort levels that make sense for a model alias (union fallback). */
  effortLevelsFor(model: string | null): string[] {
    const found = this.catalogue.models.find((m) => m.value === model);
    if (found?.effortLevels?.length) return found.effortLevels;
    return ["low", "medium", "high", "xhigh", "max"];
  }

  effortOf(threadId: string): string | null {
    return this.effortByThread.get(threadId) ?? this.catalogue.applied.effort ?? null;
  }

  /**
   * Ask a live session what the CLI actually resolved (model + effort). This is the honest readout:
   * `setEffort` writes the request, this confirms it took effect. Returns null when the thread is
   * not running or the CLI does not answer in time.
   */
  async readSettings(threadId: string, timeoutMs = 2500): Promise<{ model: string | null; effort: string | null } | null> {
    const ctx = this.threads.get(threadId);
    if (!ctx || ctx.exited) return null;
    const requestId = `settings-${Date.now()}`;
    const body = await new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingControl.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.pendingControl.set(requestId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      ctx.proc.stdin!.write(
        JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "get_settings" } }) + "\n",
      );
    });
    if (!body) return null;
    const applied = (body.applied ?? {}) as { model?: unknown; effort?: unknown };
    return {
      model: typeof applied.model === "string" ? applied.model : null,
      effort: typeof applied.effort === "string" ? applied.effort : null,
    };
  }

  /**
   * Change the effort of a Claude session. The CLI applies it live over the control channel
   * (`apply_flag_settings { effortLevel }`) — verified against 2.1.224, no restart needed.
   * For a session that is not running yet, the level is remembered for the next resume.
   */
  setEffort(threadId: string, level: string): void {
    const allowed = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
    if (!allowed.has(level)) throw new Error(`Level effort tidak dikenal: ${level}`);
    this.effortByThread.set(threadId, level);
    const ctx = this.threads.get(threadId);
    if (!ctx || ctx.exited) return;
    ctx.proc.stdin!.write(
      JSON.stringify({
        type: "control_request",
        request_id: `effort-${Date.now()}`,
        request: { subtype: "apply_flag_settings", settings: { effortLevel: level } },
      }) + "\n",
    );
  }

  /**
   * Ask the CLI for its own catalogue: one short-lived process, `initialize` + `get_settings`,
   * then killed. No model is ever called, so this costs nothing.
   */
  private async fetchCatalogue(binary: ClaudeBinaryInfo): Promise<ClaudeCatalogue> {
    return await new Promise<ClaudeCatalogue>((resolve) => {
      let settled = false;
      const done = (value: ClaudeCatalogue) => {
        if (settled) return;
        settled = true;
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        resolve(value);
      };
      const proc = spawn(
        binary.path,
        ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose"],
        { cwd: os.homedir(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
      const timer = setTimeout(() => done(FALLBACK_CATALOGUE), 12_000);
      let buffer = "";
      let models: ClaudeModelInfo[] | null = null;
      let askedSettings = false;
      let applied: { model: string | null; effort: string | null } = { model: null, effort: null };
      proc.on("error", () => {
        clearTimeout(timer);
        done(FALLBACK_CATALOGUE);
      });
      proc.stdout?.on("data", (chunk) => {
        buffer += String(chunk);
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let rec: Record<string, unknown>;
          try {
            rec = JSON.parse(line);
          } catch {
            continue;
          }
          if (rec.type !== "control_response") continue;
          const response = (rec.response ?? {}) as { subtype?: string; response?: Record<string, unknown> };
          if (response.subtype !== "success") continue;
          const body = response.response ?? {};
          if (Array.isArray(body.models)) {
            models = (body.models as Array<Record<string, unknown>>).map((m) => ({
              value: String(m.value ?? m.displayName ?? ""),
              displayName: String(m.displayName ?? ""),
              description: String(m.description ?? ""),
              resolvedModel: m.resolvedModel ? String(m.resolvedModel) : null,
              supportsEffort: Boolean(m.supportsEffort),
              effortLevels: Array.isArray(m.supportedEffortLevels) ? (m.supportedEffortLevels as string[]).map(String) : [],
            }));
          }
          if (body.applied && typeof body.applied === "object") {
            const a = body.applied as { model?: unknown; effort?: unknown };
            applied = {
              model: typeof a.model === "string" ? a.model : applied.model,
              effort: typeof a.effort === "string" ? a.effort : applied.effort,
            };
            if (models) {
              clearTimeout(timer);
              done({ models, applied });
            }
            continue;
          }
          if (models && !askedSettings) {
            // Ask for the session defaults once the catalogue is in (gives the dial its start value).
            askedSettings = true;
            proc.stdin?.write(
              JSON.stringify({ type: "control_request", request_id: "zcodex-settings", request: { subtype: "get_settings" } }) + "\n",
            );
            // Don't wait forever if the CLI stays quiet about settings.
            setTimeout(() => {
              if (models) {
                clearTimeout(timer);
                done({ models, applied });
              }
            }, 2500);
          }
        }
      });
      proc.stdin?.on("error", () => {
        /* ignore */
      });
      proc.stdin?.write(
        JSON.stringify({ type: "control_request", request_id: "zcodex-catalogue", request: { subtype: "initialize", hooks: {} } }) + "\n",
      );
    });
  }

  owns(threadId: string): boolean {
    return isClaudeThreadId(threadId) || this.threads.has(threadId);
  }

  private requireBinary(): ClaudeBinaryInfo {
    if (!this.binary) {
      throw new Error("Claude belum siap: CLI belum terdeteksi");
    }
    return this.binary;
  }

  /* ------------------------------------------------------------ lifecycle */

  async startThread(options: { cwd: string; model?: string | null; effort?: string | null; permissionMode?: ClaudePermissionMode }): Promise<{ id: string; sessionId: string | null }> {
    const ctx = this.spawnThread(options);
    await this.waitForInit(ctx);
    return { id: ctx.threadId, sessionId: ctx.sessionId };
  }

  /** Resume an existing session (threadId `claude-<sessionId>` from the sidebar). */
  async resumeThread(threadId: string, options: { cwd: string; model?: string | null; effort?: string | null; permissionMode?: ClaudePermissionMode }): Promise<void> {
    if (this.threads.has(threadId)) return;
    if (!isClaudeThreadId(threadId)) throw new Error(`Bukan thread Claude: ${threadId}`);
    this.spawnThread({
      ...options,
      effort: options.effort ?? this.effortByThread.get(threadId) ?? null,
      resumeSessionId: threadId.slice("claude-".length),
      threadId,
    });
    await this.waitForInit(this.threads.get(threadId)!);
  }

  private spawnThread(options: {
    cwd: string;
    model?: string | null;
    effort?: string | null;
    permissionMode?: ClaudePermissionMode;
    resumeSessionId?: string;
    threadId?: string;
  }): ClaudeThreadCtx {
    const binary = this.requireBinary();
    // We pass our own session id so the thread id (`claude-<sid>`) is stable from the start and
    // matches the file Claude persists under ~/.claude/projects (verified: --session-id pins the
    // init id, the file name, and every record's sessionId).
    const sessionId = options.resumeSessionId ?? crypto.randomUUID();
    const threadId = options.threadId ?? `claude-${sessionId}`;
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool", "stdio",
      "--permission-mode", options.permissionMode ?? "default",
    ];
    if (options.model) args.push("--model", options.model);
    if (options.effort) args.push("--effort", options.effort);
    if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);
    else args.push("--session-id", sessionId);
    if (options.effort) this.effortByThread.set(threadId, options.effort);

    const proc = spawn(binary.path, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const ctx: ClaudeThreadCtx = {
      threadId,
      sessionId,
      cwd: options.cwd,
      proc,
      turnId: null,
      currentMessageId: null,
      partialText: new Map(),
      partialReasoning: new Map(),
      pendingTools: [],
      pendingApproval: null,
      initSeen: false,
      exited: false,
    };
    this.threads.set(threadId, ctx);

    proc.on("error", (err) => {
      this.notify(
        asNotification("error", {
          error: turnError(`claude gagal dijalankan: ${err.message}`),
          willRetry: false,
          threadId,
          turnId: ctx.turnId ?? "",
        }),
      );
    });
    proc.on("exit", (code, signal) => {
      ctx.exited = true;
      this.threads.delete(threadId);
      if (!ctx.turnId) return; // idle exit — nothing to finalize
      this.notify(
        asNotification("turn/completed", {
          threadId,
          turn: fullTurn(ctx.turnId, "failed", turnError(`claude berhenti (${code ?? signal ?? "?"})`)),
        }),
      );
      this.notify(asNotification("thread/status/changed", { threadId, status: { type: "systemError" } }));
    });
    proc.stderr?.on("data", (d) => {
      for (const line of String(d).split("\n")) {
        const t = line.trim();
        if (!t) continue;
        this.stderrRing.push(t);
        if (this.stderrRing.length > 200) this.stderrRing.shift();
      }
    });

    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        this.notify(
          asNotification("warning", { threadId, message: `Baris claude tidak terbaca: ${line.slice(0, 120)}` }),
        );
        return;
      }
      this.handleRecord(ctx, rec);
    });

    // Open the SDK-style control bridge so permission prompts reach us — required for
    // can_use_tool routing (verified against the installed CLI).
    proc.stdin!.write(
      JSON.stringify({ type: "control_request", request_id: "zcodex-init", request: { subtype: "initialize", hooks: {} } }) + "\n",
    );
    return ctx;
  }

  private async waitForInit(ctx: ClaudeThreadCtx): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (ctx.exited || ctx.initSeen) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /* ---------------------------------------------------------------- turns */

  send(threadId: string, text: string): void {
    const ctx = this.threads.get(threadId);
    if (!ctx || ctx.exited) {
      throw new Error("Proses Claude untuk thread ini belum aktif. Buka thread dulu, lalu kirim ulang.");
    }
    if (ctx.pendingApproval) {
      throw new Error("Menunggu jawaban izin yang masih terbuka.");
    }
    ctx.turnId = `turn-${crypto.randomUUID()}`;
    ctx.currentMessageId = null;
    ctx.partialText.clear();
    ctx.partialReasoning.clear();
    ctx.pendingTools = [];
    this.notify(asNotification("turn/started", { threadId, turn: fullTurn(ctx.turnId, "inProgress") }));
    ctx.proc.stdin!.write(
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n",
    );
  }

  async interrupt(threadId: string): Promise<void> {
    const ctx = this.threads.get(threadId);
    if (!ctx || ctx.exited) return;
    ctx.proc.stdin!.write(
      JSON.stringify({ type: "control_request", request_id: `interrupt-${Date.now()}`, request: { subtype: "interrupt" } }) + "\n",
    );
    // The CLI interrupts the running turn and emits a result — if it ever refuses, don't leave
    // the user stuck: force-kill after a few seconds (the session is persisted by Claude).
    setTimeout(() => {
      if (!this.threads.has(threadId) || ctx.exited) return;
      try {
        ctx.proc.kill();
      } catch {
        /* already gone */
      }
    }, 4000);
  }

  respondApproval(threadId: string, requestId: string, decision: string): void {
    const ctx = this.threads.get(threadId);
    const pending = ctx?.pendingApproval;
    if (!pending) return;
    ctx.pendingApproval = null;
    const allowed = decision === "accept" || decision === "acceptForSession";
    const body = allowed
      ? { behavior: "allow", updatedInput: pending.input }
      : { behavior: "deny", message: "Ditolak di ZCodex" };
    ctx.proc.stdin!.write(
      JSON.stringify({
        type: "control_response",
        response: { subtype: "success", request_id: requestId, response: body },
      }) + "\n",
    );
    this.notify(asNotification("serverRequest/resolved", { threadId, requestId }));
  }

  stderrTail(): string[] {
    return [...this.stderrRing];
  }

  dispose(): void {
    for (const ctx of this.threads.values()) {
      try {
        ctx.proc.kill();
      } catch {
        /* ignore */
      }
    }
    this.threads.clear();
  }

  /* ------------------------------------------------------------- handlers */

  onNotification(handler: Handler<ServerNotification>): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: Handler<ServerRequest>): () => void {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  onStatus(handler: Handler<CodexStatusView>): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private setStatus(status: CodexStatusView): void {
    this.statusView = status;
    for (const h of this.statusHandlers) h(status);
  }

  private notify(notification: ServerNotification): void {
    for (const h of this.notificationHandlers) h(notification);
  }

  private emitRequest(request: ServerRequest): void {
    for (const h of this.requestHandlers) h(request);
  }

  /* -------------------------------------------------------- event mapping */

  private handleRecord(ctx: ClaudeThreadCtx, rec: Record<string, unknown>): void {
    const type = rec.type;
    if (typeof rec.session_id === "string" && rec.session_id) ctx.sessionId = rec.session_id;

    if (type === "system") {
      // init / status / api_retry — nothing to render beyond readiness
      if (rec.subtype === "init") ctx.initSeen = true;
      return;
    }
    if (type === "stream_event") {
      this.handleStreamEvent(ctx, rec.event as Record<string, unknown> | undefined);
      return;
    }
    if (type === "assistant") {
      this.handleAssistant(ctx, rec);
      return;
    }
    if (type === "user" && Array.isArray((rec.message as { content?: unknown } | undefined)?.content)) {
      // tool_result records arrive as user messages; complete whatever tool item they match.
      const content = (rec.message as { content: Array<Record<string, unknown>> }).content;
      for (const block of content) {
        if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
          this.completeTool(ctx, block.tool_use_id as string, block.content);
        }
      }
      return;
    }
    if (type === "result") {
      this.handleResult(ctx, rec);
      return;
    }
    if (type === "control_response") {
      // The CLI answers our control requests here. A failed `apply_flag_settings` (effort) would
      // otherwise be invisible — surface it so the UI can complain instead of lying.
      const response = (rec.response ?? {}) as { subtype?: string; request_id?: string; error?: unknown; response?: Record<string, unknown> };
      const waiter = response.request_id ? this.pendingControl.get(String(response.request_id)) : undefined;
      if (response.subtype === "success") {
        if (waiter) {
          this.pendingControl.delete(String(response.request_id));
          waiter(response.response ?? {});
        }
        return;
      }
      if (waiter) {
        this.pendingControl.delete(String(response.request_id));
        waiter(null);
      }
      this.notify(
        asNotification("warning", {
          threadId: ctx.threadId,
          message: `Claude menolak permintaan kontrol (${String(response.request_id ?? "?")}): ${String(response.error ?? "").slice(0, 200)}`,
        }),
      );
      return;
    }
    if (type === "control_request") {
      this.handleControlRequest(ctx, rec);
    }
  }

  private handleStreamEvent(ctx: ClaudeThreadCtx, evt: Record<string, unknown> | undefined): void {
    if (!evt || typeof evt !== "object") return;
    const kind = evt.type;
    if (kind === "message_start") {
      ctx.currentMessageId = (evt.message as { id?: string } | undefined)?.id ?? null;
      return;
    }
    if (kind !== "content_block_delta") return;
    const delta = evt.delta as { type?: string; text?: string; thinking?: string } | undefined;
    if (!delta) return;
    const threadId = ctx.threadId;
    const turnId = ctx.turnId ?? "";
    if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
      const msgId = ctx.currentMessageId ?? "anon";
      const prev = ctx.partialText.get(msgId) ?? "";
      ctx.partialText.set(msgId, prev + delta.text);
      if (prev === "") {
        this.notify(
          asNotification("item/started", {
            threadId,
            turnId,
            startedAtMs: Date.now(),
            item: agentMessageItem(agentItemId(msgId), "", true),
          }),
        );
      }
      this.notify(
        asNotification("item/agentMessage/delta", { threadId, turnId, itemId: agentItemId(msgId), delta: delta.text }),
      );
    } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
      const msgId = ctx.currentMessageId ?? "anon";
      ctx.partialReasoning.set(msgId, (ctx.partialReasoning.get(msgId) ?? "") + delta.thinking);
      this.notify(
        asNotification("item/reasoning/textDelta", {
          threadId,
          turnId,
          itemId: `reason-${agentItemId(msgId)}`,
          contentIndex: 0,
          delta: delta.thinking,
        }),
      );
    }
  }

  private handleAssistant(ctx: ClaudeThreadCtx, rec: Record<string, unknown>): void {
    const msg = (rec.message ?? {}) as { id?: unknown; content?: Array<Record<string, unknown>> };
    const msgId = String(msg.id ?? ctx.currentMessageId ?? "anon");
    ctx.currentMessageId = msgId;
    const threadId = ctx.threadId;
    const turnId = ctx.turnId ?? "";
    const content = Array.isArray(msg.content) ? msg.content : [];

    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") {
        // Authoritative copy — replaces the streaming item (same id).
        this.notify(
          asNotification("item/completed", {
            threadId,
            turnId,
            completedAtMs: Date.now(),
            item: agentMessageItem(agentItemId(msgId), block.text, false),
          }),
        );
        ctx.partialText.delete(msgId);
      } else if (block?.type === "tool_use" && typeof block.name === "string") {
        this.startTool(ctx, block);
      }
    }
    if (rec.error) {
      this.notify(
        asNotification("error", {
          error: turnError(String(rec.error).slice(0, 400)),
          willRetry: false,
          threadId,
          turnId,
        }),
      );
    }
  }

  private startTool(ctx: ClaudeThreadCtx, block: Record<string, unknown>): void {
    const tool = String(block.name ?? "tool");
    const input = (block.input ?? {}) as Record<string, unknown>;
    const itemId = toolItemId(String(block.id ?? `${tool}-${Date.now()}`));
    ctx.pendingTools.push({ itemId, tool });
    const threadId = ctx.threadId;
    const turnId = ctx.turnId ?? "";

    if (tool === "Bash" && typeof input.command === "string") {
      this.notify(
        asNotification("item/started", {
          threadId,
          turnId,
          startedAtMs: Date.now(),
          item: {
            type: "commandExecution",
            id: itemId,
            pluginId: null,
            scriptPath: null,
            command: input.command,
            cwd: ctx.cwd,
            processId: null,
            source: "agent",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: "",
            exitCode: null,
            durationMs: null,
          },
        }),
      );
      return;
    }
    if (EDIT_TOOLS.has(tool)) {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      this.notify(
        asNotification("item/started", {
          threadId,
          turnId,
          startedAtMs: Date.now(),
          item: {
            type: "fileChange",
            id: itemId,
            status: "inProgress",
            changes: filePath ? [{ path: filePath, kind: { type: "update", move_path: null }, diff: "" }] : [],
          },
        }),
      );
      return;
    }
    this.notify(
      asNotification("item/started", {
        threadId,
        turnId,
        startedAtMs: Date.now(),
        item: {
          type: "dynamicToolCall",
          id: itemId,
          namespace: null,
          tool,
          arguments: input,
          status: "inProgress",
          contentItems: null,
          success: null,
          durationMs: null,
        },
      }),
    );
  }

  private completeTool(ctx: ClaudeThreadCtx, toolUseId: string, result: unknown): void {
    const idx = ctx.pendingTools.findIndex((p) => p.itemId === toolItemId(toolUseId));
    if (idx === -1) return;
    const [pending] = ctx.pendingTools.splice(idx, 1);
    const text = formatToolResult(result);
    const threadId = ctx.threadId;
    const turnId = ctx.turnId ?? "";
    const failed = text.toLowerCase().includes("error");

    if (pending.tool === "Bash") {
      this.notify(
        asNotification("item/completed", {
          threadId,
          turnId,
          completedAtMs: Date.now(),
          item: {
            type: "commandExecution",
            id: pending.itemId,
            pluginId: null,
            scriptPath: null,
            command: "",
            cwd: ctx.cwd,
            processId: null,
            source: "agent",
            status: failed ? "failed" : "completed",
            commandActions: [],
            aggregatedOutput: text,
            exitCode: failed ? 1 : 0,
            durationMs: null,
          },
        }),
      );
      return;
    }
    if (EDIT_TOOLS.has(pending.tool)) {
      this.notify(
        asNotification("item/completed", {
          threadId,
          turnId,
          completedAtMs: Date.now(),
          item: { type: "fileChange", id: pending.itemId, status: failed ? "failed" : "completed", changes: [] },
        }),
      );
      return;
    }
    this.notify(
      asNotification("item/completed", {
        threadId,
        turnId,
        completedAtMs: Date.now(),
        item: {
          type: "dynamicToolCall",
          id: pending.itemId,
          namespace: null,
          tool: pending.tool,
          arguments: {},
          status: failed ? "failed" : "completed",
          contentItems: null,
          success: !failed,
          durationMs: null,
        },
      }),
    );
  }

  private handleControlRequest(ctx: ClaudeThreadCtx, rec: Record<string, unknown>): void {
    const request = (rec.request ?? {}) as {
      subtype?: string;
      tool_name?: string;
      input?: unknown;
      knowntools?: unknown;
      decision_reason?: string;
    };
    if (request.subtype !== "can_use_tool" || typeof request.tool_name !== "string") return;
    const tool = request.tool_name;
    const input = (request.input ?? {}) as Record<string, unknown>;
    const requestId = String(rec.request_id ?? `cl-${Date.now()}`);
    ctx.pendingApproval = { requestId, tool, input, threadId: ctx.threadId };
    const threadId = ctx.threadId;
    const turnId = ctx.turnId ?? "pending";

    let requestEvent: ServerRequest;
    if (tool === "Bash") {
      requestEvent = {
        method: "item/commandExecution/requestApproval",
        id: requestId,
        params: {
          kind: "shell",
          threadId,
          turnId,
          itemId: toolItemId(requestId),
          startedAtMs: Date.now(),
          command: typeof input.command === "string" ? input.command : "",
          cwd: ctx.cwd,
          reason: String(request.decision_reason ?? "Claude ingin menjalankan perintah shell"),
          approvalId: null,
        },
      } as unknown as ServerRequest;
    } else if (EDIT_TOOLS.has(tool)) {
      requestEvent = {
        method: "item/fileChange/requestApproval",
        id: requestId,
        params: {
          threadId,
          turnId,
          itemId: toolItemId(requestId),
          startedAtMs: Date.now(),
          reason: String(request.decision_reason ?? `Claude ingin mengubah file (${tool})`),
          changes: [{ path: String(input.file_path ?? ""), kind: { type: "update", move_path: null }, diff: "" }],
          grantRoot: ctx.cwd,
        },
      } as unknown as ServerRequest;
    } else {
      requestEvent = {
        method: "item/permissions/requestApproval",
        id: requestId,
        params: {
          threadId,
          turnId,
          itemId: toolItemId(requestId),
          environmentId: null,
          startedAtMs: Date.now(),
          cwd: ctx.cwd,
          reason: String(request.decision_reason ?? `Claude ingin memakai tool ${tool}`),
          permissions: {},
        },
      } as unknown as ServerRequest;
    }
    this.emitRequest(requestEvent);
  }

  private handleResult(ctx: ClaudeThreadCtx, rec: Record<string, unknown>): void {
    const threadId = ctx.threadId;
    const turnId = ctx.turnId;
    if (turnId) {
      const isError = Boolean(rec.is_error);
      this.notify(
        asNotification("turn/completed", {
          threadId,
          turn: fullTurn(
            turnId,
            isError ? "failed" : "completed",
            isError ? turnError(String(rec.result ?? rec.error ?? "Turn gagal").slice(0, 1200)) : null,
          ),
        }),
      );
    }
    ctx.turnId = null;
    ctx.currentMessageId = null;
    ctx.partialText.clear();
    ctx.partialReasoning.clear();
    ctx.pendingTools = [];

    const usage = (rec.usage ?? {}) as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    const totalTokens =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (totalTokens > 0) {
      const breakdown = {
        totalTokens,
        inputTokens: usage.input_tokens ?? 0,
        cachedInputTokens: (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        cacheWriteInputTokens: 0,
        outputTokens: usage.output_tokens ?? 0,
        reasoningOutputTokens: 0,
      };
      this.notify(
        asNotification("thread/tokenUsage/updated", {
          threadId,
          turnId: "",
          tokenUsage: { total: breakdown, last: breakdown, modelContextWindow: null },
        }),
      );
    }
    this.notify(asNotification("thread/status/changed", { threadId, status: { type: "idle" } }));
  }
}

/* ------------------------------------------------------------ item helpers */

function agentMessageItem(id: string, text: string, streaming: boolean): ThreadItem {
  return {
    type: "agentMessage",
    id,
    text,
    phase: streaming ? null : "final_answer",
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result.slice(0, 4000);
  if (Array.isArray(result)) {
    return result
      .map((b) => (typeof b === "object" && b !== null && "text" in b ? String((b as { text: unknown }).text) : JSON.stringify(b)))
      .join("\n")
      .slice(0, 4000);
  }
  try {
    return JSON.stringify(result).slice(0, 4000);
  } catch {
    return "";
  }
}