/** A-03 fixtures (design/01 Admin, `mkForm`): the empty form, Barcelona Office Opening, and the A-03b errors. */
import type { EventFormErrors, EventFormState, EventFormValues, WelcomePreview } from "./types";

import { DEFAULT_V2 } from "./editor";
import { EMPTY_EVENT } from "./defaults";
import { END_BEFORE_START } from "./validate";
export { EMPTY_EVENT, DEFAULT_WELCOME } from "./defaults";

export const BCN_FORM: EventFormValues = {
  name: "Barcelona Office Opening",
  date: "2026-10-23",
  start: "19:00",
  end: "23:00",
  timezone: "Europe/Madrid",
  venue: "Didit HQ",
  address: "Carrer de Pallars 99, 08018 Barcelona, Spain",
  street: "Carrer de Pallars 99",
  city: "Barcelona",
  postalCode: "08018",
  country: "Spain",
  placeId: "",
  lat: "",
  lng: "",
  mapsUrl: "",
  capacity: "150",
  description: "Drinks, demos and the team, in our new Poblenou office. Face check-in at the door, no tickets.",
  requestForm: true,
  questions: [
    { id: "company", label: "Company", kind: "short", required: true },
    { id: "role", label: "Role", kind: "short", required: false },
  ],
  welcomeEmail: true,
  threshold: 80,
  // The loader supplies canonical v2 values; legacy fixture fields are presentation-only.
  v2: {...structuredClone(DEFAULT_V2),door:{kiosk:true,mode:"supervised",match_threshold:80},form:{...DEFAULT_V2.form,questions:[{id:"00000000-0000-4000-8000-000000000001",label:"Company",kind:"short",required:true},{id:"00000000-0000-4000-8000-000000000002",label:"Role",kind:"short",required:false}]}},
};

/** A-03b: no name, end before start, capacity 0. */
export const ERROR_FORM: EventFormValues = { ...BCN_FORM, name: "", end: "18:00", capacity: "0" };
export const ERROR_MESSAGES: EventFormErrors = { name: "Give the event a name", end: END_BEFORE_START, capacity: "At least 1" };

export const BCN_WELCOME: WelcomePreview = {
  subject: "Welcome to Barcelona Office Opening, {first_name}",
  block: "Wi-Fi: Didit-Guest · password EXAMPLE-WIFI-PASSWORD\n20:00 Welcome from Alberto · 20:30 Product demos",
};

export const FORM_STATES = {
  empty: { status: "idle", values: EMPTY_EVENT },
  errors: { status: "invalid", values: ERROR_FORM, errors: ERROR_MESSAGES },
  saving: { status: "idle", values: BCN_FORM },
  saved: { status: "saved", values: BCN_FORM, savedAt: "2026-10-08T17:30:00+02:00" },
} satisfies Record<string, EventFormState>;
