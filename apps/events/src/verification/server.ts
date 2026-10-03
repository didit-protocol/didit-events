import { guardBrowser } from "../auth/browser";
import { headers } from "next/headers";
import { COOKIE_NAMES, PolicyError, sessionService, type DomainEvent, type GuestPrincipal } from "@didit-events/core";
import type { PublicEvent } from "../public/types";

function sessionCookie(h: Headers): string | null {
  const values = (h.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAMES.session}=`));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0]!.slice(COOKIE_NAMES.session.length + 1)); } catch { return null; }
}
export async function signedInGuest(): Promise<GuestPrincipal | null> {
  const cookie = sessionCookie(new Headers(await headers()));
  if (!cookie) return null;
  const session = await sessionService.resolve(cookie);
  if (!session || session.principal !== "guest" || !session.accountId) return null;
  return { principal: "guest", accountId: session.accountId, sessionId: session.id, authenticatedAt: session.authenticatedAt };
}
/** Native form actions carry a separate submitted CSRF value; never synthesize proof from the cookie. */
export async function verificationBrowserMutation(form?: FormData) {
  const h = new Headers(await headers());
  if (!sessionCookie(h)) return null;
  const origin = process.env.APP_URL && new URL(process.env.APP_URL).origin;
  if (!origin) throw new Error("ApplicationOriginNotConfigured");
  const submitted = form?.get("csrf");
  if (!h.has("x-csrf") && typeof submitted === "string") h.set("x-csrf", submitted);
  // Request generates the multipart boundary. Next's transport headers describe the already-parsed action.
  h.delete("content-type"); h.delete("content-length");
  const req = new Request(`${origin}/verification-action`, { method: "POST", headers: h, body: form ?? new FormData() });
  const authorized = await guardBrowser(req);
  const session = await sessionService.resolve(authorized.sessionCookie);
  if (!session || session.principal !== "guest" || !session.accountId) throw new PolicyError(401, "GuestAuthenticationRequired");
  return { cookie: authorized.sessionCookie, principal: { principal: "guest" as const, accountId: session.accountId, sessionId: session.id, authenticatedAt: session.authenticatedAt } };
}

/** B1's DB-backed link/return views use the shared U4 shape; B4 owns the wider event snapshot. */
export function verificationEvent(event: DomainEvent): PublicEvent {
  return { slug: event.slug, template: "simple", title: event.name, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
    timeZone: event.timezone, venue: { name: event.venue ?? "", address: event.address ?? "", shortAddress: event.address ?? "", city: "", mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address ?? event.venue ?? "")}` },
    lifecycle: event.status === "draft" ? "published" : event.status, registration: event.registrationMode, registrationClosesAt: event.registrationClosesAt?.toISOString(),
    capacity: event.capacity, going: 0, summary: event.description, about: event.description ? [event.description] : [], agenda: [], panels: [], hosts: [],
    goingPreview: { initials: [], names: [] }, guestList: "hidden", cover: { theme: "sky" }, related: [] };
}
