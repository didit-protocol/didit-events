import { handleResendWebhook } from "@didit-events/core/notifications";
import { PolicyError } from "@didit-events/core/http/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resend delivery receipts (Svix-signed). Disabled (404) until RESEND_WEBHOOK_SECRET is configured. */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  try {
    await handleResendWebhook(req, secret);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof PolicyError) return new Response(null, { status: error.status });
    console.error("[webhooks/resend] failed:", error instanceof Error ? error.name : "error");
    return new Response(null, { status: 500 });
  }
}
