import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cardContent } from "./card";
import { RegistrationCard, RequestCard } from "./components/RegistrationCard";
import { AI_ERA, CARD_STATES, MARIA } from "./fixtures";
import type { CardState } from "./types";

const noop = async () => {};
const actions = { verify: noop, subscribe: noop };
const state = (code: string) => CARD_STATES.find((c) => c.code === code)!.state;
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("cardContent (P-02a–n copy)", () => {
  it.each([
    ["P-02a", "Approval required", "Create your account, verify you're human once, and get recognised at your next Didit event."],
    ["P-02b", "Your request is in", "The hosts review every request. You will hear back by Fri 2 Oct either way."],
    ["P-02c", "One step left: verify with Didit", "Confirm your name and email, then take a quick selfie. 2 minutes, and it becomes your ticket."],
    ["P-02f", "You are in, María", "Your face is your ticket. At the door, just look at the screen."],
    ["P-02g", "We could not verify you", "The selfie did not pass the liveness check. Try again in good light, facing the camera. 1 attempt left."],
    ["P-02h", "You are #12 on the waitlist", "Places open up as people cancel. If one frees up the hosts can offer it to you, and we email you straight away."],
    ["P-02j", "Event is full", "All 120 places are taken. Join the waitlist and we will let you know if a place opens."],
    ["P-02k", "Registration is closed", "Requests closed on Tue 6 Oct. If you were approved, check your email for your verification link."],
    ["P-02l", "Welcome in, María", "Checked in at 18:42 at Main door. Wi-Fi: Didit-Guest · EXAMPLE-WIFI-PASSWORD."],
    ["P-02m", "This event has ended", "104 founders and operators joined. Find the next Didit event on the calendar."],
  ])("%s", (code, title, body) => {
    const c = cardContent(state(code), AI_ERA);
    expect(c.title).toBe(title);
    expect(c.body).toBe(body);
  });

  it("footnotes carry the dates and email", () => {
    expect(cardContent(state("P-02b"), AI_ERA).foot?.text).toBe("Requested 29 Sep · maria.garcia@gmail.com");
    expect(cardContent(state("P-02c"), AI_ERA).foot?.text).toBe("Link expires Mon 5 Oct · Handled by Didit · ");
  });

  it("every active registration can be withdrawn (pending, waitlist) or cancelled (an approved place)", () => {
    expect(cardContent(state("P-02b"), AI_ERA).cta2).toEqual({ label: "Withdraw request", href: "/me/events/ai-era/withdraw" });
    expect(cardContent(state("P-02h"), AI_ERA).cta2).toEqual({ label: "Withdraw request", href: "/me/events/ai-era/cancel" });
    for (const code of ["P-02c", "P-02d", "P-02e", "P-02f", "P-02g"]) {
      expect(cardContent(state(code), AI_ERA).foot?.link, code).toEqual({ label: "Cancel my place", href: "/me/events/ai-era/cancel" });
    }
    for (const code of ["P-02i", "P-02j", "P-02k", "P-02l", "P-02m"]) {
      const c = cardContent(state(code), AI_ERA);
      expect([c.cta2?.label, c.foot?.link?.label], code).not.toContain("Cancel my place");
    }
  });

  it("Didit progress: approved has nothing done, verification started has two done and the selfie in progress", () => {
    expect(cardContent(state("P-02c"), AI_ERA).progress?.map((p) => [p.bar, p.reached])).toEqual([
      ["todo", true],
      ["todo", false],
      ["todo", false],
    ]);
    expect(cardContent(state("P-02d"), AI_ERA).progress?.map((p) => p.bar)).toEqual(["done", "done", "current"]);
  });

  it("buttons: links for navigation, server actions for Didit and subscribe", () => {
    expect(cardContent(state("P-02a"), AI_ERA).cta).toEqual({ label: "Request to join", href: "/e/ai-era?join=1" });
    expect(cardContent(state("P-02c"), AI_ERA).cta).toEqual({ label: "Verify my identity", action: "verify" });
    expect(cardContent(state("P-02f"), AI_ERA).cta).toEqual({ label: "Add to calendar", href: "/e/ai-era/event.ics" });
    expect(cardContent(state("P-02i"), AI_ERA).cta).toEqual({ label: "Subscribe to Didit Events", action: "subscribe" });
    for (const code of ["P-02e", "P-02k", "P-02l"]) {
      const c = cardContent(state(code), AI_ERA);
      expect(c.cta ?? c.cta2, code).toBeUndefined();
    }
  });

  it("pluralises attempts", () => {
    expect(cardContent({ kind: "declined", attemptsLeft: 2 }, AI_ERA).body).toContain("2 attempts left.");
  });
});

describe("RegistrationCard", () => {
  it("switches content by state: pill, glyph, buttons, footnote link", () => {
    const pending = decode(renderToStaticMarkup(<RegistrationCard event={AI_ERA} state={state("P-02b")} actions={actions} />));
    expect(pending).toContain('data-card="pending"');
    expect(pending).toContain('data-status="link-sent"');
    expect(pending).toContain(">Pending<");
    expect(pending).toContain('href="/me/events/ai-era/withdraw"');

    const going = decode(renderToStaticMarkup(<RegistrationCard event={AI_ERA} state={state("P-02f")} actions={actions} />));
    expect(going).toContain(">Going<");
    expect(going).toContain('href="https://maps.google.com/?q=Carrer+de+Pallars+99,+08018+Barcelona"');
    expect(going).toContain('rel="noopener noreferrer"');
    expect(going).toContain('<a href="/me/events/ai-era/cancel"');
  });

  it("server-action buttons are one-button forms carrying the slug, with a pending label", () => {
    const html = renderToStaticMarkup(<RegistrationCard event={AI_ERA} state={state("P-02c")} actions={actions} />);
    expect(html).toMatch(/<form[^>]*><input type="hidden" name="csrf" value=""\/><input type="hidden" name="slug" value="ai-era"\/><button type="submit"/);
    expect(html).toContain("Verify my identity");
    expect(html).toContain('aria-label="Didit verification steps"');
  });

  it("is a labelled region whose status text is a polite live region", () => {
    const html = renderToStaticMarkup(<RegistrationCard event={AI_ERA} state={state("P-02e")} actions={actions} />);
    expect(html).toContain('aria-labelledby="reg-ai-era"');
    expect(html).toContain('id="reg-ai-era"');
    expect(html).toContain('aria-live="polite"');
  });

  it("P-01 request card shows who is signed in", () => {
    const html = decode(renderToStaticMarkup(<RequestCard event={AI_ERA} viewer={MARIA} actions={actions} />));
    expect(html).toContain("María García");
    expect(html).toContain("maria.garcia@gmail.com");
    expect(html).toContain("Your registration is subject to host approval. 120 places.");
  });

  it("every state renders", () => {
    for (const { state: st } of CARD_STATES) expect(renderToStaticMarkup(<RegistrationCard event={AI_ERA} state={st as CardState} actions={actions} />)).toContain("<section");
  });
});
