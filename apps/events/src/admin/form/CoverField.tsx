"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type RefObject } from "react";
import { Segmented, TextField, cx } from "@didit-events/ui";
import { actionCsrf } from "../../auth/client";
import type { CoverUploadResult, EventCover } from "../model/contract";
import { prepareCover } from "./cover";
import s from "./EventForm.module.css";

export type CoverVariant = "main" | "wide";

export interface CoverFieldProps {
  value: EventCover;
  onChange: (next: EventCover) => void;
  /** The stored main cover's URL (loader: `EventEditorView.coverUrl`); a saved event also derives it from the version. */
  storedUrl?: string | null;
  /** Saved event: upload straight to storage. New event: the files go with the first save. */
  eventId?: string;
  editVersion?: number;
  defaultAlt?: string;
  onUploaded?: (result: CoverUploadResult) => void;
  /** A file is being prepared or uploaded: saving waits. */
  onBusy: (busy: boolean) => void;
  /** The square cover as shown now (picked, uploaded or stored), for the guest page preview. */
  onPreview: (url: string | null) => void;
  /** Files are staged in the form (they upload with the save): the page counts as changed. */
  onStaged?: (staged: boolean) => void;
  error?: string;
  altError?: string;
  readOnly?: boolean;
  /** Tests: the upload transport. */
  upload?: CoverUpload;
}

export type CoverUploadResponse = { ok: true; data: CoverUploadResult } | { ok: false; code: "unavailable" | "conflict" | "invalid"; message: string };
export type CoverUpload = (eventId: string, file: File, editVersion: number, onProgress: (pct: number) => void, options?: { variant: CoverVariant; alt?: string }) => Promise<CoverUploadResponse>;

/** POST /api/admin/events/:id/cover, multipart, with upload progress. 404 = route not deployed yet. */
export const xhrCoverUpload: CoverUpload = (eventId, file, editVersion, onProgress, options) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/admin/events/${encodeURIComponent(eventId)}/cover`);
    xhr.setRequestHeader("x-csrf", actionCsrf());
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => resolve({ ok: false, code: "invalid", message: "Upload failed. Check your connection and try again." });
    xhr.onload = () => {
      if (xhr.status === 404 || xhr.status === 405) return resolve({ ok: false, code: "unavailable", message: "" });
      let body: { ok?: boolean; data?: CoverUploadResult; error?: { message?: string } } | CoverUploadResult | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status < 300 && body) return resolve({ ok: true, data: ("data" in body && body.data ? body.data : body) as CoverUploadResult });
      const message = body && "error" in body && body.error?.message && body.error.message !== "invalid" ? body.error.message : "That image couldn’t be used. Try a JPG or PNG up to 4096 pixels per side.";
      resolve({ ok: false, code: xhr.status === 409 ? "conflict" : "invalid", message: xhr.status === 409 ? "Someone else changed this event. Reload to get their changes, then upload again." : message });
    };
    const form = new FormData();
    form.append("cover", file);
    form.append("expectedEventVersion", String(editVersion));
    form.append("variant", options?.variant ?? "main");
    if (options?.alt) form.append("alt", options.alt);
    xhr.send(form);
  });

const THEMES = [
  { value: "aqua", label: "Aqua" },
  { value: "sky", label: "Sky" },
];

/** A stored cover version's URL (the same versioned URL the public page uses). */
export const coverSrc = (eventId: string, version: string) => `/api/events/${encodeURIComponent(eventId)}/cover?v=${version}`;

const SLOTS = {
  main: { title: "Square cover", help: "1:1 · event page and cards", input: "cover", ratio: 1, label: "square" },
  wide: { title: "Banner", help: "about 10:3 · tickets and emails", input: "coverWide", ratio: 10 / 3, label: "banner" },
} as const;

/** A soft note when the picked image's shape is far from the slot's (it is cropped to fit). */
export function shapeNote(variant: CoverVariant, width: number, height: number): string | null {
  if (!width || !height) return null;
  const r = width / height, want = SLOTS[variant].ratio;
  if (Math.abs(Math.log(r / want)) < Math.log(1.25)) return null;
  return variant === "main" ? "Not square: the edges are cropped on the event page." : "Not a banner shape: the top and bottom are cropped on tickets and emails.";
}

type SlotState = { picked: { name: string; url: string } | null; staged: boolean; status: string | null; error: string | null; progress: number | null; note: string | null };
const EMPTY: SlotState = { picked: null, staged: false, status: null, error: null, progress: null, note: null };

/**
 * Cover images: a square cover (event page and cards) and a banner (tickets and emails), side by side, each with a
 * live preview at its real shape and corner radius, drag and drop, replace and remove. Big photos are downscaled in
 * the browser first. On a saved event each file uploads straight to storage (one at a time, chaining the edit
 * version); on a new event both are staged in the form and stored right after the event is created. Without a
 * square image the event uses a theme.
 */
export function CoverField({ value, onChange, storedUrl, eventId, editVersion = 1, defaultAlt = "Event cover", onUploaded, onBusy, onPreview, onStaged, error, altError, readOnly, upload = xhrCoverUpload }: CoverFieldProps) {
  const ids = useId();
  const inputs = { main: useRef<HTMLInputElement>(null), wide: useRef<HTMLInputElement>(null) };
  const [slots, setSlots] = useState<Record<CoverVariant, SlotState>>({ main: EMPTY, wide: EMPTY });
  const [busy, setBusy] = useState<CoverVariant | null>(null);
  const [stagedAlt, setStagedAlt] = useState("");
  const urls = useRef(new Set<string>());
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const patch = (v: CoverVariant, p: Partial<SlotState>) => setSlots((prev) => ({ ...prev, [v]: { ...prev[v], ...p } }));
  const staged = slots.main.staged || slots.wide.staged;
  useEffect(() => onStaged?.(staged), [staged, onStaged]);

  const stored = (v: CoverVariant): string | null => {
    const version = v === "main" ? (value.kind === "asset" ? value.version : null) : value.wide?.version ?? null;
    if (!version) return null;
    return eventId ? coverSrc(eventId, version) : v === "main" ? storedUrl ?? null : null;
  };
  const shown = (v: CoverVariant) => slots[v].picked?.url ?? stored(v);

  const choose = async (v: CoverVariant, el: HTMLInputElement) => {
    const file = el.files?.[0];
    if (!file) return;
    patch(v, { error: null, note: null, status: "Preparing image…" });
    setBusy(v);
    onBusy(true);
    const done = () => {
      setBusy(null);
      onBusy(false);
    };
    const prepared = await prepareCover(file);
    if (!prepared.ok) {
      el.value = "";
      patch(v, { status: null, error: prepared.error });
      return done();
    }
    if (prepared.file !== file && typeof DataTransfer !== "undefined") {
      const dt = new DataTransfer();
      dt.items.add(prepared.file);
      el.files = dt.files;
    }
    const url = URL.createObjectURL(prepared.file);
    urls.current.add(url);
    patch(v, { picked: { name: file.name, url } });
    if (v === "main") onPreview(url);
    if (!eventId) {
      patch(v, { staged: true, status: "Uploads when you create the event." });
      return done();
    }
    patch(v, { progress: 0, status: "Uploading…" });
    const alt = value.kind === "asset" ? value.alt : defaultAlt;
    const r = await upload(eventId, prepared.file, editVersion, (pct) => patch(v, { progress: pct }), { variant: v, alt });
    patch(v, { progress: null });
    if (r.ok) {
      // Stored: the save only carries the pointer, never the bytes again.
      el.value = "";
      patch(v, { staged: false, status: `Uploaded · ${r.data.width}×${r.data.height}` });
      onUploaded?.(r.data);
      onChange(
        v === "main"
          ? { kind: "asset", version: r.data.version, alt, ...(value.privacy ? { privacy: value.privacy } : {}), ...(value.wide ? { wide: value.wide } : {}) }
          : { ...value, wide: { version: r.data.version } },
      );
    } else if (r.code === "unavailable") patch(v, { staged: true, status: "Uploads when you save." });
    else {
      el.value = "";
      patch(v, { picked: null, status: null, error: r.message });
      if (v === "main") onPreview(stored("main"));
    }
    done();
  };

  const remove = (v: CoverVariant) => {
    const el = inputs[v].current;
    if (el) el.value = "";
    patch(v, { ...EMPTY, staged: false });
    if (v === "main") {
      onPreview(null);
      if (value.kind === "asset") onChange({ kind: "theme", theme: "aqua", ...(value.privacy ? { privacy: value.privacy } : {}), ...(value.wide ? { wide: value.wide } : {}) });
    } else if (value.wide) {
      const { wide: _gone, ...rest } = value;
      onChange(rest as EventCover);
    }
  };

  const mainImage = Boolean(shown("main"));
  const stagedMainOnly = slots.main.staged && value.kind !== "asset";

  return (
    <div className={s.field} data-field="cover">
      <div className={s.fieldHead}>
        <span className={s.label} id={`${ids}-label`}>
          Cover images<span className={s.opt}> · optional</span>
        </span>
        <span className={s.hint}>JPG or PNG. Large photos are resized in the browser.</span>
      </div>
      <div className={s.coverSlots} role="group" aria-labelledby={`${ids}-label`}>
        {(["main", "wide"] as const).map((v) => (
          <CoverSlot
            key={v}
            id={`${ids}-${v}`}
            variant={v}
            inputRef={inputs[v]}
            src={shown(v)}
            alt={v === "main" && value.kind === "asset" ? value.alt : ""}
            theme={v === "main" && value.kind === "theme" ? value.theme : undefined}
            state={slots[v]}
            disabled={readOnly || (busy !== null && busy !== v)}
            busy={busy === v}
            invalid={Boolean(slots[v].error || (v === "main" && error))}
            onFile={(el) => void choose(v, el)}
            onRemove={() => remove(v)}
            onMeasured={(w, h) => patch(v, { note: shapeNote(v, w, h) })}
          />
        ))}
      </div>
      {!mainImage ? (
        <div className={s.themeField}>
          <span className={s.hint}>Theme when there is no square cover</span>
          <Segmented name={`${ids}-theme`} label="Theme without a square cover" size="sm" className={s.theme} value={value.kind === "theme" ? value.theme : "aqua"} onChange={(t) => onChange({ kind: "theme", theme: t === "sky" ? "sky" : "aqua", ...(value.privacy ? { privacy: value.privacy } : {}), ...(value.wide ? { wide: value.wide } : {}) })} options={THEMES} />
        </div>
      ) : null}
      {value.kind === "asset" ? (
        <TextField label="Square cover description (alt text)" value={value.alt} maxLength={200} readOnly={readOnly} error={altError} placeholder="e.g. Guests on the Didit HQ terrace at sunset" onChange={(e) => onChange({ ...value, alt: e.target.value })} />
      ) : stagedMainOnly ? (
        <TextField label={<>Square cover description (alt text)<span className={s.opt}> · optional</span></>} name="coverAlt" value={stagedAlt} maxLength={200} readOnly={readOnly} placeholder={defaultAlt} onChange={(e) => setStagedAlt(e.target.value)} />
      ) : null}
      {error ? (
        <span className={s.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface CoverSlotProps {
  id: string;
  variant: CoverVariant;
  inputRef: RefObject<HTMLInputElement | null>;
  src: string | null;
  alt: string;
  theme?: "aqua" | "sky";
  state: SlotState;
  disabled?: boolean;
  busy: boolean;
  invalid: boolean;
  onFile: (el: HTMLInputElement) => void;
  onRemove: () => void;
  onMeasured: (width: number, height: number) => void;
}

/** One upload slot: the preview frame (fixed aspect ratio, so nothing shifts as the image loads) is the drop zone. */
function CoverSlot({ id, variant, inputRef, src, alt, theme, state, disabled, busy, invalid, onFile, onRemove, onMeasured }: CoverSlotProps) {
  const slot = SLOTS[variant];
  const [drag, setDrag] = useState(false);
  const over = (e: DragEvent, on: boolean) => {
    if (disabled) return;
    if (on) e.preventDefault();
    setDrag(on);
  };
  const message = state.error ?? state.note;
  return (
    <div className={s.coverSlot} data-variant={variant} data-cover-slot={variant}>
      <div className={s.slotHead}>
        <label htmlFor={`${id}-file`} className={s.slotTitle}>
          {slot.title}
        </label>
        <span className={s.hint}>{slot.help}</span>
      </div>
      <div
        className={cx(s.slotFrame, variant === "wide" && s.slotWide)}
        data-theme={src ? undefined : theme}
        data-drag={drag ? "" : undefined}
        data-invalid={invalid ? "" : undefined}
        aria-busy={busy || undefined}
        onDragEnter={(e) => over(e, true)}
        onDragOver={(e) => over(e, true)}
        onDragLeave={(e) => over(e, false)}
        onDrop={() => setDrag(false)}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className={s.slotImg} decoding="async" onLoad={(e) => onMeasured(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
        ) : (
          <span className={s.slotEmpty} aria-hidden="true">
            <span className={s.dropTitle}>{drag ? "Drop to upload" : "Drop an image or browse"}</span>
            <span>{variant === "main" ? (theme ? `${theme === "sky" ? "Sky" : "Aqua"} theme until then` : "1080×1080 recommended") : "1500×450 recommended"}</span>
          </span>
        )}
        <input
          ref={inputRef}
          id={`${id}-file`}
          type="file"
          name={slot.input}
          accept="image/jpeg,image/png,image/webp"
          className={s.file}
          disabled={disabled}
          aria-describedby={`${id}-status`}
          onChange={(e) => onFile(e.currentTarget)}
        />
        {state.progress !== null ? <progress className={s.slotProgress} max={100} value={state.progress} aria-label={`${slot.title} upload progress`} /> : null}
      </div>
      <div className={s.slotFoot}>
        <span id={`${id}-status`} className={s.coverStatus} role="status" aria-live="polite">
          {state.picked && !state.status ? state.picked.name : state.status}
        </span>
        {src ? (
          <span className={s.slotActions}>
            <button type="button" className={s.link} disabled={disabled} onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button type="button" className={cx(s.link, s.linkDanger)} disabled={disabled} onClick={onRemove} aria-label={`Remove ${slot.label}`}>
              Remove
            </button>
          </span>
        ) : null}
      </div>
      {message ? (
        <span className={state.error ? s.error : s.hint} role={state.error ? "alert" : undefined}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
