import { EventBus, EngineConnector, NeutralEvent } from '@zcodex/core';

interface DemoThread {
  threadId: string;
  turnId: string;
  state: { step: number };
  pendingApprovals: Array<{ requestId: string; kind: NeutralEvent & { type: 'approval.request' } }>;
}

const SCRIPT =
  'Demo engine online. This connector synthesizes events so the GUI can be exercised without a real agent account.\n' +
  'It streams text deltas, shows a tool call, and asks for one approval before finishing the turn.';

const APPROVAL_STDIN = 1 * 400;
const APPROVAL_AFTER = 2 * 400;

/**
 * Synthetic connector used to verify the GUI <-> server pipeline (streaming text.delta,
 * status phase, tool.call, approval.request) without live agent credentials.
 */
export class DemoConnector implements EngineConnector {
  readonly agentId = 'demo';
  readonly label = 'Demo (synthetic)';
  private readonly bus: EventBus;
  private readonly threads = new Map<string, DemoThread>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  private emit(e: NeutralEvent): void {
    this.bus.emit(e);
  }

  available(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve({ ok: true, detail: 'always available' });
  }

  async startThread(cwd: string, opts?: { title?: string; prompt?: string }): Promise<{ threadId: string }> {
    const threadId = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const turnId = `turn-${threadId}`;
    const thread: DemoThread = { threadId, turnId, state: { step: 0 }, pendingApprovals: [] };
    this.threads.set(threadId, thread);
    this.emit({ type: 'thread.started', threadId, agentId: this.agentId, label: this.label, title: opts?.title });
    this.runScript(thread);
    return { threadId };
  }

  private runScript(thread: DemoThread): void {
    const { threadId, turnId } = thread;
    this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'working' });
    const t = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const h = setTimeout(() => resolve(true), ms);
        this.timers.add(h);
      });
    (async () => {
      const text = opts(thread);
      // stream the script as token deltas
      for (const ch of text) {
        this.emit({ type: 'text.delta', threadId, agentId: this.agentId, turnId, itemId: `msg-${turnId}`, delta: ch });
        await t(4);
      }
      this.emit({ type: 'text.completed', threadId, agentId: this.agentId, turnId, itemId: `msg-${turnId}`, text });
      await t(300);
      this.emit({ type: 'tool.call', threadId, agentId: this.agentId, callId: 'demo-tool-1', tool: 'read_file', state: 'start', summary: 'demo/src/hello.ts' });
      await t(400);
      this.emit({ type: 'tool.call', threadId, agentId: this.agentId, callId: 'demo-tool-1', tool: 'read_file', state: 'end' });
      await t(250);
      const requestId = `approval-${Date.now().toString(36)}`;
      thread.pendingApprovals.push({ requestId, kind: { type: 'approval.request', threadId, agentId: this.agentId, requestId, kind: 'exec', title: 'Run a demo command?', command: 'npm run demo' } as NeutralEvent & { type: 'approval.request' } });
      this.emit(thread.pendingApprovals[thread.pendingApprovals.length - 1].kind);
      this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'awaiting-approval' });
    })();
  }

  async send(): Promise<void> {
    /* demo ignores extra input */
  }

  async respondApproval(threadId: string, _requestId: string, approve: boolean): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    if (approve) {
      this.emit({ type: 'diff', threadId, agentId: this.agentId, diffId: 'demo-diff-1', path: 'demo/result.txt', patch: '+1\n+binary: true\n', state: 'updated' });
    }
    this.emit({ type: 'turn.end', threadId, agentId: this.agentId, turnId: thread.turnId, status: 'ok' });
    this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'idle' });
  }

  async close(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  async teardown(): Promise<void> {
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    this.threads.clear();
  }
}

function opts(thread: DemoThread): string {
  void thread;
  return SCRIPT;
}