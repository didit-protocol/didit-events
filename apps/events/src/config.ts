import { contactEmail, DEFAULT_CONTACT_EMAIL } from "@didit-events/core/contact-email";

/** Next.js freezes this public value for server-rendered UI and client components at build time. */
export const CONTACT_EMAIL = contactEmail(process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL);
