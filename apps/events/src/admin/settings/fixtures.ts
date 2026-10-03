/** A-11 / A-18 fixtures: Barcelona Office Opening as design/01b Admin draws it. */
import { BCN_WELCOME } from "../form/fixtures";
import type { EventSettings } from "./types";

export const BCN_SETTINGS: EventSettings = {
  eventId: "bcn-opening",
  editVersion: 4,
  details: { name: "Barcelona Office Opening", date: "2026-10-23", start: "19:00", end: "23:00", timeZone: "Europe/Madrid" },
  name: "Barcelona Office Opening",
  date: "23 Oct 2026",
  time: "19:00–23:00",
  requestForm: { open: true, questions: "First name · Last name · Email · Company (required) · Role", capacity: 150 },
  welcome: BCN_WELCOME,
  limits: { dailyScanBudget: 500, scansToday: 186, mode: "supervised", strictness: 80 },
  guestCount: 124,
  ended: false,
};
