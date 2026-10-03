import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CancelSheet } from "./components/CancelSheet";
import { MyEventsScreen } from "./components/MyEvents";
import { SecuredByDidit } from "./components/SecuredByDidit";
import { styles } from "./components/Screen";
import { StatusScreen, type StatusActions } from "./components/StatusScreen";
import { AI_ERA, FIXED_NOW, MARIA, MY_EVENTS, STATUS } from "./fixtures";
import type { GuestEventStatus } from "./types";
import { hasStarted, withdrawalFor, withdrawalFromView } from "./withdrawal";

const noop = async () => {};
const actions: StatusActions = { verify: noop, renew: noop, newLink: noop, joinWaitlist: noop, subscribe: noop };
const screen = (status: GuestEventStatus, now?: Date) => renderToStaticMarkup(<StatusScreen event={AI_ERA} account={MARIA} status={status} actions={actions} now={now} />);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("withdraw / cancel on every active status (event model v2)", () => {
  it.each(["pendingNew", "pendingReturning", "waitlisted"])("%s → one Withdraw request", (key) => {
    const html = screen(STATUS[key]!);
    expect(count(html, ">Withdraw request<"), key).toBe(1);
    expect(html).not.toContain("Cancel my place");
  });

  it.each(["approved", "going", "goingReused", "inReview", "declinedRetry", "declinedFinal", "linkExpired", "emailMismatch", "selfieExpired"])("%s → one Cancel my place", (key) => {
    const html = screen(STATUS[key]!);
    expect(count(html, ">Cancel my place<"), key).toBe(1);
    expect(html).toContain('href="/me/events/ai-era/cancel"');
    expect(html).not.toContain("Withdraw request");
  });

  it.each(["notApproved", "cancelled", "cancelledNow", "full", "closed", "checkedIn", "ended", "linkOtherAccount"])("%s (terminal / not active) → no withdraw or cancel", (key) => {
    const html = screen(STATUS[key]!);
    expect(html).not.toContain("Withdraw request");
    expect(html).not.toContain("Cancel my place");
  });

  it.each(Object.keys(STATUS))("%s → at most one secondary action; withdraw / cancel is the quiet link when cta2 exists", (key) => {
    const html = screen(STATUS[key]!, FIXED_NOW);
    const secondary = count(html, styles.cta2!);
    expect(secondary, key).toBeLessThanOrEqual(1);
    const w = html.match(/<a [^>]*data-withdrawal="[^"]+"[^>]*>|<span data-withdrawal="[^"]+"/)?.[0];
    if (!w) return;
    if (w.startsWith("<a ")) {
      // Quiet link: the status has its own secondary action, and the withdrawal is not a second button.
      expect(w, key).toContain(styles.quietAction!);
      expect(w, key).not.toContain(styles.cta2!);
      expect(secondary, key).toBe(1);
    } else {
      // No other secondary on the screen: the withdrawal is the single secondary button.
      expect(secondary, key).toBe(1);
    }
  });

  it("routes: pending → /withdraw, waitlisted → /cancel (the route that serves the waitlist)", () => {
    expect(withdrawalFor("pending", "x")?.href).toBe("/me/events/x/withdraw");
    expect(withdrawalFor("waitlisted", "x")?.href).toBe("/me/events/x/cancel");
  });

  it("follows the server's GuestRegistrationView.withdrawal once wired", () => {
    const w = (admission: "pending" | "waitlisted" | "approved", label: "Withdraw request" | "Cancel place", allowed = true) =>
      withdrawalFromView({ slug: "x", admission, withdrawal: { allowed, label, late: false, unavailableReason: null } });
    expect(w("pending", "Withdraw request")).toEqual({ kind: "withdraw", label: "Withdraw request", href: "/me/events/x/withdraw" });
    expect(w("waitlisted", "Withdraw request")?.href).toBe("/me/events/x/cancel");
    expect(w("approved", "Cancel place")).toEqual({ kind: "cancel", label: "Cancel my place", href: "/me/events/x/cancel" });
    expect(w("approved", "Cancel place", false)).toBeNull();
  });

  it("hidden once doors are open (the server refuses it then)", () => {
    expect(hasStarted(AI_ERA.startsAt, new Date("2026-10-08T18:30:00+02:00"))).toBe(true);
    expect(screen(STATUS.going!, new Date("2026-10-08T19:00:00+02:00"))).not.toContain("Cancel my place");
    expect(screen(STATUS.going!, new Date("2026-10-01T12:00:00+02:00"))).toContain("Cancel my place");
  });

  it("My events cards carry the action for active registrations only", () => {
    const html = renderToStaticMarkup(<MyEventsScreen account={MARIA} events={MY_EVENTS} now={FIXED_NOW} />);
    expect(count(html, 'data-withdrawal="cancel"')).toBe(1); // going
    expect(count(html, 'data-withdrawal="withdraw"')).toBe(2); // pending + waitlist
    expect(html).toContain('aria-label="Cancel my place: ');
  });

  it("My events cards hide withdraw / cancel once doors are open (now is required, never omitted)", () => {
    const afterStart = new Date(Math.max(...MY_EVENTS.map((e) => Date.parse(e.event.startsAt))) + 60_000);
    const html = renderToStaticMarkup(<MyEventsScreen account={MARIA} events={MY_EVENTS} now={afterStart} />);
    expect(html).not.toContain("data-withdrawal");
  });

  it("the waitlist sheet says Withdraw request", () => {
    const html = renderToStaticMarkup(<CancelSheet event={AI_ERA} mode={{ mode: "leave_waitlist" }} action={async () => ({})} />);
    expect(html).toContain("Withdraw from the waitlist?");
    expect(html).toContain(">Withdraw request<");
  });
});

describe("guest layout", () => {
  it("sheets (request, cancel) have a close control back to the event and the desktop modal class", () => {
    const html = renderToStaticMarkup(<CancelSheet event={AI_ERA} mode={{ mode: "withdraw" }} action={async () => ({})} />);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('href="/e/ai-era"');
    expect(html).toMatch(/class="[^"]*modal[^"]*"/);
  });

  it("status screens are desktop cards and the flow spacer collapses there", () => {
    const html = screen(STATUS.pendingNew!);
    expect(html).toMatch(/<main class="[^"]*card[^"]*"/);
    expect(html).toMatch(/class="[^"]*spacer[^"]*inline[^"]*"/);
  });

  it("Secured by Didit uses the official Didit logo, announced once", () => {
    const html = renderToStaticMarkup(<SecuredByDidit />);
    expect(html).toContain(">Secured by Didit<"); // screen-reader sentence
    expect(html).toMatch(/<img[^>]*didit-horizontal-color[^>]*alt=""|<img[^>]*alt=""[^>]*didit-horizontal-color/);
    expect(html).toContain('aria-hidden="true"');
  });
});
