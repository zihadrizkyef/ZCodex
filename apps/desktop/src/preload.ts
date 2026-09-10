import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IPC,
  type AppCommand,
  type ApprovalResponseRequest,
  type BootstrapPayload,
  type CodexStatusView,
  type ListThreadsRequest,
  type NewThreadRequest,
  type ProjectView,
  type RawThreadPayload,
  type StartTurnRequest,
  type ThreadSummary,
  type ZCodexApi,
} from "@zcodex/contracts";
import type { MenuId } from "@zcodex/contracts";
import type { ServerNotification, ServerRequest } from "@zcodex/codex-protocol";

function subscribe<T>(channel: string): (handler: (payload: T) => void) => () => void {
  return (handler) => {
    const listener = (_event: IpcRendererEvent, payload: T) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  };
}

const api: ZCodexApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap) as Promise<BootstrapPayload>,
  pickProject: () => ipcRenderer.invoke(IPC.pickProject) as Promise<ProjectView | null>,
  addProject: (root: string) => ipcRenderer.invoke(IPC.addProject, root) as Promise<ProjectView>,
  removeProject: (id: string) => ipcRenderer.invoke(IPC.removeProject, id) as Promise<ProjectView[]>,
  listThreads: (request: ListThreadsRequest) => ipcRenderer.invoke(IPC.listThreads, request) as Promise<ThreadSummary[]>,
  readThread: (threadId: string) => ipcRenderer.invoke(IPC.readThread, threadId) as Promise<RawThreadPayload>,
  newThread: (request: NewThreadRequest) => ipcRenderer.invoke(IPC.newThread, request) as Promise<RawThreadPayload>,
  renameThread: (threadId: string, name: string) => ipcRenderer.invoke(IPC.renameThread, threadId, name) as Promise<void>,
  archiveThread: (threadId: string) => ipcRenderer.invoke(IPC.archiveThread, threadId) as Promise<void>,
  startTurn: (request: StartTurnRequest) => ipcRenderer.invoke(IPC.startTurn, request) as Promise<void>,
  interruptTurn: (threadId: string, turnId: string) => ipcRenderer.invoke(IPC.interruptTurn, threadId, turnId) as Promise<void>,
  respondApproval: (request: ApprovalResponseRequest) => ipcRenderer.invoke(IPC.respondApproval, request) as Promise<void>,
  popupMenu: (menu: MenuId, x: number, y: number) => ipcRenderer.invoke(IPC.popupMenu, menu, x, y) as Promise<void>,
  openPath: (target: string) => ipcRenderer.invoke(IPC.openPath, target) as Promise<void>,
  revealPath: (target: string) => ipcRenderer.invoke(IPC.revealPath, target) as Promise<void>,
  onNotification: subscribe<ServerNotification>(IPC.onNotification),
  onServerRequest: subscribe<ServerRequest>(IPC.onServerRequest),
  onStatus: subscribe<CodexStatusView>(IPC.onStatus),
  onProjectsChanged: subscribe<ProjectView[]>(IPC.onProjectsChanged),
  onCommand: subscribe<AppCommand>(IPC.onCommand),
};

contextBridge.exposeInMainWorld("zcodex", api);
