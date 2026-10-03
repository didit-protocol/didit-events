/** A-11 Settings + A-18 Spend and limits view model. `(tabs)/settings/data.ts` returns it. */
import type { Strictness, WelcomePreview } from "../form/types";
import type { DoorMode as KioskMode } from "../../door/kiosk/types";

export interface EventSettings {
  eventId: string;
  /** Optimistic edit version every settings save is checked against. */
  editVersion?: number;
  /** The inline Event details editor: ISO date and HH:MM times in the event's zone. */
  details?: { name: string; date: string; start: string; end: string; timeZone: string };
  name: string;
  /** "23 Oct 2026" */
  date: string;
  /** "19:00–23:00" */
  time: string;
  requestForm: { open: boolean; questions: string; capacity: number };
  welcome: WelcomePreview;
  limits: SpendLimits;
  guestCount: number;
  ended: boolean;
  status?: "draft" | "published" | "live" | "ended" | "cancelled";
}

/** A-18: scan budget per day (C-limits: every scan is a paid face search), door mode and matching strictness. */
export interface SpendLimits {
  dailyScanBudget: number;
  scansToday: number;
  mode: KioskMode;
  strictness: Strictness;
}

export type SettingsSaveState = { status: "idle" } | { status: "saved" } | { status: "invalid"; errors: Record<string, string> } | { status: "error"; message: string };
