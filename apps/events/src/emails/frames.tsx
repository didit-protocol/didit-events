// /_frames registrations for the emails: M-01…M-29 (design/04, /05, design-prompt v2; M-25/M-26 host notices, M-27 event team invite, v4; M-28 welcome, M-29 profile reminder, v6) and E-01…E-03 (design/02).
// Each frame shows the email as the design does (sender, subject, preheader over the 600px email) plus the 390
// mobile rendering. E-* frames label both widths (the design has a frame for each); M-* label the 600 one.
// Frames are lazy: importing the registry renders nothing, and each email is built inside its frame's render(), so
// a template that throws shows an error tile for that frame only.
import type { EmailCode } from "@didit-events/core/email";
import { Banner, EmailPreview } from "@didit-events/ui";
import type { FrameDef } from "@didit-events/ui/frames";
import { getEmailMeta, getEmailPreview, PREVIEW_CODES, type EmailPreviewData } from "./data";

/**
 * The design's email frames (design/04 and /05 `width:680px;padding:24px 40px 40px`, design/02 `outer` 680 / 390)
 * set a width but no height: their height is the content's, known only once a browser lays them out. The gallery
 * frame is 680 wide and reserves a fixed 1400px (not a measured value); the per-email rendered heights come from the
 * pixel gate's design capture (`pnpm pixel:design`, browser gate), which screenshots the labelled element and so
 * does not depend on this number.
 */
export const EMAIL_FRAME_VIEWPORT = { w: 680, h: 1400 } as const;

function EmailFrame({ code, e }: { code: EmailCode; e: EmailPreviewData }) {
  const guest = code.startsWith("E-");
  const common = { from: e.from, subject: e.subject, preheader: e.preheader, html: e.html };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 48, alignItems: "flex-start" }}>
      <EmailPreview {...common} label={guest ? `${code} ${e.name} · desktop 600` : `${code} ${e.name}`} trigger={guest ? undefined : e.trigger} size="desktop" />
      <EmailPreview {...common} label={guest ? `${code} ${e.name} · mobile 390` : undefined} size="mobile" />
    </div>
  );
}

/** Shown in place of an email whose template throws; no screen label, so the pixel gate reports the frame missing. */
function EmailFrameError({ code, error }: { code: EmailCode; error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div data-frame-error={code} style={{ padding: 24 }}>
      <Banner tone="danger">
        {code} failed to render: {message}
      </Banner>
    </div>
  );
}

/** One email's frame. `load` is the preview source (injectable for tests); it runs only when the frame renders. */
export function emailFrame(code: EmailCode, load: (code: EmailCode) => EmailPreviewData = getEmailPreview): FrameDef {
  return {
    code,
    name: getEmailMeta(code).name,
    app: "events",
    viewport: EMAIL_FRAME_VIEWPORT,
    background: "var(--canvas)",
    render: () => {
      let e: EmailPreviewData;
      try {
        e = load(code);
      } catch (error) {
        return <EmailFrameError code={code} error={error} />;
      }
      return <EmailFrame code={code} e={e} />;
    },
  };
}

export const emailFrames: FrameDef[] = PREVIEW_CODES.map((code) => emailFrame(code));
