import type { ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { RequestId, ServerNotification, ServerRequest } from "@zcodex/codex-protocol";

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(err: RpcError) {
    super(err.message);
    this.name = "JsonRpcError";
    this.code = err.code;
    this.data = err.data;
  }
}

type NotificationHandler = (notification: ServerNotification) => void;
type RequestHandler = (request: ServerRequest) => void;
type StderrHandler = (chunk: string) => void;

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Newline-delimited JSON-RPC 2.0 over the child process stdio pipes.
 *
 * Codex frames every message as a single line of JSON on stdout; anything on stderr is diagnostics
 * (the app-server logs tracing there) and must never be parsed as protocol.
 */
export class JsonRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly notifications = new Set<NotificationHandler>();
  private readonly requests = new Set<RequestHandler>();
  private readonly stderrHandlers = new Set<StderrHandler>();
  private readonly exitHandlers = new Set<(code: number | null, signal: string | null) => void>();
  private reader: Interface | null = null;
  private closed = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly defaultTimeoutMs = 60_000,
  ) {
    if (child.stdout) {
      this.reader = createInterface({ input: child.stdout });
      this.reader.on("line", (line) => this.handleLine(line));
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const h of this.stderrHandlers) h(text);
    });
    child.on("exit", (code, signal) => {
      this.closed = true;
      const err = new Error(`codex app-server exited (code=${code} signal=${signal})`);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      for (const h of this.exitHandlers) h(code, signal);
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private handleLine(line: string): void {
    const text = line.trim();
    if (!text) return;
    let msg: { id?: RequestId; method?: string; params?: unknown; result?: unknown; error?: RpcError };
    try {
      msg = JSON.parse(text);
    } catch {
      // Not protocol (stray log line) — surface nothing, it is not actionable.
      return;
    }
    const isResponse = msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined);
    if (isResponse) {
      const key = String(msg.id);
      const p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new JsonRpcError(msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      if (msg.id !== undefined) {
        for (const h of this.requests) h(msg as ServerRequest);
      } else {
        for (const h of this.notifications) h(msg as ServerNotification);
      }
    }
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    if (this.closed || !this.child.stdin?.writable) {
      return Promise.reject(new Error(`Cannot send ${method}: codex app-server is not running`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timeout after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(String(id), {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed || !this.child.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  /** Answer a server-initiated request (approvals, elicitations, tool calls). */
  respond(id: RequestId, result: unknown): void {
    if (this.closed || !this.child.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  respondError(id: RequestId, code: number, message: string): void {
    if (this.closed || !this.child.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notifications.add(handler);
    return () => this.notifications.delete(handler);
  }

  onServerRequest(handler: RequestHandler): () => void {
    this.requests.add(handler);
    return () => this.requests.delete(handler);
  }

  onStderr(handler: StderrHandler): () => void {
    this.stderrHandlers.add(handler);
    return () => this.stderrHandlers.delete(handler);
  }

  onExit(handler: (code: number | null, signal: string | null) => void): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  dispose(): void {
    this.closed = true;
    this.reader?.close();
    this.reader = null;
  }
}
