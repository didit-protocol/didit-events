import { contactEmail } from "../contact-email.ts";
import { randomUUID } from "node:crypto";
import { eventCoverUrl } from "../content/event-assets.ts";
import { renderSafeMarkdown } from "../content/markdown.ts";
import type { EventEditorView } from "../contracts/event-model.ts";
import { getDb,type Db } from "../db/index.ts";
import { queryable,type Queryable } from "../db/tx.ts";
import { eventCreateSchema,eventWriteSchema,type EventWrite } from "../domain/event-model.ts";
import { ModelError } from "../domain/model-error.ts";
import type { DomainEvent,StaffPrincipal } from "../domain/services.ts";
import { emailTemplateViews } from "../notifications/event-emails.ts";
import { DEFAULT_EMAIL_FROM } from "../notifications/resend.ts";
import { Events } from "./events.ts";
import { eventBy,requireEventActor } from "./shared.ts";
export async function providerCapabilities(q:Queryable):Promise<EventEditorView["capabilities"]> {
  const rows=await q.query<{feature_key:string}>("select feature_key from didit_workflows where state='ready' and verified_at>clock_timestamp()-interval '7 days'");
  const has=(feature:string)=>rows.some(r=>r.feature_key.split("+").includes(feature));
  const phone=has("PHONE_VERIFICATION"),document=has("OCR")&&has("FACE_MATCH"),age=has("AGE_ESTIMATION")||document;
  return {phone,document,age,reason:phone&&document&&age?null:"Some provider capabilities have not been verified for this workspace"};
}
export function editorValues(event:DomainEvent):Omit<EventWrite,"expectedVersion"> {
  return {name:event.name,description:event.description,descriptionMd:event.descriptionMd,startsAt:event.startsAt.toISOString(),endsAt:event.endsAt.toISOString(),timezone:event.timezone,
    venue:event.venue,address:event.address,placeId:event.placeId,lat:event.lat,lng:event.lng,mapsUrl:event.mapsUrl,capacity:event.capacity,checks:event.checks,door:event.door,form:event.form,emails:event.emails,cover:event.cover,speakers:event.speakers as EventWrite["speakers"]};
}
export function editorEmailTemplates(emails:DomainEvent["emails"]) {
  return emailTemplateViews(emails,{baseUrl:process.env.APP_URL??"http://localhost:3000",from:process.env.EMAIL_FROM??DEFAULT_EMAIL_FROM,replyTo:contactEmail(),resend:{apiKey:process.env.RESEND_API_KEY??""}});
}
export class EventEditor {
  constructor(readonly db:Db=getDb()){}
  async view(actor:StaffPrincipal,id:string):Promise<EventEditorView> {
    const q=queryable(this.db);const event=await eventBy(q,id);if(!event)throw new ModelError("not_found");await requireEventActor(q,actor,event.id,"event.edit");
    const counts=await q.query<{policy_version:number;n:number}>("select policy_version,count(*)::int n from registrations where event_id=$1 group by policy_version",[event.id]);
    const [invites]=await q.query<{n:number}>("select count(*)::int n from invites where event_id=$1 and revoked_at is null and expires_at>clock_timestamp() and uses<max_uses",[event.id]);
    const capabilities=await providerCapabilities(q),reasons:string[]=[];
    if(!event.venue?.trim() || !event.address?.trim())reasons.push("Add the venue and address");
    if(event.startsAt<=new Date())reasons.push("Choose a future start time");
    if(event.checks.required.includes("phone")&&!capabilities.phone || event.checks.required.some(c=>c==="id_document"||c==="name_from_id")&&!capabilities.document || event.checks.age_min!==undefined&&!capabilities.age)reasons.push(capabilities.reason!);
    const editable=["draft","published","live"].includes(event.status);
    return {eventId:event.id,editVersion:event.editVersion,policyVersion:event.policyVersion,formVersion:event.formVersion,status:event.status,values:editorValues(event),coverUrl:eventCoverUrl(event.id,event.cover),descriptionHtml:renderSafeMarkdown(event.descriptionMd),capabilities,
      acceptedPolicyCounts:counts.map(c=>({policyVersion:c.policy_version,registrations:c.n})),actions:{save:editable,publish:event.status==="draft"&&!reasons.length,unpublish:event.status==="published"&&event.startsAt>new Date()&&!counts.length&&!invites?.n,cancel:editable,end:event.status==="published"||event.status==="live",publishBlockedReasons:reasons},
      emails:editorEmailTemplates(event.emails)};
  }
  async create(actor:StaffPrincipal,raw:unknown) {
    const input=eventCreateSchema.parse(raw),slug=`${input.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,100)||"event"}-${randomUUID().slice(0,8)}`;
    const e=await new Events(this.db).create(actor,{...input,slug,startsAt:new Date(input.startsAt),endsAt:new Date(input.endsAt)});return this.view(actor,e.id);
  }
  async save(actor:StaffPrincipal,id:string,raw:unknown) {
    const input=eventWriteSchema.parse(raw);await new Events(this.db).update(actor,id,{...input,startsAt:new Date(input.startsAt),endsAt:new Date(input.endsAt)});return this.view(actor,id);
  }
  async lifecycle(actor:StaffPrincipal,id:string,action:"publish"|"unpublish"|"end"|"cancel",version:number,reason?:string) {
    const events=new Events(this.db);
    if(action==="publish")await events.publish(actor,id,version);
    else if(action==="unpublish")await events.unpublish(actor,id,version);
    else if(action==="end")await events.end(actor,id,version);
    else await events.cancel(actor,id,reason??"",version);
    return this.view(actor,id);
  }
}
