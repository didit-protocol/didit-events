import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS, DESIGN_COUNTS, detailForRow } from "./fixtures";
import { parseApplicantQuery } from "./query";

vi.mock("../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions", () => ({ decideAction: vi.fn(), undoRejectAction: vi.fn(), reopenRequestsAction: vi.fn(), saveNoteAction: vi.fn() }));
const { ApplicantsView } = await import("./ApplicantsView");

// Plan §1: guests sign in with the Didit email code (no magic links) or Google via Didit.
describe("applicants sign-in method copy", () => {
  const email = DESIGN_APPLICANTS.find((r) => r.signIn === "email")!;
  const google = DESIGN_APPLICANTS.find((r) => r.signIn === "google")!;

  it("the list and the Sign-in filter say Email code, never Email link", () => {
    const html = renderToStaticMarkup(<ApplicantsView eventId="ai-era" query={parseApplicantQuery({})} counts={DESIGN_COUNTS} rows={[email, google]} event={AI_ERA_APPLICANTS} />);
    expect(html).toContain("Email code");
    expect(html).toContain("Google");
    expect(html).not.toMatch(/email link|magic link/i);
  });

  it("the drawer's Account section says Email code for email guests and Google for OIDC", () => {
    const row = (r: typeof email) => detailForRow(r).sections.find((s) => s.title === "Account")!.rows.find((x) => x.k === "Sign-in method")!.v;
    expect(row(email)).toBe("Email code");
    expect(row(google)).toBe(`Google · ${google.email}`);
  });
});
