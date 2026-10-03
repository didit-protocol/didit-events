"use client";

import { useContext, useOptimistic, useRef, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { cx } from "../cx";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** With href the tabs render as page navigation (client-side links with aria-current). */
  href?: string;
  disabled?: boolean;
  /** id of the controlled tabpanel (button tabs only). */
  panelId?: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  label: string;
  className?: string;
}

/**
 * Tabs. Button tabs follow the WAI-ARIA tabs pattern (roving tabindex, arrows / Home / End, automatic activation);
 * link tabs are a nav with aria-current="page". Link tabs navigate on the client (next/link, prefetched), and the
 * clicked tab is marked current at once, while its page loads; if the navigation does not happen it falls back.
 */
export function Tabs({ items, value, onChange, label, className }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const asLinks = items.every((t) => t.href);
  // Null outside the app router (render tests, a static frame): the links then navigate on their own.
  const router = useContext(AppRouterContext);
  const [current, setCurrent] = useOptimistic(value);
  const [, startTransition] = useTransition();

  if (asLinks) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>, t: TabItem) => {
      // Another tab of the browser, a click someone else handled (the unsaved-changes guard), or the open tab: the link's own business.
      if (!router || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || t.id === value) return;
      e.preventDefault();
      // The optimistic tab lasts as long as the navigation: `value` takes over when the new page (or its loading state) is in.
      startTransition(() => {
        setCurrent(t.id);
        router.push(t.href!);
      });
    };
    return (
      <nav aria-label={label} className={cx(styles.tabs, className)}>
        {items.map((t) => (
          <Link key={t.id} href={t.href!} className={styles.tab} aria-current={t.id === current ? "page" : undefined} onClick={(e) => onClick(e, t)}>
            {t.label}
          </Link>
        ))}
      </nav>
    );
  }

  const enabled = items.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((t) => t.id === value);
    const pos = enabled.indexOf(current);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange?.(item.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cx(styles.tabs, className)} onKeyDown={onKeyDown}>
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={t.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            className={styles.tab}
            onClick={() => onChange?.(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
