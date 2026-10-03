/** Test-only image bytes. */
/** A structurally valid PNG header (signature + IHDR + optional extra chunks + IEND); CRCs are not checked. */
export function png(width: number, height: number, extra: Array<[string, number[]]> = []): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: number[]) => { const len = data.length; return [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0]; };
  const be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...be(width), ...be(height), 8, 6, 0, 0, 0]), ...extra.flatMap(([t, d]) => chunk(t, d)), ...chunk("IDAT", [1, 2, 3]), ...chunk("IEND", [])]);
}
