/**
 * Session-expired signal (A-13f). A server action that finds the staff session gone returns
 * `{ error: "session_expired" }`; the client code that called it hands the result to `handleSessionExpired` (or calls
 * `notifySessionExpired()` directly), and the modal mounted by AdminChrome opens. No client state is shared: it is a
 * plain window event.
 */
export const SESSION_EXPIRED_EVENT = "didit-events:session-expired";

export interface SessionExpired {
  error: "session_expired";
}

export function isSessionExpired(value: unknown): value is SessionExpired {
  return typeof value === "object" && value !== null && (value as { error?: unknown }).error === "session_expired";
}

/** Opens the session-expired modal. Safe to call on the server (no-op). */
export function notifySessionExpired(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/** `if (handleSessionExpired(result)) return;` after awaiting a server action. */
export function handleSessionExpired(value: unknown): value is SessionExpired {
  if (!isSessionExpired(value)) return false;
  notifySessionExpired();
  return true;
}
