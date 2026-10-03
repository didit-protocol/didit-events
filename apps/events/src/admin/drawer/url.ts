"use client";

import { useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * The side panels live in the URL (`?applicant=`, `?guest=`, `?person=`, `?scan=`) but opening, moving and closing
 * one is not a page navigation: the list under it is already on screen. The URL changes through the History API
 * (Next 16 keeps `useSearchParams` in sync with it, and back/forward work), the panel's host reads the param here
 * and fetches the detail itself.
 */

const CHANGE = "didit-events:drawer-url";
/** Mounted hosts: without one (the frame gallery, a render test) a drawer link is a plain page load. */
let hosts = 0;

/** Moves the URL to `href` without a server navigation; a page load when no drawer host is mounted. */
export function drawerGo(href: string, mode: "push" | "replace" = "push"): void {
  if (hosts === 0) return window.location.assign(href);
  const url = new URL(href, window.location.href);
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(CHANGE, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(CHANGE, notify);
  };
}
const search = () => window.location.search;
const noSearch = () => "";

/** The search params without `drop`, in a stable order: two URLs with the same list under the drawer compare equal. */
function listPart(url: URL, drop: readonly string[]): string {
  const p = new URLSearchParams(url.search);
  for (const k of drop) p.delete(k);
  p.sort();
  return p.toString();
}

/** True when `to` is the page at `from` with only the drawer params changed. */
export function sameList(from: URL, to: URL, params: readonly string[]): boolean {
  return to.origin === from.origin && to.pathname === from.pathname && listPart(to, params) === listPart(from, params);
}

/**
 * A drawer host's view of the URL. While mounted, a plain click on any link that changes only `params` (a row's name,
 * ‹ ›, a link inside the drawer) is taken over: the URL moves, nothing reloads. Other links navigate as usual.
 */
export function useDrawerUrl(params: readonly string[]): URLSearchParams {
  const next = useContext(SearchParamsContext);
  // Outside the app router (render tests) the History API is read directly.
  const own = useSyncExternalStore(subscribe, search, noSearch);
  const key = params.join(",");
  useEffect(() => {
    const names = key.split(",");
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (!sameList(new URL(window.location.href), to, names) || to.hash) return;
      e.preventDefault();
      drawerGo(to.href);
    };
    hosts++;
    // Capture: rows stop the click from bubbling to keep their own handlers from firing twice.
    document.addEventListener("click", onClick, true);
    return () => {
      hosts--;
      document.removeEventListener("click", onClick, true);
    };
  }, [key]);
  return useMemo(() => next ?? new URLSearchParams(own), [next, own]);
}
