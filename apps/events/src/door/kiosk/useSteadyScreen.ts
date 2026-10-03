"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreenModel } from "./screen";

/** Idle and "adjust" screens (K-01, K-13, K-03): hints that change as the face moves. */
const CALM = new Set(["K-01", "K-13", "K-03"]);
const key = (m: ScreenModel) => `${m.code}|${"hint" in m ? (m.hint ?? "") : ""}`;

/**
 * Keeps an idle/adjust hint on screen for at least `minMs` so it never flickers while the face
 * moves. Real progress (hold, checking, results, errors) replaces it immediately.
 */
export function useSteadyScreen(model: ScreenModel, minMs = 1100): ScreenModel {
  const [shown, setShown] = useState(model);
  const since = useRef(0);
  const latest = useRef(model);
  useEffect(() => {
    latest.current = model;
  });
  const want = key(model);
  const have = key(shown);
  useEffect(() => {
    if (want === have) return;
    const calmSwap = CALM.has(want.split("|")[0]!) && CALM.has(have.split("|")[0]!);
    const wait = calmSwap ? Math.max(0, minMs - (Date.now() - since.current)) : 0;
    const t = setTimeout(() => {
      since.current = Date.now();
      setShown(latest.current);
    }, wait);
    return () => clearTimeout(t);
  }, [want, have, minMs]);
  // Same screen as the one shown: render the fresh model (ring progress, counters).
  return want === have ? model : shown;
}
