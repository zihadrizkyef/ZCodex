import os from "node:os";
import { CodexClient, type CodexClientInfo } from "@zcodex/codex-client";
import type { ServerNotification, ServerRequest } from "@zcodex/codex-protocol";
import type { CodexStatusView } from "@zcodex/contracts";

type Handler<T> = (value: T) => void;

/**
 * Owns the single Codex app-server process for the app's lifetime and fans its traffic out to
 * whoever is listening (the Electron windows today, anything else later).
 */
export class CodexHost {
  private client: CodexClient | null = null;
  private starting: Promise<void> | null = null;
  private status: CodexStatusView = { state: "starting" };
  private readonly stderrRing: string[] = [];

  private readonly notificationHandlers = new Set<Handler<ServerNotification>>();
  private readonly requestHandlers = new Set<Handler<ServerRequest>>();
  private readonly statusHandlers = new Set<Handler<CodexStatusView>>();

  get current(): CodexStatusView {
    return this.status;
  }

  get info(): CodexClientInfo | null {
    return this.client?.info ?? null;
  }

  get isReady(): boolean {
    return this.client !== null;
  }

  /** The live client, or null when the server is not up. */
  get maybe(): CodexClient | null {
    return this.client;
  }

  /** Throws with a user-facing message when the server is unavailable. */
  require(): CodexClient {
    if (!this.client) {
      throw new Error(
        this.status.state === "error"
          ? `Codex app-server tidak siap: ${this.status.message ?? "unknown error"}`
          : "Codex app-server belum siap",
      );
    }
    return this.client;
  }

  /** Recent app-server stderr — useful when a turn dies and the UI needs to explain why. */
  get stderrTail(): string[] {
    return [...this.stderrRing];
  }

  async ensureStarted(): Promise<void> {
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async start(): Promise<void> {
    this.setStatus({ state: "starting" });
    try {
      const client = await CodexClient.start({ cwd: os.homedir() });
      this.client = client;
      this.setStatus({
        state: "ready",
        binaryPath: client.info.binaryPath,
        binarySource: client.info.binarySource,
        version: client.info.version,
        versionWarning: client.info.versionWarning,
        codexHome: client.info.codexHome,
      });
      client.onNotification((n) => {
        for (const h of this.notificationHandlers) h(n);
      });
      client.onServerRequest((r) => {
        if (this.requestHandlers.size === 0) {
          // Nobody can answer (no window): never leave the agent hanging.
          client.rejectServerRequest(r.id, "No client available to answer this request");
          return;
        }
        for (const h of this.requestHandlers) h(r);
      });
      client.onStderr((chunk) => {
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          this.stderrRing.push(line);
          if (this.stderrRing.length > 200) this.stderrRing.shift();
        }
      });
      client.onExit((code, signal) => {
        this.client = null;
        this.setStatus({
          state: "stopped",
          message: `codex app-server berhenti (${code ?? signal ?? "?"})`,
          version: client.info.version,
        });
      });
    } catch (err) {
      this.client = null;
      this.setStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
    this.status = status;
    for (const h of this.statusHandlers) h(status);
  }

  dispose(): void {
    this.client?.dispose();
    this.client = null;
  }
}
