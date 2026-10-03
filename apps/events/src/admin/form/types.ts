/** A-03 New / edit event: the form's view model (plan §2 `events`: name, starts_at/ends_at, timezone, venue, …). */
import type { EditorV2 } from "./editor";

/** Matching strictness = `events.match_threshold` (50–99, default 80; 50 allowed since 2026-10-01). The form offers three presets. */
export type Strictness = number;
export const STRICTNESS = [70, 80, 90] as const;

/** A custom question on the public request form (R-01…R-03). */
export interface EventQuestion {
  id: string;
  label: string;
  kind: "short" | "long";
  required: boolean;
}

/** Raw form values as typed (strings, so an invalid entry round-trips back into the field). */
export interface EventFormValues {
  name: string;
  /** ISO "2026-10-23" from the date picker (the server also accepts the older "23 Oct 2026"). */
  date: string;
  /** "19:00" */
  start: string;
  end: string;
  /** IANA zone, e.g. "Europe/Madrid". */
  timezone: string;
  venue: string;
  /** Formatted one-line address (Google's formattedAddress, or composed from the manual parts). */
  address: string;
  /** Manual / Places address parts (all "" for a legacy one-line address). */
  street: string;
  city: string;
  postalCode: string;
  country: string;
  /** The picked Google Maps place ("" when entered manually). lat/lng as decimal strings. */
  placeId: string;
  lat: string;
  lng: string;
  mapsUrl: string;
  capacity: string;
  description: string;
  requestForm: boolean;
  questions: EventQuestion[];
  welcomeEmail: boolean;
  threshold: Strictness;
  /**
   * Event model v2 (description Markdown, registration form, checks, door, emails, cover). Real editor loaders always provide it; optional only for isolated presentation fixtures.
   */
  v2?: EditorV2;
}

export type EventFormField = "name" | "date" | "start" | "end" | "timezone" | "venue" | "address" | "street" | "city" | "postalCode" | "country" | "capacity" | "description" | "questions" | "cover"
  | "descriptionMd" | "agenda" | "registration" | "verification" | "door" | "emails";
export type EventFormErrors = Partial<Record<EventFormField, string>>;

/** The server action's return value (useActionState). */
export type EventFormState =
  | { status: "idle"; values: EventFormValues }
  | { status: "invalid"; values: EventFormValues; errors: EventFormErrors }
  | { status: "saved"; values: EventFormValues; savedAt: string; editVersion?: number }
  | { status: "error"; values: EventFormValues; message: string };

/** The welcome email the "Preview" link shows (M-13, edited in A-11 Settings). */
export interface WelcomePreview {
  subject: string;
  block: string;
}

/** A validated event, ready for the events service. */
export interface EventInput {
  name: string;
  /** Local wall-clock times in `timezone`, ISO without offset ("2026-10-23T19:00"). */
  startsAtLocal: string;
  endsAtLocal: string;
  timezone: string;
  venue: string;
  address: string;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  capacity: number;
  description: string;
  requestForm: boolean;
  questions: EventQuestion[];
  welcomeEmail: boolean;
  matchThreshold: Strictness;
  /** v2 values when the editor sent them (canonical documents, saved directly). */
  v2?: EditorV2;
}
