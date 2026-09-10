import { ArrowRight, ChevronDown, ChevronRight, FileDiff, Folder, ShieldQuestion, SquareTerminal } from "lucide-react";
import type { ApprovalView, ChangeView, ItemView } from "@zcodex/contracts";
import { useState } from "react";
import { useStore } from "../store";

function StatusTag({ status }: { status: string }): React.ReactElement {
  const failed = status === "failed" || status === "declined";
  return <span className={`tag${failed ? " failed" : ""}`}>{status}</span>;
}

function DiffView({ diff }: { diff: string }): React.ReactElement {
  const lines = diff.split("\n");
  return (
    <div className="diff-view">
      {lines.map((line, index) => {
        const cls = line.startsWith("+") && !line.startsWith("+++")
          ? "add"
          : line.startsWith("-") && !line.startsWith("---")
            ? "del"
            : line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")
              ? "meta"
              : "";
        return (
          <div key={index} className={`diff-line ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

function ChangeList({ changes }: { changes: ChangeView[] }): React.ReactElement {
  const [openPath, setOpenPath] = useState<string | null>(null);
  return (
    <div className="file-list">
      {changes.map((change) => (
        <div key={change.path}>
          <button
            type="button"
            className="file-row"
            style={{ width: "100%", textAlign: "left" }}
            onClick={() => setOpenPath(openPath === change.path ? null : change.path)}
          >
            {openPath === change.path ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="path" title={change.path}>
              {change.path}
            </span>
            <span className="badge">{change.kind}</span>
          </button>
          {openPath === change.path ? <DiffView diff={change.diff} /> : null}
        </div>
      ))}
    </div>
  );
}

export function ItemCard({ item }: { item: ItemView }): React.ReactElement | null {
  switch (item.kind) {
    case "user":
      return <div className="item-user">{item.text}</div>;
    case "agent":
      return <div className="item-agent">{item.text}</div>;
    case "reasoning":
      return item.text ? <div className="item-reasoning">{item.text}</div> : null;
    case "plan":
      return (
        <div className="item-plan">
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Plan</div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{item.text}</div>
        </div>
      );
    case "command":
      return (
        <div className="item-card">
          <div className="item-card-head">
            <SquareTerminal size={13} />
            <span className="cmd" title={item.command}>
              {item.command || "command"}
            </span>
            {item.exitCode !== null ? <span className="badge">exit {item.exitCode}</span> : null}
            <StatusTag status={item.status} />
          </div>
          {item.output ? <pre>{item.output}</pre> : null}
        </div>
      );
    case "fileChange":
      return (
        <div className="item-card">
          <div className="item-card-head">
            <FileDiff size={13} />
            <span className="cmd">{item.changes.length} file berubah</span>
            <StatusTag status={item.status} />
          </div>
          <ChangeList changes={item.changes} />
        </div>
      );
    case "mcp":
      return (
        <div className="item-card">
          <div className="item-card-head">
            <ArrowRight size={13} />
            <span className="cmd">
              {item.server} · {item.tool}
            </span>
            <StatusTag status={item.status} />
          </div>
          {item.error ? <pre>{item.error}</pre> : null}
        </div>
      );
    case "tool":
      return (
        <div className="item-card">
          <div className="item-card-head">
            <Folder size={13} />
            <span className="cmd">{item.label}</span>
            {item.status ? <StatusTag status={item.status} /> : null}
          </div>
          {item.detail ? <pre>{item.detail}</pre> : null}
        </div>
      );
    case "notice":
      return <div className={`notice ${item.level}`}>{item.text}</div>;
    default:
      return null;
  }
}

export function ApprovalCard({ approval }: { approval: ApprovalView }): React.ReactElement {
  const answer = useStore((s) => s.answerApproval);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const isQuestion = approval.kind === "userInput" && approval.questions.length > 0;

  return (
    <div className="approval">
      <div className="head">
        <ShieldQuestion size={14} />
        {approval.title}
      </div>
      {approval.detail ? <div className="detail">{approval.detail}</div> : null}
      {approval.command ? <div className="cmd">{approval.command}</div> : null}
      {approval.cwd ? <div className="detail">cwd: {approval.cwd}</div> : null}
      {isQuestion ? (
        <div className="approval-input">
          {approval.questions.map((question) => (
            <div key={question.id}>
              <label htmlFor={`q-${question.id}`}>{question.header || question.question}</label>
              <input
                id={`q-${question.id}`}
                value={inputs[question.id] ?? ""}
                placeholder={question.options.map((o) => o.label).join(" / ") || question.question}
                onChange={(e) => setInputs({ ...inputs, [question.id]: e.target.value })}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="row">
        {isQuestion ? (
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              void answer(
                approval,
                "accept",
                Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value ? [value] : []])),
              )
            }
          >
            Kirim jawaban
          </button>
        ) : (
          <>
            <button type="button" className="btn primary" onClick={() => void answer(approval, "accept")}>
              Izinkan sekali
            </button>
            <button type="button" className="btn ghost" onClick={() => void answer(approval, "acceptForSession")}>
              Izinkan sesi ini
            </button>
          </>
        )}
        <span className="spacer" />
        <button type="button" className="btn danger" onClick={() => void answer(approval, "decline")}>
          {isQuestion ? "Lewati" : "Tolak"}
        </button>
      </div>
    </div>
  );
}
