import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useStore } from "../store";
import { ApprovalCard, ItemCard } from "./ItemCard";
import { Composer } from "./Composer";
import { relativeTime } from "../lib/format";

export function ThreadView(): React.ReactElement {
  const thread = useStore((s) => s.thread);
  const rateLimit = useStore((s) => s.rateLimit);
  const models = useStore((s) => s.models);
  const selectedModel = useStore((s) => s.selectedModel);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastCount = useRef(0);

  const itemCount = thread?.items.length ?? 0;

  useEffect(() => {
    // Keep the newest content in view while streaming, without fighting manual scrolling.
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (itemCount !== lastCount.current && nearBottom) el.scrollTop = el.scrollHeight;
    lastCount.current = itemCount;
  }, [itemCount]);

  if (!thread) {
    return (
      <>
        <div className="scroll-area">
          <div className="empty">
            <div style={{ color: "var(--text-faint)" }}>Memuat chat…</div>
          </div>
        </div>
      </>
    );
  }

  const model = models.find((m) => m.id === selectedModel);
  const usage = thread.usage;
  const contextWindow = usage?.modelContextWindow ?? null;

  return (
    <>
      <div className="scroll-area" ref={scrollRef}>
        <div className="thread-head">
          <div className="thread-title">{thread.title ?? "Chat baru"}</div>
          <div className="thread-meta">
            <span>{thread.cwd}</span>
            {model ? <span>· {model.name}</span> : null}
            {usage ? <span>· {usage.totalTokens.toLocaleString("id-ID")} token</span> : null}
            {contextWindow ? <span>· window {Math.round(contextWindow / 1000)}k</span> : null}
            {thread.phase === "awaiting-approval" ? <span>· butuh izinmu</span> : null}
            <span>· {relativeTime(thread.lastActivityAt / 1000)}</span>
          </div>
        </div>

        <div className="thread-items">
          {thread.items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
          {thread.phase === "working" ? (
            <div className="working">
              <span className="dot" />
              Codex sedang bekerja…
              {usage?.outputTokens ? <span style={{ color: "var(--text-faint)" }}>({usage.outputTokens} token output)</span> : null}
            </div>
          ) : null}
          {thread.phase === "idle" && itemCount > 0 ? (
            <div className="working" style={{ color: "var(--text-faint)" }}>
              <CheckCircle2 size={13} /> Selesai
            </div>
          ) : null}
        </div>
      </div>

      {thread.approvals.length > 0 ? (
        <div className="composer-wrap" style={{ paddingBottom: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
            {thread.approvals.map((approval) => (
              <ApprovalCard key={String(approval.requestId)} approval={approval} />
            ))}
          </div>
        </div>
      ) : null}

      {rateLimit && rateLimit.usedPercent >= 80 ? (
        <div className="composer-wrap" style={{ paddingBottom: 0 }}>
          <div className="banner warn" style={{ margin: "0 0 8px" }}>
            <AlertTriangle size={14} />
            Kuota Codex terpakai {rateLimit.usedPercent}% ({rateLimit.planType ?? "?"} plan). Sisa window{" "}
            {rateLimit.windowDurationMins ? `${Math.round(rateLimit.windowDurationMins / 60)} jam` : "?"}.
          </div>
        </div>
      ) : null}

      <Composer />
    </>
  );
}

export { RefreshCw };
