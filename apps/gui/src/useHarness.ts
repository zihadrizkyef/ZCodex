import { useEffect, useReducer, useRef, useCallback } from 'react';
import type { NeutralEvent, ClientCommand, AgentId, ThreadId } from '@zcodex/core';

export type ItemKind = 'text' | 'tool' | 'diff' | 'error';
export interface MsgItem {
  id: string;
  kind: ItemKind;
  text?: string;
  tool?: string;
  path?: string;
  patch?: string;
  agentId: AgentId;
  done?: boolean;
}
export interface ThreadView {
  threadId: ThreadId;
  agentId: AgentId;
  label: string;
  title?: string;
  phase: 'starting' | 'working' | 'idle' | 'awaiting-approval';
  items: MsgItem[];
  pendingApproval?: NeutralEvent & { type: 'approval.request' };
  lastError?: string;
}
export interface AgentView {
  agentId: AgentId;
  label: string;
  available: boolean;
}
export interface HarnessState {
  connected: boolean;
  agents: AgentView[];
  threads: Record<ThreadId, ThreadView>;
  threadOrder: ThreadId[];
}

type Action =
  | { type: 'conn'; connected: boolean }
  | { type: 'agents'; agents: AgentView[] }
  | { type: 'evt'; e: NeutralEvent };

function blankThread(e: NeutralEvent & { threadId: string; agentId: AgentId }): ThreadView {
  return {
    threadId: e.threadId,
    agentId: e.agentId,
    label: e.agentId,
    phase: 'starting',
    items: [],
  };
}

function upsertThread(state: HarnessState, e: NeutralEvent & { threadId: string; agentId: AgentId }): ThreadView {
  let t = state.threads[e.threadId];
  if (!t) {
    t = blankThread(e);
  }
  return t;
}

function openTextItem(t: ThreadView, id: string): MsgItem {
  let it = t.items.find((i) => i.id === id && i.kind === 'text');
  if (!it) {
    it = { id, kind: 'text', text: '', agentId: t.agentId };
    t.items = [...t.items, it];
  }
  return it;
}

function reducer(state: HarnessState, action: Action): HarnessState {
  switch (action.type) {
    case 'conn':
      return { ...state, connected: action.connected };
    case 'agents':
      return { ...state, agents: action.agents, threads: indexAgents(state.threads, action.agents) };
    case 'evt': {
      const e = action.e;
      const we = e as NeutralEvent & { threadId: string; agentId: string };
      if (typeof we.threadId !== 'string') return state;
      const t = state.threads[we.threadId] ?? blankThread(we);
      const label = state.agents.find((a) => a.agentId === we.agentId)?.label ?? we.agentId;
      const nt: ThreadView = { ...t, label: label || t.label, items: [...t.items] };
      const id = we.threadId;
      switch (e.type) {
        case 'thread.started':
          nt.title = e.title;
          nt.phase = 'starting';
          break;
        case 'status':
          nt.phase = e.phase;
          break;
        case 'text.delta': {
          const it = openTextItem(nt, e.itemId);
          it.text = (it.text ?? '') + e.delta;
          it.agentId = e.agentId;
          it.done = false;
          break;
        }
        case 'text.completed': {
          const it = openTextItem(nt, e.itemId);
          it.text = e.text;
          it.done = true;
          break;
        }
        case 'tool.call': {
          if (e.state === 'end') {
            const idx = nt.items.findIndex((i) => i.kind === 'tool' && i.id === e.callId);
            if (idx >= 0) nt.items[idx] = { ...nt.items[idx], done: true };
          } else {
            nt.items.push({ id: e.callId, kind: 'tool', tool: e.tool, agentId: e.agentId });
          }
          break;
        }
        case 'diff':
          nt.items.push({ id: e.diffId, kind: 'diff', path: e.path, patch: e.patch, agentId: e.agentId, done: true });
          break;
        case 'approval.request':
          nt.pendingApproval = e as NeutralEvent & { type: 'approval.request' };
          nt.phase = 'awaiting-approval';
          break;
        case 'turn.end': {
          nt.phase = 'idle';
          if (e.error) nt.lastError = e.error;
          break;
        }
        case 'error':
          nt.lastError = e.message;
          break;
      }
      return {
        ...state,
        threads: { ...state.threads, [id]: nt },
        threadOrder: state.threadOrder.includes(id) ? state.threadOrder : [...state.threadOrder, id],
      };
    }
    default:
      return state;
  }
}

function indexAgents(threads: Record<ThreadId, ThreadView>, agents: AgentView[]): Record<ThreadId, ThreadView> {
  const labels = new Map(agents.map((a) => [a.agentId, a.label]));
  const out: Record<ThreadId, ThreadView> = {};
  for (const [id, t] of Object.entries(threads)) {
    out[id] = labels.has(t.agentId) ? { ...t, label: labels.get(t.agentId)! } : t;
  }
  return out;
}

const WS_URL = 'ws://127.0.0.1:4123';

export function useHarness() {
  const [state, dispatch] = useReducer(reducer, {
    connected: false,
    agents: [],
    threads: {},
    threadOrder: [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const cmd = useCallback((c: ClientCommand) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(c));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => dispatch({ type: 'conn', connected: true });
    ws.onclose = () => dispatch({ type: 'conn', connected: false });
    ws.onerror = () => dispatch({ type: 'conn', connected: false });
    ws.onmessage = (ev) => {
      let f: { kind: string; event?: NeutralEvent };
      try {
        f = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (f.kind !== 'event' || !f.event) return;
      // agent.list has no threadId — route it to the dedicated agents action, not the event path.
      if (f.event.type === 'agent.list') {
        dispatch({ type: 'agents', agents: (f.event as { agents: AgentView[] }).agents });
        return;
      }
      dispatch({ type: 'evt', e: f.event });
    };
    return () => ws.close();
  }, []);

  return { state, cmd };
}