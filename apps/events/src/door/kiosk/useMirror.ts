"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "didit-access:mirror";
const EVENT = "didit-access:mirror";

const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

/** Operator "Mirror preview" (K-13), on by default and remembered per device. */
export function useMirror(): [boolean, (mirror: boolean) => void] {
  const mirror = useSyncExternalStore(subscribe, read, () => true);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the setting lasts until reload.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [mirror, set];
}
