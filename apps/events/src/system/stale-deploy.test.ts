import { describe, expect, it } from "vitest";
import { isStaleDeploy } from "./StaleDeploy";

describe("stale deploy detection", () => {
  it("recognises the errors a page from the previous build raises after a deploy", () => {
    expect(isStaleDeploy(new Error('Failed to find Server Action "40a2dd". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isStaleDeploy(Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isStaleDeploy(new Error("Failed to load chunk /_next/static/chunks/abc.js"))).toBe(true);
  });
  it("leaves real errors to the normal error card", () => {
    expect(isStaleDeploy(new Error("InvalidBrowserBinding"))).toBe(false);
    expect(isStaleDeploy(undefined)).toBe(false);
  });
});
