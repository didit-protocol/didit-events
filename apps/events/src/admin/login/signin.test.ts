import { describe, expect, it } from "vitest";
import { oidcStartUrl, safeNext } from "./signin";

describe("safeNext (admin)", () => {
  it("keeps same-origin /admin paths with query and hash", () => {
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/admin/events/bcn-opening/guests?status=verified#x")).toBe("/admin/events/bcn-opening/guests?status=verified#x");
    expect(safeNext(["/admin/team", "/evil"])).toBe("/admin/team");
    expect(safeNext("/admin/./team")).toBe("/admin/team");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/%09/evil.com",
    "/\t/evil.com",
    "/admin/\t/x",
    "/admin\\..\\evil",
    "/x/..//evil.com",
    "/admin/..//evil.com",
    "/admin/../..//evil.com",
    "/admin/%2e%2e//evil.com",
    "/admin/../evil",
    "https://evil.com/admin",
    "http:/admin",
    "javascript:alert(1)",
    "/administrator",
    "/me/events",
    "admin",
    "",
    "/admin\u0000",
    "/admin\u007f",
  ])("rejects %j", (v) => {
    expect(safeNext(v)).toBe("/admin");
  });

  it("non-strings fall back", () => {
    expect(safeNext(undefined)).toBe("/admin");
    expect(safeNext(42)).toBe("/admin");
  });

  it("the OIDC start URL only carries a safe target", () => {
    expect(oidcStartUrl("//evil.com")).toBe("/api/auth/oidc/start?as=staff&next=%2Fadmin");
    expect(oidcStartUrl("/admin/team", { prompt: "select_account" })).toBe("/api/auth/oidc/start?as=staff&next=%2Fadmin%2Fteam&prompt=select_account");
  });
});
