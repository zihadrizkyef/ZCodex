import { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventBus, NeutralEvent, EngineConnector, spawnCli } from '@zcodex/core';

export interface ClaudeConnectorOptions {
  label?: string;
  /** Extra argv appended to the claude invocation (e.g. --permission-mode). */
  extraArgs?: string[];
  /** Keep partial token deltas as text.delta (needs --include-partial-messages). */
  streamDeltas?: boolean;
}

interface ClaudeThread {
  proc: ChildProcess;
  lines: ReturnType<typeof createInterface>;
  sessionId: string;
  lastAssistantId: string | null;
  turnId: string;
}

/** Status lines we care about for the neutral `status` event. */
const WORKING_SUBTYPES = new Set(['status', 'api_retry', 'auth', 'safety']);

/**
 * Claude Code connector.
 *
 * Spawns `claude -p --input-format stream-json --output-format stream-json` per thread and maps the
 * newline-delimited JSONL stream onto the neutral event bus. Verified against claude 2.1.126:
 *   - system (subtype init | status | api_retry | ...)
 *   - assistant { message.content[] }   (full message)
 *   - result { subtype: 'success', is_error, result, num_turns }  -> turn end
 */
export class ClaudeConnector implements EngineConnector {
  readonly agentId = 'claude';
  readonly label: string;
  private readonly streamDeltas: boolean;
  private readonly extraArgs: string[];
  private readonly bus: EventBus;
  private readonly threads = new Map<string, ClaudeThread>();

  constructor(bus: EventBus, opts: ClaudeConnectorOptions = {}) {
    this.bus = bus;
    this.label = opts.label ?? 'Claude';
    this.streamDeltas = opts.streamDeltas ?? false;
    this.extraArgs = opts.extraArgs ?? [];
  }

  private emit(event: NeutralEvent): void {
    this.bus.emit(event);
  }

  async available(): Promise<{ ok: boolean; detail?: string }> {
    const r = spawnCli('claude', ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const version = await new Promise<string>((resolve) => {
      let out = '';
      r.stdout?.on('data', (d) => (out += d));
      r.on('close', () => resolve(out.trim()));
      r.on('error', () => resolve(''));
    });
    return version ? { ok: true, detail: version } : { ok: false, detail: 'claude CLI not found on PATH' };
  }

  async startThread(
    cwd: string,
    opts?: { title?: string; prompt?: string },
  ): Promise<{ threadId: string }> {
    const threadId = `claude-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-hook-events',
      '--permission-mode', 'dontAsk',
      '--verbose',
    ];
    if (this.streamDeltas) args.push('--include-partial-messages');
    if (this.extraArgs.length) args.push(...this.extraArgs);
    const proc = spawnCli('claude', args, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: proc.stdout! });
    const thread: ClaudeThread = {
      proc,
      lines,
      sessionId: '',
      lastAssistantId: null,
      turnId: `turn-${threadId}`,
    };

    this.emit({ type: 'thread.started', threadId, agentId: this.agentId, label: this.label, title: opts?.title });
    this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'starting', detail: 'spawning claude' });

    proc.on('error', (err) => {
      this.emit({ type: 'error', agentId: this.agentId, threadId, message: `claude spawn failed: ${err.message}`, fatal: true });
    });

    proc.stderr?.on('data', (d) => {
      const s = d.toString().trim();
      if (s) this.emit({ type: 'error', agentId: this.agentId, threadId, message: s.slice(0, 300) });
    });

    lines.on('line', (line) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit({ type: 'error', agentId: this.agentId, threadId, message: `unparseable claude line: ${line.slice(0, 120)}` });
        return;
      }
      this.handleMessage(thread, msg);
    });

    // Send the init frame to start stream-json input mode.
        const write = (o: unknown) => proc.stdin!.write(JSON.stringify(o) + '\n');
        proc.stdin!.on('error', () => {/* closed */});
    write({ type: 'init', session_id: null, verbose: true });
    this.threads.set(threadId, thread);

    if (opts?.prompt) {
      // Give the session a beat to boot before streaming the first user message.
      await new Promise((r) => setTimeout(r, 250));
      await this.send(threadId, opts.prompt);
    }

    return { threadId };
  }

  async send(threadId: string, text: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`no such thread ${threadId}`);
    this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'working' });
    thread.proc.stdin!.write(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
      }) + '\n',
    );
  }

  private handleMessage(thread: ClaudeThread, msg: Record<string, unknown>): void {
    const type = msg['type'];
    const threadId = this.threadIdFor(thread);
    if (type === 'system') {
      const subtype = msg['subtype'];
      const sid = msg['session_id'];
      if (sid) thread.sessionId = String(sid);
      if (subtype === 'init') {
        this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'starting', detail: 'claude session ready' });
      } else if (subtype === 'status' && msg['status'] === 'requesting') {
        this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'working' });
      } else if (WORKING_SUBTYPES.has(String(subtype))) {
        this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'working', detail: String(subtype) });
      }
      return;
    }

    if (type === 'assistant') {
      const message = msg['message'] as Record<string, unknown> | undefined;
      const content = (message?.content ?? []) as Array<Record<string, unknown>>;
      const text = content.filter((c) => c['type'] === 'text').map((c) => c['text'] ?? '').join('');
      const id = String(message?.id ?? '');
      // Tool calls: claude emits tool_use blocks in content; surface as a tool.call start.
      const toolUse = content.filter((c) => c['type'] === 'tool_use');
      if (toolUse.length) {
        for (const t of toolUse) {
          this.emit({
            type: 'tool.call',
            threadId,
            agentId: this.agentId,
            callId: String(t['id'] ?? id),
            tool: String(t['name'] ?? 'tool'),
            state: 'start',
          });
        }
      }
      if (text) {
        this.emit({ type: 'text.completed', threadId, agentId: this.agentId, turnId: thread.turnId, itemId: id, text });
      }
      if (msg['error']) {
        this.emit({ type: 'error', agentId: this.agentId, threadId, message: String(msg['error']) });
      }
      if (message?.stop_reason) {
        thread.lastAssistantId = id;
      }
      return;
    }

    if (type === 'result') {
      const isError = Boolean(msg['is_error']);
      const status = isError ? 'failed' : 'ok';
      this.emit({
        type: 'turn.end',
        threadId,
        agentId: this.agentId,
        turnId: thread.turnId,
        status,
        error: isError ? String(msg['result'] ?? msg['error'] ?? '') : undefined,
      });
      this.emit({ type: 'status', threadId, agentId: this.agentId, phase: 'idle' });
      // Claude -p stays open awaiting the next user message; keep the process for thread.send.
      return;
    }
  }

  private threadIdFor(thread: ClaudeThread): string {
    for (const [id, t] of this.threads) if (t === thread) return id;
    return 'unknown';
  }

  async respondApproval(): Promise<void> {
    // Claude permission handling is not surfaced through this thin connector yet
    // (uses --permission-mode dontAsk). Kept as a no-op so the interface is uniform.
  }

  async close(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    try {
      thread.proc.stdin!.write(JSON.stringify({ type: 'close', session_id: thread.sessionId }) + '\n');
    } catch { /* ignore */ }
    thread.proc.kill();
    this.threads.delete(threadId);
  }

  async teardown(): Promise<void> {
    for (const id of [...this.threads.keys()]) await this.close(id);
  }
}