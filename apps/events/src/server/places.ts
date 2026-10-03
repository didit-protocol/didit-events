/**
 * Google Places API (New) behind staff-only proxy routes: the key (GOOGLE_MAPS_API_KEY) never reaches the browser.
 * One session token per typing session groups the autocomplete calls with the final details call for billing.
 * Tests swap the transport (`setPlacesTransport`) so no request leaves the machine.
 */
import { responseJson } from "@didit-events/core/http/response-json";

export type PlacesTransport = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 5000;
const DETAILS_FIELDS = "id,displayName,formattedAddress,addressComponents,location,googleMapsUri";
let transport: PlacesTransport = (url, init) => fetch(url, init);

/** Tests only: route every Places call through a fake. Returns the previous transport. */
export function setPlacesTransport(next: PlacesTransport): PlacesTransport {
  const prev = transport;
  transport = next;
  return prev;
}

export class PlacesError extends Error {
  constructor(readonly status: number, code: string) { super(code); this.name = "PlacesError"; }
}

export const placesKey = () => process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
export const placesEnabled = () => Boolean(placesKey());

export const SESSION_TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
export const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

export interface PlaceSuggestion { placeId: string; main: string; secondary: string }
export interface PlaceDetails {
  placeId: string;
  name: string;
  formattedAddress: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  lat: number;
  lng: number;
  mapsUrl: string;
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  const key = placesKey();
  if (!key) throw new PlacesError(404, "PlacesDisabled");
  let res: Response;
  try {
    res = await transport(url, { ...init, headers: { ...(init.headers as Record<string, string>), "X-Goog-Api-Key": key }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store", redirect: "error" });
  } catch {
    throw new PlacesError(504, "PlacesTimeout");
  }
  if (!res.ok) throw new PlacesError(502, "PlacesUnavailable");
  try { return await responseJson(res); } catch { throw new PlacesError(502, "PlacesUnavailable"); }
}

const text = (v: unknown): string => (v && typeof v === "object" && "text" in v && typeof v.text === "string" ? v.text : "");

export async function autocomplete(input: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  const body = (await call("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, sessionToken, languageCode: "en" }),
  })) as { suggestions?: Array<{ placePrediction?: { placeId?: unknown; text?: unknown; structuredFormat?: { mainText?: unknown; secondaryText?: unknown } } }> };
  return (body.suggestions ?? []).flatMap((s): PlaceSuggestion[] => {
    const p = s.placePrediction;
    if (!p || typeof p.placeId !== "string" || !PLACE_ID.test(p.placeId)) return [];
    const main = text(p.structuredFormat?.mainText) || text(p.text);
    return main ? [{ placeId: p.placeId, main: main.slice(0, 200), secondary: text(p.structuredFormat?.secondaryText).slice(0, 200) }] : [];
  }).slice(0, 8);
}

type Component = { longText?: string; shortText?: string; types?: string[] };

export async function details(placeId: string, sessionToken: string): Promise<PlaceDetails> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}&languageCode=en`;
  const body = (await call(url, { method: "GET", headers: { "X-Goog-FieldMask": DETAILS_FIELDS } })) as {
    id?: string; displayName?: unknown; formattedAddress?: string; addressComponents?: Component[]; location?: { latitude?: number; longitude?: number }; googleMapsUri?: string;
  };
  const parts = body.addressComponents ?? [];
  const find = (...types: string[]) => parts.find((c) => types.some((t) => c.types?.includes(t)))?.longText ?? "";
  const route = find("route"), number = find("street_number");
  const formatted = (body.formattedAddress ?? "").slice(0, 300);
  // When Google's first comma segment already holds route + number ("1 Market St") keep its order; else join them.
  const first = formatted.split(",")[0]?.trim() ?? "";
  const street = route && first.includes(route) && (!number || first.includes(number)) ? first : [route, number].filter(Boolean).join(" ");
  const lat = body.location?.latitude, lng = body.location?.longitude;
  const mapsUrl = typeof body.googleMapsUri === "string" && body.googleMapsUri.startsWith("https://") ? body.googleMapsUri : "";
  if (typeof lat !== "number" || typeof lng !== "number" || !formatted || !mapsUrl) throw new PlacesError(502, "PlacesIncomplete");
  return {
    placeId: typeof body.id === "string" && PLACE_ID.test(body.id) ? body.id : placeId,
    name: (text(body.displayName) || first).slice(0, 120),
    formattedAddress: formatted,
    street: street.slice(0, 160),
    city: find("locality", "postal_town", "administrative_area_level_2").slice(0, 80),
    postalCode: find("postal_code").slice(0, 12),
    country: find("country").slice(0, 80),
    lat,
    lng,
    mapsUrl: mapsUrl.slice(0, 500),
  };
}
