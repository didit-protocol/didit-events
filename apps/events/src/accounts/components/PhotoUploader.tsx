"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAdminRouter as useRouter } from "../../admin/useAdminRouter";
import { Avatar, Button } from "@didit-events/ui";
import { useCsrf } from "../../auth/CsrfField";
import { photoProblem, PHOTO_TYPES } from "../photo-file";
import s from "./Screen.module.css";
import a from "./Account.module.css";

export interface PhotoUploadState {
  error?: string;
  saved?: boolean;
  removed?: boolean;
}
export type PhotoUploadAction = (prev: PhotoUploadState, form: FormData) => Promise<PhotoUploadState>;

const OUT = 512;

/**
 * Centre-crops any JPG/PNG to the 512 px square JPEG the server stores (the identity service accepts only that),
 * on a white background so transparent PNGs do not turn black.
 */
export async function cropToJpeg(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, OUT, OUT);
    // Step the quality down until it fits the 300 KB server limit (a 512 px photo is ~40–120 KB at 0.88).
    for (const q of [0.88, 0.8, 0.7, 0.6]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= 300 * 1024) return blob;
    }
    throw new Error("too large");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PhotoUploaderProps {
  name: string;
  email: string;
  /** The stored photo (versioned /api/me/photo URL), if any. */
  photoUrl?: string;
  upload: PhotoUploadAction;
  remove: PhotoUploadAction;
  /** Turns the chosen file into the uploaded JPEG (tests replace the canvas step). */
  prepare?: (file: File) => Promise<Blob>;
}

/**
 * 05 U-34 PHOTO: the current photo (or the initial) as a 96 px circle (72 px on phones), Upload photo / Change and Remove, the
 * type/size hint, an instant preview of the chosen file, a busy state while it uploads and an inline error.
 * Success refreshes the server components, so the header avatar and Settings show the new photo at once.
 */
export function PhotoUploader({ name, email, photoUrl, upload, remove, prepare = cropToJpeg }: PhotoUploaderProps) {
  const router = useRouter();
  const csrf = useCsrf();
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const [preview, setPreview] = useState<string>();
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // The refreshed server props caught up: drop the local preview / removal override (state adjusted during render).
  const [seenUrl, setSeenUrl] = useState(photoUrl);
  if (photoUrl !== seenUrl) {
    setSeenUrl(photoUrl);
    setRemoved(false);
    setPreview(undefined);
  }
  // Free each object URL once it is no longer shown.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const shown = preview ?? (removed ? undefined : photoUrl);
  const choose = () => input.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (input.current) input.current.value = "";
    setNotice(undefined);
    const problem = photoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    const local = URL.createObjectURL(file);
    setPreview(local);
    setBusy("upload");
    try {
      const jpeg = await prepare(file);
      const form = new FormData();
      form.set("photo", jpeg, "photo.jpg");
      form.set("csrf", csrf);
      const result = await upload({}, form);
      if (result.error) {
        setError(result.error);
        setPreview(undefined);
        URL.revokeObjectURL(local);
      } else {
        setRemoved(false);
        setNotice("Photo updated.");
        router.refresh();
      }
    } catch {
      setError("That photo didn’t upload. Check your connection and try again.");
      setPreview(undefined);
      URL.revokeObjectURL(local);
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async () => {
    setError(undefined);
    setNotice(undefined);
    setBusy("remove");
    try {
      const form = new FormData();
      form.set("csrf", csrf);
      const result = await remove({}, form);
      if (result.error) setError(result.error);
      else {
        setRemoved(true);
        setPreview(undefined);
        setNotice("Photo removed.");
        router.refresh();
      }
    } catch {
      setError("The photo wasn’t removed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={s.group} aria-labelledby="grp-photo">
      <h2 id="grp-photo" className={s.groupTitle} style={{ margin: 0 }}>
        PHOTO
      </h2>
      <div className={`${s.box} ${a.photoBox}`}>
        <div className={a.photoRow}>
          <span className={a.photoAvatar} data-busy={busy === "upload" ? "" : undefined}>
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="Your profile photo" width={96} height={96} className={a.photoAvatarImg} />
            ) : (
              <Avatar name={name} email={email} size={96} tone="brand" />
            )}
            {busy === "upload" ? <span className={a.photoSpinner} aria-hidden="true" /> : null}
            <button type="button" className={a.photoBadge} onClick={choose} disabled={busy !== null} aria-label={shown ? "Change photo" : "Upload photo"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </button>
          </span>
          <div className={a.photoMeta}>
            <span className={s.rowLabel}>Profile photo</span>
            <span className={s.rowDetail} id={hintId}>
              JPG or PNG, up to 5 MB. Shown to hosts, not used for check-in.
            </span>
            <div className={a.photoButtons}>
              <Button size="sm" variant="secondary" className={a.tapButton} onClick={choose} disabled={busy !== null} loading={busy === "upload"} aria-describedby={hintId}>
                {busy === "upload" ? "Uploading…" : shown ? "Change" : "Upload photo"}
              </Button>
              {shown && !preview ? (
                <Button size="sm" variant="ghost" className={a.tapButton} onClick={onRemove} disabled={busy !== null} loading={busy === "remove"}>
                  {busy === "remove" ? "Removing…" : "Remove"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {error ? (
          <p role="alert" className={a.photoError}>
            {error}
          </p>
        ) : notice ? (
          <p role="status" className={a.photoOk}>
            {notice}
          </p>
        ) : null}
        <input
          ref={input}
          id={inputId}
          className={a.fileInput}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          onChange={(e) => void onFile(e.target.files?.[0])}
          aria-label="Choose a profile photo"
          tabIndex={-1}
        />
      </div>
    </section>
  );
}
