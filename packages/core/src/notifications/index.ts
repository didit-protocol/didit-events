import { contactEmail, DEFAULT_CONTACT_EMAIL } from "../contact-email.ts";
import { getDb,type Db } from "../db/index.ts";
import type { Tx } from "../db/tx.ts";
import type { NotificationService } from "../domain/services.ts";
import { EMAIL_CODES,type EmailCode } from "../email/index.ts";
import { isPublicHttpsOrigin } from "../email/media.ts";
import { jobHandlers,type JobRegistry } from "../jobs.ts";
import { enqueue,outboxHandlers,PermanentOutboxError,type OutboxRegistry } from "../outbox.ts";
import { emailHandler,isDiditSent,registerEmailHandlers,type EmailConfig } from "./email.ts";
import { registerEmailTestHandler } from "./event-emails.ts";
import { clearSentPayloads,registerLifecycleJobs,scheduleDoorsReminders,scheduleThanks,scheduleTomorrowReminders,scheduleVerificationNudges } from "./lifecycle.ts";
import { registerRegistrationEmails } from "./registration.ts";
import { DEFAULT_EMAIL_FROM,RESEND_API_URL } from "./resend.ts";

export * from "./calendar-invite.ts";
export * from "./email.ts";
export * from "./host-requests.ts";
export * from "./lifecycle.ts";
export * from "./profile-reminder.ts";
export * from "./resend.ts";
export * from "./webhook.ts";

/** Reads APP_URL, RESEND_API_KEY and optional EMAIL_FROM / EMAIL_ASSETS_URL / RESEND_API_URL (a local fake in e2e). */
export function emailConfigFromEnv(env: Record<string, string | undefined> = process.env, db?: Db): EmailConfig {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required to send email");
  return emailPreviewConfigFromEnv(env, db);
}

/** The same config without requiring RESEND_API_KEY: enough to render a preview, and the test send reports the missing key itself. */
export function emailPreviewConfigFromEnv(env: Record<string, string | undefined> = process.env, db?: Db): EmailConfig {
  const baseUrl = env.APP_URL, apiKey = env.RESEND_API_KEY ?? "";
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error("APP_URL must be an absolute URL");
  const assetsUrl = env.EMAIL_ASSETS_URL?.trim();
  if (assetsUrl !== undefined && !isPublicHttpsOrigin(assetsUrl)) throw new Error("EMAIL_ASSETS_URL must be a public https origin");
  if (env.EMAIL_FROM !== undefined && !env.EMAIL_FROM.trim()) throw new Error("EMAIL_FROM must not be empty");
  return { baseUrl, ...(assetsUrl ? { assetsUrl } : {}), from: env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM, replyTo: contactEmail(env.CONTACT_EMAIL ?? DEFAULT_CONTACT_EMAIL), resend: { apiKey, apiUrl: env.RESEND_API_URL || RESEND_API_URL }, db };
}

/** Wires every B5 outbox handler and lifecycle job. Call once per worker process, then run runOutbox/runJobs. */
export function registerNotifications(config: EmailConfig, registries: { outbox?: OutboxRegistry; jobs?: JobRegistry; now?: () => Date } = {}): void {
  registerEmailHandlers(registries.outbox ?? outboxHandlers, config);
  registerEmailTestHandler(registries.outbox ?? outboxHandlers, config);
  registerRegistrationEmails(registries.outbox ?? outboxHandlers, config);
  registerLifecycleJobs(registries.jobs ?? jobHandlers, { db: config.db, now: registries.now });
}

export function createNotificationService(config: EmailConfig): NotificationService {
  const send = emailHandler(config);
  return {
    async enqueue(tx: Tx, input) { await enqueue(tx, input); },
    async deliver(input) {
      const result = await send({ id: "", kind: input.kind, dedupe_key: input.dedupeKey, payload: input.payload, attempts: 0 }, { signal: new AbortController().signal });
      if (!result?.providerId) throw new PermanentOutboxError("no_provider_id");
      return { providerId: result.providerId };
    },
    async scheduleReminders(now: Date) {
      const db = config.db ?? getDb();
      const counts = await Promise.all([scheduleVerificationNudges(now, db), scheduleTomorrowReminders(now, db), scheduleDoorsReminders(now, db), scheduleThanks(now, db)]);
      await clearSentPayloads(now, db);
      return counts.reduce((a, b) => a + b, 0);
    },
  };
}
export const SENDABLE_EMAIL_CODES: readonly EmailCode[] = EMAIL_CODES.filter(code => !isDiditSent(code));
