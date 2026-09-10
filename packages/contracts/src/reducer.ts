import type {
  ServerNotification,
  ServerRequest,
  Thread,
  ThreadItem,
  Turn,
  TurnPlanStep,
} from "@zcodex/codex-protocol";
import type {
  ApprovalView,
  ChangeView,
  ItemView,
  PlanStepView,
  ProjectView,
  ThreadState,
  ThreadSummary,
  TokenUsageView,
} from "./view";

/* --------------------------------------------------------------- conversions */

function changesOf(changes: Array<{ path: string; kind: { type: string; move_path?: string | null }; diff: string }>): ChangeView[] {
  return changes.map((c) => ({
    path: c.path,
    kind: (c.kind?.type ?? "update") as ChangeView["kind"],
    movePath: c.kind?.move_path ?? null,
    diff: c.diff ?? "",
  }));
}

function planOf(plan: TurnPlanStep[]): PlanStepView[] {
  return plan.map((s) => ({ step: s.step, status: s.status }));
}

/** Map one protocol thread item onto the flat view model the UI renders. */
export function toItemView(item: ThreadItem): ItemView {
  switch (item.type) {
    case "userMessage": {
      const texts: string[] = [];
      const images: string[] = [];
      for (const part of item.content ?? []) {
        if (part.type === "text") texts.push(part.text);
        else if (part.type === "image") images.push(part.url);
        else if (part.type === "localImage") images.push(`file://${part.path}`);
      }
      return { kind: "user", id: item.id, text: texts.join("\n"), images };
    }
    case "agentMessage":
      return { kind: "agent", id: item.id, text: item.text ?? "", streaming: false };
    case "reasoning":
      return {
        kind: "reasoning",
        id: item.id,
        text: [...(item.summary ?? []), ...(item.content ?? [])].filter(Boolean).join("\n\n"),
        streaming: false,
      };
    case "plan":
      return { kind: "plan", id: item.id, text: item.text ?? "", streaming: false };
    case "commandExecution":
      return {
        kind: "command",
        id: item.id,
        command: item.command ?? "",
        cwd: item.cwd ?? "",
        status: item.status ?? "inProgress",
        output: item.aggregatedOutput ?? "",
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
        streaming: item.status === "inProgress",
      };
    case "fileChange":
      return {
        kind: "fileChange",
        id: item.id,
        status: item.status ?? "inProgress",
        changes: changesOf(item.changes ?? []),
      };
    case "mcpToolCall":
      return {
        kind: "mcp",
        id: item.id,
        server: item.server,
        tool: item.tool,
        status: item.status ?? "inProgress",
        error: item.error ? String(item.error.message ?? item.error) : null,
        streaming: item.status === "inProgress",
      };
    case "dynamicToolCall":
      return {
        kind: "tool",
        id: item.id,
        label: [item.namespace, item.tool].filter(Boolean).join("."),
        detail: "",
        status: item.status ?? "",
        streaming: item.status === "inProgress",
      };
    case "webSearch":
      return { kind: "tool", id: item.id, label: "web_search", detail: "", status: "completed", streaming: false };
    case "imageGeneration":
    case "imageView":
      return { kind: "tool", id: item.id, label: item.type, detail: "", status: "completed", streaming: false };
    case "hookPrompt":
      return { kind: "tool", id: item.id, label: "hook", detail: "", status: "completed", streaming: false };
    case "functionCallOutput":
      return {
        kind: "tool",
        id: item.id,
        label: [item.namespace, item.name].filter(Boolean).join("."),
        detail: typeof item.output === "string" ? item.output : "",
        status: "completed",
        streaming: false,
      };
    default:
      // Unknown/newer item kind: keep it visible instead of silently dropping it.
      return {
        kind: "tool",
        id: (item as { id: string }).id,
        label: (item as { type: string }).type,
        detail: "",
        status: "completed",
        streaming: false,
      };
  }
}

export function threadToSummary(thread: Thread, projectId: string | null = null): ThreadSummary {
  return {
    id: thread.id,
    name: thread.name ?? null,
    preview: thread.preview ?? "",
    cwd: thread.cwd ?? "",
    projectId: thread.projectId ?? projectId,
    createdAt: thread.createdAt ?? 0,
    updatedAt: thread.updatedAt ?? 0,
    model: thread.model ?? null,
    source: typeof thread.source === "string" ? thread.source : (thread.source as { type?: string })?.type ?? "unknown",
    status: (thread.status?.type ?? "idle") as ThreadSummary["status"],
  };
}

/** Build a thread state from a `thread/read`-style payload (full turn history). */
export function hydrateThread(thread: Thread): ThreadState {
  const items: ItemView[] = [];
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) items.push(toItemView(item));
  }
  const lastTurn = (thread.turns ?? [])[thread.turns.length - 1];
  const statusType = thread.status?.type ?? "idle";
  let error: string | null = null;
  if (lastTurn?.status === "failed" && lastTurn.error) error = lastTurn.error.message;
  return {
    threadId: thread.id,
    title: thread.name ?? null,
    cwd: thread.cwd ?? "",
    phase: statusType === "systemError" ? "error" : statusType === "active" ? "working" : "idle",
    items,
    activeTurnId: lastTurn?.status === "inProgress" ? lastTurn.id : null,
    plan: [],
    planExplanation: null,
    diff: "",
    approvals: [],
    usage: null,
    error,
    lastActivityAt: Date.now(),
  };
}

export function emptyThreadState(threadId: string, cwd: string): ThreadState {
  return {
    threadId,
    title: null,
    cwd,
    phase: "loading",
    items: [],
    activeTurnId: null,
    plan: [],
    planExplanation: null,
    diff: "",
    approvals: [],
    usage: null,
    error: null,
    lastActivityAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ approvals */

/** Turn a server-initiated request into a UI approval card. */
export function approvalFromRequest(request: ServerRequest): ApprovalView {
  const base = { requestId: request.id, method: request.method, createdAt: Date.now() };
  const params = request.params as Record<string, unknown>;
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval": {
      const command = ((params.command as string) || (params.command as string[])?.join?.(" ")) ?? null;
      return {
        ...base,
        kind: "command",
        title: "Izinkan menjalankan perintah?",
        detail: (params.reason as string) ?? "",
        command: Array.isArray(command) ? command.join(" ") : command,
        cwd: (params.cwd as string) ?? null,
        reason: (params.reason as string) ?? null,
        questions: [],
      };
    }
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return {
        ...base,
        kind: "fileChange",
        title: "Izinkan mengubah file?",
        detail: (params.reason as string) ?? (params.grantRoot as string) ?? "",
        command: null,
        cwd: (params.grantRoot as string) ?? null,
        reason: (params.reason as string) ?? null,
        questions: [],
      };
    case "item/permissions/requestApproval":
      return {
        ...base,
        kind: "permissions",
        title: "Minta izin tambahan?",
        detail: (params.reason as string) ?? "",
        command: null,
        cwd: (params.cwd as string) ?? null,
        reason: (params.reason as string) ?? null,
        questions: [],
      };
    case "item/tool/requestUserInput": {
      const questions = ((params.questions as Array<Record<string, unknown>>) ?? []).map((q) => ({
        id: String(q.id ?? ""),
        header: String(q.header ?? ""),
        question: String(q.question ?? ""),
        options: ((q.options as Array<Record<string, unknown>>) ?? []).map((o) => ({
          label: String(o.label ?? ""),
          description: String(o.description ?? ""),
        })),
      }));
      return {
        ...base,
        kind: "userInput",
        title: "Codex butuh jawabanmu",
        detail: "",
        command: null,
        cwd: null,
        reason: null,
        questions,
      };
    }
    default:
      return {
        ...base,
        kind: "other",
        title: request.method,
        detail: JSON.stringify(request.params ?? {}).slice(0, 500),
        command: null,
        cwd: null,
        reason: null,
        questions: [],
      };
  }
}

/* --------------------------------------------------------------------- reducer */

function upsert(items: ItemView[], view: ItemView): ItemView[] {
  const i = items.findIndex((x) => x.id === view.id);
  if (i === -1) return [...items, view];
  const next = items.slice();
  next[i] = view;
  return next;
}

function patch(items: ItemView[], id: string, patchFn: (view: ItemView) => ItemView, fallback: () => ItemView): ItemView[] {
  const i = items.findIndex((x) => x.id === id);
  if (i === -1) return [...items, patchFn(fallback())];
  const next = items.slice();
  next[i] = patchFn(next[i]);
  return next;
}

function appendText(view: ItemView, chunk: string): ItemView {
  if (view.kind === "agent" || view.kind === "reasoning" || view.kind === "plan") {
    return { ...view, text: view.text + chunk, streaming: true };
  }
  if (view.kind === "command") {
    return { ...view, output: view.output + chunk };
  }
  return view;
}

function now(): number {
  return Date.now();
}

/**
 * Apply one app-server notification to a thread state. Pure: returns a new state or the same
 * object when the notification does not concern the loaded thread.
 */
export function applyNotification(state: ThreadState, notification: ServerNotification): ThreadState {
  const p = (notification.params ?? {}) as Record<string, any>;
  const forOtherThread = p?.threadId && p.threadId !== state.threadId;
  switch (notification.method) {
    case "item/started": {
      if (forOtherThread) return state;
      const item = p?.item as ThreadItem | undefined;
      if (!item) return state;
      const view = toItemView(item);
      // The user's own message comes back from the server too — drop the optimistic copy.
      const deduped =
        view.kind === "user"
          ? state.items.filter((x) => !(x.kind === "user" && x.id.startsWith("local-") && x.text === view.text))
          : state.items;
      return { ...state, items: upsert(deduped, view), lastActivityAt: now() };
    }
    case "item/completed": {
      if (forOtherThread) return state;
      const item = p?.item as ThreadItem | undefined;
      if (!item) return state;
      return { ...state, items: upsert(state.items, toItemView(item)), lastActivityAt: now() };
    }
    case "item/agentMessage/delta":
      if (forOtherThread) return state;
      return {
        ...state,
        items: patch(
          state.items,
          p.itemId,
          (v) => appendText(v, p.delta ?? ""),
          () => ({ kind: "agent", id: p.itemId, text: "", streaming: true }),
        ),
        lastActivityAt: now(),
      };
    case "item/plan/delta":
      if (forOtherThread) return state;
      return {
        ...state,
        items: patch(
          state.items,
          p.itemId,
          (v) => appendText(v, p.delta ?? ""),
          () => ({ kind: "plan", id: p.itemId, text: "", streaming: true }),
        ),
        lastActivityAt: now(),
      };
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
      if (forOtherThread) return state;
      return {
        ...state,
        items: patch(
          state.items,
          p.itemId,
          (v) => appendText(v, p.delta ?? ""),
          () => ({ kind: "reasoning", id: p.itemId, text: "", streaming: true }),
        ),
        lastActivityAt: now(),
      };
    case "item/commandExecution/outputDelta":
      if (forOtherThread) return state;
      return {
        ...state,
        items: patch(
          state.items,
          p.itemId,
          (v) => appendText(v, p.delta ?? ""),
          () => ({
            kind: "command",
            id: p.itemId,
            command: "",
            cwd: "",
            status: "inProgress",
            output: "",
            exitCode: null,
            durationMs: null,
            streaming: true,
          }),
        ),
        lastActivityAt: now(),
      };
    case "item/fileChange/patchUpdated":
      if (forOtherThread) return state;
      return {
        ...state,
        items: patch(
          state.items,
          p.itemId,
          (v) => (v.kind === "fileChange" ? { ...v, changes: changesOf(p.changes ?? []) } : v),
          () => ({ kind: "fileChange", id: p.itemId, status: "inProgress", changes: changesOf(p.changes ?? []) }),
        ),
        lastActivityAt: now(),
      };
    case "item/mcpToolCall/progress":
      if (forOtherThread) return state;
      return { ...state, lastActivityAt: now() };
    case "turn/started":
      if (forOtherThread) return state;
      return { ...state, phase: "working", activeTurnId: p?.turn?.id ?? null, lastActivityAt: now() };
    case "turn/completed": {
      if (forOtherThread) return state;
      const turn = p?.turn as Turn | undefined;
      const items = [...state.items];
      // The completed turn is authoritative for its items: replace stale streaming copies.
      for (const item of turn?.items ?? []) {
        const view = toItemView(item);
        const i = items.findIndex((x) => x.id === view.id);
        if (i === -1) items.push(view);
        else items[i] = view;
      }
      const failed = turn?.status === "failed";
      return {
        ...state,
        items,
        activeTurnId: null,
        phase: failed ? "error" : "idle",
        error: failed ? (turn?.error?.message ?? "Turn gagal") : null,
        lastActivityAt: now(),
      };
    }
    case "turn/diff/updated":
      if (forOtherThread) return state;
      return { ...state, diff: p?.diff ?? "", lastActivityAt: now() };
    case "turn/plan/updated":
      if (forOtherThread) return state;
      return {
        ...state,
        plan: planOf((p?.plan ?? []) as TurnPlanStep[]),
        planExplanation: p?.explanation ?? null,
        lastActivityAt: now(),
      };
    case "thread/status/changed": {
      if (forOtherThread) return state;
      const type = p?.status?.type ?? "idle";
      const phase = type === "active" ? (state.phase === "awaiting-approval" ? "awaiting-approval" : "working") : type === "systemError" ? "error" : "idle";
      return { ...state, phase, lastActivityAt: now() };
    }
    case "thread/name/updated": {
      if (forOtherThread) return state;
      const name = p?.name ?? p?.title ?? null;
      return { ...state, title: name ?? state.title, lastActivityAt: now() };
    }
    case "thread/tokenUsage/updated": {
      if (forOtherThread) return state;
      const tu = p?.tokenUsage;
      if (!tu) return state;
      const usage: TokenUsageView = {
        totalTokens: tu.total?.totalTokens ?? 0,
        inputTokens: tu.total?.inputTokens ?? 0,
        cachedInputTokens: tu.total?.cachedInputTokens ?? 0,
        outputTokens: tu.total?.outputTokens ?? 0,
        reasoningOutputTokens: tu.total?.reasoningOutputTokens ?? 0,
        modelContextWindow: tu.modelContextWindow ?? null,
      };
      return { ...state, usage, lastActivityAt: now() };
    }
    case "error": {
      if (forOtherThread) return state;
      const message = p?.error?.message ?? "Terjadi error";
      return {
        ...state,
        error: message,
        phase: "error",
        items: [
          ...state.items,
          { kind: "notice", id: `err-${now()}-${state.items.length}`, level: "error", text: message },
        ],
        lastActivityAt: now(),
      };
    }
    case "warning": {
      const message = p?.message ?? "";
      if (forOtherThread || !message) return state;
      return {
        ...state,
        items: [
          ...state.items,
          { kind: "notice", id: `warn-${now()}-${state.items.length}`, level: "warning", text: message },
        ],
        lastActivityAt: now(),
      };
    }
    case "serverRequest/resolved":
      if (forOtherThread) return state;
      return { ...state, approvals: state.approvals.filter((a) => String(a.requestId) !== String(p?.requestId)) };
    default:
      return state;
  }
}

export function addApproval(state: ThreadState, approval: ApprovalView): ThreadState {
  if (state.approvals.some((a) => String(a.requestId) === String(approval.requestId))) return state;
  return {
    ...state,
    approvals: [...state.approvals, approval],
    phase: "awaiting-approval",
    lastActivityAt: now(),
  };
}

export function removeApproval(state: ThreadState, requestId: string | number): ThreadState {
  return {
    ...state,
    approvals: state.approvals.filter((a) => String(a.requestId) !== String(requestId)),
    phase: state.approvals.length > 1 ? "awaiting-approval" : "working",
  };
}

export function appendUserMessage(state: ThreadState, itemId: string, text: string): ThreadState {
  return {
    ...state,
    items: upsert(state.items, { kind: "user", id: itemId, text, images: [] }),
    phase: "working",
    lastActivityAt: now(),
  };
}

/* -------------------------------------------------------------- project helpers */

/** Which project (if any) owns a thread, by workspace-root containment. */
export function projectIdForCwd(
  cwd: string,
  projects: ProjectView[],
  hints: Record<string, string> = {},
): string | null {
  const normalize = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  const target = normalize(cwd);
  if (!target) return null;
  let best: { id: string; len: number } | null = null;
  for (const project of projects) {
    for (const root of project.roots) {
      const r = normalize(root);
      if (r && (target === r || target.startsWith(r + "/"))) {
        if (!best || r.length > best.len) best = { id: project.id, len: r.length };
      }
    }
  }
  if (best) return best.id;
  const normHints: Record<string, string> = {};
  for (const [cwdKey, id] of Object.entries(hints)) normHints[normalize(cwdKey)] = id;
  return normHints[target] ?? null;
}
