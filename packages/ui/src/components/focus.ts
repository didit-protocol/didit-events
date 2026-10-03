"use client";

import { useEffect, useRef, type RefObject } from "react";

// Iframes count: an embedded widget (the Didit SDK) is reachable with Tab like any other control.
const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true");
}

/**
 * Invisible focus stops right before and after the trapped element. Tab pressed inside an iframe never reaches our
 * keydown handler, so leaving the iframe moves focus to the next stop in the page: these catch it and send it back
 * to the other end of the dialog.
 */
function focusGuard(): HTMLSpanElement {
  const guard = document.createElement("span");
  guard.tabIndex = 0;
  guard.setAttribute("data-focus-guard", "");
  guard.style.cssText = "position:fixed;top:0;left:0;width:1px;height:0;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
  return guard;
}

/** Next focus target when Tab / Shift+Tab leaves either end of the list (null = let the browser move focus). */
export function wrapFocus(list: HTMLElement[], active: Element | null, backwards: boolean): HTMLElement | null {
  const first = list[0];
  const last = list[list.length - 1];
  if (!first || !last) return null;
  const idx = active ? list.indexOf(active as HTMLElement) : -1;
  if (backwards && (idx <= 0)) return last;
  if (!backwards && (idx === -1 || idx === list.length - 1)) return first;
  return null;
}

/**
 * While `active`: moves focus into `ref` (the `[data-autofocus]` element or the first focusable), keeps Tab inside it,
 * calls `onEscape` on Esc, locks page scroll, and restores focus to the previously focused element when it ends.
 * `onEscape` is read through a ref, so a new callback identity on every render never re-arms the trap (initial focus
 * happens only when `active` turns on).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void, lockScroll = true) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    const before = focusGuard(), after = focusGuard();
    root.before(before);
    root.after(after);
    const toFirst = () => (focusables(root)[0] ?? root).focus();
    const toLast = () => (focusables(root).at(-1) ?? root).focus();
    // Leaving past the end (Tab out of a trailing iframe) wraps to the start, and the other way round.
    after.addEventListener("focus", toFirst);
    before.addEventListener("focus", toLast);
    const initial = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
    initial.focus();
    const prevOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      const escape = escapeRef.current;
      if (e.key === "Escape" && escape) {
        e.stopPropagation();
        escape();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const target = wrapFocus(list, document.activeElement, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      before.remove();
      after.remove();
      if (lockScroll) document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [ref, active, lockScroll]);
}
