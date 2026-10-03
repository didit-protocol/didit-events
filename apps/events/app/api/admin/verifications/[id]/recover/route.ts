import { PolicyError,uuidPattern } from "@didit-events/core";
import { modelServices } from "@didit-events/core/verification/model-runtime";
import { routeGlobalAccess } from "../../../../../../src/auth/access";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Owner/admin only; core re-checks the staff row.
    const { actor, body } = await routeGlobalAccess(request, "verifications.recover", { contentType: "application/json" });
    if (!actor) throw new PolicyError(403, "Forbidden");
    const auth = { body: body! };
    const { id } = await params;
    const input: unknown = JSON.parse(new TextDecoder().decode(auth.body));
    if (!uuidPattern.test(id) || !input || typeof input !== "object" || !("reason" in input) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw new PolicyError(400, "RecoveryReasonRequired");
    const result = await modelServices().verification.recoverFace(actor, id, input.reason);
    return Response.json({ verificationId: result.verification.id, changed: result.changed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PolicyError ? error.message : "RecoveryUnavailable" }, { status: error instanceof PolicyError ? error.status : 403 });
  }
}
