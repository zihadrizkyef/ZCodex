/** Neutral, engine-agnostic event model. The GUI must not know which CLI produced an event. */
export type AgentId = string;
export type ThreadId = string;

interface WithThread {
  threadId: ThreadId;
  agentId: AgentId;
}

export type NeutralEvent =
  | {
      type: 'agent.list';
      agents: Array<{ agentId: AgentId; label: string; available: boolean; detail?: string }>;
    }
  | ({ type: 'thread.started' } & WithThread & { label: string; title?: string })
  | ({ type: 'text.delta' } & WithThread & { turnId: string; itemId: string; delta: string })
  | ({ type: 'text.completed' } & WithThread & { turnId: string; itemId: string; text: string })
  | ({
      type: 'tool.call';
    } & WithThread & { callId: string; tool: string; state: 'start' | 'update' | 'end'; summary?: string })
  | ({
      type: 'approval.request';
    } & WithThread & {
      requestId: string;
      kind: 'exec' | 'apply_patch' | 'user_input';
      title: string;
      command?: string;
      options?: string[];
    })
  | ({ type: 'diff' } & WithThread & { diffId: string; path?: string; patch: string; state: 'updated' })
  | ({
      type: 'turn.end';
    } & WithThread & { turnId: string; status: 'ok' | 'failed' | 'interrupted'; error?: string })
  | ({ type: 'status' } & WithThread & { phase: 'starting' | 'working' | 'idle' | 'awaiting-approval'; detail?: string })
  | ({ type: 'error'; agentId: AgentId; threadId?: ThreadId; message: string; fatal?: boolean });

/** Commands flowing GUI -> harness server. */
export type ClientCommand =
  | { type: 'agents.list' }
  | { type: 'thread.start'; agentId: AgentId; cwd: string; title?: string; prompt?: string }
  | { type: 'thread.send'; threadId: ThreadId; text: string }
  | { type: 'approval.respond'; threadId: ThreadId; requestId: string; approve: boolean; text?: string }
  | { type: 'thread.close'; threadId: ThreadId };

/** Frame envelope on the wire. */
export type ServerFrame = { kind: 'event'; event: NeutralEvent };

export const isNeutralEventType = (t: string): t is NeutralEvent['type'] =>
  [
    'agent.list',
    'thread.started',
    'text.delta',
    'text.completed',
    'tool.call',
    'approval.request',
    'diff',
    'turn.end',
    'status',
    'error',
  ].includes(t);