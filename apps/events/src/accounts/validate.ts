/** Input rules shared by the sign-in, registration, profile and cancellation forms (server actions re-check them). */
import type { ProfileInput, RegisterField, RegisterInput } from "./types";

// Deliberately simple: a local part, an @, a domain with a dot and a 2+ letter TLD. Didit verifies the address.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;

export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v.trim());

export const EMAIL_ERROR = "Enter a valid email address";

export function validateRegister(input: RegisterInput): Partial<Record<RegisterField, string>> {
  const errors: Partial<Record<RegisterField, string>> = {};
  if (input.fullName.trim().length < 2) errors.fullName = "Enter your name";
  if (!isEmail(input.email)) errors.email = EMAIL_ERROR;
  if (!input.consent) errors.consent = "Tick the box to continue";
  return errors;
}

export function validateProfile(input: ProfileInput, requireName: boolean): Partial<Record<keyof ProfileInput, string>> {
  const errors: Partial<Record<keyof ProfileInput, string>> = {};
  if (requireName && input.fullName.trim().length < 2) errors.fullName = "Enter your full name";
  if (!input.consent) errors.consent = "Tick the box to continue";
  return errors;
}

/** "María García López" → { firstName: "María", lastName: "García López" } */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export const text = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
export const checked = (form: FormData, key: string) => form.get(key) === "on" || form.get(key) === "true";
export const slugOf = (form: FormData) => String(form.get("slug") ?? "").replace(/[^a-z0-9-]/g, "");
