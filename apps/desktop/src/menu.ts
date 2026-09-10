import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { IPC, type AppCommand, type MenuId } from "@zcodex/contracts";

export interface MenuActions {
  send: (command: AppCommand) => void;
}

/** Single source of truth for both the (hidden) application menu and the custom title bar menus. */
export function buildMenuTemplate(actions: MenuActions): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  return [
    {
      id: "file",
      label: "File",
      submenu: [
        { label: "New chat", accelerator: "CmdOrCtrl+N", click: () => actions.send("new-chat") },
        { label: "Open project…", accelerator: "CmdOrCtrl+O", click: () => actions.send("open-project") },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => actions.send("settings") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Find in chats", accelerator: "CmdOrCtrl+F", click: () => actions.send("focus-search") },
      ],
    },
    {
      id: "view",
      label: "View",
      submenu: [
        { label: "Toggle sidebar", accelerator: "CmdOrCtrl+B", click: () => actions.send("toggle-sidebar") },
        { label: "Home", accelerator: "CmdOrCtrl+Shift+H", click: () => actions.send("open-codex-home") },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      id: "help",
      label: "Help",
      submenu: [
        { label: "About ZCodex", click: () => actions.send("about") },
        { label: "Open ~/.codex folder", click: () => actions.send("open-codex-home") },
      ],
    },
  ];
}

/**
 * Install the menu for accelerators, but keep the bar itself hidden: ZCodex draws its own title
 * bar (titleBarStyle: hidden + overlay), and a visible native bar would double up with it.
 */
export function installApplicationMenu(window: BrowserWindow, actions: MenuActions): void {
  const template = buildMenuTemplate(actions);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);
}

/** Pop the native context menu for a title-bar label, positioned under the button. */
export function popupMenu(menu: MenuId, x: number, y: number): void {
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById(menu);
  const submenu = menuItem?.submenu;
  if (!submenu) return;
  submenu.popup({ window: undefined, x: Math.round(x), y: Math.round(y) });
}

export function aboutDialog(): void {
  app.showAboutPanel?.();
}

export { IPC };
