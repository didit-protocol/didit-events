import { afterEach, describe, expect, it, vi } from "vitest";
import { faceWorkflowId, oidcClientId, seedOwnerEmail } from "./config.ts";
import { contactEmail } from "./contact-email.ts";
import { EVENTS_SENDER } from "./email/common.ts";
import { emailAssetsOrigin } from "./email/media.ts";
import { CALENDAR_ORGANIZER, buildCalendarInvite } from "./notifications/calendar-invite.ts";
import { emailConfigFromEnv, emailPreviewConfigFromEnv } from "./notifications/index.ts";
import { COMPANY_LINE, companyLine } from "./email/layout.ts";
import { emailFixtures } from "./email/fixtures.ts";
import { renderEmail } from "./email/index.ts";
import { LEGACY_TEAM_MAILBOX } from "./notifications/resend.ts";

afterEach(() => vi.unstubAllEnvs());

describe("fork configuration", () => {
  it("has no built-in OIDC client and only a placeholder face workflow when unset", () => {
    expect(oidcClientId({})).toBe("");
    expect(faceWorkflowId({})).toBe("00000000-0000-4000-8000-00000000face");
    expect(seedOwnerEmail({})).toBe("events.owner@didit.me");
  });
  it("uses each configured identifier, including the event-model export", async () => {
    vi.stubEnv("DIDIT_OIDC_CLIENT_ID", "fork-client");
    vi.stubEnv("DIDIT_FACE_WORKFLOW_ID", "75bd50e1-0d8e-4b17-9e01-35005cfd6902");
    expect(oidcClientId()).toBe("fork-client");
    expect(faceWorkflowId()).toBe("75bd50e1-0d8e-4b17-9e01-35005cfd6902");
    vi.resetModules();
    expect((await import("./domain/event-model.ts")).FACE_WORKFLOW_ID).toBe(faceWorkflowId());
    expect(oidcClientId({ DIDIT_OIDC_CLIENT_ID: "" })).toBe("");
    expect(faceWorkflowId({ DIDIT_FACE_WORKFLOW_ID: "" })).toBe("");
  });
  it("normalizes the seed owner and rejects an unusable override", () => {
    expect(() => seedOwnerEmail({ STAFF_EMAIL_DOMAIN: "fork.test" })).toThrow("SEED_OWNER_EMAIL is required");
    expect(seedOwnerEmail({ STAFF_EMAIL_DOMAIN: "fork.test, DIDIT.ME" })).toBe("events.owner@didit.me");
    expect(seedOwnerEmail({ SEED_OWNER_EMAIL: " Owner@Other.test ", STAFF_EMAIL_DOMAIN: "fork.test, other.test" })).toBe("owner@other.test");
    for (const value of ["", "owner@didit.me", "owner@fork.test.evil", "owner@@fork.test", "owner\n@fork.test"]) {
      expect(() => seedOwnerEmail({ SEED_OWNER_EMAIL: value, STAFF_EMAIL_DOMAIN: "fork.test" })).toThrow("SEED_OWNER_EMAIL");
    }
  });
  it("shares the contact default and override across senders, Reply-To and calendar invites", () => {
    for (const configured of [undefined, "help@fork.test"]) {
      vi.stubEnv("CONTACT_EMAIL", configured);
      const expected = configured ?? "events@example.com";
      expect(contactEmail()).toBe(expected);
      expect(EVENTS_SENDER.address).toBe(expected);
      expect(CALENDAR_ORGANIZER.email).toBe(expected);
      const env = { APP_URL: "https://fork.test", RESEND_API_KEY: "fixture", CONTACT_EMAIL: configured };
      expect(emailConfigFromEnv(env).replyTo).toBe(expected);
      const ics = buildCalendarInvite({ method: "REQUEST", uid: "fixture", sequence: 0, now: new Date(0), startsAt: new Date(0), endsAt: new Date(3600000), summary: "Event", venue: null, address: null, url: "https://fork.test/e/event", attendee: { email: "guest@example.test" } });
      expect(ics.replace(/\r\n /g, "")).toContain(`ORGANIZER;CN="Didit Events":mailto:${expected}`);
      expect(LEGACY_TEAM_MAILBOX).toBe("events@didit.me");
    }
  });
  it("validates contact addresses instead of silently using the default", () => {
    expect(contactEmail(" help@fork.test ")).toBe("help@fork.test");
    for (const value of ["", "not-email", "help@fork.test\r\nBcc: injected@evil.test", "help@fork.test?subject=other"]) {
      expect(() => contactEmail(value)).toThrow("CONTACT_EMAIL");
    }
  });
  it("renders previews without a Resend key, and still refuses to send without one", () => {
    const env = { APP_URL: "http://localhost:3000" };
    expect(() => emailConfigFromEnv(env)).toThrow("RESEND_API_KEY");
    expect(emailPreviewConfigFromEnv(env)).toMatchObject({ baseUrl: env.APP_URL, from: "Didit Events <events@updates.didit.me>", resend: { apiKey: "" } });
    expect(() => emailPreviewConfigFromEnv({})).toThrow("APP_URL");
  });
  it("takes the email footer line from EMAIL_FOOTER, production line by default", () => {
    expect(companyLine(undefined)).toBe("Didit Identity Spain, S.L. · Carrer de Pallars 99, 08018 Barcelona");
    for (const empty of ["", "  "]) expect(companyLine(empty)).toBe(COMPANY_LINE);
    expect(companyLine(" Fork Org, Inc. ·\n 1 Main Street ")).toBe("Fork Org, Inc. · 1 Main Street");
    vi.stubEnv("EMAIL_FOOTER", "Fork Org <Inc> · 1 Main Street");
    try {
      const mail = renderEmail("M-01", emailFixtures["M-01"]);
      expect(mail.html).toContain("Fork Org &lt;Inc&gt; · 1 Main Street");
      expect(mail.text).toContain("Fork Org <Inc> · 1 Main Street");
      expect(mail.html + mail.text).not.toContain("Didit Identity Spain");
    } finally { vi.unstubAllEnvs(); }
    expect(renderEmail("M-01", emailFixtures["M-01"]).text).toContain(COMPANY_LINE);
  });
  it("uses email defaults only without an override", () => {
    const env = { APP_URL: "http://localhost:3000", RESEND_API_KEY: "fixture" };
    expect(emailConfigFromEnv(env).from).toBe("Didit Events <events@updates.didit.me>");
    expect(emailAssetsOrigin(env.APP_URL)).toBe("https://events.didit.me");
    expect(emailAssetsOrigin("https://fork.test")).toBe("https://fork.test");
    const custom = emailConfigFromEnv({ ...env, EMAIL_FROM: "Fork <mail@fork.test>", EMAIL_ASSETS_URL: "https://assets.fork.test" });
    expect(custom.from).toBe("Fork <mail@fork.test>");
    expect(emailAssetsOrigin(custom.baseUrl, custom.assetsUrl)).toBe("https://assets.fork.test");
    for (const value of ["", " "]) {
      expect(() => emailConfigFromEnv({ ...env, EMAIL_FROM: value })).toThrow("EMAIL_FROM");
      expect(() => emailConfigFromEnv({ ...env, EMAIL_ASSETS_URL: value })).toThrow("EMAIL_ASSETS_URL");
      expect(() => emailAssetsOrigin(env.APP_URL, value)).toThrow("EMAIL_ASSETS_URL");
    }
  });
});
