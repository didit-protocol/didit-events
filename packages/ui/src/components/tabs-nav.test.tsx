// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminSidebar } from "./AdminSidebar";
import { ButtonLink } from "./Button";
import { Breadcrumbs, ClientButtonLink } from "./ClientLink";
import { Tabs } from "./Tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const ITEMS = [
  { id: "overview", label: "Overview", href: "/admin/events/e1" },
  { id: "guests", label: "Guests", href: "/admin/events/e1/guests" },
  { id: "door", label: "Door", href: "/admin/events/e1/door" },
];
const current = () => [...document.querySelectorAll('nav [aria-current="page"]')].map((a) => a.textContent);
const tab = (name: string) => [...document.querySelectorAll<HTMLAnchorElement>("nav a")].find((a) => a.textContent === name)!;
const click = (el: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
};

/**
 * The app router in miniature: `push` starts a navigation inside the caller's transition and the tree suspends until
 * the page arrives, which is what keeps an optimistic value on screen in the real router.
 */
type Navigation = Promise<string> & { landed?: string };
function harness() {
  const pushed: string[] = [];
  let arrive: (segment: string) => void = () => {};
  function App() {
    const [nav, setNav] = useState<Navigation | null>(null);
    if (nav && nav.landed === undefined) throw nav;
    const router = {
      push: (href: string) => {
        pushed.push(href);
        const page: Navigation = new Promise<string>((resolve) => {
          arrive = (segment) => {
            page.landed = segment;
            resolve(segment);
          };
        });
        setNav(page);
      },
      prefetch: () => {},
    } as unknown as AppRouterInstance;
    return (
      <AppRouterContext.Provider value={router}>
        <Tabs label="Event sections" value={nav?.landed ?? "overview"} items={ITEMS} />
      </AppRouterContext.Provider>
    );
  }
  return { App, pushed, arrive: (segment: string) => act(async () => arrive(segment)) };
}

describe("link tabs navigate on the client", () => {
  it("marks the clicked tab current at once, before its page arrives, and pushes instead of loading a document", async () => {
    const h = harness();
    await act(async () => root.render(<h.App />));
    expect(current()).toEqual(["Overview"]);

    const event = click(tab("Guests"));
    expect(event.defaultPrevented).toBe(true);
    expect(h.pushed).toEqual(["/admin/events/e1/guests"]);
    // The page has not arrived: the tab already shows as open.
    expect(current()).toEqual(["Guests"]);

    await h.arrive("guests");
    expect(current()).toEqual(["Guests"]);
  });

  it("follows a second click made while the first page is still loading", async () => {
    const h = harness();
    await act(async () => root.render(<h.App />));
    click(tab("Guests"));
    click(tab("Door"));
    expect(h.pushed).toEqual(["/admin/events/e1/guests", "/admin/events/e1/door"]);
    // React paints a second optimistic value on its next tick, not inside the click.
    await act(async () => {});
    expect(current()).toEqual(["Door"]);
    await h.arrive("door");
    expect(current()).toEqual(["Door"]);
  });

  it("falls back to the real tab when the navigation does not land", async () => {
    const h = harness();
    await act(async () => root.render(<h.App />));
    click(tab("Door"));
    expect(current()).toEqual(["Door"]);
    // The server sent the viewer back (a redirect): the URL segment is the one it was.
    await h.arrive("overview");
    expect(h.pushed).toEqual(["/admin/events/e1/door"]);
    expect(current()).toEqual(["Overview"]);
  });

  it("leaves modified clicks, handled clicks and the open tab to the link", async () => {
    const h = harness();
    await act(async () => root.render(<h.App />));
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) click(tab("Guests"), init);
    // The unsaved-changes guard cancels the click on the document, in the capture phase.
    const guard = (e: Event) => e.preventDefault();
    document.addEventListener("click", guard, true);
    click(tab("Guests"));
    document.removeEventListener("click", guard, true);
    click(tab("Overview"));
    expect(h.pushed).toEqual([]);
    expect(current()).toEqual(["Overview"]);
  });

  it("without a router the tabs are plain links to their pages", () => {
    act(() => root.render(<Tabs label="Event sections" value="guests" items={ITEMS} />));
    expect(current()).toEqual(["Guests"]);
    expect([...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href"))).toEqual(ITEMS.map((t) => t.href));
    // Not taken over: the browser follows the link.
    expect(click(tab("Door")).defaultPrevented).toBe(false);
    expect(current()).toEqual(["Guests"]);
  });
});

describe("admin links render as the same anchors", () => {
  const html = (el: ReactElement) => renderToStaticMarkup(el);

  it("sidebar: every section, the logo and View site keep their href, and the open section stays current", () => {
    const out = html(<AdminSidebar active="team" user={{ name: "Ada Lovelace", email: "ada@didit.me" }} sections={["events", "team", "calendar", "people"]} />);
    for (const href of ["/admin", "/events", "/admin/team", "/admin/calendar", "/admin/people"]) expect(out).toContain(`href="${href}"`);
    expect(out).toMatch(/<a(?=[^>]*href="\/admin\/team")(?=[^>]*aria-current="page")/);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    // Sign out changes cookies: still a form post.
    expect(out).toContain('<form action="/api/auth/logout" method="post">');
  });

  it("breadcrumbs link pages of the app and leave other destinations alone", () => {
    const out = html(<Breadcrumbs items={[{ label: "Events", href: "/admin" }, { label: "Docs", href: "https://docs.didit.me/" }, { label: "Odd", href: "//evil.test/" }, { label: "AI Era" }]} />);
    expect(out).toContain('<a href="/admin">Events</a>');
    expect(out).toContain('<a href="https://docs.didit.me/">Docs</a>');
    expect(out).toContain('<a href="//evil.test/">Odd</a>');
    expect(out).toContain('<span aria-current="page">AI Era</span>');
  });

  it("ClientButtonLink changes how the link navigates, not its markup", () => {
    const plain = html(<ButtonLink href="/admin/events/new" variant="secondary">New event</ButtonLink>);
    expect(html(<ClientButtonLink href="/admin/events/new" variant="secondary">New event</ClientButtonLink>)).toBe(plain);
    expect(plain).toMatch(/^<a class="[^"]+" href="\/admin\/events\/new">New event<\/a>$/);
  });
});
