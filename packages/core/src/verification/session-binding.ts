import type { verificationOps } from "../db/schema.ts";
import type { Queryable,Tx } from "../db/tx.ts";
import { lockAccount } from "../db/tx.ts";
import type { DiditClient } from "../didit/client.ts";
import type { DiditDecision } from "../didit/types.ts";
import { accountFromVendor,isTombstoned,rows,VerificationIgnored } from "./shared.ts";
import type { RegistryRow } from "./workflow-registry.ts";
export type VerificationOperation = typeof verificationOps.$inferSelect;
export async function resolveVerificationAccount(q: Queryable, sessionId: string): Promise<{ accountId: string; verificationId: string | null; opId: string } | null> {
  if (await isTombstoned(q, sessionId)) return null;
  const ops = await rows<VerificationOperation>(q, "select * from verification_ops where didit_session_id=$1", [sessionId]);
  const [v] = await q.query<{ id: string; account_id: string }>("select id,account_id from verifications where didit_session_id=$1", [sessionId]);
  if (ops.length > 1 || ops[0] && v && (ops[0].accountId !== v.account_id || ops[0].verificationId !== v.id)) throw new VerificationIgnored();
  if (ops[0]) return { accountId: ops[0].accountId, verificationId: ops[0].verificationId, opId: ops[0].id };
  if (v) {
    const [op] = await rows<VerificationOperation>(q, "select * from verification_ops where verification_id=$1", [v.id]);
    return { accountId: v.account_id, verificationId: v.id, opId: op?.id ?? "" };
  }
  return null;
}
export function decisionBelongsToOperation(op: VerificationOperation, decision: DiditDecision, hash: string): boolean {
  const created = Date.parse(decision.created_at);
  if (decision.workflow_id !== op.workflowId || decision.vendor_data !== op.vendorData ||
    !Number.isFinite(created) || created < op.createdAt.getTime() - 300_000 || created > op.expiresAt.getTime()) return false;
  if (op.purpose === "legacy") return accountFromVendor(decision.vendor_data) === op.accountId;
  const meta = decision.metadata;
  return !!meta && typeof meta === "object" && meta.events_op_id === op.id && meta.events_account_id === op.accountId && meta.events_config_hash === hash;
}
/** Legacy vendor strings can only locate a pre-existing local operation, never create an account. */
export async function legacyOperationForHint(tx: Tx, sessionId: string, vendor: unknown, workflowId: unknown) {
  const accountId = accountFromVendor(vendor);
  if (!accountId || typeof workflowId !== "string") return null;
  const ops = await rows<VerificationOperation>(tx, `select * from verification_ops where account_id=$1 and workflow_id=$2 and purpose='legacy'
    and (didit_session_id=$3 or didit_session_id is null and state in ('creating','active'))`, [accountId,workflowId,sessionId]);
  return ops.length === 1 ? ops[0] : null;
}

/** Only an authoritative decision with a pre-existing intent can bind an email-addressed session. */
export async function adoptSessionInTx(tx: Tx, opId: string, decision: DiditDecision, client: Pick<DiditClient,"listSessions"|"getDecision">): Promise<boolean> {
  const [op] = await rows<VerificationOperation>(tx,"select * from verification_ops where id=$1",[opId]);
  if (!op || op.purpose === "legacy") return false;
  if (await isTombstoned(tx,decision.session_id)) return false;
  const [live] = await tx.query("select id from accounts where id=$1 and deleting_at is null and deleted_at is null",[op.accountId]);
  const [workflow] = await rows<RegistryRow>(tx,"select * from didit_workflows where key=$1 and state='ready'",[op.workflowKey]);
  if (!live || !workflow || !decisionBelongsToOperation(op,decision,workflow.configHash)) return false;
  if (op.diditSessionId && op.diditSessionId !== decision.session_id) return false;
  // A hint cannot select the first of multiple provider sessions for the same intent.
  // Provider paging happens before the account lock; recheck all mutable state below.
  const matches=new Set<string>();
  let complete=!!op.diditSessionId;
  for (let pageNumber=0,offset=0;!op.diditSessionId && pageNumber<5;pageNumber++) {
    const page=await client.listSessions({workflow_id:op.workflowId,vendor_data:op.vendorData,limit:100,offset});
    for (const candidate of page.results) {
      if (await isTombstoned(tx,candidate.session_id)) continue;
      const authoritative=candidate.session_id===decision.session_id ? decision : await client.getDecision(candidate.session_id);
      if (decisionBelongsToOperation(op,authoritative,workflow.configHash)) matches.add(authoritative.session_id);
      if (matches.size>1) return false;
    }
    if (!page.next) { complete=true;break; }
    if (!page.results.length) return false;
    offset+=page.results.length;
  }
  if (!complete || !op.diditSessionId && (matches.size!==1 || !matches.has(decision.session_id))) return false;

  await lockAccount(tx,op.accountId);
  const [current] = await rows<VerificationOperation>(tx,"select * from verification_ops where id=$1",[opId]);
  const [currentWorkflow] = await rows<RegistryRow>(tx,"select * from didit_workflows where key=$1 and state='ready'",[current?.workflowKey]);
  const [currentAccount] = await tx.query("select id from accounts where id=$1 and deleting_at is null and deleted_at is null",[op.accountId]);
  if (!current || current.accountId!==op.accountId || current.purpose==="legacy" || !currentAccount ||
    !currentWorkflow || currentWorkflow.configHash!==workflow.configHash || await isTombstoned(tx,decision.session_id) ||
    !decisionBelongsToOperation(current,decision,currentWorkflow.configHash) ||
    current.diditSessionId && current.diditSessionId!==decision.session_id) return false;
  const claimed = await resolveVerificationAccount(tx,decision.session_id);
  if (claimed) return claimed.opId === current.id;

  await tx.query(`insert into verifications(account_id,didit_session_id,workflow_id,vendor_data,created_at,next_fetch_at)
    values($1,$2,$3,$4,$5,clock_timestamp()) on conflict(didit_session_id) do nothing`,[op.accountId,decision.session_id,op.workflowId,op.vendorData,new Date(decision.created_at)]);
  const [v] = await tx.query<{id:string;account_id:string}>("select id,account_id from verifications where didit_session_id=$1",[decision.session_id]);
  if (v?.account_id !== op.accountId) throw new VerificationIgnored();
  await tx.query("update verification_ops set verification_id=$2,didit_session_id=$3,state=case when expires_at>clock_timestamp() then 'active' else 'expired' end where id=$1",[op.id,v.id,decision.session_id]);
  return true;
}
