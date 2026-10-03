/**
 * Names shown for the signed-in person. A new email-code guest has no first/last name yet, so every
 * place that shows the viewer falls back to the email local part, then to a neutral label (never " ").
 */
export interface NamedPerson {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

const localPart = (email?: string | null) => (email ?? "").split("@")[0]?.trim() ?? "";

/** "María García" · "maria.garcia" (no names) · "Your account" (nothing at all). */
export const displayName = (p: NamedPerson) =>
  [p.firstName?.trim(), p.lastName?.trim()].filter(Boolean).join(" ") || localPart(p.email) || "Your account";

/** For greetings ("Hi María"): the first name, else the email local part, else "there". */
export const greetingName = (p: NamedPerson) => p.firstName?.trim() || localPart(p.email) || "there";
