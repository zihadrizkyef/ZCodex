import { useEffect, useRef, useState, type ReactNode } from "react";

interface DropdownProps {
  label: ReactNode;
  className?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}

/** Minimal popover: closes on outside click, Escape, or after a selection. */
export function Dropdown({ label, className, align = "left", children }: DropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={rootRef}>
      <button className={className} onClick={() => setOpen((v) => !v)} type="button">
        {label}
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            bottom: 34,
            [align]: 0,
            minWidth: 220,
            background: "#242a34",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            padding: 6,
            zIndex: 40,
            boxShadow: "0 12px 32px rgba(0,0,0,.45)",
          }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  hint,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  hint?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        borderRadius: 6,
        fontSize: 12.5,
        color: active ? "var(--text)" : "var(--text-dim)",
        background: active ? "var(--surface-active)" : "transparent",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--surface-active)" : "transparent")}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </span>
      {hint ? <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{hint}</span> : null}
    </button>
  );
}
