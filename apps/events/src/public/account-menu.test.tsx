// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CsrfProvider } from "../auth/CsrfField";
import { adminMenuItems } from "../admin/shell/AdminShell";
import { AccountMenu } from "./components/AccountMenu";
import { SiteHeader } from "./components/SiteHeader";
import type { Viewer } from "./types";

vi.mock("../../app/me/settings/actions", () => ({ signOutAction: vi.fn(async () => {}) }));

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
  host.remove();
});

const render = (el: ReactElement) => act(() => root.render(<CsrfProvider token="csrf-token">{el}</CsrfProvider>));
const trigger = () => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement;
const menu = () => host.querySelector('[role="menu"]');
const items = () => Array.from(host.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

const MARIA: Viewer = { firstName: "María", lastName: "García", email: "maria.garcia@gmail.com" };
const NEW: Viewer = { firstName: "", lastName: "", email: "zoe@example.com" };

describe("header avatar", () => {
  it("shows the first letter of the first name, else of the email, never an empty circle", () => {
    render(<SiteHeader viewer={MARIA} />);
    expect(trigger().querySelector('[role="img"]')!.textContent).toBe("M");
    render(<SiteHeader viewer={NEW} />);
    expect(trigger().querySelector('[role="img"]')!.textContent).toBe("Z");
    expect(trigger().getAttribute("aria-label")).toBe("zoe@example.com, account menu");
  });

  it("shows the stored photo when there is one", () => {
    render(<SiteHeader viewer={{ ...MARIA, photoUrl: "/api/me/photo?v=42" }} />);
    expect(trigger().querySelector("img")!.getAttribute("src")).toBe("/api/me/photo?v=42");
  });
});

describe("header avatar menu", () => {
  it("click opens Explore events / My events / Profile / Settings / Sign out and focuses the first item", () => {
    render(<SiteHeader viewer={MARIA} />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(menu()!.id);
    expect(items().map((i) => i.textContent)).toEqual(["Explore events", "My events", "Profile", "Settings", "Sign out"]);
    expect(items().slice(0, 4).map((i) => i.getAttribute("href"))).toEqual(["/events", "/me/events", "/me/profile/edit", "/me/settings"]);
    expect(document.activeElement).toBe(items()[0]);
    expect(menu()!.textContent).toContain("María García");
    expect(menu()!.textContent).toContain("maria.garcia@gmail.com");
  });

  it("Sign out posts the CSRF-guarded sign-out form", () => {
    render(<SiteHeader viewer={MARIA} />);
    act(() => trigger().click());
    const signOut = items()[4] as HTMLButtonElement;
    expect(signOut.type).toBe("submit");
    const form = signOut.closest("form")!;
    expect((form.querySelector('input[name="csrf"]') as HTMLInputElement).value).toBe("csrf-token");
  });

  it("arrow keys, Home and End move focus; Escape closes and returns focus to the avatar", () => {
    render(<SiteHeader viewer={MARIA} />);
    act(() => trigger().focus());
    key(trigger(), "ArrowDown");
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1]!, "End");
    expect(document.activeElement).toBe(items()[4]);
    key(items()[4]!, "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(items()[4]);
    key(items()[4]!, "Home");
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    // ArrowUp on the avatar opens on the last item.
    key(trigger(), "ArrowUp");
    expect(document.activeElement).toBe(items()[4]);
  });

  it("the keyboard skips items the stylesheet hides (Explore events on a wide header)", () => {
    render(<SiteHeader viewer={MARIA} />);
    act(() => trigger().click());
    const explore = items()[0]!;
    explore.style.display = "none";
    key(items()[4]!, "Home");
    expect(document.activeElement?.textContent).toBe("My events");
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement?.textContent).toBe("Sign out");
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("My events");
  });

  it("a click outside closes it; clicking the avatar again toggles it", () => {
    render(<SiteHeader viewer={MARIA} />);
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    act(() => void document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(menu()).toBeNull();
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    act(() => trigger().click());
    expect(menu()).toBeNull();
  });

  it("phones: Explore events and My events are in the avatar menu (the bar keeps only the logo and the avatar)", () => {
    render(<SiteHeader viewer={MARIA} />);
    act(() => trigger().click());
    const all = Array.from(host.querySelectorAll<HTMLElement>('[role="menu"] a'));
    expect(all.map((i) => [i.textContent, i.getAttribute("href")]).slice(0, 2)).toEqual([["Explore events", "/events"], ["My events", "/me/events"]]);
    expect(all[0]!.className).toContain("phoneOnly");
    expect(all[1]!.className).not.toContain("phoneOnly");
    const menuCss = readFileSync(resolve(import.meta.dirname, "components/AccountMenu.module.css"), "utf8");
    expect(menuCss).toMatch(/\.phoneOnly \{ display: none; \}\n@container site-header \(max-width: 767px\) \{\n  \.phoneOnly \{ display: flex; \}/);
    const headerCss = readFileSync(resolve(import.meta.dirname, "components/SiteHeader.module.css"), "utf8");
    expect(headerCss).toMatch(/@container site-header \(max-width: 767px\) \{[^}]*\}\s*\.clock, \.staff, \.link, \.tag \{ display: none; \}/);
  });

  it("the admin passes its own items: the sections the viewer may open, View site, then Sign out", () => {
    const owner = { name: "Alberto Rosas", email: "events.team@didit.me", initials: "A", role: "owner" as const };
    render(<AccountMenu name={owner.name} email={owner.email} items={adminMenuItems(owner, "team")} />);
    act(() => trigger().click());
    expect(items().map((i) => i.textContent)).toEqual(["Events", "People", "Team", "Calendar", "View site", "Sign out"]);
    expect(items().map((i) => i.getAttribute("href")).slice(0, 5)).toEqual(["/admin", "/admin/people", "/admin/team", "/admin/calendar", "/events"]);
    expect(items().filter((i) => i.getAttribute("aria-current") === "page").map((i) => i.textContent)).toEqual(["Team"]);
    expect(adminMenuItems({ ...owner, role: "admin" }).map((i) => i.label)).toEqual(["Events", "Team", "Calendar", "View site"]);
    expect(adminMenuItems({ ...owner, role: "staff", member: "host" }).map((i) => i.label)).toEqual(["Events", "View site"]);
  });

  it("keeps the Admin staff chip next to the guest menu, and next to Sign in when signed out", () => {
    render(<SiteHeader viewer={MARIA} staff={{ email: "events.team@didit.me" }} />);
    const chip = host.querySelector('a[href="/admin"]')!;
    expect(chip.textContent).toContain("Admin · events.team");
    expect(trigger()).not.toBeNull();
    render(<SiteHeader viewer={null} staff={{ email: "events.team@didit.me" }} />);
    expect(host.querySelector('a[href="/admin"]')!.textContent).toContain("Admin · events.team");
    expect(trigger()).toBeNull();
    expect(host.textContent).toContain("Sign in");
  });
});

it.each([SiteHeader])("staff role controls the first menu item in the header", Header => {
  render(<Header viewer={{ ...MARIA, email: "maria@didit.me", staffRole: "staff" }} />);
  act(() => trigger().click());
  expect(items()[0]?.textContent).toBe("Admin panel");
  expect(items()[0]?.getAttribute("href")).toBe("/admin");
  expect(document.activeElement).toBe(items()[0]);
  key(items()[0]!, "End"); expect(document.activeElement?.textContent).toBe("Sign out");
  key(items().at(-1)!, "Escape");
  render(<Header viewer={MARIA} />); act(() => trigger().click());
  expect(items().map(item => item.textContent)).not.toContain("Admin panel");
});
