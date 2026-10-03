vi.mock("../../auth/access", () => { const staff = { principal: "staff", email: "fixture@didit.me", role: "owner" }; return { staffPage: async () => staff, requireEventAccess: async () => staff }; });
vi.mock("../../../app/admin/(events)/events/[id]/data", () => ({ requireEvent: async (id: string) => { if (id !== "ai-era") throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); return { id, slug: id }; } }));
import type { ApplicantQuery } from "./types";
vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/data", async () => {
 const { DESIGN_APPLICANTS, AI_ERA_APPLICANTS, SHARE_LINKS, detailForRow } = await import("./fixtures");
 const { filterApplicants, countApplicants } = await import("./query");
 return {
  listApplicants: async (id: string, q: ApplicantQuery) => id === "ai-era" ? { rows: filterApplicants(DESIGN_APPLICANTS, q), counts: countApplicants(DESIGN_APPLICANTS), event: AI_ERA_APPLICANTS } : null,
  existingEmails: async () => DESIGN_APPLICANTS.map(r => r.email), getShareLinks: async () => SHARE_LINKS,
  getApplicantDetail: async (_id: string, id: string) => { const row = DESIGN_APPLICANTS.find(r => r.id === id); return row ? { row, detail: detailForRow(row), index: 1, total: DESIGN_APPLICANTS.length } : null; },
 };
});
import { Children, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  redirect: vi.fn(),
}));
vi.mock("next/navigation", () => nav);

const ApplicantsPage = (await import("../../../app/admin/(events)/events/[id]/(tabs)/applicants/page")).default;
const ApplicantsLoading = (await import("../../../app/admin/(events)/events/[id]/(tabs)/applicants/loading")).default;
const { LazyInviteModal } = await import("./LazyOverlays");
const { ApplicantsView } = await import("./ApplicantsView");
const ApplicantsError = (await import("../../../app/admin/(events)/events/[id]/(tabs)/applicants/error")).default;

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
/** Full render (Suspense resolved). Overlays portal after mount, so the branches below read the element tree. */
async function html(el: ReactElement): Promise<string> {
  const { prelude } = await prerender(el);
  return decode(await new Response(prelude).text());
}

describe("applicants route files", () => {
  it("loading.tsx: AP-23 toolbar with eight skeleton rows and a busy table", () => {
    const out = decode(renderToStaticMarkup(<ApplicantsLoading />));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-label="Applicants"');
    expect(out.match(/<div role="row" aria-hidden="true"/g)).toHaveLength(8);
  });

  it("error.tsx: A-13c with the request id and a retry that calls reset", () => {
    const reset = vi.fn();
    const el = ApplicantsError({ error: Object.assign(new Error("boom"), { digest: "req-42" }), reset });
    const out = decode(renderToStaticMarkup(el));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Something broke on our side");
    expect(out).toContain("req-42");
    expect(el.props.onRetry).toBe(reset);
  });
});

type El = ReactElement<Record<string, unknown>>;
/** The page's top-level children (it returns a fragment): the list (which hosts the drawer), then the invite modal. */
async function tree(sp: Record<string, string>, id = "ai-era") {
  const el = (await ApplicantsPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) })) as El;
  const kids = Children.toArray(el.props.children as ReactNode) as El[];
  const find = (type: unknown) => kids.find((k) => k.type === type);
  return { el, list: find(ApplicantsView)!, invite: find(LazyInviteModal) };
}
type Seed = { id: string; found: Promise<{ detail: { id: string }; index: number; total: number } | null> };

describe("applicants page branches", () => {
  // v11: the drawer is a client host inside the list (it reads ?applicant= itself), never a Suspense remount.
  it("plain list: the review table hosting the drawer with nothing to stream, no invite modal", async () => {
    const { el, list, invite } = await tree({ tab: "approved", q: "a" });
    expect(await html(el)).toContain('aria-label="Applicants"');
    expect(list.props).toMatchObject({ eventId: "ai-era", query: { tab: "approved", q: "a", signIn: "all", signal: "all" }, drawer: { seed: undefined } });
    expect(Children.toArray(el.props.children as ReactNode)).toHaveLength(2);
    expect(invite).toBeUndefined();
  });

  it.each(["email", "link"] as const)("?invite=%s mounts the invite modal on that tab with the share links", async (tab) => {
    const { invite, list } = await tree({ invite: tab });
    expect((list.props.drawer as { seed?: Seed }).seed).toBeUndefined();
    expect(invite?.props).toMatchObject({ eventId: "ai-era", tab, closeHref: "/admin/events/ai-era/applicants" });
    expect((invite!.props.links as { privateHint: string }).privateHint).toContain("Skips approval");
    expect((invite!.props.existingEmails as string[]).length).toBeGreaterThan(0);
  });

  // v11: a deep link streams that applicant to the host (no skeleton drawer first, no second drawer after).
  it("?applicant=<id> streams that applicant to the drawer host with its place in the list", async () => {
    const { list, invite } = await tree({ applicant: "lea-moreau" });
    expect(invite).toBeUndefined();
    const seed = (list.props.drawer as { seed: Seed }).seed;
    expect(seed.id).toBe("lea-moreau");
    const found = (await seed.found)!;
    expect(found.detail.id).toBe("lea-moreau");
    expect(found.total).toBeGreaterThanOrEqual(found.index);
  });

  it("an unknown ?applicant streams null (the host closes the drawer) instead of failing", async () => {
    const { el, list } = await tree({ applicant: "nobody-here" });
    expect(await (list.props.drawer as { seed: Seed }).seed.found).toBeNull();
    expect(await html(el)).toContain('aria-label="Applicants"');
  });

  it("an unknown event is a 404", async () => {
    await expect(ApplicantsPage({ params: Promise.resolve({ id: "nope" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
