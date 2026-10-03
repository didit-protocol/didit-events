import { afterEach, describe, expect, it, vi } from "vitest";
import { fitStage } from "./useStage";
import { doorApi, fetchContext, postPinExit, postScan, scanUrl, withScan } from "./client";
import { FIXTURE_OUTCOMES, fixtureContext } from "./fixtures";

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const base = doorApi("ai-era");

describe("door API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the JPEG with the CSRF header from the cookie, test mode as ?test=1", async () => {
    vi.stubGlobal("document", { cookie: "__Host-csrf=tok%3D; other=1" });
    const f = vi.fn(async () => res(200, FIXTURE_OUTCOMES.unknown));
    await expect(postScan(base, new Blob(["x"]), false, f)).resolves.toEqual(FIXTURE_OUTCOMES.unknown);
    expect(f).toHaveBeenCalledWith("/api/door/ai-era/scan", expect.objectContaining({ method: "POST", headers: { "content-type": "image/jpeg", "x-csrf": "tok=" } }));
    await postScan(base, new Blob(["x"]), true, f);
    expect(f).toHaveBeenLastCalledWith("/api/door/ai-era/scan?test=1", expect.anything());
  });

  it("names the face: track id and camera-px width ride on the query (multi-face door)", async () => {
    const f = vi.fn(async () => res(200, { ...FIXTURE_OUTCOMES.unknown, outcome: "unknown", trackId: 7 }));
    await postScan(base, new Blob(["x"]), true, f, { trackId: 7, faceWidth: 212.6 });
    expect(f).toHaveBeenLastCalledWith("/api/door/ai-era/scan?test=1&track=7&face=213", expect.anything());
    expect(scanUrl(base, false)).toBe("/api/door/ai-era/scan");
    expect(scanUrl(base, false, { trackId: 3 })).toBe("/api/door/ai-era/scan?track=3");
  });

  it("maps a 401 to the end of the door session, with its reason", async () => {
    await expect(postScan(base, new Blob(["x"]), false, async () => res(401, { error: "DoorSessionExpired" }))).resolves.toEqual({ session: "expired" });
    await expect(postScan(base, new Blob(["x"]), false, async () => res(401, { error: "DoorAccessRevoked" }))).resolves.toEqual({ session: "revoked" });
    await expect(postScan(base, new Blob(["x"]), false, async () => res(401, { error: "DoorSessionEnded" }))).resolves.toEqual({ session: "ended" });
    await expect(fetchContext(base, async () => res(401, { error: "DoorSessionExpired" }))).resolves.toEqual({ ok: false, session: "expired", reason: "service" });
  });

  it("server errors carry the request id; 429 retries soon; network failures are offline", async () => {
    await expect(postScan(base, new Blob(["x"]), false, async () => res(503, { error: "ServiceUnavailable", requestId: "4f2a9c11" }, { "x-request-id": "4f2a9c11" }))).resolves.toEqual({ result: "error", reason: "service", retryInS: 12, requestId: "4f2a9c11", test: false });
    await expect(postScan(base, new Blob(["x"]), true, async () => res(429))).resolves.toEqual({ result: "error", reason: "service", retryInS: 2, test: true });
    vi.stubGlobal("navigator", { onLine: false });
    await expect(postScan(base, new Blob(["x"]), false, async () => Promise.reject(new TypeError("fetch failed")))).resolves.toMatchObject({ result: "error", reason: "network", retryInS: 5 });
    await expect(fetchContext(base, async () => Promise.reject(new TypeError("fetch failed")))).resolves.toEqual({ ok: false, reason: "network" });
    await expect(fetchContext(base, async () => res(500))).resolves.toEqual({ ok: false, reason: "service" });
    await expect(fetchContext(base, async () => res(200, fixtureContext()))).resolves.toMatchObject({ ok: true });
  });

  it("PIN exit maps every refusal to a reason", async () => {
    await expect(postPinExit(base, "2468", async () => res(200, { ok: true }))).resolves.toEqual({ ok: true });
    await expect(postPinExit(base, "1111", async () => res(403, { error: "WrongPin" }))).resolves.toEqual({ ok: false, error: "wrong_pin" });
    await expect(postPinExit(base, "1111", async () => res(429, { error: "PinAttemptsExceeded" }))).resolves.toEqual({ ok: false, error: "locked" });
    await expect(postPinExit(base, "1111", async () => res(409, { error: "PinNotSet" }))).resolves.toEqual({ ok: false, error: "no_pin" });
    await expect(postPinExit(base, "1111", async () => Promise.reject(new TypeError("offline")))).resolves.toEqual({ ok: false, error: "offline" });
  });

  it("withScan prepends the scan, keeps 5, and counts first real welcomes only", () => {
    const at = new Date("2026-10-08T19:43:00+02:00");
    const c = fixtureContext();
    const welcomed = withScan(c, FIXTURE_OUTCOMES.welcomed, at);
    expect(welcomed.arrived).toBe(43);
    expect(welcomed.recentScans).toHaveLength(5);
    expect(welcomed.recentScans[0]).toMatchObject({ name: "Maria García", result: "welcomed", test: false });
    expect(withScan(c, FIXTURE_OUTCOMES.welcomed_test, at)).toMatchObject({ arrived: 42, recentScans: [{ result: "welcomed", test: true }, ...c.recentScans.slice(0, 4)] });
    expect(withScan(c, FIXTURE_OUTCOMES.welcome_back, at).arrived).toBe(42);
    expect(withScan(c, FIXTURE_OUTCOMES.unknown, at).recentScans[0]).toMatchObject({ name: null, result: "unknown" });
    expect(withScan(c, { result: "error", reason: "network", retryInS: 5 }, at)).toBe(c);
  });
});

describe("fitStage", () => {
  it("scales the design stage to the screen and grows the spare axis", () => {
    expect(fitStage(1920, 1080)).toMatchObject({ orientation: "landscape", width: 1920, height: 1080 });
    expect(fitStage(1440, 900)).toMatchObject({ orientation: "landscape", width: 1920, height: 1200 });
    expect(fitStage(1080, 1920)).toMatchObject({ orientation: "portrait", width: 1080, height: 1920 });
    expect(fitStage(768, 1024)).toMatchObject({ orientation: "portrait", width: 1440, height: 1920 });
    expect(fitStage(2560, 1080).style.transform).toBe("scale(1)");
  });
});
