import { describe, expect, it } from "vitest";
import { CRITICAL_EMAIL_CODES, EMAIL_VARIABLES as A_VARIABLES, checksSchema, coverSchema, doorSchema, emailsSchema, eventEmailCodeSchema, formSchema } from "@didit-events/core/domain/event-model";
import { DEFAULT_V2, canonicalChecks, uuid, validateV2 } from "../form/editor";
import { setOverride } from "../form/emails";
import { EMAIL_VARIABLES, EVENT_EMAIL_CODES, MANDATORY_EMAIL_CODES } from "./contract";

describe("admin contract mirrors", () => {
  it("the client-side lists equal lane A's canonical values", () => {
    expect([...EVENT_EMAIL_CODES]).toEqual(eventEmailCodeSchema.options);
    expect([...MANDATORY_EMAIL_CODES]).toEqual([...CRITICAL_EMAIL_CODES]);
    expect([...EMAIL_VARIABLES]).toEqual([...A_VARIABLES]);
  });

  it("values the editor produces parse with the canonical schemas", () => {
    // v2 editor values are authoritative; the migration owns legacy conversion.
    for (const v of [DEFAULT_V2, {...DEFAULT_V2,door:{kiosk:true as const,mode:"supervised" as const,match_threshold:80}}]) {
      expect(validateV2(v)).toEqual({});
      expect(formSchema.safeParse(v.form).success).toBe(true);
      expect(checksSchema.safeParse(v.checks).success).toBe(true);
      expect(doorSchema.safeParse(v.door).success).toBe(true);
      expect(emailsSchema.safeParse(v.emails).success).toBe(true);
      expect(coverSchema.safeParse(v.cover).success).toBe(true);
    }
    const checks = canonicalChecks({ version: 1, required: ["name_from_id", "phone"], age_min: 18, max_age: { phone: 2_592_000, document: 7_776_000, age: 7_776_000, name_from_id: 60 } });
    expect(checksSchema.safeParse(checks).success).toBe(true);
    const form = { ...DEFAULT_V2.form, mode: "open" as const, questions: [{ id: uuid(), label: "Pick", kind: "multi" as const, required: true, options: [{ id: uuid(), label: "A" }, { id: uuid(), label: "B" }] }], consent_text: "Photos are taken." };
    expect(formSchema.safeParse(form).success).toBe(true);
    const emails = setOverride(setOverride(DEFAULT_V2.emails, "M-13", { enabled: false }), "M-06", { enabled: true, subject: "You're in, {{first_name}}", body_md: "See you at **{{venue}}**. [Directions]({{maps_url}})" });
    expect(emailsSchema.safeParse(emails).success).toBe(true);
    expect(validateV2({ ...DEFAULT_V2, emails })).toEqual({});
  });

  it("what the editor rejects, the canonical schemas reject too", () => {
    const badEmails = { version: 1 as const, templates: { "M-06": { enabled: false } } };
    expect(validateV2({ ...DEFAULT_V2, emails: badEmails })).toHaveProperty(["email:M-06:enabled"]);
    expect(emailsSchema.safeParse(badEmails).success).toBe(false);
    const dup = { ...DEFAULT_V2.form, questions: [{ id: uuid(), label: "Pick", kind: "single" as const, required: false, options: [{ id: uuid(), label: "A" }, { id: uuid(), label: "a" }] }] };
    expect(Object.keys(validateV2({ ...DEFAULT_V2, form: dup }))).toHaveLength(1);
    expect(formSchema.safeParse(dup).success).toBe(false);
    expect(doorSchema.safeParse({ kiosk: true, mode: "supervised", match_threshold: 49 }).success).toBe(false);
    expect(validateV2({ ...DEFAULT_V2, door: { kiosk: true, mode: "supervised", match_threshold: 49 } })).toHaveProperty("threshold");
  });
});

describe("editorial text parity", () => {
  it("editorialTextError accepts and refuses exactly what validEditorialText does", async () => {
    const { validEditorialText } = await import("@didit-events/core/domain/event-model");
    const { editorialTextError } = await import("../form/editor");
    for (const text of ["Hi {{first_name}}", "Hi {first_name}", "{{ticket}}", "[m]({{maps_url}})", "[x](http://a.example)", "[x](https://a.example/p)", "[ref]: javascript:alert(1)", "<script>x</script>", "<iframe src=x>", "plain **bold** text", "}{"])
      expect(editorialTextError(text) === null, text).toBe(validEditorialText(text));
  });
});
