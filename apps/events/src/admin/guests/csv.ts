/**
 * CSV writing for the guests export and the "Download skipped rows" file. Cells a spreadsheet would run as a formula
 * (starting with = + - @, or a tab / carriage return) get a leading apostrophe (OWASP CSV injection).
 */
import { checkedInLabel } from "./query";
import type { GuestRow, PasteRow } from "./types";

const FORMULA_START = /^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 lines (CRLF). */
export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const STATUS_LABEL: Record<GuestRow["status"], string> = {
  approved: "Approved",
  "link-sent": "Link sent",
  verifying: "Verifying",
  verified: "Verified",
  "in-review": "In review",
  declined: "Declined",
  revoked: "Revoked",
  "checked-in": "Checked in",
};

export function guestsCsv(rows: GuestRow[]): string {
  return toCsv([
    ["Name", "Registered as", "Email", "Email verified", "Status", "Verification", "Checked in", "Source"],
    ...rows.map((r) => [
      r.name,
      r.registeredAs ?? "",
      r.email,
      r.emailVerified ? "yes" : "no",
      STATUS_LABEL[r.status],
      r.bounced ? "Email bounced" : r.verification,
      checkedInLabel(r.checkedIn),
      r.source,
    ]),
  ]);
}

export const PASTE_REASON: Record<PasteRow["status"], string> = {
  ready: "Ready",
  "invalid-email": "Invalid email",
  "missing-name": "Missing first name",
  duplicate: "Already on the list",
  "duplicate-in-list": "Twice in this list",
};

/** "Download skipped rows" (A-07f). */
export function skippedCsv(rows: PasteRow[]): string {
  return toCsv([["First name", "Last name", "Email", "Reason"], ...rows.map((r) => [r.first, r.last, r.email, PASTE_REASON[r.status]])]);
}

/** A download link that needs no script. */
export const csvDataUrl = (csv: string) => `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
