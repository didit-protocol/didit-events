vi.mock("../server/b4-policy", () => ({ guardAction: async () => {} }));
const session = vi.hoisted(() => ({ viewer: { firstName: "Ana", lastName: "Pérez", email: "ana@example.com" } as { firstName: string; lastName: string; email: string } | null, requests: [] as { email: string }[] }));
vi.mock("../../app/e/[slug]/data", () => ({ getViewer: async () => session.viewer, createRequest: async (slug: string, input: { email: string }) => { session.requests.push(input); return slug === "nope" ? "not_found" : input.email === "maria.garcia@gmail.com" ? "already" : "created"; } }));
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anonymousCsrf, anonymousHeaders, testOrigin, testSecret } from "../auth/testing-browser";
import { RequestForm } from "./components/RequestForm";
import { errorSummary, readRequest, validateRequest } from "./request";
import type { RequestFormState } from "./types";

vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT;${url}`); }), notFound: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => anonymousHeaders() }));
beforeEach(() => { vi.stubEnv("APP_URL", testOrigin); vi.stubEnv("SESSION_SECRET", testSecret); });
afterEach(() => vi.unstubAllEnvs());
const { requestAction } = await import("../../app/e/[slug]/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  f.set("csrf", anonymousCsrf);
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const valid = { slug: "barcelona-office-opening", firstName: "Ana", lastName: "Pérez", email: "Ana@Example.com ", company: "Globex", role: "" };
const idle: RequestFormState = { status: "idle" };
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("G-01 request validation", () => {
  it("trims and lower-cases the email", () => {
    expect(readRequest(form(valid)).email).toBe("ana@example.com");
  });

  it("flags the design's two fields", () => {
    expect(validateRequest({ firstName: "Maria", lastName: "", email: "maria.garcia@gmail", company: "Globex", role: "Head of Risk" })).toEqual({
      lastName: "Enter your last name",
      email: "Enter a valid email address",
    });
    expect(errorSummary(2)).toBe("Check the 2 highlighted fields.");
    expect(errorSummary(1)).toBe("Check the 1 highlighted field.");
  });

  it("role is optional; names, company and email are required", () => {
    expect(Object.keys(validateRequest({ firstName: "", lastName: "", email: "", company: "", role: "" })).sort()).toEqual(["company", "email", "firstName", "lastName"]);
  });
});

describe("requestAction", () => {
  const ana = { firstName: "Ana", lastName: "Pérez", email: "ana@example.com" };
  beforeEach(() => { session.viewer = ana; session.requests = []; });

  it("returns field errors with the values kept (signed out: the posted email is validated)", async () => {
    session.viewer = null;
    const r = await requestAction(idle, form({ ...valid, lastName: " ", email: "nope" }));
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") {
      expect(r.errors).toEqual({ lastName: "Enter your last name", email: "Enter a valid email address" });
      expect(r.values.firstName).toBe("Ana");
    }
  });

  it("submits, and reports an existing request", async () => {
    // Model v2 routes legacy forms to explicit checks and consent before submission.
    await expect(requestAction(idle, form(valid))).rejects.toThrow("NEXT_REDIRECT;/e/barcelona-office-opening/register");
    session.viewer = { ...ana, email: "maria.garcia@gmail.com" };
    await expect(requestAction(idle, form(valid))).rejects.toThrow("NEXT_REDIRECT;/e/barcelona-office-opening/register");
    expect(session.requests).toEqual([]);
  });

  it("signed in: the email comes from the session, a posted email is ignored", async () => {
    await expect(requestAction(idle, form({ ...valid, email: "attacker@evil.com" }))).rejects.toThrow("NEXT_REDIRECT;/e/barcelona-office-opening/register");
    const withoutEmail = form(valid);
    withoutEmail.delete("email");
    await expect(requestAction(idle, withoutEmail)).rejects.toThrow("NEXT_REDIRECT;/e/barcelona-office-opening/register");
    expect(session.requests).toEqual([]);
  });

  it("signed out: a valid request goes to sign-in and creates nothing", async () => {
    session.viewer = null;
    await expect(requestAction(idle, form(valid))).rejects.toThrow("NEXT_REDIRECT;/login?next=%2Fe%2Fbarcelona-office-opening%2Fregister");
    expect(session.requests).toEqual([]);
  });

  it("unknown event is an error, not a submit", async () => {
    // The request page now resolves event existence; this legacy action cannot submit.
    await expect(requestAction(idle, form({ ...valid, slug: "nope" }))).rejects.toThrow("NEXT_REDIRECT;/e/nope/register");
    expect(session.requests).toEqual([]);
  });
});

describe("RequestForm states", () => {
  const action = async (s: RequestFormState) => s;

  it("default: labelled fields, email placeholder, optional role", () => {
    const html = decode(renderToStaticMarkup(<RequestForm slug="x" action={action} />));
    for (const label of ["First name", "Last name", "Email", "Company", "Role"]) expect(html).toContain(label);
    expect(html).toContain("· optional");
    expect(html).toContain('placeholder="you@company.com"');
    expect(html).toContain('autoComplete="email"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("errors: alert banner and aria-invalid + described-by on the bad fields", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        slug="x"
        action={action}
        initial={{ status: "invalid", values: { firstName: "Maria", lastName: "", email: "maria.garcia@gmail" }, errors: { lastName: "Enter your last name", email: "Enter a valid email address" } }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Check the 2 highlighted fields.");
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html).toContain("Enter your last name");
    expect(html).toContain('value="maria.garcia@gmail"');
  });

  it("submitting: busy button with the pending label, read-only fields", () => {
    const html = renderToStaticMarkup(<RequestForm slug="x" action={action} pending initial={{ status: "idle", values: { firstName: "Maria" } }} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Sending request…");
    expect(html.match(/readOnly=""/g)?.length).toBe(5);
  });

  it("submitted replaces the form with a status message", () => {
    const html = renderToStaticMarkup(<RequestForm slug="x" action={action} initial={{ status: "submitted", firstName: "Maria" }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Thanks, Maria.");
    expect(html).not.toContain("<form");
  });

  it("signed in: names/company/role prefilled and editable, email read-only with sign out", () => {
    const signOut = async () => {};
    const viewer = { firstName: "Alberto", lastName: "Rosas", email: "alberto@example.com", company: "Didit", role: "CEO" };
    const html = decode(renderToStaticMarkup(<RequestForm slug="x" action={action} viewer={viewer} signOut={signOut} />));
    expect(html).toContain('value="Alberto"');
    expect(html).toContain('value="Rosas"');
    expect(html).toContain('value="Didit"');
    expect(html).toContain('value="CEO"');
    expect(html).not.toMatch(/<input[^>]*name="email"/);
    expect(html).not.toContain('placeholder="you@company.com"');
    expect(html).toContain("Requesting as <strong");
    expect(html).toContain("alberto@example.com</strong> · Not you? ");
    expect(html).toMatch(/<button[^>]*form="signout-x"[^>]*>Sign out<\/button>/);
    expect(html).toMatch(/<form id="signout-x"/);
    expect(html).not.toMatch(/readOnly=""/);
  });

  it("staff without a guest session: note instead of silently asking again", () => {
    const html = decode(renderToStaticMarkup(<RequestForm slug="x" action={action} staff={{ email: "ops@didit.me" }} />));
    expect(html).toContain("You’re signed in as staff (ops@didit.me). Requests use a guest account.");
    expect(html).toMatch(/<input[^>]*name="email"/);
    expect(decode(renderToStaticMarkup(<RequestForm slug="x" action={action} staff={{ email: "ops@didit.me" }} viewer={{ firstName: "A", lastName: "B", email: "a@b.co" }} />))).not.toContain("signed in as staff");
  });

  it("already requested: info banner with the email", () => {
    const html = decode(renderToStaticMarkup(<RequestForm slug="x" action={action} initial={{ status: "already", values: {}, email: "maria.garcia@gmail.com" }} />));
    expect(html).toContain("You already asked to attend with maria.garcia@gmail.com. We’ll email you when it’s confirmed.");
  });
});
