// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawerGo, sameList, useDrawerUrl } from "./url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.history.replaceState(null, "", "/admin/events/e/applicants?tab=approved");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Probe() {
  const search = useDrawerUrl(["applicant"]);
  return <output>{search.get("applicant") ?? "none"}</output>;
}
const shown = () => host.querySelector("output")!.textContent;
const link = (href: string, attrs: Record<string, string> = {}) => {
  const a = document.createElement("a");
  a.href = href;
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  host.appendChild(a);
  return a;
};
/** A real click; returns whether the browser would still follow the link. */
const click = (a: HTMLAnchorElement, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  // jsdom would log "navigation not implemented" for a followed link: the test only needs to know it was not taken over.
  a.addEventListener("click", (e) => e.preventDefault(), { once: true });
  let taken = false;
  const spy = (e: Event) => (taken = e.defaultPrevented);
  document.addEventListener("click", spy, { capture: true, once: true });
  act(() => void a.dispatchEvent(event));
  return taken;
};

describe("sameList", () => {
  const at = (s: string) => new URL(`https://x.test/admin/events/e/applicants${s}`);
  it("is true only when nothing but the drawer params differs", () => {
    expect(sameList(at("?tab=approved"), at("?tab=approved&applicant=a"), ["applicant"])).toBe(true);
    expect(sameList(at("?q=a&tab=approved&applicant=a"), at("?applicant=b&tab=approved&q=a"), ["applicant"])).toBe(true);
    expect(sameList(at("?tab=approved"), at("?applicant=a"), ["applicant"])).toBe(false);
    expect(sameList(at(""), new URL("https://x.test/admin/events/e/guests?applicant=a"), ["applicant"])).toBe(false);
    expect(sameList(at(""), new URL("https://other.test/admin/events/e/applicants?applicant=a"), ["applicant"])).toBe(false);
  });
});

describe("useDrawerUrl", () => {
  it("drawerGo moves the URL with the History API and the host re-reads it; back restores the previous one", async () => {
    const push = vi.spyOn(window.history, "pushState");
    act(() => root.render(<Probe />));
    expect(shown()).toBe("none");
    act(() => drawerGo("/admin/events/e/applicants?tab=approved&applicant=a"));
    expect(shown()).toBe("a");
    expect(window.location.search).toBe("?tab=approved&applicant=a");
    act(() => drawerGo("/admin/events/e/applicants?tab=approved&applicant=b"));
    expect(shown()).toBe("b");
    expect(push).toHaveBeenCalledTimes(2);
    // The same URL again is not a new history entry.
    act(() => drawerGo("/admin/events/e/applicants?tab=approved&applicant=b"));
    expect(push).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.history.back();
      await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    });
    expect(shown()).toBe("a");
    act(() => drawerGo("/admin/events/e/applicants?tab=approved", "replace"));
    expect(shown()).toBe("none");
    push.mockRestore();
  });

  it("takes over a plain click on a link that only changes the drawer param; every other link is left alone", () => {
    act(() => root.render(<Probe />));
    expect(click(link("/admin/events/e/applicants?tab=approved&applicant=a"))).toBe(true);
    expect(shown()).toBe("a");
    // Another list (tab), another page, a new tab, a modified click, a download: the browser's.
    expect(click(link("/admin/events/e/applicants?tab=pending&applicant=b"))).toBe(false);
    expect(click(link("/admin/events/e/guests?applicant=b"))).toBe(false);
    expect(click(link("/admin/events/e/applicants?tab=approved&applicant=b", { target: "_blank" }))).toBe(false);
    expect(click(link("/admin/events/e/applicants?tab=approved&applicant=b"), { metaKey: true })).toBe(false);
    expect(click(link("/admin/events/e/applicants?tab=approved&applicant=b", { download: "" }))).toBe(false);
    expect(shown()).toBe("a");
  });

  it("without a mounted host a drawer link is a plain page load", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, href: window.location.href });
    drawerGo("/admin/events/e/applicants?applicant=a");
    expect(assign).toHaveBeenCalledWith("/admin/events/e/applicants?applicant=a");
    vi.unstubAllGlobals();
  });
});
