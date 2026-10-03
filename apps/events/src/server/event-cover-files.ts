import { COVER_TRANSPORT_BYTES, canonicalCover, uploadEventCover } from "@didit-events/core/content/event-assets";
import type { StaffPrincipal } from "@didit-events/core";
import { COVER_TYPES } from "../admin/form/validate";

/**
 * The cover files an event form can carry with a save: the square main cover (`cover`) and the banner (`coverWide`).
 * A new event (or a saved one while the storage route is unavailable) stages them in the form; the action checks both
 * before writing anything and stores them right after the event write, main first, chaining the edit version.
 */
export const COVER_FILES = [
  { key: "cover", variant: "main", label: "" },
  { key: "coverWide", variant: "wide", label: "Banner: " },
] as const;

/** Both files at the shared 5 MiB transport limit. */
export const COVER_FILES_MAX_BYTES = COVER_FILES.length * COVER_TRANSPORT_BYTES;

const staged = (form: FormData, key: string) => {
  const f = form.get(key);
  return f instanceof File && f.size ? f : null;
};

/** The first problem with the staged files, as the `cover` field message; `decode` also runs the storage checks. */
export async function stagedCoverError(form: FormData, decode = true): Promise<string | undefined> {
  for (const c of COVER_FILES) {
    const f = staged(form, c.key);
    if (!f) continue;
    if (f.size > COVER_TRANSPORT_BYTES) return `${c.label}Up to 5 MB`;
    if (c.variant === "wide" && !COVER_TYPES.includes(f.type)) return `${c.label}Use a JPG or PNG`;
  }
  if (!decode) return undefined;
  for (const c of COVER_FILES) {
    const f = staged(form, c.key);
    if (!f) continue;
    try { await canonicalCover(new Uint8Array(await f.arrayBuffer())); }
    catch { return `${c.label}Use a valid JPG, PNG or WebP image up to 5 MB and 4096 pixels per side.`; }
  }
  return undefined;
}

/** Stores the staged files (main, then banner). Returns the event's edit version after the last write. */
export async function uploadStagedCovers(actor: StaffPrincipal, eventId: string, editVersion: number, alt: string, form: FormData): Promise<number> {
  let version = editVersion;
  for (const c of COVER_FILES) {
    const f = staged(form, c.key);
    if (!f) continue;
    const stored = await uploadEventCover(actor, eventId, { expectedEventVersion: version, alt, bytes: new Uint8Array(await f.arrayBuffer()), variant: c.variant });
    version = stored.editVersion;
  }
  return version;
}

/** The staged main cover's alt text (`coverAlt`, typed in the editor), else the event name. */
export const coverAlt = (form: FormData, fallback: string) => String(form.get("coverAlt") ?? "").trim().slice(0, 200) || fallback.trim().slice(0, 200) || "Event cover";
