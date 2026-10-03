// Data access for the email previews: fixtures only (the outbox dispatcher, lane B5, renders real sends with
// renderEmail + the event row). Swapping the preview source is a change to this file alone.
import { EMAIL_CODES, emailTemplates, renderEmail, type EmailCode, type RenderedEmail } from "@didit-events/core/email";
import { emailFixtures } from "@didit-events/core/email/fixtures";

export interface EmailPreviewData extends RenderedEmail {
  code: EmailCode;
  name: string;
  trigger: string;
}

export const PREVIEW_CODES: readonly EmailCode[] = EMAIL_CODES;

/** Name and trigger only: no rendering, so the frame registry can list every email without building one. */
export function getEmailMeta(code: EmailCode): Pick<EmailPreviewData, "code" | "name" | "trigger"> {
  const t = emailTemplates[code];
  return { code, name: t.name, trigger: t.trigger };
}

export function getEmailPreview(code: EmailCode): EmailPreviewData {
  const t = emailTemplates[code];
  return { code, name: t.name, trigger: t.trigger, ...renderEmail(code, emailFixtures[code] as never) };
}
