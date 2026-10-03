import { validEmail } from "./invites.ts";
/** Quote every cell and neutralize spreadsheet formulas, including whitespace/control prefixes. */
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const encodeCsv = (rows: readonly (readonly unknown[])[]) => rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
/** RFC 4180: quoted commas, doubled quotes and embedded newlines. Bounded at the route and parser. */
export function parseCsv(input: string): { first: string; last: string; email: string }[] {
  if (Buffer.byteLength(input) > 65536) throw new Error("CsvTooLarge");
  const rows: string[][] = [], fields: string[] = []; let field = "", quoted = false, closed = false;
  const push = () => { fields.push(field); field = ""; closed = false; };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) { if (c === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ",") push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && input[i + 1] === "\n") i++; push(); if (fields.some(Boolean)) rows.push(fields.splice(0)); else fields.length = 0; }
    else { if (closed || c === '"') throw new Error("InvalidCsv"); field += c; }
  }
  if (quoted) throw new Error("InvalidCsv");
  push(); if (fields.some(Boolean)) rows.push(fields);
  if (rows.length > 501) throw new Error("CsvTooManyRows");
  const header = rows.shift()?.map(s => s.replace(/^\uFEFF/, "").trim().toLowerCase());
  if (!header || !header.includes("email") || !header.includes("first")) throw new Error("CsvHeaderRequired");
  const seen = new Set<string>();
  return rows.map((r, index) => {
    const email = (r[header.indexOf("email")] ?? "").trim().toLowerCase(), first = (r[header.indexOf("first")] ?? "").trim(), last = (r[header.indexOf("last")] ?? "").trim();
    if (!validEmail(email) || !first || first.length > 120 || last.length > 120 || r.length !== header.length) throw new Error(`InvalidCsvRow:${index + 2}`);
    return { first, last, email };
  }).filter(r => { if (seen.has(r.email)) return false; seen.add(r.email); return true; });
}
