import { useMemo, useRef, useState } from 'react';
import { useHarness, type HarnessState, type ThreadView } from './useHarness';
import type { AgentId } from '@zcodex/core';

const DEFAULT_CWD = 'C:/Users/LENOVO';

function StatusDot({ phase }: { phase: ThreadView['phase'] }): React.ReactElement {
  const cls =
    phase === 'idle' ? 'dot idle' : phase === 'working' ? 'dot working' : phase === 'awaiting-approval' ? 'dot wait' : 'dot start';
  return <span className={cls} />;
}

function AgentItem({
  agent,
  active,
  onPickThread,
}: {
  agent: { agentId: AgentId; label: string };
  active: boolean;
  onPickThread: (id: string) => void;
}): React.ReactElement {
  return (
    <button className={active ? 'agent-item agent-item-active' : 'agent-item'} onClick={() => onPickThread(agent.agentId)}>
      <span className="agent-kbd">{agent.label.charAt(0).toUpperCase()}</span>
      <span className="agent-name">{agent.label}</span>
    </button>
  );
}

function ChatMessage({ item }: { item: ThreadView['items'][number] }): React.ReactElement {
  if (item.kind === 'tool') {
    return (
      <div className="msg tool">
        <span className="tool-tag">{item.done ? 'tool ✓' : 'tool'}</span>
        <code>{item.tool}</code>
      </div>
    );
  }
  if (item.kind === 'diff') {
    return (
      <div className="msg diff">
        <span className="tool-tag">diff</span>
        <code>{item.path ?? 'patch'}</code>
        <pre>{item.patch}</pre>
      </div>
    );
  }
  if (item.kind === 'error') {
    return <div className="msg err">{item.text}</div>;
  }
  return <div className="msg text">{item.text}</div>;
}

function ApprovalCard({ thread, onRespond }: { thread: ThreadView; onRespond: (a: boolean) => void }): React.ReactElement | null {
  const p = thread.pendingApproval;
  if (!p) return null;
  return (
    <div className="approval">
      <div className="approval-title">
        <span className="tag">{p.kind}</span>
        <span>{p.title}</span>
      </div>
      {p.command ? (
        <pre className="approval-cmd">
          <code>{p.command}</code>
        </pre>
      ) : null}
      {p.options?.length ? (
        <div className="approval-opts">
          {p.options.map((o, i) => (
            <button key={i} className="opt" onClick={() => onRespond(true)}>
              {o}
            </button>
          ))}
        </div>
      ) : null}
      <div className="approval-actions">
        <button className="btn" onClick={() => onRespond(true)}>
          Approve
        </button>
        <button className="btn ghost" onClick={() => onRespond(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

function ChatPane({ thread, onRespond, onSend }: { thread?: ThreadView; onRespond: (a: boolean) => void; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useMemo(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.items.length]);

  if (!thread) {
    return (
      <div className="empty">
        <h1 className="brand">zcodex</h1>
        <p className="empty-sub">Coding harness — one bus, many agents. Create a thread below.</p>
      </div>
    );
  }
  return (
    <div className="chat">
      <header className="chat-head">
        <div className="chat-title">
          <StatusDot phase={thread.phase} />
          <span>{thread.title ?? 'untitled'}</span>
        </div>
        <span className="chat-agent">{thread.label}</span>
        {thread.lastError ? <span className="chat-err">{thread.lastError.slice(0, 60)}</span> : null}
      </header>
      <div className="msgs" ref={scrollRef}>
        {thread.items.map((it, i) => (
          <ChatMessage key={i} item={it} />
        ))}
        {thread.phase === 'working' ? <div className="cursor" /> : null}
        <div ref={bottomRef} />
      </div>
      <ApprovalCard thread={thread} onRespond={onRespond} />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            onSend(text);
            setText('');
          }
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the agent…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) {
                onSend(text);
                setText('');
              }
            }
          }}
        />
        <button className="btn primary" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

export default function App(): React.ReactElement {
  const { state, cmd } = useHarness();
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentId | ''>('');
  const [cwd, setCwd] = useState(DEFAULT_CWD);
  const [prompt, setPrompt] = useState('');

  const threads = state.threadOrder.map((id) => state.threads[id]);
  const active = activeThread ? state.threads[activeThread] : undefined;

  const startThread = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    cmd({
      type: 'thread.start',
      agentId: agent,
      cwd: cwd || '',
      title: prompt.slice(0, 40) || undefined,
      prompt: prompt || undefined,
    });
    setPrompt('');
  };

  if (!state.agents.length) {
    return (
      <div className="boot">
        <div className="boot-card">
          <h1 className="brand">zcodex</h1>
          <p>connecting to harness server @ ws://127.0.0.1:4123 ({state.connected ? 'connected' : 'offline'})</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand-dot" />
          <span className="brand">zcodex</span>
          <span className={state.connected ? 'live' : 'live dead'}>{state.connected ? 'live' : 'off'}</span>
        </div>
        <div className="rail-section">
          <div className="rail-label">Agents</div>
          {state.agents
            .filter((a) => a.available)
            .map((a) => (
              <AgentItem key={a.agentId} agent={a} active={agent === a.agentId} onPickThread={() => setAgent(a.agentId)} />
            ))}
        </div>
        <div className="rail-section grow">
          <div className="rail-label">Threads</div>
          <div className="threads">
            {threads.map((t) => (
              <button key={t.threadId} className={activeThread === t.threadId ? 'thread thread-active' : 'thread'} onClick={() => setActiveThread(t.threadId)}>
                <StatusDot phase={t.phase} />
                <span className="thread-name">{t.title ?? 'untitled'}</span>
                <span className="thread-agent">{t.label}</span>
              </button>
            ))}
            {!threads.length ? <div className="thread-empty">no threads yet</div> : null}
          </div>
        </div>
      </aside>
      <main className="main">
        <ChatPane
          thread={active}
          onRespond={(a) => active && cmd({ type: 'approval.respond', threadId: active.threadId, requestId: active.pendingApproval!.requestId, approve: a })}
          onSend={(t) => activeThread && cmd({ type: 'thread.send', threadId: activeThread, text: t })}
        />
        <form className="launcher" onSubmit={startThread}>
          <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="agent">
            <option value="" disabled>
              agent…
            </option>
            {state.agents
              .filter((a) => a.available)
              .map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.label}
                </option>
              ))}
          </select>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="working dir" aria-label="working dir" />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="initial prompt (optional)"
            aria-label="initial prompt"
          />
          <button className="btn primary" type="submit" disabled={!agent}>
            Start
          </button>
        </form>
      </main>
    </div>
  );
}