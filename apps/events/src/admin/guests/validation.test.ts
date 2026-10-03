import { describe, expect, it } from "vitest";
import { allowedDialog, canCheckIn } from "./checkin";
import { csvCell, skippedCsv, toCsv } from "./csv";
import { cleanGuest, parseGuestPaste, problemChips } from "./paste";

describe("cleanGuest: the one guest validator", () => {
  it("trims and bounds the fields", () => {
    expect(cleanGuest({ first: "  Ana ", last: " Soler ", email: " ana@example.com " })).toEqual({ ok: true, guest: { first: "Ana", last: "Soler", email: "ana@example.com" } });
    expect(cleanGuest({ first: "x".repeat(90), last: "", email: "a@b.co" })).toMatchObject({ ok: true, guest: { first: "x".repeat(80) } });
  });

  it("a first name is required; the email problem wins when both are wrong", () => {
    expect(cleanGuest({ first: "", last: "Soler", email: "ana@example.com" })).toEqual({ ok: false, reason: "missing-name" });
    expect(cleanGuest({ first: "   ", last: "", email: "ana@example.com" })).toEqual({ ok: false, reason: "missing-name" });
    expect(cleanGuest({ first: "", last: "", email: "nope" })).toEqual({ ok: false, reason: "invalid-email" });
    expect(cleanGuest(null)).toEqual({ ok: false, reason: "invalid-email" });
    expect(cleanGuest({ first: 7, email: ["a@b.co"] })).toEqual({ ok: false, reason: "invalid-email" });
  });
});

describe("paste preview uses cleanGuest", () => {
  it("a row with only a last name is invalid (with its reason) and never counted as ready", () => {
    const r = parseGuestPaste("First,Last,Email\n,García,maria@example.com\nOliver,Bennett,oliver@example.com");
    expect(r.ready).toBe(1);
    expect(r.missingName).toBe(1);
    expect(r.rows[0]).toMatchObject({ status: "missing-name", last: "García" });
    expect(problemChips(r)).toEqual([{ tone: "danger", label: "1 missing first name" }]);
  });

  it("every row the preview calls ready passes the server validator", () => {
    const r = parseGuestPaste("First,Last,Email\n,Only,a@example.com\nA,,b@example.com\nC,D,bad\nE,F,e@example.com\nE,F,E@example.com");
    for (const row of r.rows.filter((x) => x.status === "ready")) expect(cleanGuest(row).ok).toBe(true);
    expect(r.rows.map((x) => x.status)).toEqual(["missing-name", "ready", "invalid-email", "ready", "duplicate-in-list"]);
  });
});

describe("csv", () => {
  it.each(["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "\rx"])("neutralises a formula start: %j", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("formula cells are also quoted when they carry quotes/commas", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it("escapes quotes, commas and newlines (RFC 4180)", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("García, María")).toBe('"García, María"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
    expect(csvCell(" pad")).toBe('" pad"');
    expect(csvCell(null)).toBe("");
    expect(csvCell("plain")).toBe("plain");
    expect(toCsv([["a", "b,c"]])).toBe('a,"b,c"\r\n');
  });

  it("skipped rows keep their reason and are neutralised too", () => {
    expect(skippedCsv([{ line: 1, first: "=cmd", last: "", email: "x", status: "missing-name" }])).toBe("First name,Last name,Email,Reason\r\n'=cmd,,x,Missing first name\r\n");
  });
});

describe("manual check-in eligibility", () => {
  it("only admitted guests", () => {
    for (const s of ["approved", "link-sent", "verifying", "verified"]) expect(canCheckIn(s)).toBe(true);
    for (const s of ["revoked", "declined", "rejected", "cancelled", "in-review", "checked-in", "", undefined]) expect(canCheckIn(s)).toBe(false);
  });

  it("?checkin=1 is dropped for a guest who can't be checked in", () => {
    expect(allowedDialog("checkin", "revoked")).toBeUndefined();
    expect(allowedDialog("checkin", "declined")).toBeUndefined();
    expect(allowedDialog("checkin", "link-sent")).toBe("checkin");
    expect(allowedDialog("revoke", "revoked")).toBe("revoke");
  });
});
