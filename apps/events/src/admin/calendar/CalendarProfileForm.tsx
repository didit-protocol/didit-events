"use client";

import { useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, ConfirmDialog, Logo, TextField, Textarea, toast } from "@didit-events/ui";
import { useCsrf, CsrfField } from "../../auth/CsrfField";
import { CalendarHeader } from "../../public/components/CalendarHeader";
import { calendarLinks, calendarStats, showTagline } from "../../public/calendar-profile";
import { PageHeading } from "../shell/PageHeading";
import shell from "../shell/AdminShell.module.css";
import { useAdminRouter } from "../useAdminRouter";
import {
  CALENDAR_BIO_MAX,
  CALENDAR_IMAGE_TYPES,
  CALENDAR_NAME_MAX,
  CALENDAR_TAGLINE_MAX,
  calendarFieldError,
  imageProblem,
  linkError,
  validateCalendarForm,
  type CalendarErrors,
  type CalendarField,
  type CalendarFormValues,
  type CalendarImageState,
  type CalendarSaveState,
} from "./validate";
import type { CalendarAdminModel } from "./model";
import s from "./Calendar.module.css";

type ImageKind = "cover" | "logo";
export type CalendarSaveAction = (prev: CalendarSaveState, form: FormData) => Promise<CalendarSaveState>;
export type CalendarImageAction = (kind: ImageKind, prev: CalendarImageState, form: FormData) => Promise<CalendarImageState>;

export interface CalendarProfileFormProps {
  model: CalendarAdminModel;
  save: CalendarSaveAction;
  upload: CalendarImageAction;
  remove: CalendarImageAction;
  /** The public page's subscriber and event counts for the preview stats line; absent = the line is hidden. */
  counts?: { subscribers: number; events: number };
  /** Turns the chosen file into the uploaded image (tests replace the canvas step). */
  prepare?: (file: File, kind: ImageKind) => Promise<Blob>;
}

const SLOT = {
  cover: { label: "Cover", hint: "JPG, PNG or WebP up to 5 MB. Recommended 1760 × 400; shown cropped like the banner.", aria: "Choose a cover image" },
  logo: { label: "Logo", hint: "Square JPG, PNG or WebP up to 5 MB, at least 256 × 256.", aria: "Choose a logo image" },
} as const;

/**
 * Resizes in the browser before upload (and drops camera metadata by re-encoding): the cover to at most 2400 px on
 * its long side as JPEG, the logo to a 512 px centre-cropped square PNG (keeps transparency).
 */
export async function resizeForUpload(file: Blob, kind: ImageKind): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    if (kind === "logo") {
      const side = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(512, side);
      canvas.width = out;
      canvas.height = out;
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("encode");
      return blob;
    }
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("encode");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Preview-safe links: only the valid ones show in the live header. */
function previewLinks(v: CalendarFormValues) {
  const ok = (f: CalendarField) => (v[f].trim() && !linkError(f, v[f]) ? new URL(v[f].trim()).href : null);
  return calendarLinks({ websiteUrl: ok("websiteUrl"), xUrl: ok("xUrl"), linkedinUrl: ok("linkedinUrl") });
}

/**
 * /admin/calendar: the P-03 header editor. Live preview on top (banner with the logo tile, name, tagline, bio,
 * links), then Images (upload / replace / remove), Details and Links. Text saves through one server action; each
 * image uploads on its own so a large file never blocks a copy edit.
 */
export function CalendarProfileForm({ model, save, upload, remove, counts, prepare = resizeForUpload }: CalendarProfileFormProps) {
  const [state, action, pending] = useActionState(save, { status: "idle", values: model.values });
  const [values, setValues] = useState<CalendarFormValues>(model.values);
  const [touched, setTouched] = useState<CalendarErrors>({});
  const [images, setImages] = useState<{ cover?: string; logo?: string }>({ cover: model.coverUrl, logo: model.logoUrl });
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();

  // A new server model (after refresh) replaces the local image URLs (state adjusted during render, no effect).
  const [seen, setSeen] = useState(model);
  if (seen !== model) {
    setSeen(model);
    setImages({ cover: model.coverUrl, logo: model.logoUrl });
  }

  const [reported, setReported] = useState(state);
  if (reported !== state) {
    setReported(state);
    if (state.status === "invalid") setTouched(state.errors);
    if (state.status === "saved") setTouched({});
  }
  useEffect(() => {
    if (state.status === "saved") toast({ message: "Calendar saved. The public page is updated.", tone: "success" });
  }, [state]);

  const errors = touched;
  const set = (k: CalendarField, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    // Clear a shown error as soon as the value is valid again.
    if (errors[k] && !calendarFieldError(k, { ...values, [k]: v })) setTouched((prev) => ({ ...prev, [k]: undefined }));
  };
  const blur = (k: CalendarField) => setTouched((prev) => ({ ...prev, [k]: calendarFieldError(k, values) }));
  const field = (k: CalendarField) => ({
    name: k,
    value: values[k],
    error: errors[k],
    readOnly: pending,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
    onBlur: () => blur(k),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const found = validateCalendarForm(values);
    if (Object.keys(found).length) {
      e.preventDefault();
      setTouched(found);
      const first = (["name", "tagline", "description", "websiteUrl", "xUrl", "linkedinUrl"] as const).find((f) => found[f]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    }
  };

  const profile = {
    name: values.name.trim() || "Calendar name",
    tagline: values.tagline.trim(),
    description: values.description.trim(),
    // Same rule as the public header; once text is saved a row exists, so an edited tagline shows after the save.
    showTagline: showTagline(model.hasRow || values.tagline.trim() !== model.values.tagline.trim(), values.tagline),
    coverUrl: images.cover ?? model.defaultCoverUrl,
    logoUrl: images.logo,
    links: previewLinks(values),
  };
  const bioLeft = CALENDAR_BIO_MAX - values.description.trim().length;

  return (
    <div className={`${shell.page} ${s.page}`}>
      <PageHeading title="Calendar" description="The public calendar page at /events: banner, logo, name, bio and links." />

      <section className={s.preview} aria-label="Public page preview">
        <span className={s.previewLabel}>Preview</span>
        <div className={s.previewFrame}>
          <CalendarHeader profile={profile} headingLevel={2} stats={counts ? <span className={s.previewStats}>{calendarStats(counts.subscribers, counts.events)}</span> : undefined} aside={<span className={s.fakeButton} aria-hidden="true">Subscribe</span>} />
        </div>
      </section>

      <div className={s.content}>
        <section className={s.section} aria-labelledby={`${ids}-images`}>
          <h2 id={`${ids}-images`} className={s.title}>
            Images
          </h2>
          <div className={s.slots}>
            {(["cover", "logo"] as const).map((kind) => (
              <ImageSlot
                key={kind}
                kind={kind}
                url={images[kind]}
                fallbackUrl={kind === "cover" ? model.defaultCoverUrl : undefined}
                upload={upload}
                remove={remove}
                prepare={prepare}
                onChange={(url) => setImages((prev) => ({ ...prev, [kind]: url }))}
              />
            ))}
          </div>
        </section>

        <form ref={formRef} action={action} onSubmit={onSubmit} className={s.form} noValidate aria-busy={pending || undefined}>
          <CsrfField />
          <section className={s.section} aria-labelledby={`${ids}-details`}>
            <h2 id={`${ids}-details`} className={s.title}>
              Details
            </h2>
            <TextField label="Name" maxLength={CALENDAR_NAME_MAX + 20} hint={`${values.name.trim().length}/${CALENDAR_NAME_MAX}`} {...field("name")} />
            <TextField label="Tagline" placeholder="Identity, fraud and founders" maxLength={CALENDAR_TAGLINE_MAX + 20} hint={`Shown above the name · ${values.tagline.trim().length}/${CALENDAR_TAGLINE_MAX}`} {...field("tagline")} />
            <Textarea
              label="Bio"
              className={s.bio}
              maxLength={CALENDAR_BIO_MAX + 100}
              hint={<span className={s.counter} data-over={bioLeft < 0 ? "" : undefined}>{bioLeft >= 0 ? `${bioLeft} characters left` : `${-bioLeft} over the limit`}</span>}
              {...field("description")}
            />
          </section>
          <section className={s.section} aria-labelledby={`${ids}-links`}>
            <h2 id={`${ids}-links`} className={s.title}>
              Links
            </h2>
            <p className={s.note}>Optional. Shown under the bio; https links only.</p>
            <div className={s.linksGrid}>
              <TextField label="Website" placeholder="https://didit.me" type="url" inputMode="url" {...field("websiteUrl")} />
              <TextField label="X" placeholder="https://x.com/didit" type="url" inputMode="url" {...field("xUrl")} />
              <TextField label="LinkedIn" placeholder="https://www.linkedin.com/company/didit" type="url" inputMode="url" {...field("linkedinUrl")} />
            </div>
          </section>
          <div className={s.saveRow}>
            <Button type="submit" loading={pending} disabled={pending}>
              {pending ? "Saving…" : "Save calendar"}
            </Button>
            <span className={s.meta} role="status" aria-live="polite">
              {state.status === "saved" && !pending ? "Saved" : model.updatedAtLabel ? `Last saved ${model.updatedAtLabel}${model.updatedBy ? ` by ${model.updatedBy}` : ""}` : "Showing the built-in Didit header"}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

/** One image slot: current image (or the built-in one), Upload / Replace, Remove with a confirm, inline errors. */
function ImageSlot({ kind, url, fallbackUrl, upload, remove, prepare, onChange }: {
  kind: ImageKind;
  url?: string;
  fallbackUrl?: string;
  upload: CalendarImageAction;
  remove: CalendarImageAction;
  prepare: (file: File, kind: ImageKind) => Promise<Blob>;
  onChange: (url: string | undefined) => void;
}) {
  const router = useAdminRouter();
  const csrf = useCsrf();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const copy = SLOT[kind];
  const shown = url ?? fallbackUrl;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (input.current) input.current.value = "";
    const problem = imageProblem(file);
    if (problem) return setError(problem);
    setError(undefined);
    const local = URL.createObjectURL(file);
    const before = url;
    onChange(local);
    setBusy("upload");
    try {
      const blob = await prepare(file, kind);
      const form = new FormData();
      form.set("csrf", csrf);
      form.set("image", blob, `${kind}.${blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"}`);
      const result = await upload(kind, {}, form);
      if (result.error) {
        setError(result.error);
        onChange(before);
      } else {
        toast({ message: kind === "cover" ? "Cover updated." : "Logo updated.", tone: "success" });
        router.refresh();
      }
    } catch {
      setError("That image didn’t upload. Check your connection and try again.");
      onChange(before);
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async () => {
    setBusy("remove");
    setError(undefined);
    try {
      const form = new FormData();
      form.set("csrf", csrf);
      const result = await remove(kind, {}, form);
      if (result.error) setError(result.error);
      else {
        onChange(undefined);
        toast({ message: kind === "cover" ? "Cover removed. The default banner is back." : "Logo removed. The Didit mark is back.", tone: "success" });
        router.refresh();
      }
    } catch {
      setError("The image wasn’t removed. Try again.");
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <div className={s.slot} data-kind={kind}>
      <span className={s.slotLabel}>{copy.label}</span>
      <div className={s.slotImage} data-busy={busy === "upload" ? "" : undefined} data-empty={shown ? undefined : ""}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={url ? `Current ${kind}` : `Default ${kind}`} className={s.slotImg} />
        ) : (
          <Logo variant="mark" height={44} alt="Didit mark" className={s.slotMark} />
        )}
      </div>
      <span className={s.hint} id={hintId}>
        {copy.hint}
      </span>
      <div className={s.slotButtons}>
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy !== null} loading={busy === "upload"} aria-describedby={hintId}>
          {busy === "upload" ? "Uploading…" : url ? "Replace" : "Upload"}
        </Button>
        {url ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy !== null}>
            Remove
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={s.error}>
          {error}
        </p>
      ) : null}
      <input ref={input} type="file" className={s.file} accept={CALENDAR_IMAGE_TYPES.join(",")} aria-label={copy.aria} tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
      {confirming ? (
        <ConfirmDialog
          open
          title={kind === "cover" ? "Remove the cover?" : "Remove the logo?"}
          description={kind === "cover" ? "The public page goes back to the default banner." : "The public page goes back to the Didit mark."}
          confirmLabel="Remove"
          destructive
          loading={busy === "remove"}
          onConfirm={() => void onRemove()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
