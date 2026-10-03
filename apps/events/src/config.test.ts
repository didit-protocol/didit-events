import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([undefined, "support@fork.test"])("publishes CONTACT_EMAIL=%j at build time for UI copy and links", async configured => {
  vi.stubEnv("CONTACT_EMAIL", configured);
  vi.stubEnv("SENTRY_AUTH_TOKEN", undefined);
  vi.stubEnv("STAFF_EMAIL_DOMAIN", "fork.test,second.test");
  vi.resetModules();
  const { default: next } = await import("../next.config.ts");
  const expected = configured ?? "events@example.com";
  expect(next.env?.NEXT_PUBLIC_CONTACT_EMAIL).toBe(expected);
  expect(next.env?.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN).toBe("fork.test,second.test");
  vi.stubEnv("NEXT_PUBLIC_CONTACT_EMAIL", next.env!.NEXT_PUBLIC_CONTACT_EMAIL);
  // Simulate the browser, which has the build-time public value but no server env.
  vi.stubEnv("CONTACT_EMAIL", undefined);
  const { CONTACT_EMAIL } = await import("./config.ts");
  const { links } = await import("./public/links.ts");
  const { accountLinks } = await import("./accounts/links.ts");
  expect(CONTACT_EMAIL).toBe(expected);
  expect(links.contact()).toBe(`mailto:${expected}`);
  expect(links.report("a b")).toBe(`mailto:${expected}?subject=Report%20event%20a%20b`);
  expect(accountLinks.contactEvents()).toBe(`mailto:${expected}`);
});

it("uses public configured domains for the team invite validator", async () => {
  vi.stubEnv("NEXT_PUBLIC_STAFF_EMAIL_DOMAIN", "fork.test,second.test");
  vi.resetModules();
  const { parseStaffEmail, parseInvite } = await import("./admin/team/policy.ts");
  for (const email of ["owner@fork.test", "teammate@second.test"]) {
    expect(parseStaffEmail(email)).toBe(email);
    expect(parseInvite({ role: "owner" }, { email, role: "staff" })).toMatchObject({ ok: true, email });
  }
  expect(parseStaffEmail("owner@didit.me")).toBeUndefined();
  expect(parseStaffEmail("owner@fork.test.evil")).toBeUndefined();
});
it("exports both Docker fork build arguments before Next compiles the public configuration", async () => {
  const { readFile } = await import("node:fs/promises");
  const docker = await readFile(new URL("../../../Dockerfile", import.meta.url), "utf8");
  const build = docker.indexOf("RUN pnpm --filter @didit-events/events build");
  for (const name of ["CONTACT_EMAIL", "STAFF_EMAIL_DOMAIN"]) {
    const declaration = docker.indexOf(`ARG ${name}=`);
    const exported = docker.indexOf(`ENV ${name}=$${name}`);
    expect(declaration).toBeGreaterThan(-1);
    expect(exported).toBeGreaterThan(declaration);
    expect(exported).toBeLessThan(build);
  }
});
