import { PolicyError, webhookAuth } from "@didit-events/core/http/policy";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "WebhookUnavailable" }, { status: 503 });
  try {
    // Authentication includes the durable inbox commit. No decision fetch or evidence work on this path.
    await webhookAuth(request, secret);
    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error instanceof PolicyError ? error.message : "WebhookUnavailable" }, { status: error instanceof PolicyError ? error.status : 503 });
  }
}
