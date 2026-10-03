export const DEFAULT_CONTACT_EMAIL = "events@example.com";

/** Pass NEXT_PUBLIC_CONTACT_EMAIL from UI code; server callers read CONTACT_EMAIL at runtime. */
export function contactEmail(value = process.env.CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@<>;,?&#]+@[^\s@<>;,?&#]+\.[^\s@<>;,?&#]+$/.test(email)) {
    throw new Error("CONTACT_EMAIL must be an email address");
  }
  return email;
}
