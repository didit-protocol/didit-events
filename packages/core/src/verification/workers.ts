import { queryable,withTx } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import { inboxHandlers,type InboxHandler,type InboxRegistry } from "../inbox.ts";
import { jobHandlers,scheduleJob,type JobRegistry } from "../jobs.ts";
import { outboxHandlers,type OutboxRegistry } from "../outbox.ts";
import { ModelVerification } from "./model-verification.ts";
import { retainVerificationData } from "./reconcile.ts";
import { adoptSessionInTx,legacyOperationForHint,resolveVerificationAccount } from "./session-binding.ts";
import { isTombstoned,uuidPattern,VerificationIgnored } from "./shared.ts";
import type { VerificationLifecycle } from "./verification-service.ts";

export function registerVerificationHandlers(service: VerificationLifecycle, registries: { inbox?: InboxRegistry; outbox?: OutboxRegistry; jobs?: JobRegistry } = {}) {
  const inbox = registries.inbox ?? inboxHandlers, outbox = registries.outbox ?? outboxHandlers, jobs = registries.jobs ?? jobHandlers;
  const model = new ModelVerification({...service.options,client:service.options.client as DiditClient});
  const handler: InboxHandler = async (message, tx) => {
    const body = JSON.parse(message.raw!) as Record<string, unknown>;
    const sessionId = body.session_id;
    if (typeof sessionId !== "string" || !uuidPattern.test(sessionId) || await isTombstoned(tx,sessionId)) return;
    let mapping = await resolveVerificationAccount(tx,sessionId);
    const legacy = !mapping ? await legacyOperationForHint(tx, sessionId, body.vendor_data, body.workflow_id) : null;
    if (!mapping && !legacy) {
      const intents=await tx.query("select id from verification_ops where vendor_data=$1 and workflow_id=$2 and purpose<>'legacy' and didit_session_id is null",[typeof body.vendor_data==='string'?body.vendor_data:'',typeof body.workflow_id==='string'&&uuidPattern.test(body.workflow_id)?body.workflow_id:null]);
      if(!intents.length)return;
      const decision = await service.options.client.getDecision(sessionId);
      const opId = decision.metadata?.events_op_id;
      if (typeof opId === "string" && uuidPattern.test(opId)) {
        const [intent] = await tx.query("select id from verification_ops where id=$1", [opId]);
        if (!intent) return;
        if (!await adoptSessionInTx(tx,opId,decision,service.options.client)) throw new Error("VerificationMappingPending");
        mapping = await resolveVerificationAccount(tx,sessionId);
      }
    }
    const accountId = mapping?.accountId ?? legacy?.accountId;
    if (!accountId) return;
    try { await service.evidence.applyDecision(tx, accountId, sessionId); }
    catch (error) { if (!(error instanceof VerificationIgnored)) throw error; }
  };
  for (const kind of ["status.updated", "data.updated"]) inbox.register(kind, handler);
  for (const kind of ["verify_invite", "verification.request"]) outbox.register(kind, async (message, { signal }) => {
    signal.throwIfAborted();
    try { await service.requestRegistration(String(message.payload?.registrationId ?? "")); }
    catch (error) { if (!(error instanceof VerificationIgnored)) throw error; }
  });
  outbox.register("verification.create", async (message, { signal }) => {
    signal.throwIfAborted();
    try {
      const id = String(message.payload?.opId ?? "");
      const [op] = await queryable(service.options.db).query("select purpose from verification_ops where id=$1",[id]);
      if (op?.purpose === "legacy") await service.createOrAdopt(id);
      else { const result = await model.launch(id); if (result.state === "creating" || result.state === "blocked") throw new Error("VerificationNotReady"); }
    }
    catch (error) { if (!(error instanceof VerificationIgnored)) throw error; }
  });
  outbox.register("verification.attach", async (message, { signal }) => {
    signal.throwIfAborted();
    try { await service.attach(String(message.payload?.opId ?? ""), String(message.payload?.registrationId ?? "")); }
    catch (error) { if (!(error instanceof VerificationIgnored)) throw error; }
  });
  outbox.register("verification.refresh", async (message, { signal }) => {
    signal.throwIfAborted();
    try {
      await withTx(tx => service.evidence.applyDecision(tx, String(message.payload?.accountId ?? ""), String(message.payload?.sessionId ?? "")), service.options.db);
    } catch (error) { if (!(error instanceof VerificationIgnored)) throw error; }
  });
  jobs.register("b1.reconcile", async () => { await service.reconcile(); });
  jobs.register("b1.retention", () => retainVerificationData(service));
  return { inbox, outbox, jobs };
}
export async function scheduleVerificationJobs(service: VerificationLifecycle) {
  await scheduleJob("b1.reconcile", 60, {}, service.options.db);
  await scheduleJob("b1.retention", 3600, {}, service.options.db);
}
