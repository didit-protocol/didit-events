"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import styles from "./VerifiedBadge.module.css";

export interface VerifiedBadgeProps {
  /** Accessible name and the tooltip's first line ("Verified by Didit · 1 Oct 2026"). */
  label: string;
  /** Further tooltip lines (method, email verified, profile created). */
  details?: ReactNode[];
  /** 14–16px inline with text (default 16); 24–32px on the door's AR name tags. */
  size?: 14 | 15 | 16 | 24 | 28 | 32;
  className?: string;
}

/** A scalloped seal: 8 rounded lobes around a 24px box. Computed once. */
const SEAL = (() => {
  const cx0 = 12, cy0 = 12, inner = 9.6, bulge = 12.9, lobes = 8;
  const pt = (r: number, a: number) => `${(cx0 + r * Math.cos(a)).toFixed(2)} ${(cy0 + r * Math.sin(a)).toFixed(2)}`;
  const step = (Math.PI * 2) / lobes;
  let d = `M${pt(inner, -Math.PI / 2)}`;
  for (let i = 0; i < lobes; i++) {
    const a0 = -Math.PI / 2 + i * step;
    d += ` Q${pt(bulge, a0 + step / 2)} ${pt(inner, a0 + step)}`;
  }
  return `${d}Z`;
})();

/**
 * Blue verified seal (X / Instagram style) for a person whose human check is approved. Hover or keyboard focus shows
 * a tooltip with the details; it floats over the page (fixed, portalled) so table cells and drawers never clip it.
 * The same text is always in the accessibility tree through aria-describedby.
 */
export function VerifiedBadge({ label, details = [], size = 16, className }: VerifiedBadgeProps) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 120;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const hide = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [pos, hide]);
  const lines = details.filter((d) => d !== null && d !== undefined && d !== "");
  return (
    <>
      <span
        ref={ref}
        role="img"
        aria-label={label.split(" · ")[0]}
        aria-describedby={id}
        tabIndex={0}
        className={cx(styles.badge, className)}
        style={{ width: size, height: size }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
        data-verified-badge=""
      >
        <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
          <path d={SEAL} fill="#1D9BF0" />
          <path d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {/* Hidden yet still the description (aria-describedby reads hidden nodes); it never joins a heading's name. */}
      <span id={id} hidden>
        {[label, ...lines].map((l, i) => (
          <span key={i}>{i ? ". " : ""}{l}</span>
        ))}
      </span>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <span aria-hidden="true" className={cx(styles.tip, pos.below && styles.below)} style={{ left: pos.x, top: pos.y }}>
              <b>{label}</b>
              {lines.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
