import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkCode, sendCode } from "../../app/login/data";
import { accountLinks, safeNext } from "./links";
describe("safeNext (open redirect)", () => {
  it.each([
    ["tab", "/\t/evil.com"],
    ["newline", "/\n/evil.com"],
    ["carriage return", "/\r/evil.com"],
    ["decoded %09", decodeURIComponent("/%09/evil.com")],
    ["decoded %0A", decodeURIComponent("/%0A/evil.com")],
    ["decoded %0D", decodeURIComponent("/%0D/evil.com")],
    ["backslash", "/\\evil.com"],
    ["protocol-relative", "//evil.com"],
    ["absolute", "https://evil.com"],
    ["javascript:", "javascript:alert(1)"],
    ["space", "/ /evil.com"],
    ["NUL", "/\u0000/evil.com"],
    ["DEL", "/\u007f/evil.com"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(safeNext(value)).toBe("/me/events");
  });

  it("keeps percent-encoded slashes inside the path (same origin)", () => {
    expect(safeNext("/%2F%2Fevil")).toBe("/%2F%2Fevil");
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
  });

  it("round-trips a normal path with query and hash", () => {
    expect(safeNext("/me/events?x=1#y")).toBe("/me/events?x=1#y");
    expect(safeNext("/e/ai-era/register")).toBe("/e/ai-era/register");
  });

  it("normalizes dot segments and honours a custom fallback", () => {
    expect(safeNext("/me/../e/ai-era")).toBe("/e/ai-era");
    expect(safeNext("//evil.com", "/")).toBe("/");
  });

  it("the sign-in link builders drop an unsafe next", () => {
    expect(accountLinks.login("//evil.com")).toBe("/login");
    expect(accountLinks.login("/\t/evil.com", { step: "linked" })).toBe("/login?step=linked");
    expect(accountLinks.login("/me/events?x=1")).toBe("/login?next=%2Fme%2Fevents%3Fx%3D1");
    expect(accountLinks.google("https://evil.com")).toBe("/api/auth/oidc/start?idp=google");
    expect(accountLinks.google("/me")).toBe("/api/auth/oidc/start?idp=google&next=%2Fme");
  });
});

describe("safeNext: dot-segment normalisation bypass", () => {
  it.each(["/x/..//evil.com", "/.//evil.com", "/%2e%2e//evil.com", "/a/b/../..//evil.com?x=1"])("%s falls back", (n) => {
    expect(safeNext(n)).toBe("/me/events");
  });
  it("keeps a normal path with query and hash", () => {
    expect(safeNext("/me/events/ai-era?tab=1#top")).toBe("/me/events/ai-era?tab=1#top");
  });
});

// Registration for the AI Era event closes 2026-10-06 23:59 CEST: pin the clock so these tests don't expire.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00+02:00"));
});
afterAll(() => vi.useRealTimers());

describe("server-side code attempts (review fix)", () => {
  it("locks after 3 wrong codes whatever the client claims, and a new code resets the budget", async () => {
    const email = "attempts@example.com";
    await sendCode(email);
    expect(await checkCode(email, "111111")).toMatchObject({ ok: false, reason: "wrong", attemptsLeft: 2 });
    expect(await checkCode(email, "111111")).toMatchObject({ ok: false, reason: "wrong", attemptsLeft: 1 });
    expect(await checkCode(email, "111111")).toMatchObject({ ok: false, reason: "locked" });
    expect(await checkCode(email, "481903")).toMatchObject({ ok: false, reason: "locked" });
    await sendCode(email);
    expect(await checkCode(email, "481903")).toMatchObject({ ok: true });
  });
});

// UI fixture validation; real code budgets and guard boundaries are in auth/wiring.test.ts.
vi.mock("../../app/login/data", () => import("./testing-login"));
