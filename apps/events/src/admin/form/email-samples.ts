/**
 * The default template rendered with the email fixtures: for the /_frames gallery and tests only. Real routes
 * never import this module (scripts/no-route-fixtures.test.mjs); they preview through lane A's route.
 */
import type { EmailPreview, EventEmailCode } from "../model/contract";
import { STUB_SENDER } from "./emails";

export async function samplePreview(code: EventEmailCode): Promise<EmailPreview> {
  const [{ renderEmail }, { emailFixtures }] = await Promise.all([import("@didit-events/core/email"), import("@didit-events/core/email/fixtures")]);
  const r = renderEmail(code, emailFixtures[code] as never);
  return { subject: r.subject, html: r.html, text: r.text, from: `${r.from.name} <${r.from.address}>`, replyTo: STUB_SENDER.replyTo, rendererVersion: "sample" };
}
