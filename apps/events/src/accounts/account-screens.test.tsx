// v7 responsive pass (lane G): the /me screens' markup contracts. Static renders only; sizes are measured in the browser gate.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeleteAccountSheet } from "./components/AccountSheets";
import { CancelSheet, startsIn } from "./components/CancelSheet";
import { isPastEvent, MyEventsScreen } from "./components/MyEvents";
import { ProfileScreen } from "./components/ProfileScreens";
import { SettingsScreen } from "./components/SettingsScreen";
import { SocialChips } from "./components/SocialChips";
import { AI_ERA, MARIA, MY_EVENTS } from "./fixtures";

const noop = async () => {};
const settingsActions = { signOut: noop, signOutAll: noop, toggleMarketing: noop, disconnectGoogle: noop };

describe("cancel sheet: late callout", () => {
  it("whole hours only, and 'less than an hour' near the start", () => {
    expect(startsIn(8.899917222222221)).toBe("in 9 hours");
    expect(startsIn(1)).toBe("in 1 hour");
    expect(startsIn(0)).toBe("in less than an hour");
    const html = renderToStaticMarkup(<CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 0, late: true }} action={async (s) => s} />);
    expect(html).toContain("The event starts in less than an hour.");
    expect(html).not.toMatch(/\d\.\d+ hours/);
  });
  it("each reason row draws a radio ring next to its native radio", () => {
    const html = renderToStaticMarkup(<CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 48, late: false }} action={async (s) => s} />);
    expect(html.match(/type="radio"/g)).toHaveLength(6);
    expect(html.match(/class="[^"]*radioDot[^"]*"/g)).toHaveLength(6);
  });
});

describe("settings: row actions", () => {
  const html = renderToStaticMarkup(<SettingsScreen account={MARIA} actions={settingsActions} />);
  it("'Sign out of all devices' is a row of the ACCOUNT group, after 'Sign out'", () => {
    const group = html.slice(html.indexOf('id="grp-account"'));
    expect(group).toMatch(/form="f-signout"[^>]*>Sign out<[\s\S]*form="f-signout-all"[^>]*>Sign out of all devices</);
    expect(html.slice(0, html.indexOf('id="grp-account"'))).not.toContain("Sign out of all devices");
    expect(html).toContain('<form id="f-signout-all"');
  });
  it("the marketing toggle is a switch named by its row label", () => {
    expect(html).toMatch(/<button type="submit" form="f-marketing"[^>]*role="switch"[^>]*aria-checked="(true|false)"[^>]*aria-labelledby="marketing-label"/);
    expect(html).toContain('<span id="marketing-label">Email me about new Didit events</span>');
  });
  it("the page eyebrow does not repeat the ACCOUNT group title", () => {
    expect(html).toContain(">YOUR ACCOUNT<");
    expect(html.match(/>ACCOUNT</g)).toHaveLength(1);
  });
});

describe("profile head", () => {
  it("names the page, and shows the initial with an 'Add photo' link when there is no photo", () => {
    const html = renderToStaticMarkup(<ProfileScreen account={{ ...MARIA, photoUrl: undefined }} />);
    expect(html).toMatch(/<h1[^>]*id="profile-title"[^>]*>Your public profile<\/h1>/);
    expect(html).toMatch(/<h2 id="profile-name"/);
    expect(html).toMatch(/class="[^"]*photoInitial[^"]*" aria-hidden="true">M</);
    expect(html).toMatch(/<a href="\/me\/profile\/photo"[^>]*>Add photo<\/a>/);
  });
  it("a stored photo has no 'Add photo' link", () => {
    const html = renderToStaticMarkup(<ProfileScreen account={{ ...MARIA, photoUrl: "/api/me/photo?v=1" }} />);
    expect(html).not.toContain("Add photo");
  });
});

describe("my events list", () => {
  const html = renderToStaticMarkup(<MyEventsScreen account={MARIA} events={MY_EVENTS} now={new Date("2026-09-29T12:00:00+02:00")} />);
  it("thumbnails are lazy 52px images, not CSS backgrounds", () => {
    const thumbs = html.match(/<img[^>]*class="[^"]*thumb[^"]*"[^>]*>/g) ?? [];
    expect(thumbs).toHaveLength(MY_EVENTS.length);
    for (const t of thumbs) expect(t).toMatch(/width="52" height="52" loading="lazy"/);
  });
  it("a request the hosts did not approve stays with the upcoming events until the event ends, then moves to Past", () => {
    const now = new Date("2026-09-29T12:00:00+02:00");
    const future = { event: { ...MY_EVENTS[0]!.event, slug: "not-approved-future", startsAt: "2026-10-08T19:00:00+02:00", endsAt: "2026-10-08T23:00:00+02:00" }, badge: "not-approved" as const, detail: "Thu 8 Oct · Didit HQ" };
    const over = { ...future, event: { ...future.event, slug: "not-approved-over", startsAt: "2026-09-01T19:00:00+02:00", endsAt: "2026-09-01T23:00:00+02:00" } };
    expect([isPastEvent(future, now), isPastEvent(over, now), isPastEvent(MY_EVENTS[3]!, now), isPastEvent(MY_EVENTS[0]!, now)]).toEqual([false, true, true, false]);
    const list = renderToStaticMarkup(<MyEventsScreen account={MARIA} events={[...MY_EVENTS, future, over]} now={now} />);
    const past = list.indexOf('id="me-past"');
    expect(past).toBeGreaterThan(-1);
    expect(list.indexOf("/me/events/not-approved-future")).toBeLessThan(past);
    expect(list.indexOf("/me/events/not-approved-over")).toBeGreaterThan(past);
    expect(list).toContain('data-status="not-approved"');
  });
  it("'Account settings' follows the list (no bottom spacer)", () => {
    expect(html).not.toMatch(/class="[^"]*spacer/);
    expect(html).toMatch(/<a href="\/me\/settings" class="[^"]*footLink[^"]*">Account settings<\/a>/);
  });
});

describe("delete account sheet", () => {
  it("does not auto-focus the field in the markup (phones: the keyboard would cover the warning)", () => {
    const html = renderToStaticMarkup(<DeleteAccountSheet upcoming={1} open={0} action={async (s) => s} />);
    expect(html).toContain('name="confirm"');
    expect(html).not.toMatch(/autofocus/i);
  });
});

describe("social chips", () => {
  // Round 3: on the account editor a lookup no longer shows a pending pill that then collapses (the fields below jumped).
  it("collapseEmpty keeps no row and no pending pill until there are chips", () => {
    const row = (loading: boolean, collapseEmpty?: boolean) => renderToStaticMarkup(<SocialChips loading={loading} chips={[]} onPick={() => {}} collapseEmpty={collapseEmpty} />);
    expect(row(false, true)).toMatch(/suggestEmpty/);
    expect(row(true, true)).toMatch(/suggestEmpty/);
    expect(row(true, true)).not.toMatch(/suggestPending/);
    expect(row(true)).toMatch(/suggestPending/);
    expect(row(false)).not.toMatch(/suggestEmpty/);
  });
});
