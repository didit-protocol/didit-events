import { IdentityError } from "@didit-events/core/identity";
import { beforeEach, expect, it, vi } from "vitest";
import { authService } from "@didit-events/core";
import { guardAction } from "../auth/actions";
import { randomToken, signToken } from "@didit-events/core/identity/shared";
import { csrfToken } from "../auth/browser";
import { actionStaff, guestPrincipal, staffRead } from "./b4-policy";
const request = vi.hoisted(() => ({ headers: new Headers(), cookie: "signed-session" }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => ({ get: () => request.cookie ? { value: request.cookie } : undefined }) }));
const secret = "b4-browser-policy-secret-longer-than-32-characters";
const form = (...values: unknown[]) => { const f = new FormData(); f.set("csrf", csrfToken(request.cookie, secret)); f.set("payload", JSON.stringify(values)); return f; };
beforeEach(() => { vi.stubEnv("APP_URL", "https://events.example.test"); vi.stubEnv("SESSION_SECRET", secret); request.cookie = signToken(randomToken(), secret, "session"); request.headers = new Headers({ origin: "https://events.example.test", cookie: `__Host-sid=${request.cookie}; __Host-csrf=${csrfToken(request.cookie, secret)}` }); });

it("action guard requires exact origin, independently submitted CSRF and session", async () => {
  await expect(guardAction(form("event", "decision"))).resolves.toMatchObject({ sessionCookie: request.cookie });
  request.headers.set("origin", "https://evil.test"); await expect(guardAction(form())).rejects.toMatchObject({ status: 403 });
  request.headers.set("origin", "https://events.example.test"); request.headers.set("cookie", `__Host-sid=${request.cookie}`); await expect(guardAction(form())).rejects.toMatchObject({ status: 403 });
});
it("action guard rejects mixed credentials and oversized arguments", async () => {
  request.headers.set("authorization", "Bearer device"); await expect(guardAction(form())).rejects.toMatchObject({ status: 403 }); request.headers.delete("authorization");
  await expect(guardAction(form("x".repeat(65537)))).rejects.toMatchObject({ status: 413 });
});
it("action guard counts repeated form fields and uploaded bytes without Content-Length", async () => {
  const repeated = form();
  repeated.append("note", "x".repeat(40000)); repeated.append("note", "y".repeat(40000));
  await expect(guardAction(repeated)).rejects.toMatchObject({ status: 413 });
  const upload = form(); upload.set("file", new File([new Uint8Array(65537)], "cover.png", { type: "image/png" }));
  await expect(guardAction(upload)).rejects.toMatchObject({ status: 413 });
});
it("principals come from B2 and read APIs reject device/webhook credentials", async () => {
  const staff = vi.spyOn(authService, "requireStaff").mockRejectedValue(new IdentityError("StaffSessionRequired", 401));
  await expect(actionStaff()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/login?next=%2Fadmin;307;" }); expect(staff).toHaveBeenCalledWith(request.cookie, undefined);
  await expect(staffRead(new Request("https://events.example.test/api/admin", { headers: { authorization: "Bearer device" } }))).rejects.toMatchObject({ status: 403 });
  request.cookie = ""; expect(await guestPrincipal()).toBeNull(); staff.mockRestore();
});
