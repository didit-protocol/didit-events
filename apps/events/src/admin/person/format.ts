/** "1 Oct 2026" / "1 Oct 2026, 13:02" in the event's zone; "" for a missing or invalid date. */
export function fmtWhen(iso: string | null | undefined, timeZone: string, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}) }).format(d);
}

/** The badge tooltip lines: "Verified by Didit · 1 Oct 2026", method, email verified, profile created. */
export function verifiedLines(v: { verifiedAt: string; method: string; emailVerifiedAt: string | null; createdAt: string | null }, timeZone: string): { label: string; details: string[] } {
  return {
    label: `Verified by Didit · ${fmtWhen(v.verifiedAt, timeZone)}`,
    details: [v.method, v.emailVerifiedAt ? `Email verified ${fmtWhen(v.emailVerifiedAt, timeZone)}` : "", v.createdAt ? `Profile created ${fmtWhen(v.createdAt, timeZone)}` : ""].filter(Boolean),
  };
}
