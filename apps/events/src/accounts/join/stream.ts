"use client";

import { useEffect, useRef } from "react";

export const VERIFICATION_STREAM = "/api/me/verification/stream";

/**
 * While `active`, listens to GET /api/me/verification/stream (Server-Sent Events: the webhook's NOTIFY, or the server's
 * own decision reads when no webhook arrives) and calls `onSignal` for every verification change. The browser's
 * EventSource reconnects on its own; as a last resort (no EventSource, or the stream keeps failing) the read-only view
 * is refreshed every `fallbackMs` so the step never waits forever.
 *
 * `mode` "decision" asks the server to read Didit every few seconds (the guest is waiting on a result); "passive" (the
 * guest is still in the camera UI) keeps the push and only a rare read. `onLimited` fires when the server can no longer
 * read Didit for this account for a while (per-account budget or the app-wide limiter).
 */
export function useVerificationStream(
  active: boolean,
  onSignal: () => void,
  { fallbackMs = 10_000, url = VERIFICATION_STREAM, mode = "decision", onLimited }: { fallbackMs?: number; url?: string; mode?: "decision" | "passive"; onLimited?: () => void } = {},
) {
  const signal = useRef(onSignal);
  const limited = useRef(onLimited);
  useEffect(() => {
    signal.current = onSignal;
    limited.current = onLimited;
  });
  const src = mode === "decision" ? `${url}${url.includes("?") ? "&" : "?"}wait=decision` : url;
  useEffect(() => {
    if (!active) return;
    let source: EventSource | null = null;
    const fallback = setInterval(() => signal.current(), fallbackMs);
    if (typeof EventSource !== "undefined") {
      source = new EventSource(src, { withCredentials: true });
      source.onmessage = (e) => {
        try {
          const data = JSON.parse(String(e.data)) as { type?: string };
          if (data.type === "verification.updated" || data.type === "onboarding.complete") signal.current();
          else if (data.type === "verification.limited") limited.current?.();
        } catch { /* not ours */ }
      };
      // The server ends the stream when the session lapsed or after its lifetime; EventSource reconnects by itself.
      source.addEventListener("end", () => signal.current());
    }
    return () => {
      clearInterval(fallback);
      source?.close();
    };
  }, [active, fallbackMs, src]);
}
