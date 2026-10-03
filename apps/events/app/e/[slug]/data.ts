import { cache } from "react";
import { accountStaffRole } from "@didit-events/core/identity/sessions";
import { identity } from "../../../src/auth/runtime";
import { one, read } from "@didit-events/core/admission/shared";
import type { Account } from "@didit-events/core";
import { guestPrincipal } from "../../../src/server/b4-policy";
import { publicModel, publicEvent, cardStatus } from "../../../src/server/b4-views";
import { cardWithoutRegistration, eventGate } from "../../../src/public/state";
import { createRequest as request, registerGate } from "./register/data";
import { Requests, rejoinOf } from "@didit-events/core/admission/requests";
import type { JoinInitial } from "../../../src/accounts/join/machine";
import type { CardState, PublicEvent, RequestInput, SimpleEventGate, Viewer } from "../../../src/public/types";
import { getVerificationRuntime } from "@didit-events/core";
import type { VerificationStart } from "@didit-events/core/verification/index";
import { verificationBrowserMutation } from "../../../src/verification/server";
import { photoSrc } from "../../../src/accounts/photo";
import { hostPhotoVersions,publicHosts,type HostEntry } from "../../../src/server/hosts";
import { pendingDeletion } from "../../../src/accounts/deletion";
export type EventPageData = { template: "feature"; event: PublicEvent; related: PublicEvent[]; viewer: Viewer | null; card: CardState } | { template: "simple"; event: PublicEvent; gate: SimpleEventGate; viewer: Viewer | null; card: CardState | null };
/** One view per read model per request (React cache, keyed by the model): generateMetadata and the page share the host photo read. */
const eventView = cache(async (m:NonNullable<Awaited<ReturnType<typeof publicModel>>>) => {
 const event=publicEvent(m.event,m.approvedCount,m.checkins.filter(c=>!c.undoneAt).length);
 // Hosts that name an account show its profile photo (versioned); the email never reaches the page.
 const hosts=(m.event.speakers ?? []) as HostEntry[];
 event.hosts=publicHosts(m.event.id,hosts,await hostPhotoVersions(hosts));
 if(event.guestList === "names") {const names=m.views.filter(v=>v.registration.admission==="approved").slice(0,3).map(v=>v.account.fullName || [v.account.firstName,v.account.lastName].filter(Boolean).join(" "));event.goingPreview={names,initials:names.map(name=>name.split(/\s+/).map(p=>p[0]).join("").slice(0,2))};}
 return event;
});
/** One read model per request: generateMetadata, the page and the join modal share it instead of reading it again. */
const modelOf = cache((slug: string) => publicModel(slug));
/**
 * The layout's check (same rule as `publicModel`: the event exists and is not a draft). One row, read above the page's
 * loading boundary, so an unknown slug answers HTTP 404 before any HTML is sent.
 */
export const eventExists = cache(async (slug: string) => { const event = await one<{ status: string }>(read(), "select status from events where id::text=$1 or slug=$1", [slug]); return !!event && event.status !== "draft"; });
export async function getEvent(slug: string) { const m = await modelOf(slug); return m ? await eventView(m) : null; }
export async function getViewer(): Promise<Viewer | null> {
 const principal = await guestPrincipal(); if (!principal) return null;
 const account = await one<Account>(read(), "select * from accounts where id=$1 and deleting_at is null and deleted_at is null", [principal.accountId]);
 return account ? { staffRole: await accountStaffRole(read(), account.id), firstName: account.firstName ?? "", lastName: account.lastName ?? "", email: account.email, ...(account.company ? { company: account.company } : {}), ...(account.jobRole ? { role: account.jobRole } : {}), ...(account.photoUrl ? { photoUrl: photoSrc(account.photoUrl, account.updatedAt) } : {}) } : null;
}
export async function getEventPage(slug: string, now: Date, _preview?: string): Promise<EventPageData | null> {
 const m = await modelOf(slug); if (!m) return null;
 // Independent reads run together: the event view (host photos), who is asking, and their header account.
 const [event, principal, viewer] = await Promise.all([eventView(m), guestPrincipal(), getViewer()]);
 const view = m.views.find(v => v.account.id === principal?.accountId);
 // v5: the card offers "Request again" (or says why not) by the same rule as the join modal. Simple events never read `related`.
 const [again, related] = await Promise.all([
  view ? rejoinOf(read(), view.registration, m.event, now, !!view.checkedIn) : undefined,
  event.template === "simple" ? [] : Promise.all(event.related.map(getEvent)).then(list => list.filter((e): e is PublicEvent => e !== null)),
 ]);
 // Simple events: a signed-in guest with a live request sees its status; a withdrawn request can ask again (createRequest allows it).
 if (event.template === "simple") return { template: "simple", event, gate: eventGate(event, now), viewer, card: view && view.registration.admission !== "cancelled_by_guest" ? cardStatus(view, m.event) : null };
 return { template: "feature", event, related, viewer, card: view ? cardStatus(view, m.event, again) : cardWithoutRegistration(event, viewer, now) };
}
export async function createRequest(slug: string, input: RequestInput,requestInput?:unknown): Promise<"created" | "already" | "not_found"> {
 const result = await request(slug, { email: input.email, fullName: [input.firstName, input.lastName].filter(Boolean).join(" "), company: input.company, role: input.role },new Date(),requestInput);
 return result.kind === "gated" ? "not_found" : result.kind;
}

/** The Didit hosted-flow URL for the signed-in guest's verification (created or reused, C4). */
export async function startVerification(slug: string, form?: FormData): Promise<VerificationStart | { signIn: true }> {
  const auth = await verificationBrowserMutation(form);
  if (!auth) return { signIn: true };
  return getVerificationRuntime().startForRegistration(auth.principal, slug);
}

/** Subscribe the signed-in guest to the Didit Events calendar. */
export async function subscribe(): Promise<"subscribed" | "sign_in"> {
  const principal = await guestPrincipal();
  if (!principal) return "sign_in";
  await identity.profile.preference(principal, true);
  return "subscribed";
}

/** Flow v3: what the join modal starts from — signed out (and whether requests are open), or the request context. */
export async function getJoinInitial(slug: string, now: Date): Promise<JoinInitial> {
  const principal = await guestPrincipal();
  if (!principal) {
    // v5: this browser's account is in its deletion grace period: "Keep my account" first, then the flow continues.
    const deleting = await pendingDeletion();
    if (deleting) return { kind: "deleting", graceUntil: deleting.graceUntil };
    return { kind: "signed_out", requestsOpen: (await registerGate(slug, now)).kind === "open" };
  }
  const model = await modelOf(slug);
  if (!model) return { kind: "signed_out", requestsOpen: false };
  try {
    return { kind: "signed_in", ctx: await new Requests().getRequestContext(principal, model.event.id) };
  } catch {
    return { kind: "unavailable", reason: "account" };
  }
}
