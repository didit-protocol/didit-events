import { existsSync, globSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LoginPage from "../../app/admin/login/page";
import ForbiddenPage from "../../app/admin/forbidden/page";
import Forbidden from "../../app/forbidden";
import EventsLayout from "../../app/admin/(events)/layout";
import { requireStaff } from "../../app/admin/data";
import { switchAccountAction } from "../../app/admin/login/actions";
import { anonymousCsrf, anonymousHeaders, testOrigin, testSecret } from "./testing-browser";
import { IdentityError } from "@didit-events/core/identity";

const auth = vi.hoisted(() => ({ requireStaff: vi.fn(), resolve: vi.fn() }));
vi.mock("@didit-events/core/status", () => ({ operationalStatus: async () => ({ diditApi: "ok" }) }));
vi.mock("./runtime", () => ({ identity: { auth: { requireStaff: auth.requireStaff }, sessions: { resolve: auth.resolve } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => anonymousHeaders() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Error("HTTP:403"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
const next = "/admin/events/barcelona/guests?add=paste";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", testOrigin); vi.stubEnv("SESSION_SECRET", testSecret);
  auth.requireStaff.mockRejectedValue(new IdentityError("InvalidSession", 401));
});
afterEach(() => vi.unstubAllEnvs());
it("every app page maps to a unique route, with one A-02 /admin page and no root staff wrapper", () => {
  const root = new URL("../../app/", import.meta.url), routes = new Map<string, string[]>();
  for (const file of globSync("**/page.{tsx,ts,jsx,js}", { cwd: root })) {
    const route = "/" + file.split("/").slice(0, -1).filter(part => !part.startsWith("(") && !part.startsWith("@")).join("/");
    routes.set(route, [...(routes.get(route) ?? []), file]);
  }
  expect([...routes].filter(([, files]) => files.length > 1)).toEqual([]);
  expect(routes.get("/admin")).toEqual(["admin/(events)/(list)/page.tsx"]);
  expect(existsSync(new URL("admin/layout.tsx", root))).toBe(false);
});
it("old admin login redirects to the single account login with a safe next", async () => {
  await expect(LoginPage({ searchParams: Promise.resolve({ next }) })).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(next)}`);
  await expect(LoginPage({ searchParams: Promise.resolve({ next: "//evil.test", error: "expired" }) })).rejects.toThrow("REDIRECT:/login?next=%2Fadmin&reason=expired");
});
it("forbidden responds with HTTP 403 and offers the site and account login", async () => {
  expect(() => ForbiddenPage()).toThrow("HTTP:403");
  const html = renderToStaticMarkup(await Forbidden());
  expect(html).toContain("No access"); expect(html).toContain('href="/events"');
  const form = new FormData(); form.set("csrf", anonymousCsrf); form.set("next", next);
  await expect(switchAccountAction(form)).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(next)}`);
});
it("signed-in non-staff routes to forbidden without restarting login", async () => {
  auth.requireStaff.mockRejectedValue(new IdentityError("StaffForbidden", 403));
  await expect(requireStaff(next)).rejects.toThrow(`REDIRECT:/admin/forbidden?next=${encodeURIComponent(next)}`);
});
it("an enabled staff account renders admin directly", async () => {
  auth.requireStaff.mockResolvedValue({ principal: "staff", email: "ops@didit.me", role: "admin" });
  const html = renderToStaticMarkup(await EventsLayout({ children: "private" }));
  expect(html).toContain("private"); expect(html).toContain("ops@didit.me"); expect(html).toContain("View site");
});
it("staff layouts stay protected and per-page guards preserve the caller's next", async () => {
  await expect(EventsLayout({ children: "private" })).rejects.toThrow("REDIRECT:/login?next=%2Fadmin");
  await expect(requireStaff(next)).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(next)}`);
});
