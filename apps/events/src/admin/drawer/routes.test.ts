// The drawer detail routes (v11): staff-only GETs that answer with the page loaders' own results, guarded by the
// same capability before anything is read. The suite-wide checks (every admin route declares a capability and calls a
// guard) live in src/auth/access.test.ts and h1-boundaries.test.tsx; these pin each route's contract.
import { IdentityError } from "@didit-events/core/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ routeEventAccess: vi.fn(), routeGlobalAccess: vi.fn() }));
vi.mock("../../auth/access", () => access);
const applicants = vi.hoisted(() => ({ getApplicantDetail: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/data", () => applicants);
const guests = vi.hoisted(() => ({ getGuestDetail: vi.fn() }));
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/guests/data", () => guests);
const people = vi.hoisted(() => ({ getPerson: vi.fn() }));
vi.mock("../../../app/admin/people/data", () => people);

const applicantRoute = await import("../../../app/api/admin/events/[id]/applicants/[registrationId]/detail/route");
const guestRoute = await import("../../../app/api/admin/events/[id]/guests/[registrationId]/route");
const personRoute = await import("../../../app/api/admin/people/[accountId]/route");

const ACCOUNT = "6d0f8f5e-3c0a-4f8e-9a51-1b2c3d4e5f60";
const get = (path: string) => new Request(`https://events.test${path}`);
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const body = async (r: Response) => (await r.json()) as { ok: boolean; data?: unknown; error?: { code: string } };

beforeEach(() => {
  vi.clearAllMocks();
  access.routeEventAccess.mockResolvedValue({ actor: { role: "staff" }, event: { id: "event-uuid", slug: "ai-era" } });
  access.routeGlobalAccess.mockResolvedValue({ actor: { role: "owner" }, viewer: { kind: "staff" } });
});

describe("GET /api/admin/events/[id]/applicants/[registrationId]/detail", () => {
  it("guards with guests.view, then answers the page loader's result for the same list filters", async () => {
    const found = { detail: { id: "lea" }, row: { id: "lea" }, index: 2, total: 5, prevId: "a", nextId: "b" };
    applicants.getApplicantDetail.mockResolvedValue(found);
    const request = get("/api/admin/events/ai-era/applicants/lea/detail?tab=approved&q=%20ana%20&signin=google&signal=nope&applicant=other&invite=email");
    const response = await applicantRoute.GET(request, params({ id: "ai-era", registrationId: "lea" }));
    expect(access.routeEventAccess).toHaveBeenCalledWith(request, "ai-era", "guests.view");
    expect(access.routeEventAccess.mock.invocationCallOrder[0]!).toBeLessThan(applicants.getApplicantDetail.mock.invocationCallOrder[0]!);
    // Parsed and bounded like the page's own search params; the event comes from the guard, not from the URL.
    expect(applicants.getApplicantDetail).toHaveBeenCalledWith("ai-era", "lea", expect.objectContaining({ tab: "approved", q: "ana", signIn: "google", signal: "all" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await body(response)).toEqual({ ok: true, data: found });
  });

  it("an unknown or malformed applicant is data: null; a refused caller reads nothing", async () => {
    applicants.getApplicantDetail.mockResolvedValue(null);
    expect(await body(await applicantRoute.GET(get("/x"), params({ id: "ai-era", registrationId: "nobody" })))).toEqual({ ok: true, data: null });
    applicants.getApplicantDetail.mockClear();
    expect(await body(await applicantRoute.GET(get("/x"), params({ id: "ai-era", registrationId: "../etc" })))).toEqual({ ok: true, data: null });
    expect(applicants.getApplicantDetail).not.toHaveBeenCalled();

    access.routeEventAccess.mockRejectedValue(new IdentityError("EventForbidden", 403));
    const refused = await applicantRoute.GET(get("/x"), params({ id: "ai-era", registrationId: "lea" }));
    expect(refused.status).toBe(403);
    expect((await body(refused)).ok).toBe(false);
    expect(applicants.getApplicantDetail).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/events/[id]/guests/[registrationId]", () => {
  it("guards with guests.view, then answers the page loader's result; refused callers read nothing", async () => {
    guests.getGuestDetail.mockResolvedValue({ id: "maria" });
    const request = get("/api/admin/events/bcn/guests/maria");
    const response = await guestRoute.GET(request, params({ id: "bcn", registrationId: "maria" }));
    expect(access.routeEventAccess).toHaveBeenCalledWith(request, "bcn", "guests.view");
    expect(guests.getGuestDetail).toHaveBeenCalledWith("ai-era", "maria");
    expect(await body(response)).toEqual({ ok: true, data: { id: "maria" } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    guests.getGuestDetail.mockClear();
    expect(await body(await guestRoute.GET(request, params({ id: "bcn", registrationId: "a b" })))).toEqual({ ok: true, data: null });
    access.routeEventAccess.mockRejectedValue(new IdentityError("Unauthenticated", 401));
    expect((await guestRoute.GET(request, params({ id: "bcn", registrationId: "maria" }))).status).toBe(401);
    expect(guests.getGuestDetail).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/people/[accountId]", () => {
  it("is owner-only (people.view): staff actor required, then the page loader's result", async () => {
    people.getPerson.mockResolvedValue({ id: ACCOUNT });
    const request = get(`/api/admin/people/${ACCOUNT}`);
    const response = await personRoute.GET(request, params({ accountId: ACCOUNT.toUpperCase() }));
    expect(access.routeGlobalAccess).toHaveBeenCalledWith(request, "people.view");
    expect(people.getPerson).toHaveBeenCalledWith(ACCOUNT);
    expect(await body(response)).toEqual({ ok: true, data: { id: ACCOUNT } });

    people.getPerson.mockClear();
    expect(await body(await personRoute.GET(request, params({ accountId: "not-a-uuid" })))).toEqual({ ok: true, data: null });
    // An event member (no global actor) is refused, like on the photo route.
    access.routeGlobalAccess.mockResolvedValue({ actor: null, viewer: { kind: "member" } });
    expect((await personRoute.GET(request, params({ accountId: ACCOUNT }))).status).toBe(403);
    access.routeGlobalAccess.mockRejectedValue(new IdentityError("StaffForbidden", 403));
    expect((await personRoute.GET(request, params({ accountId: ACCOUNT }))).status).toBe(403);
    expect(people.getPerson).not.toHaveBeenCalled();
  });
});
