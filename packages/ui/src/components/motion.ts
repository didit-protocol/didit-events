"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Calls `done` when the animations now running on `els` have ended: at once when there are none (reduced motion, a
 * browser or test DOM without Web Animations). Reading the animations flushes styles, so a leave animation started
 * by an attribute set just before this call is seen.
 */
export function afterAnimations(els: readonly (Element | null | undefined)[], done: () => void) {
  const running = els.flatMap((el) => (el && typeof el.getAnimations === "function" ? el.getAnimations() : []));
  if (running.length === 0) return done();
  void Promise.allSettled(running.map((a) => a.finished)).then(done);
}

/**
 * Keeps a layer mounted while it animates out. Returns true while `open`, and after it closes until the leave
 * animations on `ref`'s element and its first child (the scrim and its panel) have ended. Mark the leaving state in
 * the markup (`data-leaving`) so CSS can start those animations.
 */
export function usePresence(open: boolean, ref: RefObject<Element | null>): boolean {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    let live = true;
    afterAnimations([ref.current, ref.current?.firstElementChild], () => live && setPresent(false));
    return () => {
      live = false;
    };
  }, [open, present, ref]);
  return open || present;
}
