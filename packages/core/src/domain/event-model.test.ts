import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { z } from "zod";
import {
applicationSchema,checksSchema,consentSchema,coverSchema,documentFactSchema,doorSchema,
emailsSchema,emailTestSchema,eventCreateSchema,eventWriteSchema,formSchema,
profilePatchSchema,
profileSchema,
validateApplication,validateQuestionEvolution
} from "./event-model.ts";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const form = formSchema.parse({ version: 1, mode: "request", closes_at: null, waitlist: true,
  fields: { phone_number: "off" }, questions: [], consent_text: null });
const profile = { fullName: "Prince", headline: "Artist", company: "Independent", jobRole: "", bio: "Music.",
  links: [{ kind: "website", label: "Work", href: "https://example.com" }] };
const event = { name: "Meet", description: "Short", descriptionMd: "## Details", startsAt: "2027-01-01T12:00:00+01:00",
  endsAt: "2027-01-01T14:00:00+01:00", timezone: "Europe/Madrid", venue: null, address: null, placeId: null,
  lat: null, lng: null, mapsUrl: null, capacity: 20, checks: { version: 1, required: [], max_age: {} },
  door: { kiosk: false }, form, emails: { version: 1, templates: {} }, cover: { kind: "theme", theme: "aqua" } };

describe("browser-safe v2 contract", () => {
  it("has no server dependency in either public entry point", () => {
    for (const file of ["./event-model.ts", "../contracts/event-model.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*(?:node:|\/db\/|\/env|\/services|\/didit\/)/u);
    }
  });
  it("keeps baseline out of extras, sorts and rejects invalid/irrelevant freshness", () => {
    expect(checksSchema.parse({ version: 1, required: ["name_from_id", "phone"], max_age: { document: 1 } }).required)
      .toEqual(["phone", "name_from_id"]);
    for (const value of [null, {}, { version: 1, required: ["face"], max_age: {} },
      { version: 1, required: ["phone", "phone"], max_age: {} },
      { version: 1, required: [], max_age: { phone: 1 } },
      { version: 1, required: [], max_age: {}, email: true },
      { version: 1, required: [], max_age: {}, age_min: 18.1 }]) expect(checksSchema.safeParse(value).success).toBe(false);
    expect(doorSchema.safeParse({ kiosk: false, mode: "strict" }).success).toBe(false);
  });
  it("accepts mononyms, Unicode code points and normalized HTTPS links", () => {
    const result = profileSchema.parse(profile);
    expect(result.links[0]!.href).toBe("https://example.com/");
    expect(profileSchema.safeParse({ ...profile, fullName: "😀".repeat(240) }).success).toBe(true);
    for (const href of ["http://example.com", "https://user:pass@example.com", "javascript:alert(1)"])
      expect(profileSchema.safeParse({ ...profile, links: [{ kind: "website", label: "Work", href }] }).success).toBe(false);
    expect(profileSchema.safeParse({ ...profile, links: [{ kind: "linkedin", label: "Work", href: "https://linkedin.com.evil.test/" }] }).success).toBe(false);
    expect(profileSchema.safeParse({ ...profile, bio: " ", links: [] }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ expectedProfileVersion: 1, email: "new@example.com" }).success).toBe(false);
  });
  it("normalizes UTC timestamps and validates dates, zones, coordinates and strict fields", () => {
    expect(eventCreateSchema.parse(event).startsAt).toBe("2027-01-01T11:00:00.000Z");
    for (const patch of [{ endsAt: event.startsAt }, { timezone: "Bad/Zone" }, { lat: 2 }, { providerWorkflowId: id },
      { startsAt: "2027-02-30T11:00:00Z" }, { form: { ...form, closes_at: "2028-01-01T00:00:00Z" } }])
      expect(eventCreateSchema.safeParse({ ...event, ...patch }).success).toBe(false);
    expect(eventWriteSchema.safeParse({ ...event, expectedVersion: 0 }).success).toBe(false);
    expect(documentFactSchema.safeParse({ legal_name: "Name", birth_date: "2025-02-29", expires_on: null }).success).toBe(false);
    expect(coverSchema.safeParse({ kind: "asset", version: id, alt: "Cover" }).success).toBe(true);
  });
  it("rejects unknown variables/unsafe links and disabling critical notices", () => {
    for (const templates of [{ "M-06": { enabled: false } }, { "M-01": { enabled: true } },
      { "M-13": { enabled: true, subject: "Hi\r\nBcc: x" } },
      { "M-13": { enabled: true, body_md: "{{secret}}" } },
      { "M-13": { enabled: true, body_md: "[click](javascript:alert)" } }])
      expect(emailsSchema.safeParse({ version: 1, templates }).success).toBe(false);
    expect(emailsSchema.safeParse({ version: 1, templates: { "M-13": { enabled: true, body_md: "Hi {{first_name}}. [Map]({{maps_url}})" } } }).success).toBe(true);
    expect(emailTestSchema.safeParse({ template: "M-06", to: "any@external.test", preview: { kind: "sample" }, expectedEventVersion: 1, idempotencyKey: id }).success).toBe(true);
    expect(consentSchema.safeParse({ disclosureVersion: "events-profile-v2", shareProfileWithHosts: true, eventConsentAccepted: false, acceptedChecks: ["face"], acceptedAt: "2027-01-01T00:00:00Z" }).success).toBe(false);
  });
  it("validates every question kind; false is a required answer and blanks are omitted", () => {
    const yes = { ...form, questions: [{ id, kind: "yes_no" as const, label: "Coming?", required: true }] };
    expect(validateApplication(yes, { fields: {}, answers: { [id]: false } }).answers[id]).toBe(false);
    expect(() => validateApplication(yes, { fields: {}, answers: {} })).toThrow(z.ZodError);
    expect(validateApplication(yes, { fields: {}, answers: {} }, { partial: true }).answers).toEqual({});
    for (const kind of ["short", "long", "url", "single", "multi"] as const) {
      const f = formSchema.parse({ ...form, questions: [{ id, kind, required: false, label: "Question",
        ...(["single", "multi"].includes(kind) ? { options: [{ id, label: "One" }, { id: other, label: "Two" }] } : {}) }] });
      const valid = { short: " Yes ", long: "Line\nTwo", url: "https://example.com", single: id, multi: [id, other] }[kind];
      expect(validateApplication(f, { fields: {}, answers: { [id]: valid } }).answers[id]).toBeDefined();
      expect(validateApplication(f, { fields: {}, answers: { [id]: " " } }).answers).toEqual({});
      expect(() => validateApplication(f, { fields: {}, answers: { [other]: "unknown" } })).toThrow();
      if (kind === "multi") expect(() => validateApplication(f, { fields: {}, answers: { [id]: [id, id] } })).toThrow();
    }
    expect(() => validateApplication(form, { fields: { phone_number: "+34600000000" }, answers: {} })).toThrow();
    expect(applicationSchema.safeParse({ fields: {}, answers: {}, accountId: id }).success).toBe(false);
    expect(() => validateQuestionEvolution(yes, { ...yes, questions: [{ ...yes.questions[0]!, kind: "short" }] })).toThrow();
  });
});

describe("event consent text", () => {
  it("blank or missing text means no consent step (the registration trigger treats any non-null text as required)", () => {
    for (const consent_text of ["", "   ", null, undefined]) expect(formSchema.parse({ ...form, consent_text }).consent_text).toBeNull();
    expect(formSchema.parse({ ...form, consent_text: "I agree to be photographed" }).consent_text).toBe("I agree to be photographed");
  });
});
