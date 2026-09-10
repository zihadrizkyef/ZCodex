import { EventBus, EngineConnector, NeutralEvent, ClientCommand, ServerFrame } from '@zcodex/core';
import { WebSocketServer, WebSocket } from 'ws';
import { ClaudeConnector } from '@zcodex/engine-claude';
import { OpencodeConnector } from '@zcodex/engine-opencode';
import { DemoConnector } from './demo';

interface RunningThread {
  agentId: string;
  threadId: string;
  title?: string;
}

export class HarnessServer {
  private readonly bus = new EventBus();
  private readonly agents = new Map<string, EngineConnector>();
  private readonly threads = new Map<string, RunningThread>();
  private wss: WebSocketServer | null = null;
  public readonly port: number;

  constructor(port = 4123) {
    this.port = port;
    this.register(new DemoConnector(this.bus));
    this.register(new OpencodeConnector(this.bus));
    this.register(new ClaudeConnector(this.bus));
  }

  private register(conn: EngineConnector): void {
    this.agents.set(conn.agentId, conn);
  }

  async start(): Promise<void> {
    // Availability probe for the stock agents.
    for (const [agentId, conn] of this.agents) {
      if (agentId === 'demo') continue;
      conn.available().then((r) =>
        this.bus.emit({
          type: 'error',
          agentId,
          message: r.ok ? `${conn.label} ready (${r.detail})` : `${conn.label} unavailable: ${r.detail}`,
          fatal: !r.ok,
        }),
      );
    }

    this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });
    this.bus.on((e) => this.broadcast({ kind: 'event', event: e }));
    this.emitAgentList();

    this.wss.on('connection', (socket) => {
      socket.on('message', (raw) => this.onCommand(socket, raw.toString()));
      this.broadcast({ kind: 'event', event: { type: 'agent.list', agents: this.listAgents() } });
    });

    return new Promise((resolve) => this.wss!.on('listening', () => resolve()));
  }

  private listAgents(): Array<{ agentId: string; label: string; available: boolean; detail?: string }> {
    return [...this.agents.values()].map((c) => ({ agentId: c.agentId, label: c.label, available: true }));
  }

  private emitAgentList(): void {
    this.broadcast({ kind: 'event', event: { type: 'agent.list', agents: this.listAgents() } });
  }

  private broadcast(frame: ServerFrame): void {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(frame));
    }
  }

  private sendTo(socket: WebSocket, frame: ServerFrame): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  private async onCommand(socket: WebSocket, raw: string): Promise<void> {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(raw);
    } catch {
      this.sendTo(socket, { kind: 'event', event: { type: 'error', agentId: 'server', message: 'bad command JSON', fatal: true } });
      return;
    }

    switch (cmd.type) {
      case 'agents.list':
        this.sendTo(socket, { kind: 'event', event: { type: 'agent.list', agents: this.listAgents() } });
        break;
      case 'thread.start': {
        const conn = this.agents.get(cmd.agentId);
        if (!conn) {
          this.sendTo(socket, { kind: 'event', event: { type: 'error', agentId: cmd.agentId, message: `unknown agent "${cmd.agentId}"`, fatal: true } });
          return;
        }
        try {
          const { threadId } = await conn.startThread(cmd.cwd, { title: cmd.title, prompt: cmd.prompt });
          this.threads.set(threadId, { agentId: cmd.agentId, threadId, title: cmd.title });
        } catch (err) {
          this.sendTo(socket, {
            kind: 'event',
            event: { type: 'error', agentId: cmd.agentId, message: `thread.start failed: ${(err as Error).message}`, fatal: true },
          });
        }
        break;
      }
      case 'thread.send': {
        const t = this.threads.get(cmd.threadId);
        const conn = t && this.agents.get(t.agentId);
        if (!conn || !t) {
          this.sendTo(socket, { kind: 'event', event: { type: 'error', agentId: 'server', message: `unknown thread ${cmd.threadId}`, fatal: true } });
          return;
        }
        try {
          await conn.send(cmd.threadId, cmd.text);
        } catch (err) {
          this.sendTo(socket, { kind: 'event', event: { type: 'error', agentId: t.agentId, threadId: t.threadId, message: (err as Error).message } });
        }
        break;
      }
      case 'approval.respond': {
        const t = this.threads.get(cmd.threadId);
        const conn = t && this.agents.get(t.agentId);
        if (conn && t) await conn.respondApproval(cmd.threadId, cmd.requestId, cmd.approve, cmd.text);
        break;
      }
      case 'thread.close': {
        const t = this.threads.get(cmd.threadId);
        const conn = t && this.agents.get(t.agentId);
        if (conn) await conn.close(cmd.threadId);
        this.threads.delete(cmd.threadId);
        break;
      }
    }
  }

  async stop(): Promise<void> {
    await Promise.all([...this.agents.values()].map((c) => c.teardown()));
    this.wss?.close();
  }
}

// ---- runner ----
if (require.main === module) {
  const port = Number(process.env.PORT || 4123);
  const server = new HarnessServer(port);
  server.start().then(() => {
    console.log(`zcodex harness server listening on ws://127.0.0.1:${port}`);
  });
}