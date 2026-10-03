import { describe, expect, it } from "vitest";
import { recentServerErrors, recordServerError } from "./recent-errors.ts";

describe("recent server errors", () => {
  it("keeps the newest 50, newest first, masks emails and drops query strings", () => {
    for (let i = 0; i < 55; i++) recordServerError(Object.assign(new Error(`boom ${i} for ana@example.com`), { digest: `d${i}` }), { path: `/login?next=/x&e=${i}`, method: "POST" }, { routerKind: "App Router", routeType: "action" });
    const list = recentServerErrors();
    expect(list).toHaveLength(50);
    expect(list[0]).toMatchObject({ path: "/login", method: "POST", name: "Error", message: "boom 54 for <email>", digest: "d54", kind: "App Router/action" });
    expect(list.at(-1)!.message).toBe("boom 5 for <email>");
    expect((globalThis as { __diditRecentErrors?: unknown[] }).__diditRecentErrors).toHaveLength(50);
  });
});

it.each(["/i/short", "/e/gala/v/short", `/other/${"A1_-".repeat(10)}`, "/i/%61%62%63"]) ("redacts bearer segments before storage: %s", path => {
  recordServerError(new Error(`Failed ${path}`), { path: `${path}?secret=value` });
  const last = recentServerErrors()[0]!;
  expect(last.path).toContain("<token>");
  expect(last.message).toContain("<token>");
  expect(last.path).not.toContain(path.split("/").at(-1));
  expect(last.path).not.toContain("secret");
});
