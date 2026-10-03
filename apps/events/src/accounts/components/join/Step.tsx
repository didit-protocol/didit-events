"use client";

import { Component, createContext, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { cx } from "@didit-events/ui";
import { afterAnimations } from "@didit-events/ui/motion";
import s from "../Screen.module.css";
import j from "./Join.module.css";

/** How the screen around a step's body arrived: the body plays that entrance, the footer under it does not. */
const PaneMotion = createContext<{ animate: boolean; back: boolean } | null>(null);

/**
 * One screen of the join modal. A new `step` cross-fades: the screen that leaves fades out in place while the new one
 * slides in (from the right going forward, from the left going back; opacity only under prefers-reduced-motion), and
 * focus moves to its title, so a screen reader hears where the guest is now. The first screen is left to the modal's
 * own focus handling. `order`: the screen's place in the flow; a lower one than before reads as going back (`back`
 * says so directly). `enter="change"`: a nested pane (the Didit check's phases) that animates only when it changes,
 * never together with the screen around it.
 *
 * A screen is a `StepBody` over a `SheetFooter` (its actions, on the bottom edge of the modal): only the body slides
 * and fades, and the copy of the screen that leaves hides its footer, so the footer stays put while the bodies
 * cross-fade.
 */
export function StepPane({ step, titleId, enter = "mount", back, order, children }: { step: string; titleId: string; enter?: "mount" | "change"; back?: boolean; order?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState({ step, order, moves: 0, back: false });
  if (step !== nav.step) setNav({ step, order, moves: nav.moves + 1, back: back ?? (order !== undefined && nav.order !== undefined && order < nav.order) });
  const { moves } = nav;
  const around = useContext(PaneMotion);

  useEffect(() => {
    const pane = ref.current;
    if (!moves || !pane) return;
    // A lazy step renders its title a moment later: wait for it.
    const focus = () => {
      const title = pane.querySelector<HTMLElement>(`[id="${titleId}"]`) ?? pane.querySelector<HTMLElement>("h1, h2");
      if (!title) return false;
      if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
      return true;
    };
    if (focus()) return;
    const watch = new MutationObserver(() => focus() && watch.disconnect());
    watch.observe(pane, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [moves, titleId]);

  const own = enter === "mount" || moves > 0;
  // A nested pane that has not changed yet arrives with the screen around it.
  const animate = own || Boolean(around?.animate);
  const goingBack = own ? (back ?? nav.back) : Boolean(around?.back);
  return (
    <div className={j.steps}>
      <div key={step} ref={ref} className={cx(j.step, own && j.stepIn, own && goingBack && j.stepBack)} data-step={step}>
        <PaneMotion value={{ animate, back: goingBack }}>{children}</PaneMotion>
      </div>
      <div ref={ghosts} className={j.ghosts} aria-hidden="true" data-step-ghosts="" />
      <LeavingStep step={step} back={goingBack} pane={ref} host={ghosts} />
    </div>
  );
}

/**
 * The part of a screen over its footer: it takes the height the footer leaves (`align="center"`: a result or a
 * waiting state sits in the middle of it) and is what moves when the screen changes.
 */
export function StepBody({ align = "start", className, children, ...rest }: { align?: "start" | "center" } & HTMLAttributes<HTMLDivElement>) {
  const pane = useContext(PaneMotion);
  return (
    <div {...rest} className={cx(s.fill, align === "center" && s.fillCenter, pane?.animate && j.bodyIn, pane?.animate && pane.back && j.bodyBack, className)} data-step-body="">
      {children}
    </div>
  );
}

/**
 * The screen that leaves, as a picture: just before React replaces it, its DOM is copied (no ids, no frames, typed
 * values kept) and the copy fades out over the new screen, then goes. A copy rather than the old React children: those
 * would mount again and run their effects (a second Didit session, a second request).
 */
class LeavingStep extends Component<{ step: string; back: boolean; pane: RefObject<HTMLDivElement | null>; host: RefObject<HTMLDivElement | null> }> {
  getSnapshotBeforeUpdate(prev: { step: string }): HTMLElement | null {
    const pane = this.props.pane.current;
    // Nothing to play without Web Animations (old browsers, the test DOM) or under reduced motion.
    if (prev.step === this.props.step || !pane || typeof pane.getAnimations !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
    const copy = pane.cloneNode(true) as HTMLElement;
    const typed = pane.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    copy.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((field, i) => {
      const from = typed[i];
      if (!from) return;
      field.value = from.value;
      if ("checked" in from && "checked" in field) field.checked = from.checked;
      field.removeAttribute("name");
    });
    copy.querySelectorAll("iframe, [data-step-ghosts]").forEach((el) => el.remove());
    copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    // Nothing in the copy plays its own entrance again.
    copy.querySelectorAll<HTMLElement>("[data-step], [data-step-body]").forEach((el) => (el.style.animation = "none"));
    // Its footer keeps its room but is not drawn: the new screen's footer is already there, in the same place.
    copy.querySelectorAll<HTMLElement>("[data-sheet-footer]").forEach((el) => (el.style.visibility = "hidden"));
    copy.querySelectorAll("[data-animate]").forEach((el) => el.removeAttribute("data-animate"));
    copy.removeAttribute("data-step");
    copy.setAttribute("inert", "");
    return copy;
  }

  componentDidUpdate(_prev: unknown, _state: unknown, copy: HTMLElement | null) {
    const host = this.props.host.current;
    if (!copy || !host) return;
    copy.className = cx(j.step, j.stepOut, this.props.back && j.stepOutBack);
    host.replaceChildren(copy);
    afterAnimations([copy], () => copy.remove());
  }

  render() {
    return null;
  }
}

/** "Step 2 of 3" as dots (the current one long), with Back from the second step on. */
export function StepBar({ index, total, onBack }: { index: number; total: number; onBack?: () => void }) {
  return (
    <div className={j.stepBar}>
      {onBack ? (
        <button type="button" className={j.backButton} onClick={onBack}>
          ‹ Back
        </button>
      ) : (
        <span />
      )}
      <span className={j.dots} role="img" aria-label={`Step ${index + 1} of ${total}`} data-step-dots={`${index + 1}/${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-current={i === index ? "" : undefined} data-done={i < index ? "" : undefined} />
        ))}
      </span>
    </div>
  );
}
