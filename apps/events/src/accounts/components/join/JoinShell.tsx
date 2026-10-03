"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HEADER_LOGO_HEIGHT, Logo } from "@didit-events/ui";
import { useFocusTrap } from "@didit-events/ui/focus";
import { afterAnimations } from "@didit-events/ui/motion";
import j from "./Join.module.css";

/**
 * The frame of the join modal: a centred card from 768px, a bottom sheet that slides up below it. The steps render
 * inside it and the body's height follows its content with a transition instead of jumping. Each step is a body over
 * its actions footer (`SheetFooter`), which sits on the bottom edge of the frame and stays there while a long step
 * scrolls under it. ×, Esc and a tap on the
 * scrim play the leave animation, then call `onClose`; focus stays inside while it is open and starts on the step's
 * field (`data-autofocus`) or its title, never on the × (a focus ring on Close is not where the guest is). `instant`: it replaces the launcher's
 * placeholder (same frame, already on screen), so it skips the entrance and grows from the placeholder's height.
 */
export function JoinShell({ eventName, onClose, focusKey, instant = false, children }: { eventName: string; onClose: () => void; /** Changes when the content is replaced as a whole (signed out → signed in): focus moves to the new content. */ focusKey?: string; instant?: boolean; children: ReactNode }) {
  const scrim = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const close = () => setLeaving(true);
  // A press that starts on the scrim and ends on it closes (a text selection dragged out of the card does not).
  const pressedScrim = useRef(false);
  useFocusTrap(dialog, true, close);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!leaving) return;
    let live = true;
    afterAnimations([scrim.current, dialog.current], () => {
      if (!live) return;
      onCloseRef.current();
      // An owner that keeps the modal mounted gets it back as it was.
      setLeaving(false);
    });
    return () => {
      live = false;
    };
  }, [leaving]);

  // On open (after the trap, which starts on the first control: the ×) and when the content is replaced as a whole
  // (it took the focused element with it): focus the step's field, else its title, else the dialog.
  const opened = useRef(false);
  useEffect(() => {
    const root = dialog.current;
    if (!root) return;
    const first = !opened.current;
    opened.current = true;
    if (!first && root.contains(document.activeElement) && document.activeElement !== root) return;
    const field = root.querySelector<HTMLElement>("[data-autofocus]");
    if (first && field) return;
    const title = root.querySelector<HTMLElement>("h1, h2");
    if (title && !field && !title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
    (field ?? title ?? root).focus({ preventScroll: true });
  }, [focusKey]);

  // After the placeholder: start at its height (the body's minimum), so the first size is a transition too.
  useLayoutEffect(() => {
    if (instant && body.current && inner.current) body.current.style.height = getComputedStyle(inner.current).minHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The body's height follows its content with a transition (auto → px never animates, so the first size is silent).
  useEffect(() => {
    const box = body.current;
    const content = inner.current;
    if (!box || !content || typeof ResizeObserver === "undefined") return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const watch = new ResizeObserver(() => {
      const height = `${content.offsetHeight}px`;
      if (box.style.height === height) return;
      // While it resizes the body does not scroll (no scrollbar flashing in and out).
      if (box.style.height.endsWith("px")) {
        box.setAttribute("data-resizing", "");
        clearTimeout(settle);
        settle = setTimeout(() => box.removeAttribute("data-resizing"), 280);
      }
      box.style.height = height;
    });
    watch.observe(content);
    return () => {
      watch.disconnect();
      clearTimeout(settle);
    };
  }, []);

  return (
    <div
      ref={scrim}
      className={j.scrim}
      data-leaving={leaving ? "" : undefined}
      data-instant={instant ? "" : undefined}
      onPointerDown={(e) => {
        pressedScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedScrim.current) close();
      }}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="request-title" tabIndex={-1} className={j.dialog} data-join-modal="">
        <div className={j.top}>
          <Logo variant="color" height={HEADER_LOGO_HEIGHT} alt="Didit" />
          <span className={j.eventName}>{eventName}</span>
          <button type="button" className={j.close} aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div ref={body} className={j.body}>
          <div ref={inner} className={j.inner}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
