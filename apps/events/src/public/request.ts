import type { RequestField, RequestInput } from "./types";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const REQUEST_FIELDS: { name: RequestField; label: string; optional?: boolean; autoComplete: string }[] = [
  { name: "firstName", label: "First name", autoComplete: "given-name" },
  { name: "lastName", label: "Last name", autoComplete: "family-name" },
  { name: "email", label: "Email", autoComplete: "email" },
  { name: "company", label: "Company", autoComplete: "organization" },
  { name: "role", label: "Role", optional: true, autoComplete: "organization-title" },
];

const MESSAGES: Record<Exclude<RequestField, "role">, string> = {
  firstName: "Enter your first name",
  lastName: "Enter your last name",
  email: "Enter a valid email address",
  company: "Enter your company",
};

/** Reads the G-01 form, trimming values and lower-casing the email. */
export function readRequest(form: FormData): RequestInput {
  const v = (k: string) => String(form.get(k) ?? "").trim();
  return { firstName: v("firstName"), lastName: v("lastName"), email: v("email").toLowerCase(), company: v("company"), role: v("role") };
}

/** G-01 validation: required names, company and a well-formed email (≤ 254 chars); role is optional. */
export function validateRequest(input: RequestInput): Partial<Record<RequestField, string>> {
  const errors: Partial<Record<RequestField, string>> = {};
  if (!input.firstName || input.firstName.length > 100) errors.firstName = MESSAGES.firstName;
  if (!input.lastName || input.lastName.length > 100) errors.lastName = MESSAGES.lastName;
  if (!EMAIL.test(input.email) || input.email.length > 254) errors.email = MESSAGES.email;
  if (!input.company || input.company.length > 120) errors.company = MESSAGES.company;
  return errors;
}

/** "Check the 2 highlighted fields." */
export const errorSummary = (n: number) => `Check the ${n} highlighted ${n === 1 ? "field" : "fields"}.`;
