/** IPC channel names. Main, preload and renderer all import these so a typo cannot silently drop a frame. */
export const IPC = {
  // renderer -> main (invoke/handle)
  bootstrap: "app:bootstrap",
  pickProject: "project:pick",
  addProject: "project:add",
  removeProject: "project:remove",
  listThreads: "thread:list",
  readThread: "thread:read",
  newThread: "thread:new",
  renameThread: "thread:rename",
  archiveThread: "thread:archive",
  startTurn: "turn:start",
  interruptTurn: "turn:interrupt",
  respondApproval: "approval:respond",
  popupMenu: "menu:popup",
  openPath: "app:open-path",
  revealPath: "app:reveal-path",

  // main -> renderer (send)
  onNotification: "codex:notification",
  onServerRequest: "codex:server-request",
  onStatus: "codex:status",
  onProjectsChanged: "app:projects-changed",
  onCommand: "app:command",
} as const;

export type MenuId = "file" | "edit" | "view" | "help";

/** Menu / accelerator actions that need the renderer to react. */
export type AppCommand =
  | "new-chat"
  | "open-project"
  | "toggle-sidebar"
  | "focus-search"
  | "open-codex-home"
  | "settings"
  | "about";
