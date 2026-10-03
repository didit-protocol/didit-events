import { describe, expect, it } from "vitest";
import { assignableRoles, canDisable, canResendInvite, canRestore, formatLastActive, INVITE_ERRORS, parseInvite, parseStaffEmail } from "./policy";
import { SYSTEM_COPY } from "../system/copy";
import { staffAccountPhrase, staffEmailPlaceholder, yourStaffAccountPhrase } from "./domain";
import { TEAM_COPY } from "./TeamView";
import type { TeamMember } from "./types";

const owner = { role: "owner" as const, email: "events.team@didit.me" };
const admin = { role: "admin" as const, email: "ada@didit.me" };
const staff = { role: "staff" as const, email: "sam@didit.me" };
const member = (role: TeamMember["role"], email: string, disabledAt: string | null = null): TeamMember => ({ email, name: email, initials: "XX", role, lastActiveAt: null, disabledAt });

describe("staff domain copy", () => {
  it("names the configured domain; several domains read as your organization", () => {
    expect(staffEmailPlaceholder()).toBe("name@didit.me");
    expect(TEAM_COPY.manage).toContain("Everyone with a @didit.me account who can sign in.");
    expect(SYSTEM_COPY.forbidden.help("x@y.test")).toContain("Use your @didit.me account,");
    expect(staffEmailPlaceholder("fork.test")).toBe("name@fork.test");
    expect(staffAccountPhrase("fork.test")).toBe("a @fork.test account");
    expect(yourStaffAccountPhrase("fork.test")).toBe("your @fork.test account");
    expect(staffEmailPlaceholder("fork.test, partner.org")).toBe("name@fork.test");
    expect(staffAccountPhrase("fork.test,partner.org")).toBe("an account from your organization");
    expect(yourStaffAccountPhrase("fork.test,partner.org")).toBe("your organization account");
  });
});

describe("assignableRoles", () => {
  it("owner: all; admin: admin + staff; staff: none", () => {
    expect(assignableRoles(owner)).toEqual(["owner", "admin", "staff"]);
    expect(assignableRoles(admin)).toEqual(["admin", "staff"]);
    expect(assignableRoles(staff)).toEqual([]);
  });
});

describe("canResendInvite", () => {
  it("pending (never signed in, active) rows only, by whoever could disable them", () => {
    expect(canResendInvite(admin, member("staff", "x@didit.me"))).toBe(true);
    expect(canResendInvite(admin, { ...member("staff", "x@didit.me"), lastActiveAt: "2026-10-21T10:00:00Z" })).toBe(false);
    expect(canResendInvite(admin, member("staff", "x@didit.me", "2026-10-21T10:00:00Z"))).toBe(false);
    expect(canResendInvite(admin, member("owner", "o@didit.me"))).toBe(false);
    expect(canResendInvite(owner, member("owner", "o@didit.me"))).toBe(true);
    expect(canResendInvite(staff, member("staff", "x@didit.me"))).toBe(false);
  });
});

describe("canDisable / canRestore", () => {
  it("nobody disables themselves; only an owner disables an owner; staff disable nobody", () => {
    expect(canDisable(owner, member("owner", "events.team@didit.me"))).toBe(false);
    expect(canDisable(owner, member("owner", "other@didit.me"))).toBe(true);
    expect(canDisable(admin, member("owner", "other@didit.me"))).toBe(false);
    expect(canDisable(admin, member("staff", "x@didit.me"))).toBe(true);
    expect(canDisable(admin, member("admin", "y@didit.me"))).toBe(true);
    expect(canDisable(staff, member("staff", "x@didit.me"))).toBe(false);
    expect(canDisable(owner, member("staff", "x@didit.me", "2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("restore only disabled members, owners only by an owner", () => {
    const off = "2026-10-01T00:00:00Z";
    expect(canRestore(owner, member("owner", "o@didit.me", off))).toBe(true);
    expect(canRestore(admin, member("owner", "o@didit.me", off))).toBe(false);
    expect(canRestore(admin, member("staff", "s@didit.me", off))).toBe(true);
    expect(canRestore(staff, member("staff", "s@didit.me", off))).toBe(false);
    expect(canRestore(owner, member("staff", "s@didit.me"))).toBe(false);
  });
});

describe("parseInvite", () => {
  it("normalises a @didit.me email with a grantable role", () => {
    expect(parseInvite(owner, { email: "  New.Person@Didit.me ", role: "owner" })).toEqual({ ok: true, email: "new.person@didit.me", role: "owner" });
    expect(parseInvite(admin, { email: "n@didit.me", role: "staff" })).toEqual({ ok: true, email: "n@didit.me", role: "staff" });
  });

  it("rejects other domains, look-alikes and empty emails", () => {
    for (const email of ["n@gmail.com", "n@didit.me.evil.com", "n@notdidit.me", "n@sub.didit.mex"]) {
      expect(parseInvite(owner, { email, role: "staff" })).toMatchObject({ ok: false, errors: { email: INVITE_ERRORS.domain } });
    }
    expect(parseInvite(owner, { email: "", role: "staff" })).toMatchObject({ ok: false, errors: { email: INVITE_ERRORS.email } });
    expect(parseInvite(owner, { email: 42, role: "staff" })).toMatchObject({ ok: false, email: "" });
  });

  it("an admin can't mint an owner; staff can't invite at all; unknown roles fail", () => {
    expect(parseInvite(admin, { email: "n@didit.me", role: "owner" })).toMatchObject({ ok: false, errors: { role: INVITE_ERRORS.role } });
    expect(parseInvite(staff, { email: "n@didit.me", role: "staff" })).toMatchObject({ ok: false, errors: { role: INVITE_ERRORS.role } });
    expect(parseInvite(owner, { email: "n@didit.me", role: "root" })).toMatchObject({ ok: false, errors: { role: INVITE_ERRORS.role } });
  });
});

describe("parseStaffEmail", () => {
  it("returns the normalised @didit.me email or undefined", () => {
    expect(parseStaffEmail(" Ada@DIDIT.me ")).toBe("ada@didit.me");
    expect(parseStaffEmail("ada@gmail.com")).toBeUndefined();
    expect(parseStaffEmail("not an email")).toBeUndefined();
    expect(parseStaffEmail(undefined)).toBeUndefined();
    expect(parseStaffEmail(["ada@didit.me"])).toBeUndefined();
  });
});

describe("formatLastActive (Madrid calendar days, DST-safe)", () => {
  it("now, minutes, today, never", () => {
    const now = new Date("2026-10-08T15:30:00Z");
    expect(formatLastActive(null, now)).toBe("Not signed in yet");
    expect(formatLastActive(new Date("2026-10-08T15:29:30Z"), now)).toBe("Now");
    expect(formatLastActive("2026-10-08T15:18:00Z", now)).toBe("12 min ago");
    expect(formatLastActive("2026-10-08T09:20:00Z", now)).toBe("Today 11:20");
    expect(formatLastActive("2025-10-19T10:00:00Z", now)).toBe("19 Oct 2025");
  });

  it("around the 25 Oct 2026 fall-back (a 25-hour day)", () => {
    // 26 Oct 00:30 CET = 25 Oct 23:30Z. 24 Oct 23:45 CEST = 24 Oct 21:45Z → yesterday of 25 Oct, two days before 26 Oct.
    const now = new Date("2026-10-25T23:30:00Z");
    expect(formatLastActive("2026-10-25T00:10:00Z", now)).toBe("Yesterday"); // 25 Oct 02:10 CEST
    expect(formatLastActive("2026-10-24T21:45:00Z", now)).toBe("24 Oct");
    const lateOn25 = new Date("2026-10-25T22:59:00Z"); // 25 Oct 23:59 CET: now − 24 h is still 25 Oct (00:59 CEST)
    expect(formatLastActive("2026-10-24T21:45:00Z", lateOn25)).toBe("Yesterday");
    expect(formatLastActive("2026-10-25T00:30:00Z", lateOn25)).toBe("Today 02:30");
  });

  it("around the 29 Mar 2026 spring-forward (a 23-hour day)", () => {
    const now = new Date("2026-03-29T22:30:00Z"); // 30 Mar 00:30 CEST
    expect(formatLastActive("2026-03-28T23:30:00Z", now)).toBe("Yesterday"); // 29 Mar 00:30 CET
    expect(formatLastActive("2026-03-28T22:30:00Z", now)).toBe("28 Mar"); // 28 Mar 23:30 CET
  });
});
