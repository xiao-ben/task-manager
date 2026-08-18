import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconMore } from "./Icons";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

type Pos = { top: number; left: number; maxHeight: number };

export function TaskMoreMenu({ open, onOpenChange, children }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const gutter = 8;
    const width = 220;
    const spaceBelow = window.innerHeight - rect.bottom - gutter;
    const spaceAbove = rect.top - gutter;
    const openUp = spaceBelow < 280 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, (openUp ? spaceAbove : spaceBelow) - 4);

    let left = rect.right - width;
    left = Math.min(Math.max(gutter, left), window.innerWidth - width - gutter);

    let top = rect.bottom + 4;
    if (openUp) {
      const panelH = panelRef.current?.offsetHeight ?? Math.min(maxHeight, 320);
      top = Math.max(gutter, rect.top - panelH - 4);
    }
    setPos({ top, left, maxHeight });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    // Re-measure after first paint so upward menus sit flush above the button
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only after panel mounts
  }, [open, children]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    const onReposition = () => onOpenChange(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, onOpenChange]);

  return (
    <div className="more-menu">
      <button
        ref={btnRef}
        className="btn icon"
        type="button"
        title="更多"
        aria-label="更多操作"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
      >
        <IconMore size={15} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="more-menu-panel more-menu-panel-fixed"
            role="menu"
            style={{
              top: pos.top,
              left: pos.left,
              maxHeight: pos.maxHeight,
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
