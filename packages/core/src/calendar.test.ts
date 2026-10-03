import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { testDatabase, resetDatabase } from "./testing/database.ts";
import { png } from "./testing/images.ts";
import { CalendarImageError, getCalendarImage, getCalendarProfile, removeCalendarImage, saveCalendarText, setCalendarImage, sniffImage, stripMetadata, validateCalendarImage } from "./calendar.ts";

const webpX = (w: number, h: number) => { const b = new Uint8Array(40); b.set([..."RIFF"].map(c => c.charCodeAt(0)), 0); b.set([..."WEBPVP8X"].map(c => c.charCodeAt(0)), 8); b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24); return b; };
const jpeg = async () => new Uint8Array(await readFile(new URL("./identity/fixtures/photo.jpg", import.meta.url)));

describe("image sniffing", () => {
  it("removes padded WebP EXIF/XMP/ICC chunks, updates flags and size, and keeps decoded pixels", async () => {
    const sharp = (await import("sharp")).default;
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).webp().withMetadata().toBuffer();
    const chunk = (name: string) => { const payload = Buffer.from("PRIVATE-GPS"); const b = Buffer.alloc(8 + payload.length + payload.length % 2); b.write(name); b.writeUInt32LE(payload.length, 4); payload.copy(b, 8); return b; };
    const tagged = Buffer.concat([image, chunk("EXIF"), chunk("XMP ")]); tagged.writeUInt32LE(tagged.length - 8, 4);
    const clean = Buffer.from(stripMetadata(tagged, "image/webp"));
    expect(clean.toString("latin1")).not.toMatch(/EXIF|XMP |ICCP|PRIVATE-GPS/);
    expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
    expect(clean[20]! & 0x2c).toBe(0);
    expect(await sharp(clean).raw().toBuffer()).toEqual(await sharp(image).raw().toBuffer());
    expect(() => stripMetadata(tagged.subarray(0, -1), "image/webp")).toThrow("Unreadable");
    const truncated = Buffer.from(tagged); truncated.writeUInt32LE(0xffffffff, 16);
    expect(() => stripMetadata(truncated, "image/webp")).toThrow("Unreadable");
  });
  it("reads type and size from PNG, JPEG and WebP headers, never from the claimed type", async () => {
    expect(sniffImage(png(1760, 400))).toEqual({ type: "image/png", width: 1760, height: 400 });
    expect(sniffImage(await jpeg())).toEqual({ type: "image/jpeg", width: 512, height: 512 });
    expect(sniffImage(webpX(1200, 300))).toEqual({ type: "image/webp", width: 1200, height: 300 });
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Uint8Array(40)]))).toBeNull();
  });
  it("rejects non-images, oversized files and implausible dimensions per slot", () => {
    const code = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return e instanceof CalendarImageError ? e.code : String(e); } };
    expect(code(() => validateCalendarImage("cover", new Uint8Array(100)))).toBe("NotAnImage");
    expect(code(() => validateCalendarImage("cover", new Uint8Array(5 * 1024 * 1024 + 1)))).toBe("TooLarge");
    expect(code(() => validateCalendarImage("cover", png(300, 100)))).toBe("BadDimensions");
    expect(code(() => validateCalendarImage("cover", png(9000, 400)))).toBe("BadDimensions");
    expect(code(() => validateCalendarImage("logo", png(32, 32)))).toBe("BadDimensions");
    expect(code(() => validateCalendarImage("logo", png(1000, 200)))).toBe("BadDimensions");
    expect(code(() => validateCalendarImage("logo", png(256, 256)))).toBe("ok");
    expect(code(() => validateCalendarImage("cover", png(1760, 400)))).toBe("ok");
  });
  it("strips PNG text/EXIF chunks and JPEG APP1+ segments, keeping the image data", async () => {
    const tagged = png(256, 256, [["tEXt", [65, 0, 66]], ["eXIf", [1, 2]], ["iCCP", [3, 4]]]);
    const clean = stripMetadata(tagged, "image/png");
    expect(clean.length).toBeLessThan(tagged.length);
    expect(new TextDecoder("latin1").decode(clean)).not.toMatch(/tEXt|eXIf|iCCP/);
    expect(sniffImage(clean)).toEqual({ type: "image/png", width: 256, height: 256 });
    const j = await jpeg(), exif = [0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0];
    const withExif = new Uint8Array([...j.subarray(0, 2), ...exif, ...j.subarray(2)]);
    expect(stripMetadata(withExif, "image/jpeg").length).toBeLessThanOrEqual(j.length);
    expect(sniffImage(stripMetadata(withExif, "image/jpeg"))).toEqual({ type: "image/jpeg", width: 512, height: 512 });
  });
  it("fails closed: a truncated JPEG segment or a PNG chunk running past EOF is rejected, never returned with its metadata", async () => {
    const code = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return e instanceof CalendarImageError ? e.code : String(e); } };
    const j = await jpeg();
    // APP1 declares 0x1000 bytes but the file ends after a few: the old code returned the input (EXIF and all).
    const truncatedApp1 = new Uint8Array([...j.subarray(0, 2), 0xff, 0xe1, 0x10, 0x00, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    expect(code(() => stripMetadata(truncatedApp1, "image/jpeg"))).toBe("Unreadable");
    // Segment chain that never reaches SOS.
    expect(code(() => stripMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2]), "image/jpeg"))).toBe("Unreadable");
    const ok = png(1760, 400), ihdrEnd = 8 + 25;
    const pastEof = new Uint8Array([...ok.subarray(0, ihdrEnd), 0, 0, 0x10, 0, ...[..."tEXt"].map(c => c.charCodeAt(0)), 65, 0, 66]);
    expect(code(() => stripMetadata(pastEof, "image/png"))).toBe("Unreadable");
    expect(code(() => stripMetadata(ok.subarray(0, ok.length - 12), "image/png"))).toBe("Unreadable");
    expect(code(() => stripMetadata(ok, "image/png"))).toBe("ok");
    expect(code(() => stripMetadata(j, "image/jpeg"))).toBe("ok");
  });
});

describe("calendar profile store", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => { database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite"); }, 60000);
  beforeEach(async () => { await resetDatabase(database.db); });
  afterAll(async () => { await database?.close(); });
  const seed = { name: "Didit Events", tagline: "Identity, fraud and founders", description: "Built-in" };

  it("starts empty, upserts text, stores and versions images, and removes them", async () => {
    expect(await getCalendarProfile(database.db)).toBeNull();
    const cover = png(1760, 400);
    const withCover = await setCalendarImage("owner@didit.me", "cover", cover, seed, database.db);
    expect(withCover).toMatchObject({ name: "Didit Events", coverType: "image/png", coverVersion: 1, logoType: null, updatedBy: "owner@didit.me" });
    expect((await getCalendarImage("cover", database.db))?.bytes).toEqual(cover);
    const saved = await saveCalendarText("admin@didit.me", { name: "Founders Club", tagline: "Evenings", description: "Bio", websiteUrl: "https://didit.me", xUrl: null, linkedinUrl: null }, database.db);
    expect(saved).toMatchObject({ name: "Founders Club", coverVersion: 1, websiteUrl: "https://didit.me", updatedBy: "admin@didit.me" });
    expect((await setCalendarImage("admin@didit.me", "cover", png(1200, 300), seed, database.db)).coverVersion).toBe(2);
    const removed = await removeCalendarImage("admin@didit.me", "cover", database.db);
    expect(removed).toMatchObject({ coverType: null, coverVersion: 3, name: "Founders Club" });
    expect(await getCalendarImage("cover", database.db)).toBeNull();
    await expect(setCalendarImage("admin@didit.me", "logo", new Uint8Array(10), seed, database.db)).rejects.toBeInstanceOf(CalendarImageError);
  });
  it("the database refuses non-https links and over-long bios", async () => {
    await expect(saveCalendarText("a@didit.me", { ...seed, websiteUrl: "javascript:alert(1)", xUrl: null, linkedinUrl: null }, database.db)).rejects.toThrow();
    await expect(saveCalendarText("a@didit.me", { ...seed, description: "x".repeat(601), websiteUrl: null, xUrl: null, linkedinUrl: null }, database.db)).rejects.toThrow();
  });
});
