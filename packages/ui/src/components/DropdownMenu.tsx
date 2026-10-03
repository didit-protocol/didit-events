"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import { Button, type ButtonProps } from "./Button";
import styles from "./DropdownMenu.module.css";

export type MenuEntry =
  | { type?: "item"; id: string; label: ReactNode; onSelect?: () => void; href?: string; danger?: boolean; disabled?: boolean }
  | { type: "separator"; id: string };

type MenuItemEntry = Extract<MenuEntry, { id: string; label: ReactNode }>;

const isItem = (e: MenuEntry): e is MenuItemEntry => e.type !== "separator";

export interface MenuPanelProps {
  items: MenuEntry[];
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement>;
  /** Index (into `items`) of the highlighted item. */
  highlighted?: number;
  onHighlight?: (index: number) => void;
  onSelect?: (item: MenuItemEntry) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  id?: string;
  labelledBy?: string;
  label?: string;
  className?: string;
}

/** The menu surface (role="menu"). Used by DropdownMenu; rendered alone in the frame gallery. */
export function MenuPanel({ items, highlighted, onHighlight, onSelect, onKeyDown, id, labelledBy, label, className, style, panelRef }: MenuPanelProps) {
  return (
    <div ref={panelRef} role="menu" id={id} aria-labelledby={labelledBy} aria-label={label} className={cx(styles.menu, className)} style={style} onKeyDown={onKeyDown} tabIndex={-1}>
      {items.map((entry, i) => {
        if (!isItem(entry)) return <div key={entry.id} role="separator" className={styles.separator} />;
        const common = {
          role: "menuitem",
          tabIndex: i === highlighted ? 0 : -1,
          "data-index": i,
          "data-highlighted": i === highlighted ? "" : undefined,
          "aria-disabled": entry.disabled || undefined,
          className: cx(styles.item, entry.danger && styles.danger),
          onMouseEnter: () => onHighlight?.(i),
          onClick: () => {
            if (!entry.disabled) onSelect?.(entry);
          },
        } as const;
        return entry.href && !entry.disabled ? (
          <a key={entry.id} href={entry.href} {...common}>
            {entry.label}
          </a>
        ) : (
          <button key={entry.id} type="button" {...common}>
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

/** Next enabled item index moving by `step` (wraps). */
export function nextEnabled(items: MenuEntry[], from: number, step: 1 | -1): number {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    const e = items[i];
    if (e && isItem(e) && !e.disabled) return i;
  }
  return from;
}

export interface DropdownMenuProps {
  items: MenuEntry[];
  /** Trigger content; the trigger is a Button. */
  trigger: ReactNode;
  triggerProps?: Omit<ButtonProps, "children" | "onClick">;
  align?: "start" | "end";
  className?: string;
}

/** Fixed-position placement under the trigger (flipped above it when the viewport has no room below). */
export function menuPlacement(trigger: { top: number; bottom: number; left: number; right: number }, menuHeight: number, align: "start" | "end", viewport: { width: number; height: number }): CSSProperties {
  const GAP = 4, MARGIN = 8;
  const below = trigger.bottom + GAP + menuHeight + MARGIN <= viewport.height || trigger.top - GAP - menuHeight < MARGIN;
  const top = below ? trigger.bottom + GAP : trigger.top - GAP - menuHeight;
  return align === "end" ? { top, right: Math.max(MARGIN, viewport.width - trigger.right) } : { top, left: Math.max(MARGIN, trigger.left) };
}

/**
 * Menu button (WAI-ARIA): Enter/Space/ArrowDown open on the first item, ArrowUp on the last; arrows / Home / End move;
 * Enter selects; Esc or Tab closes; Esc returns focus to the trigger; outside click closes.
 * The open menu is portalled to <body> with fixed positioning, so a clipping ancestor (a table cell with
 * overflow:hidden, a scroll container) can never cut it down to an empty box.
 */
export function DropdownMenu({ items, trigger, triggerProps, align = "start", className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const triggerId = useId();

  useEffect(() => {
    if (!open || !position) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`);
    el?.focus();
  }, [open, highlighted, position]);

  // Measure after render, before paint: place the menu next to the trigger, and follow it on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      setPosition(menuPlacement(t, menuRef.current?.offsetHeight ?? 0, align, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) { setOpen(false); setPosition(null); setHighlighted(-1); }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openAt = (index: number) => {
    setHighlighted(index);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    setPosition(null);
    setHighlighted(-1);
    if (refocus) triggerRef.current?.focus();
  };
  const select = (item: MenuItemEntry) => {
    close(true);
    item.onSelect?.();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => nextEnabled(items, h, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => nextEnabled(items, h, -1));
        break;
      case "Home":
        e.preventDefault();
        setHighlighted(nextEnabled(items, -1, 1));
        break;
      case "End":
        e.preventDefault();
        setHighlighted(nextEnabled(items, items.length, -1));
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        // Focus goes back to the trigger first, so Tab continues from there (the menu itself lives at the end of <body>).
        close(true);
        break;
    }
  };

  return (
    <div ref={wrapRef} className={cx(styles.wrap, className)}>
      <Button
        variant="secondary"
        {...triggerProps}
        ref={triggerRef}
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(nextEnabled(items, -1, 1)))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openAt(nextEnabled(items, -1, 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(nextEnabled(items, items.length, -1));
          }
        }}
      >
        {trigger}
      </Button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <MenuPanel
              panelRef={menuRef}
              id={menuId}
              labelledBy={triggerId}
              items={items}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              onSelect={select}
              onKeyDown={onMenuKeyDown}
              className={styles.floating}
              style={position ?? { top: 0, left: 0, visibility: "hidden" }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
