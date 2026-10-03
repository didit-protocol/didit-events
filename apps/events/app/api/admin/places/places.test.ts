import { accountSession } from "@didit-events/core/testing/account-session";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdentityServices } from "@didit-events/core/identity";
import { testDatabase, resetDatabase } from "@didit-events/core/testing/database";
import { queryable } from "@didit-events/core/db/tx";
import { setPlacesTransport, type PlacesTransport } from "../../../../src/server/places";
import { GET as autocomplete } from "./autocomplete/route";
import { GET as details } from "./details/route";

const state = vi.hoisted(() => ({ identity: undefined as ReturnType<typeof createIdentityServices> | undefined }));
vi.mock("../../../../src/auth/runtime", () => ({ get identity() { return state.identity!; } }));

const secret = "places-proxy-fixture-secret-over-32-characters", origin = "https://events.didit.me";
const KEY = "test-maps-key-never-in-responses";
const SESSION = "0f5c2d6e-7a1b-4c3d-9e8f-001122334455";
const PLACE = "ChIJ5TCOcRaYpBIRCmZHTz37sEQ";
const GOOGLE_DETAILS = {
  id: PLACE,
  displayName: { text: "Didit HQ", languageCode: "en" },
  formattedAddress: "Carrer de Pallars, 99, Sant Martí, 08018 Barcelona, Spain",
  addressComponents: [
    { longText: "99", shortText: "99", types: ["street_number"] },
    { longText: "Carrer de Pallars", shortText: "Carrer de Pallars", types: ["route"] },
    { longText: "Barcelona", shortText: "Barcelona", types: ["locality", "political"] },
    { longText: "08018", shortText: "08018", types: ["postal_code"] },
    { longText: "Spain", shortText: "ES", types: ["country", "political"] },
  ],
  location: { latitude: 41.4036, longitude: 2.1916 },
  googleMapsUri: "https://maps.google.com/?cid=4949212542133135882",
};

describe("Places proxy (/api/admin/places/*)", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let cookie = "";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let reply: PlacesTransport = async () => Response.json({});
  let previous: PlacesTransport;

  beforeAll(async () => {
    database = await testDatabase(process.env.TEST_DATABASE_URL ? "postgres" : "pglite");
    (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb = database.db;
    previous = setPlacesTransport((url, init) => { calls.push({ url, init }); return reply(url, init); });
  }, 60_000);
  beforeEach(async () => {
    await resetDatabase(database.db);
    calls.length = 0;
    vi.stubEnv("APP_URL", origin); vi.stubEnv("SESSION_SECRET", secret); vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    state.identity = createIdentityServices({ db: database.db, secret, appUrl: origin });
    await queryable(database.db).query("insert into staff(email,role) values('staff@didit.me','staff')");
    cookie = (await accountSession(state.identity, database.db, "staff@didit.me")).cookie;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    setPlacesTransport(previous);
    delete (globalThis as typeof globalThis & { __diditEventsDb?: typeof database.db }).__diditEventsDb;
    await database?.close();
  });

  const req = (path: string, headers: Record<string, string> = {}) => new Request(`${origin}${path}`, { headers: { cookie: `__Host-sid=${cookie}`, "sec-fetch-site": "same-origin", ...headers } });
  const search = (q: string, session = SESSION, headers?: Record<string, string>) => autocomplete(req(`/api/admin/places/autocomplete?q=${encodeURIComponent(q)}&session=${session}`, headers));

  it.each([undefined, "1", "524289"])("caps both Places response streams with length %j and returns a safe 502", async length => {
    const cancel = vi.fn();
    reply = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64 * 1024)); }, cancel }),
      { headers: length ? { "content-length": length } : {} });
    for (const res of [await search("Didit HQ"), await details(req(`/api/admin/places/details?id=${PLACE}&session=${SESSION}`))]) {
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "PlacesUnavailable" });
    }
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("autocomplete: calls Places API (New) with the server key and session token, returns only main/secondary text", async () => {
    reply = async () => Response.json({ suggestions: [
      { placePrediction: { placeId: PLACE, text: { text: "Didit HQ, Carrer de Pallars, Barcelona, Spain" }, structuredFormat: { mainText: { text: "Didit HQ" }, secondaryText: { text: "Carrer de Pallars, Barcelona, Spain" } } } },
      { placePrediction: { placeId: "bad id!", text: { text: "x" } } },
      { queryPrediction: { text: { text: "didit near me" } } },
    ] });
    const res = await search("Didit HQ");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ suggestions: [{ placeId: PLACE, main: "Didit HQ", secondary: "Carrer de Pallars, Barcelona, Spain" }] });
    expect(body).not.toContain(KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe(KEY);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ input: "Didit HQ", sessionToken: SESSION });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    // The key header must never follow a redirect to another host.
    expect(calls[0]!.init.redirect).toBe("error");
  });

  it("details: field mask, same session token, mapped to the form's parts", async () => {
    reply = async () => Response.json(GOOGLE_DETAILS);
    const res = await details(req(`/api/admin/places/details?id=${PLACE}&session=${SESSION}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ place: { placeId: PLACE, name: "Didit HQ", formattedAddress: GOOGLE_DETAILS.formattedAddress, street: "Carrer de Pallars 99", city: "Barcelona", postalCode: "08018", country: "Spain", lat: 41.4036, lng: 2.1916, mapsUrl: GOOGLE_DETAILS.googleMapsUri } });
    expect(calls[0]!.url).toBe(`https://places.googleapis.com/v1/places/${PLACE}?sessionToken=${SESSION}&languageCode=en`);
    expect((calls[0]!.init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("id,displayName,formattedAddress,addressComponents,location,googleMapsUri");
    expect(calls[0]!.init.redirect).toBe("error");
  });

  it("no key configured: 404 PlacesDisabled and no network call", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const res = await search("Didit HQ");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "PlacesDisabled" });
    expect(calls).toHaveLength(0);
  });

  it("staff only, same-origin only; bad input is refused before Google is called", async () => {
    cookie = "";
    expect([401, 403]).toContain((await search("Didit HQ")).status);
    const [guest] = await queryable(database.db).query<{ id: string }>("insert into accounts(email) values('guest@example.test') returning id");
    cookie = (await state.identity!.sessions.rotate({ principal: "guest", accountId: guest!.id, authenticatedAt: new Date(), authMethod: "email_otp" })).cookie;
    expect((await search("Didit HQ")).status).toBe(403);
    cookie = (await accountSession(state.identity!, database.db, "staff@didit.me")).cookie;
    expect((await search("Didit HQ", SESSION, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await search("Didit HQ", "short")).status).toBe(400);
    expect(await (await search("Di")).json()).toEqual({ suggestions: [] });
    expect((await details(req(`/api/admin/places/details?id=${encodeURIComponent("../../v1/x")}&session=${SESSION}`))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("upstream errors and timeouts map to 502 / 504 (the form falls back to manual fields)", async () => {
    reply = async () => new Response("quota", { status: 429 });
    expect((await search("Didit HQ")).status).toBe(502);
    reply = async () => { throw new DOMException("The operation timed out.", "TimeoutError"); };
    const res = await search("Didit HQ");
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "PlacesTimeout" });
    reply = async () => Response.json({ ...GOOGLE_DETAILS, location: undefined });
    expect((await details(req(`/api/admin/places/details?id=${PLACE}&session=${SESSION}`))).status).toBe(502);
  });

  it("rate-limits each staff member (120 a minute)", async () => {
    reply = async () => Response.json({ suggestions: [] });
    for (let i = 0; i < 120; i++) expect((await search("Didit HQ")).status).toBe(200);
    const limited = await search("Didit HQ");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(calls).toHaveLength(120);
  });
});
