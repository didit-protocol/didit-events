import { createHmac, timingSafeEqual } from "node:crypto";

/** Python json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False) + shorten_floats. */
export function canonicalizeV2(raw: string): string {
  let at = 0;
  const ws = () => { while (/[ \t\r\n]/.test(raw[at] ?? "") && at < raw.length) at++; };
  const fail = (): never => { throw new Error("InvalidWebhookJson"); };
  const string = (): string => {
    const start = at++;
    while (at < raw.length) {
      if (raw[at] === "\\") { at += 2; continue; }
      if (raw[at++] === '"') {
        const value: unknown = JSON.parse(raw.slice(start, at));
        if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) return fail();
        return value;
      }
    }
    return fail();
  };
  const compare = (a: string, b: string): number => {
    const x = Array.from(a), y = Array.from(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const diff = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
      if (diff) return diff;
    }
    return x.length - y.length;
  };
  const value = (depth: number): string => {
    if (depth > 128) return fail();
    ws();
    const char = raw[at];
    if (char === '"') return JSON.stringify(string());
    if (char === "{") {
      at++; ws();
      const entries: Array<[string, string]> = [], keys = new Set<string>();
      if (raw[at] === "}") { at++; return "{}"; }
      while (at < raw.length) {
        ws(); if (raw[at] !== '"') return fail();
        const key = string(); if (keys.has(key)) return fail(); keys.add(key);
        ws(); if (raw[at++] !== ":") return fail();
        entries.push([key, value(depth + 1)]); ws();
        if (raw[at] === "}") { at++; return `{${entries.sort((a, b) => compare(a[0], b[0])).map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",")}}`; }
        if (raw[at++] !== ",") return fail();
      }
      return fail();
    }
    if (char === "[") {
      at++; ws(); const values: string[] = [];
      if (raw[at] === "]") { at++; return "[]"; }
      while (at < raw.length) {
        values.push(value(depth + 1)); ws();
        if (raw[at] === "]") { at++; return `[${values.join(",")}]`; }
        if (raw[at++] !== ",") return fail();
      }
      return fail();
    }
    for (const literal of ["true", "false", "null"]) {
      if (raw.startsWith(literal, at)) { at += literal.length; return literal; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(at));
    if (!match) return fail();
    const lexeme = match[0]; at += lexeme.length;
    if (!/[.eE]/.test(lexeme)) return BigInt(lexeme).toString();
    const n = Number(lexeme);
    if (!Number.isFinite(n)) return fail();
    if (Number.isInteger(n)) return BigInt(n).toString();
    if (Math.abs(n) >= 1e-4) return JSON.stringify(n);
    const [mantissa, exponent] = n.toExponential().split("e");
    const e = Number(exponent);
    return `${mantissa}e${e < 0 ? "-" : "+"}${Math.abs(e).toString().padStart(2, "0")}`;
  };
  const canonical = value(0); ws(); if (at !== raw.length) return fail();
  return canonical;
}
export function signV2(raw: string, secret: string): string { return createHmac("sha256", secret).update(canonicalizeV2(raw)).digest("hex"); }
const equalsHex = (actual: string, expected: string): boolean => /^[a-fA-F0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
export function verifyWebhookSignature(raw: string, headers: Headers, secret: string, now = new Date()): boolean {
  if (!secret || !Number.isFinite(now.getTime())) return false;
  const timestamp = headers.get("x-timestamp");
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || !("timestamp" in payload) || payload.timestamp !== Number(timestamp)) return false;
    const v2 = headers.get("x-signature-v2");
    if (v2 !== null) return equalsHex(v2, signV2(raw, secret));
    const original = headers.get("x-signature");
    // Canonical parsing still rejects duplicate keys/non-finite numbers on the raw fallback.
    canonicalizeV2(raw);
    return original !== null && equalsHex(original, createHmac("sha256", secret).update(raw).digest("hex"));
  } catch { return false; }
}
