import { ChevronLeft, ChevronRight } from "lucide-react";
import { IPC, type MenuId } from "@zcodex/contracts";
import { useStore } from "../store";

const MENUS: Array<{ id: MenuId; label: string }> = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "help", label: "Help" },
];

/**
 * App-drawn title bar. The window itself is frameless with a Windows title bar overlay, so the
 * minimise/maximise/close buttons are drawn by the OS into the right side of this strip while we
 * own the navigation arrows and the menu labels.
 */
export function TitleBar(): React.ReactElement {
  const view = useStore((s) => s.view);
  const goHome = useStore((s) => s.goHome);
  const thread = useStore((s) => s.thread);

  const openMenu = (id: MenuId, event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    void window.zcodex.popupMenu(id, rect.left, rect.bottom);
  };

  return (
    <div className="titlebar">
      <div className="titlebar-nav">
        <button type="button" title="Kembali ke Home" disabled={view === "home"} onClick={goHome}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" title="Maju" disabled>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="titlebar-menus">
        {MENUS.map((menu) => (
          <button key={menu.id} type="button" onClick={(event) => openMenu(menu.id, event)}>
            {menu.label}
          </button>
        ))}
      </div>
      <div className="titlebar-title">{thread?.title ?? "ZCodex"}</div>
    </div>
  );
}

export { IPC };
