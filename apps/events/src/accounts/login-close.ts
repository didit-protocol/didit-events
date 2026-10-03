/**
 * The × (and Esc) on /login: back to the page the guest came from when it is on this site, else the events home.
 * A sign-in for the admin (`next=/admin…`) always closes to the events home, and so does a referrer that would only
 * send a signed-out guest straight back here (/admin, /me, /login): closing must never loop.
 */
import type { MouseEvent } from "react";
import { links } from "../public/links";

export const LOGIN_CLOSE_HOME = links.calendar();

const GUARDED = /^\/(admin|me|login)(\/|$)/;

export interface CloseEnv {
  historyLength: number;
  referrer: string;
  origin: string;
}

export function loginCloseTarget(next: string, env: CloseEnv): "back" | string {
  if (/^\/admin(\/|$|\?)/.test(next)) return LOGIN_CLOSE_HOME;
  if (env.historyLength > 1 && env.referrer) {
    try {
      const from = new URL(env.referrer);
      if (from.origin === env.origin && !GUARDED.test(from.pathname)) return "back";
    } catch {
      // An unparsable referrer is not "this site".
    }
  }
  return LOGIN_CLOSE_HOME;
}

export function closeLogin(next: string): void {
  const target = loginCloseTarget(next, { historyLength: window.history.length, referrer: document.referrer, origin: window.location.origin });
  if (target === "back") window.history.back();
  else window.location.assign(target);
}

/** The × link's click: a plain click closes (Back or home); modified clicks keep the link's default. */
export const onLoginClose = (next: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  closeLogin(next);
};
