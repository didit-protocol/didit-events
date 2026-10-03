/**
 * A-07 "Paste a list": reads CSV or plain "first, last, email" rows (comma, semicolon or tab separated, quotes
 * allowed, header row optional) and marks each row ready, invalid or a duplicate. Pure: the preview and the tests call
 * it; the add actions re-validate what they receive with the same `cleanGuest`.
 */
import type { NewGuest, PasteResult, PasteRow } from "./types";

export const MAX_PASTE_ROWS = 1000;

/** Loose but useful: something@domain.tld with a 2+ letter TLD and no spaces. */
export const EMAIL_RE = /^[^\s@,;"<>]+@[^\s@,;"<>]+\.[A-Za-z]{2,}$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());

export type GuestProblem = "invalid-email" | "missing-name";
export type CleanGuest = { ok: true; guest: NewGuest } | { ok: false; reason: GuestProblem };

/**
 * The one guest validator (A-07 preview and the add actions): trimmed and bounded fields, a valid email and a first
 * name (the registrations service needs one). The email problem wins when both are wrong.
 */
export function cleanGuest(g: unknown): CleanGuest {
  const { first, last, email } = g && typeof g === "object" ? (g as Record<string, unknown>) : {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const f = str(first, 80);
  const e = str(email, 254);
  if (!isEmail(e)) return { ok: false, reason: "invalid-email" };
  if (!f) return { ok: false, reason: "missing-name" };
  return { ok: true, guest: { first: f, last: str(last, 80), email: e } };
}

/** Splits one line on `sep`, honouring double quotes ("García, María" and "" escapes). */
export function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function detectSeparator(lines: string[]): string {
  const sample = lines.slice(0, 5).join("\n");
  if (sample.includes("\t")) return "\t";
  const commas = (sample.match(/,/g) ?? []).length;
  const semis = (sample.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

type Col = "first" | "last" | "name" | "email";
const HEADER_WORDS: Record<string, Col> = {
  first: "first",
  "first name": "first",
  firstname: "first",
  "given name": "first",
  nombre: "first",
  last: "last",
  "last name": "last",
  lastname: "last",
  surname: "last",
  "family name": "last",
  apellido: "last",
  apellidos: "last",
  name: "name",
  "full name": "name",
  email: "email",
  "e-mail": "email",
  "email address": "email",
  correo: "email",
};

function headerColumns(cells: string[]): Col[] | null {
  if (cells.some((c) => c.includes("@"))) return null;
  const cols = cells.map((c) => HEADER_WORDS[c.toLowerCase().replace(/[_*]/g, " ").replace(/\s+/g, " ").trim()]);
  return cols.some(Boolean) ? (cols as Col[]) : null;
}

/** Without a header: the cell with an @ is the email, the others are the name (first, last). */
function guessRow(cells: string[]): { first: string; last: string; email: string } {
  const at = cells.findIndex((c) => c.includes("@"));
  const email = at >= 0 ? cells[at]! : cells.length >= 3 ? cells[2]! : "";
  const names = cells.filter((_, i) => i !== (at >= 0 ? at : 2)).filter(Boolean);
  if (names.length >= 2) return { first: names[0]!, last: names.slice(1).join(" "), email };
  const [first = "", ...rest] = (names[0] ?? "").split(/\s+/);
  return { first, last: rest.join(" "), email };
}

function mapRow(cells: string[], cols: Col[]): { first: string; last: string; email: string } {
  const get = (c: Col) => cells[cols.indexOf(c)] ?? "";
  if (cols.includes("first") || cols.includes("last")) return { first: get("first"), last: get("last"), email: get("email") };
  const [first = "", ...rest] = get("name").split(/\s+/);
  return { first, last: rest.join(" "), email: get("email") };
}

/**
 * @param existingEmails emails already on the event's guest list (any case)
 */
export function parseGuestPaste(text: string, existingEmails: Iterable<string> = []): PasteResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .map((l, i) => ({ text: l, line: i + 1 }))
    .filter((l) => l.text.trim() !== "");
  const empty: PasteResult = { rows: [], header: false, ready: 0, invalidEmail: 0, missingName: 0, duplicate: 0 };
  if (lines.length === 0) return empty;

  const sep = detectSeparator(lines.map((l) => l.text));
  const first = splitLine(lines[0]!.text, sep);
  const cols = headerColumns(first);
  const body = cols ? lines.slice(1) : lines;
  if (body.length > MAX_PASTE_ROWS) return { ...empty, header: Boolean(cols), error: `That’s ${body.length} rows. Add up to ${MAX_PASTE_ROWS} at a time.` };

  const existing = new Set([...existingEmails].map((e) => e.trim().toLowerCase()));
  const seen = new Set<string>();
  const rows: PasteRow[] = body.map(({ text: l, line }) => {
    const cells = splitLine(l, sep);
    const raw = cols ? mapRow(cells, cols) : guessRow(cells);
    const checked = cleanGuest(raw);
    if (!checked.ok) return { line, first: raw.first.trim(), last: raw.last.trim(), email: raw.email.trim(), status: checked.reason };
    const { guest } = checked;
    const key = guest.email.toLowerCase();
    const status: PasteRow["status"] = existing.has(key) ? "duplicate" : seen.has(key) ? "duplicate-in-list" : "ready";
    seen.add(key);
    return { line, ...guest, status };
  });

  return {
    rows,
    header: Boolean(cols),
    ready: rows.filter((r) => r.status === "ready").length,
    invalidEmail: rows.filter((r) => r.status === "invalid-email").length,
    missingName: rows.filter((r) => r.status === "missing-name").length,
    duplicate: rows.filter((r) => r.status === "duplicate" || r.status === "duplicate-in-list").length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Preview chips after "N ready" (A-07d: "1 invalid email", "1 duplicate"). */
export function problemChips(r: PasteResult): { tone: "danger" | "warning"; label: string }[] {
  const out: { tone: "danger" | "warning"; label: string }[] = [];
  if (r.invalidEmail) out.push({ tone: "danger", label: plural(r.invalidEmail, "invalid email", "invalid emails") });
  if (r.missingName) out.push({ tone: "danger", label: plural(r.missingName, "missing first name", "missing first names") });
  if (r.duplicate) out.push({ tone: "warning", label: plural(r.duplicate, "duplicate", "duplicates") });
  return out;
}

/** A-07f: "23 added, 2 skipped" and "Skipped: 1 invalid email, 1 already on the list." */
export function doneSummary(added: number, skipped: PasteRow[]): { title: string; detail: string } {
  const title = skipped.length ? `${added} added, ${skipped.length} skipped` : `${added} added`;
  if (!skipped.length) return { title, detail: "Each guest gets their personal Didit verification link." };
  const invalid = skipped.filter((r) => r.status === "invalid-email").length;
  const missing = skipped.filter((r) => r.status === "missing-name").length;
  const dup = skipped.filter((r) => r.status === "duplicate" || r.status === "duplicate-in-list").length;
  const parts = [
    invalid ? plural(invalid, "invalid email", "invalid emails") : "",
    missing ? plural(missing, "missing first name", "missing first names") : "",
    dup ? `${dup} already on the list` : "",
  ].filter(Boolean);
  return { title, detail: `Skipped: ${parts.join(", ")}.` };
}
