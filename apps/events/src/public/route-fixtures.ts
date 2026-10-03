// Test-only route fixtures. Production reads live in the route data adapter.
/**
 * Data access for /e/[slug] (P-01, P-02, G-01). Every read and write of this route goes through here.
 *
 * Today: fixtures. Wiring (F1/B1/B2): `getViewer` → the guest session (C5), `registrationCard` → the domain
 * `displayStatus(event, registration, evidence, now)`, `createRequest` → registrations (C10 grantSeat for open
 * events), `startVerification` → the verification op + Didit session (C4), `subscribe` → calendar subscriptions.
 */
import { framesEnabled } from "@didit-events/ui/frames/guard";
import { CARD_STATES, CALENDAR, findEvent } from "./fixtures";
import { cardWithoutRegistration, eventGate } from "./state";
import type { CardState, PublicEvent, RequestInput, SimpleEventGate, Viewer } from "./types";

export type EventPageData =
  | { template: "feature"; event: PublicEvent; related: PublicEvent[]; viewer: Viewer | null; card: CardState }
  | { template: "simple"; event: PublicEvent; gate: SimpleEventGate; viewer: Viewer | null; card: CardState | null };

export async function getEvent(slug: string): Promise<PublicEvent | null> {
  return findEvent(slug) ?? null;
}

/** The signed-in guest, if any (B2: the `__Host-` guest session). */
export async function getViewer(): Promise<Viewer | null> {
  return null;
}

/**
 * The card for this viewer. `preview` (a P-02 code such as "P-02f") only works where the frame gallery does
 * (dev, test, FRAMES=1), so every card state is reachable on the real route before the backend lands.
 */
async function registrationCard(event: PublicEvent, viewer: Viewer | null, now: Date, preview?: string): Promise<CardState> {
  if (preview && framesEnabled()) {
    const fixture = CARD_STATES.find((c) => c.code === preview);
    if (fixture) return fixture.state;
  }
  return cardWithoutRegistration(event, viewer, now);
}

export async function getEventPage(slug: string, now: Date, preview?: string): Promise<EventPageData | null> {
  const event = await getEvent(slug);
  if (!event) return null;
  if (event.template === "simple") {
    const gate = preview && framesEnabled() && ["open", "closed", "full", "ended"].includes(preview) ? (preview as SimpleEventGate) : eventGate(event, now);
    const card = preview && framesEnabled() ? CARD_STATES.find((c) => c.code === preview)?.state ?? null : null;
    return { template: "simple", event, gate, viewer: await getViewer(), card };
  }
  const viewer = await getViewer();
  const related = event.related.map((s) => CALENDAR.events.find((e) => e.slug === s)).filter((e): e is PublicEvent => Boolean(e));
  return { template: "feature", event, related, viewer, card: await registrationCard(event, viewer, now, preview) };
}

/** G-01 request. "already" when this email already asked for this event. */
export async function createRequest(slug: string, input: RequestInput): Promise<"created" | "already" | "not_found"> {
  if (!findEvent(slug)) return "not_found";
  return input.email === "maria.garcia@gmail.com" && slug === "barcelona-office-opening" ? "already" : "created";
}

/** The Didit hosted-flow URL for the signed-in guest's verification (created or reused, C4). */
export async function startVerification(slug: string): Promise<{ url: string } | { signIn: true }> {
  const viewer = await getViewer();
  if (!viewer) return { signIn: true };
  return { url: `/e/${slug}/done?session=demo-not-finished` };
}

/** Subscribe the signed-in guest to the Didit Events calendar. */
export async function subscribe(): Promise<"subscribed" | "sign_in"> {
  return (await getViewer()) ? "subscribed" : "sign_in";
}
