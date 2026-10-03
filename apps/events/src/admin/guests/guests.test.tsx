import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAMES_APP, FrameView } from "../../../frames";
import { AddGuests } from "./AddGuests";
import { GuestDrawer } from "./GuestDrawer";
import { BCN_GUESTS, DESIGN_GUESTS, EXISTING_EMAILS, mariaDetail, PASTE_VALID, PASTE_WITH_ERRORS } from "./fixtures";
import { GuestsView } from "./GuestsView";
import { parseGuestPaste } from "./paste";
import { countGuests, emptyCopy, guestsHref, parseGuestQuery } from "./query";

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const frame = (code: string) => decode(renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />));
const ID = "bcn-opening";
const COUNTS = countGuests(BCN_GUESTS);

describe("A-05 guests list", () => {
  it("fixture counts match the design chips", () => {
    expect(COUNTS).toMatchObject({ all: 124, "checked-in": 42, verified: 56, "link-sent": 12, verifying: 4, "in-review": 3, declined: 2, revoked: 5 });
  });

  it("A-05a: chips with counts, bulk bar, sending row, bounced row and the row menu", () => {
    const html = frame("A-05a");
    expect(html).toContain("2 selected");
    expect(html).toContain("Send links by email");
    expect(html).toContain("Sending…");
    expect(html).toContain("Email bounced");
    expect(html).toContain("Registered as Maria Garcia Lopez");
    expect(html).toContain("Copy verification link");
    expect(html).toContain("Revoke invite");
    expect(html).toContain("1–15 of 124");
  });

  it("rows open the drawer with the list state kept", () => {
    const html = decode(renderToStaticMarkup(<GuestsView eventId={ID} query={parseGuestQuery({ status: "verified" })} counts={COUNTS} page={{ rows: DESIGN_GUESTS, total: 124, page: 1, pageSize: 15 }} />));
    expect(html).toContain('href="/admin/events/bcn-opening/guests?status=verified&guest=amara-okafor"');
    expect(html).toContain('href="/admin/events/bcn-opening/guests/export?status=verified"');
    expect(html).toContain('href="/admin/events/bcn-opening/guests?status=verified&add=1"');
  });

  it("verified rows server-render the blue badge (its code loads on demand)", () => {
    const html = decode(renderToStaticMarkup(<GuestsView eventId={ID} query={parseGuestQuery({})} counts={COUNTS} page={{ rows: DESIGN_GUESTS, total: 124, page: 1, pageSize: 15 }} />));
    const verified = DESIGN_GUESTS.filter((r) => r.person?.verified).length;
    expect(verified).toBeGreaterThan(0);
    expect(html.match(/data-verified-badge=""/g)?.length).toBe(verified);
    expect(html).toContain("Verified by Didit · 21 Oct 2026");
  });

  it("A-05c / A-05d empty copy", () => {
    expect(emptyCopy(0, { q: "", status: "all" }).help).toBe("Add people one by one, paste a list, or share the request link.");
    expect(emptyCopy(124, { q: "okafor", status: "in-review" })).toMatchObject({ title: "No guests match these filters.", help: "Nobody named “okafor” is in review.", cta: "Clear filters" });
    expect(frame("A-05d")).toContain("Nobody named “okafor” is in review.");
  });

  it("dialog params only apply with a guest", () => {
    expect(parseGuestQuery({ guest: "maria-garcia", checkin: "1" }).dialog).toBe("checkin");
    expect(parseGuestQuery({ checkin: "1" }).dialog).toBeUndefined();
    expect(guestsHref(ID, { guest: "maria-garcia", dialog: "undo" })).toBe("/admin/events/bcn-opening/guests?guest=maria-garcia&undo=1");
  });
});

describe("A-06 drawer and A-14…A-16", () => {
  const drawer = (state: Parameters<typeof mariaDetail>[0]) => decode(renderToStaticMarkup(<GuestDrawer eventId={ID} detail={mariaDetail(state)} closeHref="/x" inline />));

  it("not started: empty answer, invite link, unverified email, pending steps", () => {
    const html = drawer("not-started");
    expect(html).toContain("No answer");
    expect(html).toContain("verify.didit.me/s/7Hk2Qm");
    expect(html).toContain("Not verified yet");
    expect(html).toContain("email not verified");
    expect(html).toContain("Doors not open yet");
    expect(html.match(/>Pending</g)?.length).toBe(2);
  });

  it("declined: Didit's reason; in review: the reviewer note", () => {
    expect(drawer("declined")).toContain("Declined by Didit.</b> Liveness failed: a screen replay was detected.");
    expect(drawer("declined")).toContain("Declined by Didit · screen replay");
    expect(drawer("in-review")).toContain("A Didit reviewer is checking this session. Usually under 2 hours.");
  });

  it("verified offers manual check-in; checked in offers undo", () => {
    expect(drawer("verified")).toContain("Manual check-in");
    const checked = drawer("checked-in");
    expect(checked).toContain("Undo check-in");
    expect(checked).toContain("96% match");
    expect(checked).toContain("Verified by Didit · 21 Oct 2026");
    expect(checked).toContain("Show selfie");
  });

  it("A-14: confirm dialog, then the manual check-in with note and the undo toast", () => {
    expect(frame("A-14a")).toContain("Check in María García without face?");
    const done = frame("A-14b");
    expect(done).toContain("Manual check-in · Alberto");
    expect(done).toContain("ID checked at the door");
    expect(done).toContain("Undo");
  });

  it("A-15: undo confirm, then the audit line in the timeline", () => {
    expect(frame("A-15a")).toContain("Undo María García’s check-in?");
    const tl = mariaDetail("undone").person.timeline;
    expect(tl.map((t) => [t.label, t.done])).toEqual([["Requested", true], ["Approved", true], ["Verified", true], ["Checked in", false], ["Check-in undone", true]]);
    expect(tl.at(-1)).toMatchObject({ who: "Door", at: "2026-10-23T17:48:00Z", tone: "danger" });
  });

  it("A-16: invited and verified emails side by side with both actions", () => {
    const html = drawer("email-mismatch");
    expect(html).toContain("maria.garcia@globex.test");
    expect(html).toContain("maria.g@gmail.com");
    expect(html).toContain("Accept this email");
    expect(html).toContain("Ask to verify again");
  });

  it("A-06a loading renders skeletons", () => {
    expect(renderToStaticMarkup(<GuestDrawer eventId={ID} detail={null} closeHref="/x" inline />)).toContain('aria-label="Loading guest"');
  });
});

describe("A-07 add guests", () => {
  it("parses the valid paste (25 ready) and the one with errors (23 ready, 1 invalid, 1 duplicate)", () => {
    expect(parseGuestPaste(PASTE_VALID, EXISTING_EMAILS)).toMatchObject({ ready: 25, invalidEmail: 0, duplicate: 0, header: true });
    expect(parseGuestPaste(PASTE_WITH_ERRORS, EXISTING_EMAILS)).toMatchObject({ ready: 23, invalidEmail: 1, duplicate: 1 });
  });

  it("the one-guest CTA starts disabled; the preview shows chips and the row notes", () => {
    expect(frame("A-07a")).toMatch(/<button[^>]*disabled=""[^>]*>Add guest<\/button>/);
    const html = frame("A-07d");
    for (const t of ["23 ready", "1 invalid email", "1 duplicate", "Invalid email", "Already on the list", "+ 19 more rows", "Add 23 guests"]) expect(html).toContain(t);
  });

  it("adding shows real progress; done summarises skipped rows with a download", () => {
    expect(frame("A-07e")).toContain("14 of 23 · creating Didit verification links");
    const done = frame("A-07f");
    expect(done).toContain("23 added, 2 skipped");
    expect(done).toContain("Skipped: 1 invalid email, 1 already on the list.");
    expect(done).toContain('download="skipped-guests.csv"');
    expect(done).toContain('aria-label="Skipped rows"');
  });

  it("done lists each skipped row with its reason (incl. rows the server refused)", () => {
    const skipped = [
      { line: 2, first: "", last: "Nofirst", email: "nofirst@example.com", status: "missing-name" as const },
      { line: 3, first: "Amara", last: "Okafor", email: "amara@example.com", status: "duplicate" as const },
    ];
    const html = decode(renderToStaticMarkup(<AddGuests eventId={ID} closeHref="/x" existingEmails={[]} initial={{ step: "done", result: { added: 1, skipped } }} inline />));
    expect(html).toContain("1 added, 2 skipped");
    expect(html).toContain("Skipped: 1 missing first name, 1 already on the list.");
    expect(html).toMatch(/nofirst@example\.com<\/span><span role="cell" class="[^"]*">Missing first name/);
    expect(html).toMatch(/amara@example\.com<\/span><span role="cell" class="[^"]*">Already on the list/);
  });

  it("paste step: CTA disabled until text is there", () => {
    const html = renderToStaticMarkup(<AddGuests eventId={ID} closeHref="/x" existingEmails={[]} initial={{ step: "paste" }} inline />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add guests<\/button>/);
    expect(html).toContain("Or drop a .csv file here. Header row is optional.");
  });
});
