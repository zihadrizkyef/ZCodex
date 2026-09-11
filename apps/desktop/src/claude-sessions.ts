import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Thread, ThreadItem, Turn } from "@zcodex/codex-protocol";

/**
 * Read Claude Code's own session store (~/.claude/projects/<cwd-encoded>/*.jsonl) and present
 * those sessions as codex-shaped `Thread` objects so the rest of the app (sidebar, reducer)
 * can treat them identically to Codex threads.
 *
 * Format per session file (newline-delimited JSON, order preserved):
 *   - the first line is usually a `permission-mode` record carrying `sessionId`
 *   - `user` records carry `message.content`, `cwd`, `sessionId`, `timestamp`
 *   - `assistant` records carry `message.content: [{type:"text",text}|{type:"tool_use",...}]`
 *   - file mtime refreshes whenever the session is touched/summarized
 */
export interface ClaudeSessionFile {
  threadId: string;
  sessionId: string;
  file: string;
  cwd: string;
  preview: string;
  model: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export function isClaudeThreadId(threadId: string): boolean {
  return threadId.startsWith("claude-");
}

/** Enumerate every session Claude Code has persisted, newest first. */
export function listClaudeSessions(limit = 200): ClaudeSessionFile[] {
  const root = claudeProjectsRoot();
  if (!existsSync(root)) return [];
  const sessions: ClaudeSessionFile[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dirPath, file);
      try {
        const stat = statSync(full);
        sessions.push(scanSessionFile(full, stat.mtimeMs));
      } catch {
        /* unreadable session — skip */
      }
    }
  }
  sessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return sessions.slice(0, limit);
}

/** Read one session file's envelope (first lines are enough: it never re-orders). */
function scanSessionFile(file: string, mtimeMs: number): ClaudeSessionFile {
  const raw = readFileSync(file, "utf8");
  let sessionId = path.basename(file, ".jsonl");
  let cwd = "";
  let preview = "";
  let model: string | null = null;
  let createdAtMs = mtimeMs;
  let scanned = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    if (scanned++ > 1200) break;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!sessionId) {
      const sid = String(rec.sessionId ?? "").trim();
      if (sid) sessionId = sid;
    }
    if (!cwd) {
      const c = (rec as { cwd?: unknown }).cwd;
      if (typeof c === "string" && c) cwd = c;
    }
    if (rec.type === "user" && !preview) {
      const msg = (rec.message ?? {}) as { content?: unknown };
      const content = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content : [];
      if (typeof content === "string") {
        preview = content.trim();
      } else {
        for (const part of content as Array<Record<string, unknown>>) {
          if (typeof part?.text === "string" && part.text.trim()) {
            preview = part.text.trim();
            break;
          }
        }
      }
      // user records usually carry the session's cwd too
      if (!cwd) {
        const c = (rec as { cwd?: unknown }).cwd;
        if (typeof c === "string" && c) cwd = c;
      }
      const ts = Number(rec.timestamp);
      if (Number.isFinite(ts)) createdAtMs = new Date(ts).getTime();
    }
    if (!model) {
      const m = (rec as { model?: unknown }).model ?? (rec.message as { model?: string } | undefined)?.model;
      if (typeof m === "string" && m) model = m;
    }
    if (sessionId && cwd && preview) break;
  }
  return {
    threadId: `claude-${sessionId}`,
    sessionId,
    file,
    cwd,
    preview: preview.slice(0, 240),
    model,
    createdAtMs: createdAtMs || mtimeMs,
    updatedAtMs: mtimeMs,
  };
}

/** Find the file that owns a session id. */
function findSessionFile(threadId: string): ClaudeSessionFile | null {
  for (const s of listClaudeSessions(1000)) {
    if (s.threadId === threadId) return s;
  }
  return null;
}

/** Envelope (cwd, model…) of one session, for resuming it later. */
export function claudeSessionMeta(threadId: string): ClaudeSessionFile | null {
  if (!isClaudeThreadId(threadId)) return null;
  return findSessionFile(threadId);
}

function textPart(text: string): ThreadItem {
  return { type: "userMessage", id: `user-${simpleHash(text)}`, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Build a codex-shaped Thread from a Claude session file, for `thread/read`-style hydration. */
export function hydrateClaudeThread(threadId: string): Thread | null {
  const meta = findSessionFile(threadId);
  if (!meta) return null;
  const raw = readFileSync(meta.file, "utf8");
  const items: ThreadItem[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type === "user") {
      const msg = (rec.message ?? {}) as { content?: unknown };
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        items.push(textPart(content.trim()));
      } else if (Array.isArray(content)) {
        const text = (content as Array<Record<string, unknown>>)
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text as string)
          .join("\n")
          .trim();
        if (text) items.push(textPart(text));
      }
    } else if (rec.type === "assistant") {
      const msg = (rec.message ?? {}) as { id?: unknown; content?: Array<Record<string, unknown>> };
      const content = Array.isArray(msg.content) ? msg.content : [];
      const id = String(msg.id ?? "");
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string") {
          items.push({ type: "agentMessage", id: `agent-${sanitizeId(id)}`, text: block.text, phase: null, memoryCitation: null, delivery: null, questions: null });
        } else if (block?.type === "tool_use") {
          const tool = String(block.name ?? "tool");
          const input = (block.input ?? {}) as Record<string, unknown>;
          const command = typeof input.command === "string" ? input.command : "";
          if (tool === "Bash" && command) {
            items.push({
              type: "commandExecution",
              id: `cmd-${sanitizeId(String(block.id ?? `${tool}-${items.length}`))}`,
              pluginId: null,
              scriptPath: null,
              command,
              cwd: meta.cwd,
              processId: null,
              source: "agent",
              status: "completed",
              commandActions: [],
              aggregatedOutput: typeof input.description === "string" ? input.description : "",
              exitCode: 0,
              durationMs: null,
            });
          } else {
            items.push({
              type: "dynamicToolCall",
              id: `tool-${sanitizeId(String(block.id ?? `${tool}-${items.length}`))}`,
              namespace: null,
              tool,
              arguments: {},
              status: "completed",
              contentItems: null,
              success: true,
              durationMs: null,
            });
          }
        }
      }
    }
  }

  const turn: Turn = {
    id: `turn-${meta.sessionId}`,
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: Math.floor(meta.createdAtMs / 1000),
    completedAt: Math.floor(meta.updatedAtMs / 1000),
    durationMs: null,
  };

  return {
    id: meta.threadId,
    sessionId: meta.sessionId,
    forkedFromId: null,
    parentThreadId: null,
    preview: meta.preview,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "paginated",
    modelProvider: "",
    model: meta.model,
    reasoningEffort: null,
    createdAt: Math.floor(meta.createdAtMs / 1000),
    updatedAt: Math.floor(meta.updatedAtMs / 1000),
    recencyAt: Math.floor(meta.updatedAtMs / 1000),
    status: { type: "idle" },
    path: meta.file,
    cwd: meta.cwd,
    cliVersion: "",
    originator: null,
    source: { custom: "claude" },
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: meta.preview.slice(0, 80) || null,
    turns: [turn],
  };
}

/** Projection for the sidebar: same fields the codex path produces, engine marked. */
export function claudeSessionSummary(meta: ClaudeSessionFile): {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  source: string;
  engine: "claude";
  status: "idle";
} {
  return {
    id: meta.threadId,
    name: meta.preview.slice(0, 80) || null,
    preview: meta.preview,
    cwd: meta.cwd,
    projectId: null,
    createdAt: meta.createdAtMs,
    updatedAt: meta.updatedAtMs,
    model: meta.model,
    source: "claude",
    engine: "claude",
    status: "idle",
  };
}