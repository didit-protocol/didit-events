import { contactEmail } from "../contact-email.ts";
import { z } from "zod";
import { registrationChecks } from "../admission/policies.ts";
import { audit,eventBy,registrationBy,requireEventActor } from "../admission/shared.ts";
import type { EmailPreview,EmailTemplateView,EmailTestResult } from "../contracts/event-model.ts";
import { getDb,type Db } from "../db/index.ts";
import { advisoryKey,queryable,withTx,type Queryable } from "../db/tx.ts";
import { CRITICAL_EMAIL_CODES,emailsSchema,emailTestSchema,eventEmailCodeSchema,type EventEmails } from "../domain/event-model.ts";
import { ModelError } from "../domain/model-error.ts";
import type { StaffPrincipal } from "../domain/services.ts";
import { configHash } from "../domain/workflow-plan.ts";
import { emailTemplates,renderEmail,type EmailDataByCode } from "../email/index.ts";
import { emailAssetsUrl,emailFontAssetsUrl } from "../email/media.ts";
import { enqueue,PermanentOutboxError,type OutboxRegistry } from "../outbox.ts";
import { sender,toEmailEvent,type EmailConfig,type EventEmailRow } from "./email.ts";
import { sendResendEmail } from "./resend.ts";
import { previewData } from "./email-preview-data.ts";
export const EMAIL_RENDERER_VERSION="event-model-v2.1";
export const emailPreviewSchema=emailTestSchema.omit({to:true,idempotencyKey:true});
function configured(config:EmailConfig) {if(!config.resend.apiKey || !config.from)throw new ModelError("provider_unavailable","Test emails need RESEND_API_KEY. Set it to send; previews work without it.");}
export function emailTemplateViews(settings:EventEmails,config:EmailConfig):EmailTemplateView[] {
  return eventEmailCodeSchema.options.map(code=>({code,title:emailTemplates[code].name,trigger:emailTemplates[code].trigger,
    enabled:settings.templates[code]?.enabled!==false,canDisable:!CRITICAL_EMAIL_CODES.includes(code),canEdit:true,
    from:sender(emailTemplates[code].from.name,config.from),replyTo:config.replyTo??contactEmail(),override:settings.templates[code]??null}));
}
export class EventEmailsService {
  constructor(readonly config:EmailConfig,readonly db:Db=config.db??getDb()){}
  private async render(q:Queryable,actor:StaffPrincipal,id:string,input:z.infer<typeof emailPreviewSchema>):Promise<EmailPreview> {
    const event=await eventBy(q,id);if(!event)throw new ModelError("not_found");await requireEventActor(q,actor,event.id,"event.emails");
    if(event.editVersion!==input.expectedEventVersion)throw new ModelError("context_changed");
    if(input.override)emailsSchema.parse({version:1,templates:{[input.template]:input.override}});
    let recipient={firstName:"Alex",email:"alex@example.com"};
    let guestChecks:Record<string,unknown>={};
    if(input.preview.kind==="guest") {
      const [guest]=await q.query<{first_name:string|null;email:string}>("select a.first_name,a.email from registrations r join accounts a on a.id=r.account_id where r.id=$1 and r.event_id=$2 and a.deleting_at is null and a.deleted_at is null",[input.preview.registrationId,event.id]);
      if(!guest)throw new ModelError("not_found");recipient={firstName:guest.first_name??"Guest",email:guest.email};
      const checks=await registrationChecks(q,await registrationBy(q,input.preview.registrationId),event,this.config.now?.()??new Date(),true);
      const labels:Record<string,string>={face:"selfie",phone:"phone number",id_document:"ID document",name_from_id:"name from ID",age:"age"};
      guestChecks={renewalNeeded:!checks.canSubmit,renewalChecks:checks.missing.map(m=>labels[m.check]??m.check)};

    }
    const [raw]=await q.query<EventEmailRow & Record<string,unknown>>("select * from events where id=$1",[event.id]);
    const base=this.config.baseUrl.replace(/\/$/,""),inert=`${base}/e/${event.slug}#email-preview`;
    const assets=emailAssetsUrl(base,this.config.assetsUrl),data={...previewData(input.template,toEmailEvent(raw!,base,assets),recipient,base,inert,assets,emailFontAssetsUrl(base,this.config.assetsUrl)),...guestChecks,door:event.door};
    const rendered=renderEmail(input.template,data as unknown as EmailDataByCode[typeof input.template],input.override??event.emails.templates[input.template]);
    return {subject:rendered.subject,html:rendered.html,text:rendered.text,from:sender(rendered.from.name,this.config.from),replyTo:this.config.replyTo??contactEmail(),rendererVersion:EMAIL_RENDERER_VERSION};
  }
  preview(actor:StaffPrincipal,id:string,raw:unknown) {return this.render(queryable(this.db),actor,id,emailPreviewSchema.parse(raw));}
  async test(actor:StaffPrincipal,id:string,raw:unknown):Promise<EmailTestResult> {
    const input=emailTestSchema.parse(raw),hash=configHash({eventId:id,...input}),staffId=actor.accountId??actor.email,key=`email:test:${staffId}:${input.idempotencyKey}`;
    return withTx(async tx=>{
      await requireEventActor(tx,actor,id,"event.emails");
      // Rendering needs no transport; only a send does.
      configured(this.config);
      if(tx.kind==="postgres")await tx.query("select pg_advisory_xact_lock($1::bigint)",[advisoryKey("session",key)]);
      const [prior]=await tx.query<{id:string;payload:Record<string,unknown>}>("select id,payload from outbox where dedupe_key=$1",[key]);
      if(prior){if(prior.payload?.inputHash!==hash)throw new ModelError("idempotency_conflict");return this.statusIn(tx,actor,id,prior.id);}
      const preview=await this.render(tx,actor,id,emailPreviewSchema.parse({template:input.template,preview:input.preview,override:input.override,expectedEventVersion:input.expectedEventVersion}));
      const counterKey=`email-test:${staffId}`;
      const [count]=await tx.query("insert into counters(key,value,expires_at) values($1,1,clock_timestamp()+interval '3600 seconds') on conflict(key) do update set value=case when counters.expires_at<=clock_timestamp() then 1 else counters.value+1 end,expires_at=case when counters.expires_at<=clock_timestamp() then clock_timestamp()+interval '3600 seconds' else counters.expires_at end where counters.expires_at<=clock_timestamp() or counters.value<10 returning key",[counterKey]);
      if(!count){const [window]=await tx.query<{ms:number}>("select greatest(1,ceil(extract(epoch from expires_at-clock_timestamp())*1000))::int ms from counters where key=$1",[counterKey]);throw new ModelError("rate_limited",undefined,undefined,undefined,window?.ms??3600_000);}
      const testId=await enqueue(tx,{kind:"email.test",dedupeKey:key,payload:{eventId:id,staffId,inputHash:hash,to:input.to,template:input.template,snapshot:{...preview,subject:`[Test] ${preview.subject}`}}});
      if(!testId)throw new ModelError("idempotency_conflict");
      await audit(tx,id,actor.email,"email.test",testId,{template:input.template,recipientHash:configHash(input.to.toLowerCase()),recipientDomain:input.to.split("@").at(-1)?.toLowerCase(),outcome:"queued",rendererVersion:preview.rendererVersion,previewKind:input.preview.kind});
      return {testId,status:"queued",errorCode:null};
    },this.db);
  }
  private async statusIn(q:Queryable,actor:StaffPrincipal,eventId:string,id:string):Promise<EmailTestResult> {
    await requireEventActor(q,actor,eventId,"event.emails");const [row]=await q.query<{id:string;status:string;delivery_status:string|null;error:string|null}>("select id,status,delivery_status,error from outbox where id=$1 and kind='email.test' and payload->>'eventId'=$2",[id,eventId]);
    if(!row)throw new ModelError("not_found");
    return {testId:row.id,status:row.status==="failed"||["bounced","complained"].includes(row.delivery_status??"")?"failed":row.delivery_status==="delivered"?"delivered":row.status==="sent"?"sent":"queued",errorCode:row.status==="failed"?row.error:null};
  }
  status(actor:StaffPrincipal,eventId:string,id:string){return this.statusIn(queryable(this.db),actor,eventId,z.uuid().parse(id));}
}
export function registerEmailTestHandler(registry:OutboxRegistry,config:EmailConfig) {
  registry.register("email.test",async(message,{signal})=>{
    configured(config);const payload=message.payload,body=payload?.snapshot as EmailPreview|undefined;
    if(!body || typeof payload?.to!=="string")throw new PermanentOutboxError("invalid_email_test");
    return sendResendEmail(config.resend,{from:body.from,to:[payload.to],reply_to:body.replyTo,subject:body.subject,html:body.html,text:body.text},message.dedupe_key,signal);
  });
}
