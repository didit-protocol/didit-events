import type { RequestContext } from "@didit-events/core/contracts/event-model";
import type { Account } from "@didit-events/core";
import { Requests } from "@didit-events/core/admission/requests";
import { one,read } from "@didit-events/core/admission/shared";
import { submitRequestSchema } from "@didit-events/core/domain/event-model";
import { type GuestAccount,type RegisterInput,type RequirementRow } from "../../../../src/accounts/types";
import type { PublicEvent } from "../../../../src/public/types";
import { guestPrincipal } from "../../../../src/server/b4-policy";
import { guestAccount,publicEvent,publicModel } from "../../../../src/server/b4-views";
export type RegisterPage = {view:"request";event:PublicEvent;context:RequestContext} | {view:"sign_in";slug:string} | {view:"registered";slug:string} | {view:"unavailable";slug:string;gate:RegisterGate};
export type RegisterGate = "full" | "closed" | "ended" | "invite_only";
export async function registerGate(slug: string, now: Date): Promise<{ kind: "open"; event: PublicEvent } | { kind: "not_found" } | { kind: "gated"; event: PublicEvent; gate: RegisterGate }> {
 const model = await publicModel(slug); if (!model) return { kind: "not_found" };
 const e = model.event, event = publicEvent(e, model.approvedCount);
 if (["ended", "cancelled"].includes(e.status)) return { kind: "gated", event, gate: "ended" };
 if (e.form.mode === "invite_only") return { kind: "gated", event, gate: "invite_only" };
 if (now >= e.startsAt || e.form.closes_at && now >= new Date(e.form.closes_at!)) return { kind: "gated", event, gate: "closed" };
 return { kind: "open", event };
}
export function requirementRows(account: GuestAccount, ageRequired: boolean): RequirementRow[] {
 const met = account.verification.state === "verified";
 const rows: RequirementRow[] = [{ kind: "name", label: "Full name", detail: met ? "Verified" : "Not verified", met }, { kind: "email", label: "Email", detail: met ? "Verified" : "Not verified", met }, { kind: "selfie", label: "Selfie · liveness", detail: met ? "Verified" : "Not verified", met }];
 if (ageRequired) rows.push({ kind: "age", label: "Age 18+", detail: "Required for this event", met: false }); return rows;
}
export async function getRegisterPage(slug: string, now: Date, _previewCode?: string): Promise<RegisterPage | null> {
 const gate = await registerGate(slug, now); if (gate.kind === "not_found") return null;
 const principal = await guestPrincipal(), model = (await publicModel(slug))!, view = principal && model.views.find(v => v.account.id === principal.accountId);
 if (view && view.registration.admission !== "cancelled_by_guest") return { view: "registered", slug };
 if (gate.kind === "gated") return { view: "unavailable", slug, gate: gate.gate };
 if (!principal) return { view: "sign_in", slug };
 const stored = view ? null : await one<Account>(read(), "select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [principal.accountId]);
 const account: GuestAccount | null = view ? guestAccount(view) : stored ? { id: stored.id, email: stored.email, firstName: stored.firstName ?? "", lastName: stored.lastName ?? "", links: [], verification: { state: "none" }, marketingOptIn: false, eventsAttended: 0 } : null;
 if (!account || account.id !== principal.accountId) return { view: "sign_in", slug };
 const requestContext=await new Requests().getRequestContext(principal,model.event.id);
 return {view:"request",event:gate.event,context:requestContext};
}
export type RequestResult = { kind: "created"; replyBy: string } | { kind: "already"; requestedAt: string } | { kind: "not_found" } | { kind: "gated"; gate: RegisterGate };
export async function createRequest(slug: string, input: Pick<RegisterInput, "email" | "fullName" | "company" | "role"> & { why?: string }, now = new Date(),requestInput?:unknown): Promise<RequestResult> {
 const principal = await guestPrincipal(); if (!principal) throw new Error("SignInRequired");
 const gate = await registerGate(slug, now); if (gate.kind === "not_found") return gate; if (gate.kind === "gated") return { kind: "gated", gate: gate.gate };
 const model = (await publicModel(slug))!, existing = model.views.find(v => v.account.id === principal.accountId);
 if (existing && existing.registration.admission !== "cancelled_by_guest") return { kind: "already", requestedAt: existing.registration.appliedAt.toISOString() };
 await new Requests().submitRequest(principal,model.event.id,submitRequestSchema.parse(requestInput));
 return { kind: "created", replyBy: model.event.startsAt.toISOString() };
}
export async function joinWaitlist(slug: string,input?:unknown) { const principal = await guestPrincipal(); if (!principal) throw new Error("SignInRequired"); const model = await publicModel(slug); if (!model) throw new Error("EventNotFound"); await new Requests().submitRequest(principal,model.event.id,submitRequestSchema.parse(input)); }
export async function requestAsGuest(slug: string, profile?: { fullName: string; company: string; role: string; why: string }, now = new Date(),requestInput?:unknown): Promise<RequestResult | { kind: "sign_in" }> {
 const principal = await guestPrincipal(); if (!principal) return { kind: "sign_in" };
 return createRequest(slug, { email: "", fullName: profile?.fullName ?? "", company: profile?.company ?? "", role: profile?.role ?? "", why: profile?.why ?? "" }, now,requestInput);
}

export async function getRequestContext(slug:string){const actor=await guestPrincipal();if(!actor)throw new Error("SignInRequired");const model=await publicModel(slug);if(!model)return null;return new Requests().getRequestContext(actor,model.event.id);}
export async function submitRequest(slug:string,input:unknown){const actor=await guestPrincipal();if(!actor)throw new Error("SignInRequired");const model=await publicModel(slug);if(!model)throw new Error("EventNotFound");return new Requests().submitRequest(actor,model.event.id,input);}
