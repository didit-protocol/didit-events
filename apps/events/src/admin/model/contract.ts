/**
 * The event model v2 contract as the admin UI uses it: lane A's canonical types (`@didit-events/core`
 * `domain/event-model` and `contracts/event-model`, docs/event-model-v2.md), re-exported with the element types the
 * editor components name. Type-only imports: the zod schemas never enter the admin's client bundles. The few runtime
 * lists below mirror A's exports for the same reason; `contract.test.ts` pins them to A's values.
 */
import type { ApplicantDrawer, EventEditorView } from "@didit-events/core/contracts/event-model";
import type { EventChecks, EventEmailCode, EventForm } from "@didit-events/core/domain/event-model";

export type {
  Admission,
  ApiErrorCode,
  ApiResult,
  CoverUploadResult,
  EmailPreview,
  EmailTemplateView,
  EmailTestResult,
  EventEditorView,
  VerificationBadge,
} from "@didit-events/core/contracts/event-model";
export type { EmailOverride, EventChecks, EventCover, EventDoor, EventEmailCode, EventEmails, EventForm, ProofCheck } from "@didit-events/core/domain/event-model";

/** An event's extra check (email and face are account requirements, never listed). */
export type ExtraCheck = EventChecks["required"][number];
export type FormQuestion = EventForm["questions"][number];
export type QuestionKind = FormQuestion["kind"];
export type QuestionOption = Extract<FormQuestion, { options: unknown }>["options"][number];
export type RegistrationMode = EventForm["mode"];
export type FieldRule = EventForm["fields"]["phone_number"];
export type EditorCapabilities = EventEditorView["capabilities"];
export type ApplicantDrawerView = ApplicantDrawer;
export type ProfileLink = ApplicantDrawer["profile"]["links"][number];

/** eventEmailCodeSchema.options */
export const EVENT_EMAIL_CODES = [
  "M-02", "M-03", "M-05", "M-06", "M-07", "M-08", "M-09", "M-10",
  "M-11", "M-12", "M-13", "M-14", "M-15", "M-16", "M-19", "M-20", "M-21", "M-23", "M-24",
] as const satisfies readonly EventEmailCode[];
/** CRITICAL_EMAIL_CODES: critical notices cannot be disabled. */
export const MANDATORY_EMAIL_CODES: readonly EventEmailCode[] = ["M-03", "M-06", "M-16", "M-20", "M-21"];
/** EMAIL_VARIABLES: the only variables an override may use. */
export const EMAIL_VARIABLES = ["first_name", "event_name", "date", "venue", "maps_url"] as const;
