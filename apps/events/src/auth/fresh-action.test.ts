import { beforeEach, expect, it, vi } from "vitest";
import type { GuestPrincipal } from "@didit-events/core";
import { pendingAccountAction, savePendingAccountAction, type PendingAccountAction } from "./fresh-action";

const fixture = vi.hoisted(() => ({ jar: new Map<string, string>(), accountId: "10000000-0000-4000-8000-0000000000a1" }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => ({ value: fixture.jar.get(name) }),
  set: (name: string, value: string) => { fixture.jar.set(name, value); },
}) }));
vi.mock("./access", () => ({ guestPage: async () => ({ accountId: fixture.accountId }) }));
vi.mock("./actions", () => ({ requireGuest: vi.fn() }));
vi.mock("./browser", () => ({ sessionSecret: () => "fresh-action-test-secret-over-thirty-two-characters" }));
const principal: GuestPrincipal = { principal: "guest", accountId: fixture.accountId, sessionId: "10000000-0000-4000-8000-0000000000a2", authenticatedAt: new Date() };
beforeEach(() => fixture.jar.clear());

it.each<PendingAccountAction["operation"]>([
  "delete-account", "delete-verification", "disconnect-google", "sign-out-all", "change-name", "save-profile", "onboarding-profile",
])("%s fits the sealed-cookie limit with its largest legal fields", async operation => {
  const fields: Record<string, string> = ["change-name", "save-profile", "onboarding-profile"].includes(operation)
    ? { fullName: "😀".repeat(240), expectedProfileVersion: "9007199254740991" } : {};
  await savePendingAccountAction(principal, "/me/profile/verification", operation, fields);
  expect(Buffer.byteLength(fixture.jar.get("__Host-reauth")!)).toBeLessThan(3800);
  expect(await pendingAccountAction()).toMatchObject({ accountId: principal.accountId, operation, fields });
});

it("rejects embedding non-name fields before they can fill the cookie", async () => {
  await expect(savePendingAccountAction(principal, "/me/profile/edit", "save-profile", { fullName: "Ana", bio: "a".repeat(3000) })).rejects.toThrow();
  expect(fixture.jar.size).toBe(0);
});
