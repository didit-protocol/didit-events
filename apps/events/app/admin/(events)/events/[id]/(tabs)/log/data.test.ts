import { render } from "../../../../../../../src/testing/react-cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireEventAccess } from "../../../../../../../src/auth/access";
import { adminModel } from "../../../../../../../src/server/b4-views";
import { DEFAULT_FILTERS, filterScans, logChips } from "../../../../../../../src/admin/log/helpers";

// Framework/DB adapters mocked: the role decides the photo (guests.photo), the model is a minimal snapshot.
const role = vi.hoisted(() => ({ current: "operator" as string }));
// A test may add guests and scans to the snapshot.
const extra = vi.hoisted(() => ({ views: [] as unknown[], scans: [] as unknown[] }));
vi.mock("../../../../../../../src/auth/access", () => ({ requireEventAccess: vi.fn(async () => ({ role: role.current })) }));
vi.mock("../../../../../../../src/server/b4-person", () => ({
  personSummary: (_e: string, v: { registration: { id: string } }, _n: Date, access: { photos: boolean }) => ({
    ...(access.photos ? { photoUrl: `/photo/${v.registration.id}` } : {}),
    verified: { verifiedAt: "2026-10-01T10:00:00Z", method: "Selfie liveness", emailVerifiedAt: null, createdAt: null },
  }),
}));
const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 18, m));
const scan = (id: string, m: number, result: string, registrationId: string | null, test = false) => ({ id, createdAt: at(m), result, registrationId, kioskId: "k1", candidates: [{ sessionId: "s", score: 91 }], latencyMs: 900, test });
const guest = (id: string, firstName: string, lastName: string, email: string) => ({ registration: { id, admission: "approved", updatedAt: at(0) }, eligible: true, checkedIn: null, verification: null, account: { firstName, lastName, email } });
vi.mock("../../../../../../../src/server/b4-views", () => ({
  adminStatus: () => "live",
  adminModel: vi.fn(async () => ({
    event: { id: "ev", timezone: "Europe/Madrid", startsAt: at(0) },
    kiosks: [{ id: "k1", name: "Main door", revokedAt: null, lastSeenAt: null }],
    views: [guest("reg-albert", "Albert", "Rosas", "albert@example.com"), ...extra.views],
    scans: [
      scan("t1", 1, "welcomed", "reg-albert", true),
      scan("t2", 2, "welcomed", "reg-albert", true),
      scan("t3", 3, "unknown", null, true),
      scan("t4", 4, "no_face", null, true),
      scan("r1", 5, "welcomed", "reg-albert"),
      scan("r2", 6, "unknown", null),
      ...extra.scans,
    ],
  })),
}));

const { getLogPage, getLogSummary } = await import("./data");

describe("v5 check-in log data", () => {
  beforeEach(() => {
    role.current = "operator";
    extra.views = []; extra.scans = [];
    vi.mocked(adminModel).mockClear(); vi.mocked(requireEventAccess).mockClear();
  });

  it("each scan joins the guest of its own registration; a scan with none, or of one not in the model, stays anonymous", async () => {
    extra.views = [guest("reg-bea", "Bea", "Lopez", "bea@example.com"), guest("reg-carl", "", "", "carl@example.com")];
    extra.scans = [scan("b1", 7, "welcomed", "reg-bea"), scan("c1", 8, "welcome_back", "reg-carl"), scan("g1", 9, "not_on_list", "reg-gone"), scan("a2", 10, "welcome_back", "reg-albert")];
    const page = await getLogPage("ev", DEFAULT_FILTERS);
    if (page.view !== "all") throw new Error("view");
    const row = (id: string) => page.scans.find((s) => s.id === id)!;
    expect(row("b1")).toMatchObject({ registrationId: "reg-bea", guestName: "Bea Lopez", guestEmail: "bea@example.com", person: { timeZone: "Europe/Madrid" } });
    expect(row("c1")).toMatchObject({ registrationId: "reg-carl", guestName: "carl@example.com", guestEmail: "carl@example.com" });
    expect(row("r1")).toMatchObject({ registrationId: "reg-albert", guestName: "Albert Rosas" });
    expect(row("a2")).toMatchObject({ registrationId: "reg-albert", guestName: "Albert Rosas", guestEmail: "albert@example.com" });
    // No registration on the scan (unknown face): no guest, no email, no person.
    expect(row("r2")).toMatchObject({ registrationId: null, guestName: null, doorId: "k1", similarity: 91 });
    expect(row("r2")).not.toHaveProperty("guestEmail");
    expect(row("r2")).not.toHaveProperty("person");
    // A registration the model no longer lists reads the same as none.
    expect(row("g1")).toMatchObject({ registrationId: null, guestName: null });
    expect(row("g1")).not.toHaveProperty("guestEmail");
    expect(row("g1")).not.toHaveProperty("person");
    expect(page.scans).toHaveLength(9);
  });

  it("one render builds the rows once for the summary and the page; each still checks access", async () => {
    await render(async () => {
      const summary = (await getLogSummary("ev", DEFAULT_FILTERS))!;
      const page = await getLogPage("ev", DEFAULT_FILTERS);
      if (page.view !== "all") throw new Error("view");
      expect(summary.total).toBe(page.scans.length);
    });
    expect(adminModel).toHaveBeenCalledTimes(1);
    expect(requireEventAccess).toHaveBeenCalledTimes(2);
    await render(async () => { await getLogPage("ev", DEFAULT_FILTERS); });
    expect(adminModel).toHaveBeenCalledTimes(2);
  });

  it("rows built for a role without guests.photo are never reused for one with it, in the same render", async () => {
    await render(async () => {
      const photoOf = async () => { const page = await getLogPage("ev", DEFAULT_FILTERS); if (page.view !== "all") throw new Error("view"); return page.scans.find((s) => s.id === "r1")?.person?.photoUrl; };
      expect(await photoOf()).toBeUndefined();
      role.current = "host";
      expect(await photoOf()).toBe("/photo/reg-albert");
      role.current = "operator";
      expect(await photoOf()).toBeUndefined();
    });
    expect(adminModel).toHaveBeenCalledTimes(2);
  });

  it("rows carry the registration, person summary and badge; operators get no photo", async () => {
    const page = await getLogPage("ev", DEFAULT_FILTERS);
    if (page.view !== "all") throw new Error("view");
    const albert = page.scans.find((s) => s.id === "r1")!;
    expect(albert).toMatchObject({ registrationId: "reg-albert", guestName: "Albert Rosas", guestEmail: "albert@example.com", person: { timeZone: "Europe/Madrid" } });
    expect(albert.person?.verified).toBeTruthy();
    expect(albert.person?.photoUrl).toBeUndefined();
    expect(page.scans.find((s) => s.id === "r2")).toMatchObject({ registrationId: null, guestName: null });
  });

  it("hosts (guests.photo) get the staff photo route", async () => {
    role.current = "host";
    const page = await getLogPage("ev", DEFAULT_FILTERS);
    if (page.view !== "all") throw new Error("view");
    expect(page.scans.find((s) => s.id === "r1")?.person?.photoUrl).toBe("/photo/reg-albert");
  });

  it("chip counts match the listed rows for every chip, Test mode included", async () => {
    for (const people of [true, false]) {
      const base = { ...DEFAULT_FILTERS, people };
      const summary = (await getLogSummary("ev", base))!;
      const all = await getLogPage("ev", base);
      if (all.view !== "all") throw new Error("view");
      // "All" lists the test scans too (the screenshot: 4 test scans, "All 0").
      expect(summary.total).toBe(all.scans.length);
      expect(summary.test).toBe(people ? 3 : 4);
      for (const chip of logChips("ev", summary, base)) {
        const result = chip.key === "all" ? null : (chip.key as typeof base.result);
        const rows = await getLogPage("ev", { ...base, result });
        if (rows.view !== "all") throw new Error("view");
        expect(`${chip.label}`).toMatch(new RegExp(` ${rows.scans.length}$`));
      }
    }
    const summary = (await getLogSummary("ev", DEFAULT_FILTERS))!;
    expect(logChips("ev", summary, DEFAULT_FILTERS).map((c) => c.label)).toEqual(["All 5", "Welcomed 1", "Welcome back 0", "Unknown face 1", "Not on list 0", "Not verified 0", "Test 3"]);
  });

  it("?scan= finds any scan of the event, regardless of filters", async () => {
    expect((await getLogPage("ev", { ...DEFAULT_FILTERS, result: "welcomed" }, "t3")).scan).toMatchObject({ id: "t3", result: "unknown", test: true, registrationId: null });
    expect((await getLogPage("ev", DEFAULT_FILTERS, "nope")).scan).toBeNull();
    expect((await getLogPage("ev", DEFAULT_FILTERS)).scan).toBeUndefined();
  });

  it("result filters never mix real and Test mode scans", async () => {
    const page = await getLogPage("ev", { ...DEFAULT_FILTERS, result: "welcomed" });
    if (page.view !== "all") throw new Error("view");
    expect(page.scans.map((s) => s.id)).toEqual(["r1"]);
    expect(filterScans(page.scans, { ...DEFAULT_FILTERS, result: "test" })).toEqual([]);
  });
});
