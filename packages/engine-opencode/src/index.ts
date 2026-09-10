import { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventBus, NeutralEvent, EngineConnector, spawnCli } from '@zcodex/core';

export interface OpencodeConnectorOptions {
  label?: string;
  model?: string;
}

interface OpencodeThread {
  cwd: string;
  sessionId: string | null;
  pendingText: string;
  turnId: string;
  runEnded: boolean;
}

/**
 * OpenCode connector (MVP).
 *
 * One `opencode run -p <prompt> --format json` invocation per turn (stdout = JSONL events), mapped to
 * the neutral bus. Streaming-friendly JSON events, verified on opencode 1.18.25:
 *   - step_start { sessionID }
 *   - text       { part: { type: 'text', text } }
 *   - step_finish{ part: { reason, tokens, cost } }   -> turn end
 * Session is resumed on subsequent sends via `--session <id>`.
 * Streaming (token deltas) upgrades to `opencode acp` in a later phase.
 */
export class OpencodeConnector implements EngineConnector {
  readonly agentId = 'opencode';
  readonly label: string;
  private readonly model?: string;
  private readonly bus: EventBus;
  private readonly threads = new Map<string, OpencodeThread>();

  constructor(bus: EventBus, opts: OpencodeConnectorOptions = {}) {
    this.bus = bus;
    this.label = opts.label ?? 'OpenCode';
    this.model = opts.model;
  }

  private emit(event: NeutralEvent): void {
    this.bus.emit(event);
  }

  async available(): Promise<{ ok: boolean; detail?: string }> {
    const r = spawnCli('opencode', ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const version = await new Promise<string>((resolve) => {
      let out = '';
      r.stdout?.on('data', (d) => (out += d));
      r.on('close', () => resolve(out.trim()));
      r.on('error', () => resolve(''));
    });
    return version ? { ok: true, detail: version } : { ok: false, detail: 'opencode CLI not found on PATH' };
  }

  async startThread(
    cwd: string,
    opts?: { title?: string; prompt?: string },
  ): Promise<{ threadId: string }> {
    const threadId = `opencode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const thread: OpencodeThread = { cwd, sessionId: null, pendingText: '', turnId: `turn-${threadId}`, runEnded: true };
    this.threads.set(threadId, thread);
    this.emit({ type: 'thread.started', threadId, agentId: this.agentId, label: this.label, title: opts?.title });
    this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'idle' });
    if (opts?.prompt) {
      await this.send(threadId, opts.prompt);
    }
    return { threadId };
  }

  async send(threadId: string, text: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`no such thread ${threadId}`);

    this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'working' });
    const args = ['run', text, '--format', 'json', '--dir', thread.cwd];
    if (this.model) args.push('--model', this.model);
    if (thread.sessionId) args.push('--session', thread.sessionId);

    const proc = spawnCli('opencode', args, {
      cwd: thread.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: proc.stdout as unknown as NodeJS.ReadableStream });
    let stderrBuf = '';
    thread.pendingText = '';
    thread.runEnded = false;

    proc.stderr?.on('data', (d) => {
      stderrBuf += d.toString();
      if (stderrBuf.trim()) {
        this.emit({ type: 'error', agentId: this.agentId, threadId, message: stderrBuf.trim().slice(0, 300) });
      }
    });

    proc.on('error', (err) => {
      this.emit({ type: 'error', agentId: this.agentId, threadId, message: `opencode spawn failed: ${err.message}`, fatal: true });
    });

    lines.on('line', (line) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      this.handleEvent(thread, msg, threadId);
    });

    proc.on('close', (code) => {
      // opencode emits step_finish before exiting; only synthesize turn.end if we never saw it.
      if (!thread.runEnded) {
        this.emit({
          type: 'turn.end',
          threadId,
          agentId: this.agentId,
          turnId: thread.turnId,
          status: code === 0 ? 'ok' : 'failed',
          error: code !== 0 ? (stderrBuf.trim().slice(0, 300) || `opencode exited ${code}`) : undefined,
        });
        this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'idle' });
      }
      thread.runEnded = true;
    });
  }

  private handleEvent(thread: OpencodeThread, msg: Record<string, unknown>, threadId: string): void {
    const type = msg['type'];
    const sid = typeof msg['sessionID'] === 'string' ? msg['sessionID'] : null;
    if (sid) thread.sessionId = sid;

    if (type === 'step_start') {
      this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'working' });
      return;
    }
    if (type === 'text') {
      const t = (msg['part'] as { text?: string } | undefined)?.text ?? '';
      if (t) {
        thread.pendingText += t;
        this.emit({ type: 'text.completed', threadId, agentId: this.agentId, turnId: thread.turnId, itemId: String(Date.now()), text: t });
      }
      return;
    }
    if (type === 'step_finish') {
      const part = (msg['part'] ?? {}) as Record<string, unknown>;
      const reason = String(part['reason'] ?? '');
      const tokens = part['tokens'] as { total?: number } | undefined;
      this.emit({
        type: 'turn.end',
        threadId,
        agentId: this.agentId,
        turnId: thread.turnId,
        status: reason === 'error' ? 'failed' : 'ok',
        error: reason === 'error' ? 'opencode step failed' : undefined,
      });
      thread.runEnded = true;
      this.emit({
        type: 'status',
        threadId,
        agentId: this.agentId,
        phase: 'idle',
        detail: tokens?.total ? `tokens: ${tokens.total}` : undefined,
      });
      return;
    }
    // TODO: map tool calls (type 'tool' / 'tool_start' / 'tool_finish') and diffs (type 'file') later.
  }

  async respondApproval(): Promise<void> {
    /* one-shot MVP doesn't surface mid-run permission prompts; approval UI lands with `opencode acp`. */
  }

  async close(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  async teardown(): Promise<void> {
    this.threads.clear();
  }
}