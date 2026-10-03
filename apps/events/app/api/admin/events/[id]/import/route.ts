import { IdentityError } from "@didit-events/core/identity";
import { PolicyError } from "@didit-events/core/http/policy";
import { inviteService } from "@didit-events/core";
import { parseCsv } from "@didit-events/core/admission/csv";
import { eventReadModel } from "@didit-events/core/admission/read-model";
import { lockForSeatGrant, withTx } from "@didit-events/core/db/tx";
import { routeEventAccess } from "../../../../../../src/auth/access";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const { actor, event, body } = await routeEventAccess(request, (await params).id, "guests.invite", { contentType: "text/csv" });
  const rows = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(body!));
  const summary = { invited: 0, waitlisted: 0, alreadyRequested: 0 };
  // Validation above is whole-file. Each invitation has its own capacity-checked transaction.
  for (const row of rows) {
   const result = await inviteService.batch(actor, event.id, [row.email], { skipApproval: true });
   summary.invited += result.invited; summary.waitlisted += result.waitlisted; summary.alreadyRequested += result.alreadyRequested;
   const model = await eventReadModel(event.id), view = model!.views.find(v => v.account.email === row.email);
   if (view && !result.alreadyRequested) await withTx(async tx => { await lockForSeatGrant(tx, [view.account.id], event.id); await tx.query("update registrations set application=application || $2::jsonb,updated_at=clock_timestamp() where id=$1", [view.registration.id, JSON.stringify({ fullName: [row.first, row.last].filter(Boolean).join(" "), source: "CSV" })]); });
  }
  return Response.json(summary);
 } catch (e) { return Response.json({ error: (e instanceof PolicyError || e instanceof IdentityError) ? e.message : "ImportFailed" }, { status: (e instanceof PolicyError || e instanceof IdentityError) ? e.status : 400 }); }
}
