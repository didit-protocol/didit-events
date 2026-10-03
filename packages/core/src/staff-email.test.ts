import { afterEach, expect, it, vi } from "vitest";
import { isStaffEmail, staffEmailDomains, staffEmailSql } from "./staff-email.ts";

afterEach(() => vi.unstubAllEnvs());

it("defaults to didit.me with exact, case-insensitive domain matching", () => {
  vi.stubEnv("STAFF_EMAIL_DOMAIN", undefined);
  expect(staffEmailDomains()).toEqual(["didit.me"]);
  expect(isStaffEmail(" Staff@Didit.Me ")).toBe(true);
  for (const email of ["staff@other.test", "staff@sub.didit.me", "staff@didit.me.evil", "staff@notdidit.me", "@didit.me", "staff@@didit.me", "staff x@didit.me"]) {
    expect(isStaffEmail(email), email).toBe(false);
  }
});

it("normalizes and deduplicates multiple domains without retaining the default", () => {
  vi.stubEnv("STAFF_EMAIL_DOMAIN", " Fork.Test, other.test, FORK.TEST ");
  expect(staffEmailDomains()).toEqual(["fork.test", "other.test"]);
  expect(isStaffEmail("owner@fork.test")).toBe(true);
  expect(isStaffEmail("owner@OTHER.TEST")).toBe(true);
  expect(isStaffEmail("owner@didit.me")).toBe(false);
});

it.each(["", " ", "fork.test,", "*.test", "@fork.test", "https://fork.test", "fork.test' OR true --", "fork_test", "fork..test", "-fork.test"])("rejects invalid domain configuration %j", value => {
  vi.stubEnv("STAFF_EMAIL_DOMAIN", value);
  expect(() => isStaffEmail("owner@fork.test")).toThrow("STAFF_EMAIL_DOMAIN");
  expect(() => staffEmailSql("t.email")).toThrow("STAFF_EMAIL_DOMAIN");
});

it("rejects request-shaped SQL identifiers", () => {
  expect(() => staffEmailSql("email) OR true --")).toThrow("Invalid staff email column");
});
