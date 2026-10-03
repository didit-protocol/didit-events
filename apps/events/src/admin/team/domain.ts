import { DEFAULT_STAFF_EMAIL_DOMAIN, staffEmailDomains } from "@didit-events/core/staff-email";

/** The configured staff domain(s) (STAFF_EMAIL_DOMAIN, inlined at build as NEXT_PUBLIC_STAFF_EMAIL_DOMAIN) and the copy built from them. */
export const STAFF_DOMAIN = process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_EMAIL_DOMAIN;

/** Placeholders show the first configured domain. */
export const staffEmailPlaceholder = (value = STAFF_DOMAIN) => `name@${staffEmailDomains(value)[0]}`;

/** "a @didit.me account" with one domain; "an account from your organization" when several are configured. */
export function staffAccountPhrase(value = STAFF_DOMAIN): string {
  const domains = staffEmailDomains(value);
  return domains.length === 1 ? `a @${domains[0]} account` : "an account from your organization";
}

/** "your @didit.me account" with one domain; "your organization account" when several are configured. */
export function yourStaffAccountPhrase(value = STAFF_DOMAIN): string {
  const domains = staffEmailDomains(value);
  return domains.length === 1 ? `your @${domains[0]} account` : "your organization account";
}
