import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Folder, Mic, Plus, Square } from "lucide-react";
import type { EngineId } from "@zcodex/contracts";
import { useStore } from "../store";
import { Dropdown, MenuItem } from "./Dropdown";
import { EffortSlider, effortLabel } from "./EffortSlider";
import { modelLabel, shortenPath } from "../lib/format";

const EXAMPLE_PROMPTS = [
  "Create an image of…",
  "Refactor layar ini biar ga ada nested scroll",
  "Cari file di atas 100 baris…",
  "Tulis test untuk fungsi ini…",
  "Kenapa build ini gagal?",
];

export function Composer(): React.ReactElement {
  const draft = useStore((s) => s.composerDraft);
  const setDraft = useStore((s) => s.setDraft);
  const thread = useStore((s) => s.thread);
  const phase = useStore((s) => s.thread?.phase ?? "idle");
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const setSelectedProject = useStore((s) => s.setSelectedProject);
  const addProject = useStore((s) => s.addProject);
  const models = useStore((s) => s.models);
  const claudeModels = useStore((s) => s.claudeModels);
  const selectedModel = useStore((s) => s.selectedModel);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const selectedEngine = useStore((s) => s.selectedEngine);
  const setSelectedEngine = useStore((s) => s.setSelectedEngine);
  const selectedEffort = useStore((s) => s.selectedEffort);
  const applyEffort = useStore((s) => s.applyEffort);
  const autoApprove = useStore((s) => s.autoApprove);
  const setAutoApprove = useStore((s) => s.setAutoApprove);
  const interrupt = useStore((s) => s.interrupt);
  const setNotice = useStore((s) => s.setNotice);
  const newChat = useStore((s) => s.newChat);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const project = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );
  // A running thread fixes its engine; only a fresh chat can switch engines.
  const engine: EngineId = thread?.engine ?? selectedEngine;
  const availableModels = engine === "claude" ? claudeModels : models;
  const model = useMemo(() => availableModels.find((m) => m.id === selectedModel), [availableModels, selectedModel]);
  // Claude exposes a manual effort dial per model; Codex carries effort inside the model choice.
  const effortLevels = engine === "claude" && model?.supportsEffort ? (model.effortLevels ?? []) : [];
  const effortValue = useMemo(() => {
    if (!effortLevels.length) return null;
    const fromThread = thread?.effort ?? null;
    if (selectedEffort && effortLevels.includes(selectedEffort)) return selectedEffort;
    if (fromThread && effortLevels.includes(fromThread)) return fromThread;
    if (model?.defaultReasoningEffort && effortLevels.includes(model.defaultReasoningEffort)) {
      return model.defaultReasoningEffort;
    }
    return effortLevels[Math.min(2, effortLevels.length - 1)];
  }, [effortLevels, selectedEffort, thread?.effort, model?.defaultReasoningEffort]);
  const working = phase === "working" && Boolean(thread?.activeTurnId);

  useEffect(() => {
    const timer = setInterval(() => setPlaceholderIndex((i) => (i + 1) % EXAMPLE_PROMPTS.length), 7000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    if (!useStore.getState().thread) {
      if (!project) {
        setNotice("Pilih project dulu sebelum kirim prompt.");
        return;
      }
      await newChat(project.id);
    }
    await useStore.getState().send(text);
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer-project">
          <Folder size={13} />
          {thread ? (
            <span className="selected" title={thread.cwd}>
              {project?.name ?? shortenPath(thread.cwd)}
            </span>
          ) : (
            <Dropdown
              className="chip square"
              label={
                <span className="selected" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {project ? project.name : "Choose project"}
                  <ChevronDown size={12} />
                </span>
              }
            >
              {(close) => (
                <>
                  {projects.map((p) => (
                    <MenuItem
                      key={p.id}
                      active={p.id === project?.id}
                      onClick={() => {
                        setSelectedProject(p.id);
                        close();
                      }}
                      hint={shortenPath(p.roots[0] ?? "", 22)}
                    >
                      {p.name}
                    </MenuItem>
                  ))}
                  <MenuItem
                    onClick={() => {
                      close();
                      void addProject();
                    }}
                  >
                    + Tambah project…
                  </MenuItem>
                </>
              )}
            </Dropdown>
          )}
          <span className="spacer" />
          {thread ? <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{shortenPath(thread.cwd, 34)}</span> : null}
        </div>

        <div className="composer-box">
          <div className="composer-input">
            <textarea
              ref={textareaRef}
              value={draft}
              placeholder={EXAMPLE_PROMPTS[placeholderIndex]}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <div className="composer-footer">
            <button type="button" className="chip square" title="Attach (belum tersedia)">
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="chip"
              title={autoApprove ? "Agent boleh jalan tanpa nanya tiap langkah" : "Agent akan minta izin tiap langkah"}
              onClick={() => setAutoApprove(!autoApprove)}
            >
              <Check size={13} style={{ opacity: autoApprove ? 1 : 0.35 }} />
              Approve for me
            </button>
            <span className="spacer" />
            {thread ? (
              <span className="chip engine-chip" title={`Thread ini dijalankan lewat ${engine === "claude" ? "Claude Code" : "Codex"}`}>
                {engine === "claude" ? "Claude" : "Codex"}
              </span>
            ) : (
              <Dropdown
                className="chip engine-chip"
                label={
                  <>
                    {engine === "claude" ? "Claude" : "Codex"}
                    <ChevronDown size={12} />
                  </>
                }
              >
                {(close) => (
                  <>
                    <MenuItem active={engine === "codex"} onClick={() => { setSelectedEngine("codex"); close(); }}>
                      Codex
                    </MenuItem>
                    <MenuItem active={engine === "claude"} onClick={() => { setSelectedEngine("claude"); close(); }}>
                      Claude
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            )}
            <Dropdown
              className="chip"
              align="right"
              label={
                <>
                  {modelLabel(model, engine === "claude" ? "" : undefined)}
                  <ChevronDown size={12} />
                </>
              }
            >
              {(close) => (
                <>
                  {availableModels.filter((m) => !m.hidden).length === 0 ? (
                    <MenuItem onClick={close}>{engine === "claude" ? "Default Claude" : "Default Codex"}</MenuItem>
                  ) : null}
                  {availableModels
                    .filter((m) => !m.hidden)
                    .map((m) => (
                      <MenuItem
                        key={m.id}
                        active={m.id === selectedModel}
                        hint={m.hint ?? (engine === "claude" ? undefined : m.defaultReasoningEffort ?? undefined)}
                        onClick={() => {
                          setSelectedModel(m.id);
                          close();
                        }}
                      >
                        {m.name}
                      </MenuItem>
                    ))}
                </>
              )}
            </Dropdown>
            {effortValue ? (
              <Dropdown
                className="chip effort-chip"
                align="right"
                label={
                  <>
                    Effort {effortLabel(effortValue)}
                    <ChevronDown size={12} />
                  </>
                }
              >
                {() => (
                  <EffortSlider
                    levels={effortLevels}
                    value={effortValue}
                    onChange={(level) => void applyEffort(level)}
                  />
                )}
              </Dropdown>
            ) : null}
            <button type="button" className="chip square" title="Voice (belum tersedia)" disabled style={{ opacity: 0.5 }}>
              <Mic size={14} />
            </button>
            {working ? (
              <button type="button" className="send-btn ready" title="Stop" onClick={() => void interrupt()}>
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className={`send-btn${draft.trim() ? " ready" : ""}`}
                disabled={!draft.trim()}
                title="Kirim (Enter)"
                onClick={() => void submit()}
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
