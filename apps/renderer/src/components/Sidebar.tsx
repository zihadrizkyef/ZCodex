import { useMemo, useState } from "react";
import {
  ChevronRight,
  Clock,
  Folder,
  MoreHorizontal,
  Plug,
  Search,
  Settings,
  SquarePen,
} from "lucide-react";
import type { ProjectView, ThreadSummary } from "@zcodex/contracts";
import { useStore } from "../store";
import { relativeTime } from "../lib/format";

function ThreadRow({
  thread,
  unread,
  selected,
  onOpen,
}: {
  thread: ThreadSummary;
  unread: boolean;
  selected: boolean;
  onOpen: () => void;
}): React.ReactElement {
  const label = thread.name || thread.preview || "Chat tanpa judul";
  return (
    <button type="button" className={`leaf-row${selected ? " selected" : ""}`} onClick={onOpen} title={label}>
      <span className={unread ? "unread-dot" : "unread-dot placeholder"} />
      <span className="label">{label}</span>
      {thread.engine === "claude" ? <span className="engine-badge">Claude</span> : null}
    </button>
  );
}

function ProjectNode({ project, threads }: { project: ProjectView; threads: ThreadSummary[] }): React.ReactElement {
  const expanded = useStore((s) => s.expandedProjects[project.id] ?? false);
  const toggleProject = useStore((s) => s.toggleProject);
  const removeProject = useStore((s) => s.removeProject);
  const openThread = useStore((s) => s.openThread);
  const activeId = useStore((s) => s.thread?.threadId ?? null);
  const readThreads = useStore((s) => s.readThreads);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? threads : threads.slice(0, 5);

  return (
    <div>
      <div className={`tree-row${expanded ? " open" : ""}`} style={{ cursor: "default" }}>
        <ChevronRight
          size={13}
          className={`chev${expanded ? " open" : ""}`}
          onClick={() => toggleProject(project.id)}
          style={{ cursor: "pointer", flex: "none" }}
        />
        <Folder size={14} style={{ color: "var(--text-dim)", flex: "none" }} onClick={() => toggleProject(project.id)} />
        <span className="label" onClick={() => toggleProject(project.id)} title={project.roots.join(", ")}>
          {project.name}
        </span>
        <button
          type="button"
          className="icon-btn"
          title="Hapus project dari sidebar"
          style={{ width: 20, height: 20 }}
          onClick={() => {
            if (confirm(`Hapus project "${project.name}" dari sidebar? File di disk tidak dihapus.`)) {
              void removeProject(project.id);
            }
          }}
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
      {expanded ? (
        <div>
          {visible.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              unread={!readThreads.has(thread.id)}
              selected={activeId === thread.id}
              onOpen={() => void openThread(thread.id)}
            />
          ))}
          {threads.length === 0 ? (
            <div style={{ padding: "4px 8px 4px 30px", fontSize: 12, color: "var(--text-faint)" }}>Belum ada chat</div>
          ) : null}
          {threads.length > 5 ? (
            <button type="button" className="show-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar(): React.ReactElement {
  const projects = useStore((s) => s.projects);
  const threads = useStore((s) => s.threads);
  const searchTerm = useStore((s) => s.searchTerm);
  const searchResults = useStore((s) => s.searchResults);
  const setSearch = useStore((s) => s.setSearch);
  const account = useStore((s) => s.account);
  const status = useStore((s) => s.status);
  const openThread = useStore((s) => s.openThread);
  const newChat = useStore((s) => s.newChat);
  const addProject = useStore((s) => s.addProject);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const activeId = useStore((s) => s.thread?.threadId ?? null);
  const readThreads = useStore((s) => s.readThreads);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const searchOpen = useStore((s) => s.searchOpen);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const view = useStore((s) => s.view);

  const byProject = useMemo(() => {
    const map: Record<string, ThreadSummary[]> = {};
    for (const thread of threads) {
      if (!thread.projectId) continue;
      (map[thread.projectId] ??= []).push(thread);
    }
    for (const list of Object.values(map)) list.sort((a, b) => b.updatedAt - a.updatedAt);
    return map;
  }, [threads]);

  const recents = useMemo(
    () => threads.filter((t) => !t.projectId).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  );

  const email = account?.email ?? "Belum login";
  const initial = (email.split("@")[0] || "?").trim().charAt(0).toUpperCase() || "?";
  const plan = account?.planType ? `${account.planType} plan` : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-actions" style={{ marginLeft: 0 }}>
          <button
            type="button"
            className="icon-btn"
            title="Cari chat"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Chat baru"
            onClick={() => void newChat(selectedProjectId ?? projects[0]?.id ?? null)}
          >
            <SquarePen size={15} />
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="sidebar-search">
          <Search size={13} style={{ color: "var(--text-faint)" }} />
          <input
            autoFocus
            placeholder="Cari chat…"
            value={searchTerm}
            onChange={(e) => {
              setSearch(e.target.value);
              void useStore.getState().refreshThreads(e.target.value || undefined);
            }}
          />
        </div>
      ) : null}

      <div className="sidebar-scroll">
        <button
          type="button"
          className={`nav-row${view === "home" && !activeId ? " active" : ""}`}
          onClick={() => void newChat(selectedProjectId ?? projects[0]?.id ?? null)}
        >
          <SquarePen size={15} />
          New chat
          <span className="spacer" />
          <span className="hint">Ctrl+N</span>
        </button>
        <button type="button" className="nav-row" onClick={() => alert("Scheduled tasks belum tersambung di versi ini.")}>
          <Clock size={15} />
          Scheduled
        </button>
        <button
          type="button"
          className="nav-row"
          onClick={() => alert(`Plugins/MCP dari Codex:\n${status.codexHome ?? "~/.codex"}\n(belum ada panel khusus)`)}
        >
          <Plug size={15} />
          Plugins
        </button>

        {searchResults ? (
          <>
            <div className="section-label">Hasil pencarian ({searchResults.length})</div>
            {searchResults.slice(0, 40).map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                unread={!readThreads.has(thread.id)}
                selected={activeId === thread.id}
                onOpen={() => void openThread(thread.id)}
              />
            ))}
          </>
        ) : null}

        <div className="section-label">
          Projects
          <button type="button" onClick={() => void addProject()}>
            + Tambah
          </button>
        </div>
        {projects.map((project) => (
          <ProjectNode key={project.id} project={project} threads={byProject[project.id] ?? []} />
        ))}
        {projects.length === 0 ? (
          <div style={{ padding: "4px 8px", fontSize: 12, color: "var(--text-faint)" }}>
            Belum ada project. Tambah folder kerja biar tiap chat punya konteks repo.
          </div>
        ) : null}

        {recents.length > 0 ? (
          <>
            <div className="section-label">
              Recents
              <button type="button" onClick={() => setRecentsOpen((v) => !v)}>
                {recentsOpen ? "Hide" : "Show"}
              </button>
            </div>
            {recentsOpen
              ? recents.slice(0, 12).map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    unread={!readThreads.has(thread.id)}
                    selected={activeId === thread.id}
                    onOpen={() => void openThread(thread.id)}
                  />
                ))
              : null}
          </>
        ) : null}
      </div>

      <div className="sidebar-footer">
        <div className="avatar">{initial}</div>
        <span className="name" title={email}>
          {email}
          {plan ? ` · ${plan}` : ""}
        </span>
        <button type="button" className="icon-btn" title="Settings" onClick={() => alert("Settings belum ada di versi ini.")}>
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}

export { relativeTime };
