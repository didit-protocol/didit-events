import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OneGuestFields } from "./AddGuests";
import { canSendLink } from "./checkin";
import { BCN_GUESTS, mariaDetail } from "./fixtures";
import { GuestDrawer } from "./GuestDrawer";
import { bulkToast, rowMenu } from "./GuestsTable";
import { guestTransition, type GuestOp } from "./transitions";
import type { GuestRow, GuestStatus } from "./types";

const ALL: GuestStatus[] = ["approved", "link-sent", "verifying", "verified", "in-review", "declined", "revoked", "checked-in"];
const allowed = (op: GuestOp) => ALL.filter((s) => guestTransition(s, op).ok);
const noop = () => {};

describe("guestTransition (S-00 admin guest states + domain admission table)", () => {
  it("approve only restores a revoked guest", () => {
    expect(allowed("approve")).toEqual(["revoked"]);
    expect(guestTransition("revoked", "approve")).toEqual({ ok: true, to: "approved" });
  });

  it("send: approved → link sent, link sent → link sent, verifying stays verifying", () => {
    expect(allowed("send")).toEqual(["approved", "link-sent", "verifying"]);
    expect(guestTransition("approved", "send")).toEqual({ ok: true, to: "link-sent" });
    expect(guestTransition("verifying", "send")).toEqual({ ok: true, to: "verifying" });
  });

  it("nothing moves checked-in / verified / in-review / declined back to link sent or approved", () => {
    for (const from of ["checked-in", "verified", "in-review", "declined"] as const) {
      for (const op of ["approve", "send"] as const) expect(guestTransition(from, op).ok).toBe(false);
    }
  });

  it("revoke: any admitted guest except a checked-in one; revoked is already revoked", () => {
    expect(allowed("revoke")).toEqual(["approved", "link-sent", "verifying", "verified", "in-review", "declined"]);
    expect(guestTransition("checked-in", "revoke")).toEqual({ ok: false, reason: "Already checked in: undo the check-in first" });
    expect(guestTransition("revoked", "revoke")).toEqual({ ok: false, reason: "Already revoked" });
  });

  it("check-in and undo: admitted guests in, undo back to exactly the recorded state", () => {
    expect(allowed("check-in")).toEqual(["approved", "link-sent", "verifying", "verified"]);
    expect(guestTransition("checked-in", "undo-check-in", "link-sent")).toEqual({ ok: true, to: "link-sent" });
    expect(guestTransition("checked-in", "undo-check-in").ok).toBe(false);
    expect(guestTransition("checked-in", "undo-check-in", "revoked").ok).toBe(false);
    expect(guestTransition("verified", "undo-check-in", "approved")).toEqual({ ok: false, reason: "Not checked in" });
  });

  it("A-16 accept / reverify only while verifying or in review", () => {
    expect(allowed("accept-email")).toEqual(["verifying", "in-review"]);
    expect(allowed("reverify")).toEqual(["verifying", "in-review"]);
  });
});

describe("send link is only offered for approved / link sent / verifying", () => {
  const row = (status: GuestStatus): GuestRow => ({ ...BCN_GUESTS[0]!, status });
  const item = (status: GuestStatus, id: string) => rowMenu(row(status), noop, noop, noop).find((e) => e.id === id) as { disabled?: boolean };

  it.each(ALL)("row menu for %s", (status) => {
    const sendable = ["approved", "link-sent", "verifying"].includes(status);
    expect(canSendLink(status)).toBe(sendable);
    expect(Boolean(item(status, "send").disabled)).toBe(!sendable);
    expect(Boolean(item(status, "resend").disabled)).toBe(!sendable || status === "approved");
    expect(Boolean(item(status, "revoke").disabled)).toBe(status === "revoked" || status === "checked-in");
    expect(Boolean(item(status, "checkin").disabled)).toBe(!["approved", "link-sent", "verifying", "verified"].includes(status));
  });

  it("drawer: Send by email is enabled for link sent, disabled for in review / declined", () => {
    const html = (state: Parameters<typeof mariaDetail>[0]) => renderToStaticMarkup(<GuestDrawer eventId="bcn-opening" detail={mariaDetail(state)} closeHref="/x" inline />);
    expect(html("not-started")).toMatch(/<button(?![^>]*disabled)[^>]*>Send by email<\/button>/);
    expect(html("in-review")).toMatch(/<button[^>]*disabled=""[^>]*>Send by email<\/button>/);
    expect(html("declined")).toMatch(/<button[^>]*disabled=""[^>]*>Send by email<\/button>/);
  });

  it("bulk toast reports changed and skipped rows", () => {
    expect(bulkToast("approve", { changed: ["a"], skipped: [] })).toEqual({ message: "Approved 1 guest." });
    expect(bulkToast("approve", { changed: ["a", "b"], skipped: [{ id: "c", reason: "Already approved" }] })).toEqual({ message: "Approved 2 guests. 1 skipped: Already approved." });
    expect(
      bulkToast("send", {
        changed: [],
        skipped: [
          { id: "a", reason: "Can’t send a link to a guest who is checked in" },
          { id: "b", reason: "Can’t send a link to a guest who is checked in" },
        ],
      }),
    ).toEqual({ message: "Nothing changed. 2 skipped: Can’t send a link to a guest who is checked in.", tone: "danger" });
  });
});

describe("A-07 one guest: an invalid result restores every field", () => {
  const html = (state: Parameters<typeof OneGuestFields>[0]["state"]) => renderToStaticMarkup(<OneGuestFields state={state} inline />);
  const sendInput = (h: string) => h.match(/<input[^>]*name="send"[^>]*>/)?.[0] ?? "";

  it("invalid email with send off → the send toggle stays off, fields and note keep their values", () => {
    const h = html({ status: "invalid", errors: { email: "Enter a valid email, like name@company.com" }, values: { first: "Ana", last: "Soler", email: "ana@nowhere", note: "Plus one", send: false } });
    expect(sendInput(h)).not.toContain("checked");
    expect(h).toContain('value="Ana"');
    expect(h).toContain('value="Soler"');
    expect(h).toContain('value="ana@nowhere"');
    expect(h).toMatch(/<textarea[^>]*name="note"[^>]*>Plus one<\/textarea>/);
    expect(h).toContain("Enter a valid email, like name@company.com");
  });

  it("invalid with send on keeps it on; a fresh form starts on", () => {
    expect(sendInput(html({ status: "invalid", errors: { first: "Add a first name" }, values: { first: "", last: "", email: "a@b.co", note: "", send: true } }))).toContain('checked=""');
    expect(sendInput(html({ status: "idle" }))).toContain('checked=""');
  });
});
