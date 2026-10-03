import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, type Db } from "../db/index.ts";
import { queryable } from "../db/tx.ts";
import { bodyLimit, BODY_LIMITS, PolicyError } from "../http/policy.ts";

/** Resend signs webhooks with Svix: HMAC-SHA256(base64 secret after "whsec_", `${id}.${timestamp}.${body}`). */
export function verifyResendSignature(raw: string, headers: Headers, secret: string, now: Date = new Date()): boolean {
  const id = headers.get("svix-id"), timestamp = headers.get("svix-timestamp"), signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp) || !secret.startsWith("whsec_")) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.slice("whsec_".length), "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
  return signatures.split(" ").some(entry => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const DELIVERY: Record<string, { status: string; rank: number }> = {
  "email.sent": { status: "sent", rank: 1 },
  "email.delivery_delayed": { status: "delivery_delayed", rank: 2 },
  "email.delivered": { status: "delivered", rank: 3 },
  "email.bounced": { status: "bounced", rank: 4 },
  "email.complained": { status: "complained", rank: 4 },
};
const RANK_SQL = "case delivery_status when 'sent' then 1 when 'delivery_delayed' then 2 when 'delivered' then 3 when 'bounced' then 4 when 'complained' then 4 else 0 end";

/**
 * C14-style webhook guard for /api/webhooks/resend: POST, no browser/device credentials, 1 MB JSON, Svix
 * signature within 300 s. Records the delivery receipt on the outbox row whose provider_id is the email id.
 * Receipts never move backwards (a late "delivered" cannot hide a bounce); unknown ids and types are acknowledged.
 */
export async function handleResendWebhook(req: Request, secret: string, options: { db?: Db; now?: Date } = {}): Promise<{ recorded: boolean }> {
  if (req.method !== "POST" || ["cookie", "authorization", "origin", "x-csrf", "x-signature", "x-signature-v2"].some(h => req.headers.has(h))) throw new PolicyError(401, "WebhookCallerRequired");
  const bytes = await bodyLimit(req, BODY_LIMITS.webhook, "application/json");
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new PolicyError(400, "InvalidWebhookEncoding"); }
  if (!verifyResendSignature(raw, req.headers, secret, options.now)) throw new PolicyError(401, "InvalidWebhookSignature");
  let body: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  try { body = JSON.parse(raw) as typeof body; } catch { throw new PolicyError(400, "InvalidWebhookJson"); }
  const delivery = typeof body.type === "string" ? DELIVERY[body.type] : undefined;
  const emailId = body.data?.email_id;
  if (!delivery || typeof emailId !== "string" || !emailId) return { recorded: false };
  const at = typeof body.created_at === "string" && Number.isFinite(Date.parse(body.created_at)) ? new Date(body.created_at) : options.now ?? new Date();
  const rows = await queryable(options.db ?? getDb()).query(`update outbox set delivery_status=$2,delivery_at=$3::timestamptz
    where provider_id=$1 and kind like 'email:%' and ${RANK_SQL} < $4 returning id`, [emailId, delivery.status, at, delivery.rank]);
  return { recorded: rows.length > 0 };
}
