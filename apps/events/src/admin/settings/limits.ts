/** A-18 validation (pure; the server action and the render tests share it). */
import { type Strictness } from "../form/types";
import type { SpendLimits } from "./types";

export const BUDGET_MIN = 50;
export const BUDGET_MAX = 5000;

export function parseLimits(form: { budget: unknown; mode: unknown; strictness: unknown }, scansToday: number): { ok: true; limits: SpendLimits } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const raw = String(form.budget ?? "").trim();
  const budget = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX) errors.budget = `Between ${BUDGET_MIN} and ${BUDGET_MAX} scans`;
  const mode = form.mode === "strict" ? "strict" : form.mode === "supervised" ? "supervised" : null;
  if (!mode) errors.mode = "Pick a door mode";
  const strictness = Number(form.strictness) as Strictness;
  if (!Number.isInteger(strictness) || strictness < 60 || strictness > 99) errors.strictness = "Pick a whole number from 60 to 99";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, limits: { dailyScanBudget: budget, scansToday, mode: mode!, strictness } };
}

/** "186 of 500 scans today" and the bar tone once past 80% / at the cap. */
export function usage(l: SpendLimits): { text: string; tone: "ok" | "warn" | "full" } {
  const ratio = l.dailyScanBudget ? l.scansToday / l.dailyScanBudget : 1;
  return { text: `${l.scansToday} of ${l.dailyScanBudget} scans today`, tone: ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok" };
}

/** Real scans made today in the event's zone; test-mode scans admitted nobody and never spend the budget. */
export function scansToday(timeZone: string, scans: readonly { createdAt: Date; test: boolean }[], now = new Date()): number {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);
  const today = day(now);
  return scans.filter(s => !s.test && day(s.createdAt) === today).length;
}
