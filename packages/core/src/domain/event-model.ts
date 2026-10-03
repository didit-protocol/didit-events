import { faceWorkflowId } from "../config.ts";
import { z } from "zod";

const cp = (s: string) => Array.from(s).length;
const noControls = (s: string) => !/[\u0000-\u001f\u007f]/u.test(s);
const line = (min: number, max: number) => z.string().trim()
  .refine(s => cp(s) >= min && cp(s) <= max && noControls(s));
const prose = (max: number) => z.string()
  .refine(s => cp(s) <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const httpsUrl = z.string().max(2048).url().refine(s => {
  const u = new URL(s);
  return u.protocol === "https:" && !u.username && !u.password;
}).transform(s => new URL(s).href);
const uuid = z.string().uuid();
const instant = z.iso.datetime({ offset: true }).transform(s => new Date(s).toISOString());
const revision = z.number().int().positive();
const seconds = z.number().int().min(1).max(31_536_000);

export const extraCheck = z.enum(["phone", "id_document", "name_from_id"]);
const checksShape = z.object({
  version: z.literal(1),
  required: z.array(extraCheck).max(3)
    .refine(a => new Set(a).size === a.length),
  age_min: z.number().int().min(1).max(100).optional(),
  max_age: z.object({
    phone: seconds.optional(), document: seconds.optional(),
    name_from_id: seconds.optional(), age: seconds.optional(),
  }).strict(),
}).strict();
export const checksSchema = checksShape.superRefine((value, ctx) => {
  const relevant = { phone: value.required.includes("phone"),
    document: value.required.includes("id_document") || value.required.includes("name_from_id"),
    name_from_id: value.required.includes("name_from_id"), age: value.age_min !== undefined };
  for (const key of Object.keys(value.max_age) as (keyof typeof relevant)[]) {
    if (!relevant[key]) ctx.addIssue({ code: "custom", path: ["max_age", key], message: "Freshness requires the corresponding check" });
  }
}).transform(value => ({ ...value, required: [...value.required].sort((a, b) =>
  extraCheck.options.indexOf(a) - extraCheck.options.indexOf(b)) }));
export const doorSchema = z.discriminatedUnion("kiosk", [
  z.object({ kiosk: z.literal(false) }).strict(),
  z.object({ kiosk: z.literal(true), mode: z.enum(["supervised", "strict"]),
    match_threshold: z.number().int().min(50).max(99) }).strict(),
]);

const linkSchema = z.object({
  kind: z.enum(["linkedin", "website", "other"]),
  label: line(1, 40), href: httpsUrl,
}).strict().refine(l => l.kind !== "linkedin" ||
  /(^|\.)linkedin\.com$/i.test(new URL(l.href).hostname));
export const profileSchema = z.object({
  fullName: line(1, 240), headline: line(1, 80), company: line(1, 120),
  // Flow v3: hosts need name, role, company and one link; a bio is welcome but never blocks a request.
  jobRole: line(0, 120), bio: prose(160),
  links: z.array(linkSchema).min(1).max(8)
    .refine(a => a.some(l => l.kind === "linkedin" || l.kind === "website"))
    .refine(a => new Set(a.map(l => l.href)).size === a.length),
}).strict();
export const profileDraftSchema = z.object({
  fullName: line(0, 240), headline: line(0, 80), company: line(0, 120),
  jobRole: line(0, 120), bio: prose(160),
  links: z.array(linkSchema).max(8)
    .refine(a => new Set(a.map(l => l.href)).size === a.length),
}).strict();
export const profilePatchSchema = profileDraftSchema.partial().extend({
  expectedProfileVersion: revision,
}).strict(); // Merge, then validate complete profile if it was already complete.

const questionBase = { id: uuid, label: line(1, 200), required: z.boolean() };
const option = z.object({ id: uuid, label: line(1, 100) }).strict();
const options = z.array(option).min(2).max(20)
  .refine(a => new Set(a.map(x => x.id)).size === a.length)
  .refine(a => new Set(a.map(x => x.label.toLowerCase())).size === a.length);
export const questionSchema = z.discriminatedUnion("kind", [
  z.object({ ...questionBase, kind: z.literal("short") }).strict(),
  z.object({ ...questionBase, kind: z.literal("long") }).strict(),
  z.object({ ...questionBase, kind: z.literal("url") }).strict(),
  z.object({ ...questionBase, kind: z.literal("yes_no") }).strict(),
  z.object({ ...questionBase, kind: z.literal("single"), options }).strict(),
  z.object({ ...questionBase, kind: z.literal("multi"), options }).strict(),
]);
export const formSchema = z.object({
  version: z.literal(1), mode: z.enum(["request", "open", "invite_only"]),
  closes_at: instant.nullable(), waitlist: z.boolean(),
  fields: z.object({ phone_number: z.enum(["off", "optional", "required"]) }).strict(),
  questions: z.array(questionSchema).max(20)
    .refine(a => new Set(a.map(q => q.id)).size === a.length),
  // Blank means no event consent (the editor already saves null): the registration trigger asks for acceptance of any
  // non-null text, so an empty string here would block every request while the request UI shows nothing to accept.
  consent_text: prose(2000).nullable().optional().transform(s => eventConsentText({ consent_text: s })),
}).strict();
/** The event consent guests must accept, or null: blank text (incl. rows stored before it was normalized) asks for nothing. */
export const eventConsentText = (form: { consent_text?: string | null }): string | null => (form.consent_text?.trim() ? form.consent_text : null);
export const applicationSchema = z.object({
  fields: z.object({ phone_number: z.string().regex(/^\+[1-9][0-9]{6,14}$/).optional() }).strict(),
  answers: z.record(uuid, z.union([prose(2000), z.boolean(), z.array(uuid).max(20)])),
}).strict();
export const consentSchema = z.object({
  disclosureVersion: z.literal("events-profile-v2"),
  shareProfileWithHosts: z.literal(true), eventConsentAccepted: z.boolean(),
  acceptedChecks: z.array(z.enum(["face", "phone", "id_document", "name_from_id", "age"])).max(5)
    .refine(a => new Set(a).size === a.length),
}).strict(); // Server records accepted_at; clients cannot supply it.
export const consentReceiptSchema = consentSchema.extend({ acceptedAt: instant }).strict();
export const requestReceiptSchema = z.object({
  version: z.literal(1), evaluatedAt: instant, emailVerifiedAt: instant, profileVersion: revision,
  evidenceIds: z.object({ face: uuid, phone: uuid.optional(), id_document: uuid.optional(),
    name_from_id: uuid.optional(), age: uuid.optional() }).strict(),
  consent: consentReceiptSchema,
}).strict();
const calendarDate = z.iso.date();
export const phoneFactSchema = z.object({ e164: z.string().regex(/^\+[1-9][0-9]{6,14}$/) }).strict();
export const documentFactSchema = z.object({
  legal_name: line(1, 240), birth_date: calendarDate.nullable(), expires_on: calendarDate.nullable(),
}).strict();
export const ageFactSchema = z.number().finite().nonnegative();

export const eventEmailCodeSchema = z.enum([
  "M-02", "M-03", "M-05", "M-06", "M-07", "M-08", "M-09", "M-10",
  "M-11", "M-12", "M-13", "M-14", "M-15", "M-16", "M-19", "M-20", "M-21", "M-23", "M-24",
]);
export const emailOverride = z.object({
  enabled: z.boolean(), subject: line(1, 200).optional(), body_md: prose(10_000).optional(),
}).strict().superRefine((value, ctx) => {
  for (const key of ["subject", "body_md"] as const) {
    const text = value[key];
    if (text !== undefined && !validEditorialText(text))
      ctx.addIssue({ code: "custom", path: [key], message: "Unknown variable or unsafe link" });
  }
});
export const emailsSchema = z.object({ version: z.literal(1),
  templates: z.partialRecord(eventEmailCodeSchema, emailOverride),
}).strict().superRefine((value, ctx) => {
  for (const [code, override] of Object.entries(value.templates)) {
    if (!override) continue;
    if (!override.enabled && CRITICAL_EMAIL_CODES.includes(code as EventEmailCode))
      ctx.addIssue({ code: "custom", path: ["templates", code, "enabled"], message: "This service notice cannot be disabled" });
  }
});
export const guestListPrivacySchema = z.object({ guestList: z.enum(["hidden", "count", "names"]) }).strict();
/** A host may name a Didit Events account by email: the public page then shows that account's profile photo (never the email). */
export const speakersSchema = z.array(z.object({ name: line(1, 200), role: line(0, 200), photoUrl: httpsUrl.optional(),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional() }).strict()).max(50);
/**
 * The event-page agenda: ISO instants (shown as HH:mm in the event's zone) and a one-line label, in display order.
 * `endAt` (optional, after `at`) turns the time into a range: "19:10–20:00 · label".
 */
export const AGENDA_MAX = 30;
export const agendaItemSchema = z.object({ at: instant, endAt: instant.optional(), label: line(1, 120), emphasis: z.boolean().optional() }).strict()
  .refine(item => item.endAt === undefined || Date.parse(item.endAt) > Date.parse(item.at), { path: ["endAt"], message: "End must be after the start" });
export const agendaSchema = z.array(agendaItemSchema).max(AGENDA_MAX);
export const coverSchema = z.discriminatedUnion("kind", [
  // `wide`: an optional banner-format image (about 10:3) for tickets, cards and email heroes; the square/main cover stays the source elsewhere.
  z.object({ kind: z.literal("theme"), theme: z.enum(["aqua", "sky"]), privacy: guestListPrivacySchema.optional(), wide: z.object({ version: uuid }).strict().optional() }).strict(),
  z.object({ kind: z.literal("asset"), version: uuid, alt: line(1, 200), privacy: guestListPrivacySchema.optional(), wide: z.object({ version: uuid }).strict().optional() }).strict(),
]);
const eventWriteShape = z.object({
  expectedVersion: revision, name: line(1, 200),
  description: prose(600), descriptionMd: prose(20_000),
  startsAt: instant, endsAt: instant, timezone: line(1, 100),
  venue: line(0, 300).nullable(), address: line(0, 500).nullable(),
  placeId: line(1, 500).nullable(), lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(), mapsUrl: httpsUrl.nullable(),
  capacity: z.number().int().min(1).max(1_000_000),
  checks: checksSchema, door: doorSchema, form: formSchema,
  emails: emailsSchema, cover: coverSchema, speakers: speakersSchema.optional(), agenda: agendaSchema.optional(),
}).strict();
export const eventWriteSchema = eventWriteShape.superRefine(validateEvent);
export const eventCreateSchema = eventWriteShape.omit({ expectedVersion: true }).superRefine(validateEvent);
export const draftWriteSchema = z.object({
  expectedVersion: revision, policyVersion: revision, formVersion: revision,
  application: applicationSchema, consent: consentSchema,
  inviteToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
}).strict();
export const renewalInputSchema = z.object({
  consent: consentSchema.optional(), strategy: z.enum(["minimal", "id_alternative"]).default("minimal"),
}).strict();
export const submitRequestSchema = z.object({
  draftId: uuid.optional(), expectedPolicyVersion: revision, expectedFormVersion: revision,
  profileVersion: revision, application: applicationSchema, consent: consentSchema,
  inviteToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  joinWaitlist: z.boolean(), idempotencyKey: uuid,
}).strict();
export const emailTestSchema = z.object({
  template: eventEmailCodeSchema, to: z.email().max(254),
  preview: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("sample") }).strict(),
    z.object({ kind: z.literal("guest"), registrationId: uuid }).strict(),
  ]),
  override: emailOverride.optional(), expectedEventVersion: revision, idempotencyKey: uuid,
}).strict();

export type EventChecks = z.infer<typeof checksSchema>;
export type EventDoor = z.infer<typeof doorSchema>;
export type EventForm = z.infer<typeof formSchema>;
export type EventEmails = z.infer<typeof emailsSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
export type EventWrite = z.infer<typeof eventWriteSchema>;
export type SubmitRequest = z.infer<typeof submitRequestSchema>;

export type ProofCheck = "face" | "phone" | "id_document" | "name_from_id" | "age";
export type ExtraCheck = Exclude<ProofCheck, "face">;
export type EventCover = z.infer<typeof coverSchema>;
export type EventEmailCode = z.infer<typeof eventEmailCodeSchema>;
export type EmailOverride = z.infer<typeof emailOverride>;
export type ProfileDraft = z.infer<typeof profileDraftSchema>;
export type ConsentReceipt = z.infer<typeof consentReceiptSchema>;
export type RequestReceipt = z.infer<typeof requestReceiptSchema>;
export const FACE_WORKFLOW_ID = faceWorkflowId();
export const CRITICAL_EMAIL_CODES: readonly EventEmailCode[] = ["M-03", "M-06", "M-16", "M-20", "M-21"];
export const EMAIL_VARIABLES = ["first_name", "event_name", "date", "venue", "maps_url"] as const;

/** No recursive interpolation: consumers replace these tokens exactly once. */
export function validEditorialText(value: string): boolean {
  if (Array.from(value.matchAll(/\{\{([^{}]*)\}\}/gu)).some(m =>
    !(EMAIL_VARIABLES as readonly string[]).includes(m[1]!))) return false;
  if (/[{}]/u.test(value.replace(/\{\{(?:first_name|event_name|date|venue|maps_url)\}\}/gu, ""))) return false;
  // Links are parsed again by the Markdown renderer. Reject unsafe destinations at save time.
  for (const match of value.matchAll(/\]\(\s*<?([^\s)>]+)|^\s*\[[^\]]+\]:\s*<?([^\s>]+)/gmu)) {
    const href = match[1] ?? match[2]!;
    if (href === "{{maps_url}}") continue;
    if (!httpsUrl.safeParse(href).success) return false;
  }
  return !/<\s*(?:script|style|iframe)\b/iu.test(value);
}

function validateEvent(value: z.infer<typeof eventWriteShape> | Omit<z.infer<typeof eventWriteShape>, "expectedVersion">, ctx: z.RefinementCtx): void {
  if (!(Date.parse(value.endsAt) > Date.parse(value.startsAt)))
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
  if (value.form.closes_at && Date.parse(value.form.closes_at) > Date.parse(value.startsAt))
    ctx.addIssue({ code: "custom", path: ["form", "closes_at"], message: "Requests must close by the event start" });
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }); }
  catch { ctx.addIssue({ code: "custom", path: ["timezone"], message: "Use an IANA time zone" }); }
  if ((value.lat === null) !== (value.lng === null))
    ctx.addIssue({ code: "custom", path: ["lat"], message: "Both coordinates are required" });
}

/** Validate against the accepted form, returning a canonical application or a ZodError. */
export function validateApplication(formInput: EventForm, input: unknown, { partial = false }: { partial?: boolean } = {}): Application {
  const form = formSchema.parse(formInput);
  const value = applicationSchema.parse(input);
  const issues: z.core.$ZodIssue[] = [];
  const issue = (path: (string | number)[], message: string) => issues.push({ code: "custom", path, message });
  const fields: Application["fields"] = {};
  if (value.fields.phone_number !== undefined) {
    if (form.fields.phone_number === "off") issue(["fields", "phone_number"], "Phone is not collected");
    else fields.phone_number = value.fields.phone_number;
  } else if (!partial && form.fields.phone_number === "required") issue(["fields", "phone_number"], "Required");
  const definitions = new Map(form.questions.map(q => [q.id, q]));
  const answers: Application["answers"] = {};
  for (const [id, raw] of Object.entries(value.answers)) {
    const question = definitions.get(id);
    if (!question) { issue(["answers", id], "Unknown question"); continue; }
    if (typeof raw === "string" && !raw.trim()) continue;
    let result: z.ZodSafeParseResult<unknown>;
    switch (question.kind) {
      case "short": result = line(1, 300).safeParse(raw); break;
      case "long": result = prose(2000).transform(s => s.trim()).refine(s => cp(s) > 0).safeParse(raw); break;
      case "url": result = httpsUrl.safeParse(raw); break;
      case "yes_no": result = z.boolean().safeParse(raw); break;
      case "single": result = uuid.refine(id => question.options.some(o => o.id === id)).safeParse(raw); break;
      case "multi": result = z.array(uuid).min(1).max(20)
        .refine(ids => new Set(ids).size === ids.length && ids.every(id => question.options.some(o => o.id === id))).safeParse(raw); break;
    }
    if (!result.success) issue(["answers", id], "Invalid answer");
    else answers[id] = result.data as Application["answers"][string];
  }
  if (!partial) for (const question of form.questions) {
    if (question.required && answers[question.id] === undefined) issue(["answers", question.id], "Required");
  }
  const canonical = { fields, answers };
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 32768 ||
      new TextEncoder().encode(JSON.stringify(canonical)).byteLength > 32768) issue([], "Application exceeds 32 KiB");
  if (issues.length) throw new z.ZodError(issues);
  return canonical;
}

export function validateQuestionEvolution(previous: EventForm, next: EventForm): void {
  const kinds = new Map(previous.questions.map(q => [q.id, q.kind]));
  const changed = next.questions.find(q => kinds.has(q.id) && kinds.get(q.id) !== q.kind);
  if (changed) throw new z.ZodError([{ code: "custom", path: ["questions", changed.id], message: "A changed question kind requires a new ID" }]);
}
