import type { EventFormValues, WelcomePreview } from "./types";

export const EMPTY_EVENT: EventFormValues = {
  name: "",
  date: "",
  start: "",
  end: "",
  timezone: "Europe/Madrid",
  venue: "",
  address: "",
  street: "",
  city: "",
  postalCode: "",
  country: "",
  placeId: "",
  lat: "",
  lng: "",
  mapsUrl: "",
  capacity: "",
  description: "",
  requestForm: true,
  questions: [],
  welcomeEmail: true,
  threshold: 80,
};

export const DEFAULT_WELCOME = (name: string): WelcomePreview => ({ subject: `Welcome to ${name || "your event"}, {first_name}`, block: "" });

