import { beforeEach, expect, it, vi } from "vitest";
import { createTokenAction, revokeTokenAction } from "./actions";

const mocks = vi.hoisted(() => ({ staff: vi.fn(), guard: vi.fn(), create: vi.fn(), revoke: vi.fn(), revalidate: vi.fn() }));
vi.mock("../../../../src/auth/access", () => ({ requireStaffAccess: mocks.staff }));
vi.mock("../../../../src/auth/actions", () => ({ guardAction: mocks.guard }));
vi.mock("@didit-events/core/api-tokens", () => ({ createApiTokenService: () => ({ create: mocks.create, revoke: mocks.revoke }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
const actor = { principal: "staff", email: "owner@didit.me", role: "owner", sessionId: "browser-session" };
beforeEach(() => { vi.resetAllMocks(); mocks.staff.mockResolvedValue(actor); mocks.guard.mockResolvedValue(undefined); mocks.create.mockResolvedValue({ token: "det_once", metadata: { name: "client" } }); });
const form = () => { const data = new FormData(); data.set("name", "client"); data.set("id", "b1b67c09-9c5d-471c-b864-8f70cd33269d"); return data; };
it("requires owner/admin browser auth and CSRF before creating or revoking", async () => {
  mocks.staff.mockRejectedValue(new Error("forbidden"));
  await expect(createTokenAction({}, form())).rejects.toThrow("forbidden");
  await expect(revokeTokenAction(form())).rejects.toThrow("forbidden");
  expect(mocks.guard).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  mocks.staff.mockResolvedValue(actor); mocks.guard.mockRejectedValue(new Error("csrf"));
  await expect(createTokenAction({}, form())).rejects.toThrow("csrf"); await expect(revokeTokenAction(form())).rejects.toThrow("csrf");
  expect(mocks.staff).toHaveBeenCalledWith("tokens.manage", "/admin/team/tokens");
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
});
it("returns the new credential only in the creation response, and never echoes an earlier token or internal error", async () => {
  expect(await createTokenAction({}, form())).toEqual({ token: "det_once" });
  expect(mocks.create).toHaveBeenCalledWith(actor, "client");
  const invalid = form(); invalid.set("name", " ");
  expect(await createTokenAction({ token: "previous-secret" }, invalid)).toEqual({ error: "Enter a token name between 1 and 100 characters." });
  mocks.create.mockRejectedValue(new Error("database password=secret"));
  expect(await createTokenAction({}, form())).toEqual({ error: "Could not create the token. Try again." });
  await revokeTokenAction(form()); expect(mocks.revoke).toHaveBeenCalledWith(actor, "b1b67c09-9c5d-471c-b864-8f70cd33269d");
});
