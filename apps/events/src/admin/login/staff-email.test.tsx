import { afterEach, expect, it, vi } from "vitest";
import { anonymousCsrf, anonymousHeaders, testOrigin, testSecret } from "../../auth/testing-browser";
import { staffEmailSignInAction } from "../../../app/admin/login/actions";
vi.mock("next/headers", () => ({ headers: async () => anonymousHeaders() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
afterEach(() => vi.unstubAllEnvs());
it("old staff email action is a CSRF-guarded redirect to account login", async () => {
  vi.stubEnv("APP_URL", testOrigin); vi.stubEnv("SESSION_SECRET", testSecret);
  const form = new FormData(); form.set("csrf", anonymousCsrf); form.set("next", "/admin/team");
  await expect(staffEmailSignInAction({ step: "email" }, form)).rejects.toThrow("REDIRECT:/login?next=%2Fadmin%2Fteam");
  form.set("csrf", "invalid");
  await expect(staffEmailSignInAction({ step: "email" }, form)).rejects.toMatchObject({ status: 403 });
});
