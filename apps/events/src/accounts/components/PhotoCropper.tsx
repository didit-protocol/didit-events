"use client";

import { useCsrf } from "../../auth/CsrfField";
import { startTransition, useActionState, useId, useRef, useState } from "react";
import { Button } from "@didit-events/ui";
import { accountLinks } from "../links";
import { photoProblem } from "../photo-file";
import { Callout, CtaLink, Spacer, Title } from "./Screen";
import s from "./Screen.module.css";
import a from "./Account.module.css";

export interface PhotoState {
  error?: string;
}
export type PhotoAction = (prev: PhotoState, form: FormData) => Promise<PhotoState>;

const OUT = 512;

/**
 * The interactive part of 05 U-35 (position the photo) and U-36 (upload error). The crop runs in the browser: the
 * circle is drawn to a 512 px JPEG before upload, so only a small image reaches the server action.
 */
export function PhotoCropper({ initialError, previewSrc, action, titleId }: { initialError?: string; previewSrc?: string; action: PhotoAction; titleId: string }) {
  const inputId = useId();
  const zoomId = useId();
  const file = useRef<HTMLInputElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState(previewSrc);
  const [zoom, setZoom] = useState(1.4);
  const [local, setLocal] = useState<string | undefined>(initialError);
  const [state, dispatch, pending] = useActionState(action, {});
  const csrf = useCsrf();
  const error = local ?? state.error;

  const choose = () => file.current?.click();
  const onFile = (f: File | undefined) => {
    if (!f) return;
    const problem = photoProblem(f);
    if (problem) {
      setLocal(problem);
      return;
    }
    setLocal(undefined);
    setSrc(URL.createObjectURL(f));
  };

  const upload = async () => {
    const image = img.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The visible square is the image scaled by `zoom` around its centre (object-fit: cover).
    const side = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, OUT, OUT);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) return;
    const form = new FormData();
    form.set("photo", blob, "photo.jpg");
    form.set("csrf", csrf);
    startTransition(() => dispatch(form));
  };

  const picker = <input ref={file} id={inputId} className={a.fileInput} type="file" accept="image/jpeg,image/png" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Choose a photo" tabIndex={-1} />;

  if (error) {
    return (
      <>
        <Title id={titleId} size={22}>
          That photo didn’t upload
        </Title>
        <Callout tone="danger">{error}</Callout>
        <Spacer />
        {picker}
        <Button size="xl" block onClick={choose}>
          Choose another photo
        </Button>
        <CtaLink href={accountLinks.editProfile()} secondary>
          Cancel
        </CtaLink>
      </>
    );
  }
  // Nothing to position yet (the route opened without a photo): the picker is the screen, not an empty cropper.
  if (!src) {
    return (
      <>
        <Title id={titleId} size={22}>
          Add a profile photo
        </Title>
        <button type="button" className={a.cropPick} onClick={choose}>
          Choose a photo
          <span className={a.cropPickHint}>JPG or PNG, up to 5 MB. Shown to hosts, not used for check-in.</span>
        </button>
        <Spacer />
        {picker}
        <Button size="xl" block onClick={choose}>
          Choose a photo
        </Button>
        <CtaLink href={accountLinks.editProfile()} secondary>
          Cancel
        </CtaLink>
      </>
    );
  }
  return (
    <>
      <Title id={titleId} size={22}>
        Position your photo
      </Title>
      <div className={a.crop}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} src={src} alt="Your photo" className={a.cropImg} style={{ transform: `scale(${zoom})` }} />
        <span className={a.mask} aria-hidden="true" />
      </div>
      <div className={a.zoom}>
        <span aria-hidden="true">−</span>
        <label htmlFor={zoomId} className={s.srOnly}>
          Zoom
        </label>
        <input id={zoomId} className={a.slider} type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <span aria-hidden="true">+</span>
      </div>
      <Spacer />
      {picker}
      <Button size="xl" block loading={pending} onClick={upload}>
        {pending ? "Uploading…" : "Use photo"}
      </Button>
      <Button variant="secondary" size="lg" block className={s.cta2} onClick={choose}>
        Choose another
      </Button>
    </>
  );
}
