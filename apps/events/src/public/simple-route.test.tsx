// /e/[slug] with the simple (G-01) template: signed-in guest prefill, status instead of form, staff note, gate.
import type { CardState, Viewer } from "./types";

const state = vi.hoisted(() => ({
  viewer: null as Viewer | null,
  staff: null as { email: string } | null,
  card: null as CardState | null,
  gate: "open" as "open" | "closed" | "full" | "ended",
}));
vi.mock("../server/b4-policy", () => ({ staffViewer: async () => state.staff }));
vi.mock("../../app/e/[slug]/actions", () => ({ requestAction: async () => ({ status: "idle" }), signOutAction: async () => {}, subscribeAction: async () => {}, verifyAction: async () => {} }));
vi.mock("../../app/e/[slug]/data", async () => {
  const { findEvent } = await import("./fixtures");
  return {
    getEvent: async (slug: string) => findEvent(slug) ?? null,
    getEventPage: async (slug: string) => {
      const event = findEvent(slug);
      return event ? { template: "simple", event, gate: state.gate, viewer: state.viewer, card: state.card } : null;
    },
  };
});
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("404"); }), redirect: vi.fn() }));

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const EventRoute = (await import("../../app/e/[slug]/page")).default;
const p = <T,>(v: T) => Promise.resolve(v);
const html = async () => renderToStaticMarkup(await EventRoute({ params: p({ slug: "barcelona-office-opening" }), searchParams: p({}) })).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const alberto: Viewer = { firstName: "Alberto", lastName: "Rosas", email: "alberto@example.com", company: "Didit" };

beforeEach(() => Object.assign(state, { viewer: null, staff: null, card: null, gate: "open" }));

describe("/e/[slug] simple template", () => {
  it("signed out: the email input is there", async () => {
    const out = await html();
    expect(out).toContain("Request to attend");
    expect(out).toMatch(/<input[^>]*name="email"/);
    expect(out).not.toContain("Requesting as");
  });

  it("signed-in guest: prefilled names, read-only email with a sign-out form", async () => {
    state.viewer = alberto;
    state.staff = { email: "ops@didit.me" };
    const out = await html();
    expect(out).toContain('value="Alberto"');
    expect(out).toContain('value="Didit"');
    expect(out).not.toMatch(/<input[^>]*name="email"/);
    expect(out).toContain("alberto@example.com</strong> · Not you? ");
    expect(out).toContain('id="signout-barcelona-office-opening"');
    expect(out).not.toContain("signed in as staff");
  });

  it("already requested: the status card replaces the form", async () => {
    state.viewer = alberto;
    state.card = { kind: "pending", viewer: alberto, requestedAt: "2026-09-29T10:00:00+02:00", replyBy: "2026-10-02T18:00:00+02:00" };
    const out = await html();
    expect(out).toContain('data-card="pending"');
    expect(out).not.toContain("<form");
    state.card = { kind: "waitlist", position: 3 };
    expect(await html()).toContain('data-card="waitlist"');
  });

  it("the status card wins over a closed gate; without one the gate message replaces the form", async () => {
    state.gate = "closed";
    state.viewer = alberto;
    state.card = { kind: "going", viewer: alberto };
    expect(await html()).toContain('data-card="going"');
    state.card = null;
    const closed = await html();
    expect(closed).toContain("Requests are closed");
    expect(closed).not.toContain("Request to attend");
  });

  it("staff without a guest session: a note, not a silent second ask", async () => {
    state.staff = { email: "ops@didit.me" };
    const out = await html();
    expect(out).toContain("You’re signed in as staff (ops@didit.me). Requests use a guest account.");
    expect(out).toContain("Request to attend");
  });
});
