import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FRAMES_APP, FrameView, getFrame } from "../../../frames";
import { ApplicantsView } from "./ApplicantsView";
import { RejectDialog } from "./Dialogs";
import { AI_ERA_APPLICANTS, DESIGN_APPLICANTS, DESIGN_COUNTS } from "./fixtures";
import { APPLICANT_FRAME_CODES } from "./frames";
import { InviteModal } from "./InviteModal";
import { bulkApproveBody, capacityBody } from "./present";
import { applicantsHref, checkInviteEmails, filterApplicants, parseApplicantQuery, reviewKey } from "./query";

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
const frame = (code: string) => decode(renderToStaticMarkup(<FrameView app={FRAMES_APP} code={code} />));
const labelOf = (html: string) => /data-screen-label="([^"]+)"/.exec(html)?.[1];
const LANE = [...Array.from({ length: 28 }, (_, i) => `AP-${String(i + 1).padStart(2, "0")}`), "S-00"];

describe("U3 applicant frames in /_frames", () => {
  it("registers every frame of the lane (AP-01…AP-28, S-00) exactly once", () => {
    expect([...APPLICANT_FRAME_CODES].sort()).toEqual([...LANE].sort());
  });

  it.each(LANE)("%s server-renders with its design label and viewport", (code) => {
    const def = getFrame(code, FRAMES_APP);
    expect(def, code).toBeDefined();
    const html = frame(code);
    expect(labelOf(html)).toBe(`${code} ${def!.name}`);
    expect(html).toContain(`width:${def!.viewport.w}px`);
    if (code !== "S-00") expect(html).toContain(`height:${def!.viewport.h}px`);
  });
});

describe("AP list states", () => {
  it("AP-01: header, segments with counts, capacity, one row approving, J/K/A/W/R shortcuts in the drawer", () => {
    const html = frame("AP-01");
    expect(html).toContain("Building, Raising & Scaling in the AI Era");
    expect(html).toContain("Thu 8 Oct 2026 · 18:30–21:30 CEST · Didit HQ, Barcelona · Approval required");
    expect(html).toContain("Share request link");
    expect(html).toContain("Invite guests");
    for (const seg of ["Pending", "Waitlist", "Approved", "Rejected", "Cancelled"]) expect(html).toContain(seg);
    expect(html).toContain("84 / 120");
    expect(html).toContain("Approving");
    expect(html).toContain("WHY THEY WANT TO COME");
    expect(html).toContain('data-state="hover"');
  });

  it("AP-02: bulk bar with 3 selected", () => {
    const html = frame("AP-02");
    expect(html).toContain("3 selected");
    expect(html.match(/aria-selected="true"/g)).toHaveLength(3);
  });

  it("AP-09: failed row and the Retry all banner", () => {
    const html = frame("AP-09");
    expect(html).toContain("Didit did not respond for 1 applicant. Nothing was sent to them.");
    expect(html).toContain("Retry all");
    expect(html).toContain("Couldn’t create Didit link");
  });

  it("switches columns and actions per tab (AP-12…AP-15)", () => {
    expect(frame("AP-12")).toContain("POSITION");
    expect(frame("AP-12")).toContain("Auto-promote is on");
    expect(frame("AP-13")).toContain("Link sent 29 Sep · not opened");
    expect(frame("AP-13")).toContain("Resend link");
    expect(frame("AP-14")).toContain("Not emailed");
    expect(frame("AP-14")).toContain("Reconsider");
    expect(frame("AP-15")).toContain("Late · <24h");
    expect(frame("AP-15")).toContain("Re-approve");
  });

  it("AP-21 / AP-22 / AP-23 empty, no results, loading", () => {
    expect(frame("AP-21")).toContain("No pending requests.");
    expect(frame("AP-22")).toContain("No applicants match “glovo”.");
    expect(frame("AP-22")).toContain("Clear search");
    expect(frame("AP-23")).toContain('aria-busy="true"');
  });

  it("AP-24 full: FULL pill, auto-waitlist banner, no Approve buttons; AP-25 closed banner", () => {
    const full = frame("AP-24");
    expect(full).toContain('data-status="full"');
    expect(full).toContain("You are at capacity. New requests go to the waitlist automatically.");
    expect(full).not.toContain('aria-label="Approve Ingrid Nilsen"');
    const closed = frame("AP-25");
    expect(closed).toContain('data-status="closed"');
    expect(closed).toContain("Requests closed on Tue 6 Oct. You can still decide on the 2 pending and invite people directly.");
  });

  it("row names link to the drawer with the list state kept", () => {
    const html = decode(renderToStaticMarkup(<ApplicantsView eventId="ai-era" query={parseApplicantQuery({ q: "hooli" })} counts={DESIGN_COUNTS} rows={DESIGN_APPLICANTS} event={AI_ERA_APPLICANTS} />));
    expect(html).toContain('href="/admin/events/ai-era/applicants?q=hooli&applicant=diego-herrera"');
  });
});

describe("drawers, dialogs and invites", () => {
  it("AP-03…AP-05, AP-26 drawers", () => {
    expect(frame("AP-03")).toContain("Applicant · 3 of 7");
    expect(frame("AP-03")).toContain("Add a private note…");
    expect(frame("AP-04")).toContain("Returning guest · attended 2 Didit events");
    expect(frame("AP-05")).toContain("Possible duplicate: same name and company as isabel.c@gmail.com");
    expect(frame("AP-26")).toContain("Meets all 3 requirements");
    expect(frame("AP-03")).toContain('aria-keyshortcuts="A"');
  });

  it("AP-28 v2 drawer: profile, links, badges, every answer (incl. earlier form) and history", () => {
    const html = frame("AP-28");
    for (const text of ["Head of Risk", "Fraud & Identity · Globex", "Previously payments risk at Litware", "Profile updated since the request (version 2 → 3)",
      "Ready: every accepted check is valid", "Selfie liveness", "1 Oct 2026, 13:02", "30 Mar 2027", "Age", "Verified · 18+", "Phone",
      "What do you want to get out of the evening?", "Raising in SF vs EU", "Happy to be photographed?", "Earlier form answers", "Heard great things about the last one.",
      "Requested", "1 Oct 2026, 13:08", "Verified by Didit · 1 Oct 2026", "Email verified 12 Feb 2026", "Add a private note…"]) expect(html).toContain(text);
    expect(html).toContain('<a href="https://www.linkedin.com/in/mariagarcia" target="_blank" rel="noopener noreferrer nofollow">LinkedIn');
    expect(html).not.toMatch(/birth|document number|legal_name/i);
  });

  it("v2 drawer links: only HTTPS hrefs become anchors", async () => {
    const { PersonSections } = await import("../person/PersonPanel");
    const { personFromDrawer } = await import("../person/build");
    const { DRAWER_V2 } = await import("./fixtures");
    const view = { ...DRAWER_V2.v2!, profile: { ...DRAWER_V2.v2!.profile, links: [{ kind: "other" as const, label: "Bad", href: "javascript:alert(1)" }] } };
    const html = renderToStaticMarkup(<PersonSections person={personFromDrawer({ name: "x", email: "x@y.z", timeZone: "UTC" }, view)} />);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<span>Bad</span>");
  });

  it("AP-06 / AP-07 copy is computed from the rows", () => {
    expect(capacityBody(["Ingrid Nilsen"], 120, 120, "Mon 5 Oct")).toBe("Approving Ingrid puts you at 121 of 120. Approved guests who never verify are released on Mon 5 Oct.");
    expect(bulkApproveBody([{ verified: true }, { verified: false }, { verified: false }])).toBe("2 need Didit verification and get M-03. 1 is already verified and goes straight to Going (M-06).");
    const html = frame("AP-07");
    expect(html).toContain("Approve 3 applicants?");
    expect(html).toContain("33 of 120");
  });

  it("AP-10 reject: the reason is required", () => {
    const ok = decode(renderToStaticMarkup(<RejectDialog inline onClose={() => {}} names={["Kwame Mensah"]} initial={{ reason: "Not a fit for this audience" }} onConfirm={() => {}} />));
    expect(ok).toContain("Reject Kwame Mensah?");
    expect(ok).toContain("Options: At capacity · Not a fit · Duplicate · Incomplete answers · Other");
    const bad = decode(renderToStaticMarkup(<RejectDialog inline initialInvalid onClose={() => {}} names={["Kwame Mensah"]} onConfirm={() => {}} />));
    expect(bad).toContain("Pick a reason. Staff see it in the Rejected tab.");
    expect(bad).toContain('aria-invalid="true"');
  });

  it("AP-16 / AP-17 invite checks and the send button", () => {
    const empty = decode(renderToStaticMarkup(<InviteModal inline eventId="ai-era" tab="email" closeHref="/x" existingEmails={[]} links={{ publicLink: "a", privateLink: "b", privateHint: "c" }} />));
    expect(empty).toContain("Send invites");
    const html = frame("AP-17");
    expect(html).toContain("Invalid email");
    expect(html).toContain("Already requested · will be approved");
    expect(html).toContain("3 others");
    expect(html).toContain("Send 4 invites");
    expect(checkInviteEmails(["a@b.co", "A@b.co", "x@y", "tom@fabrikam.test"], ["tom@fabrikam.test"]).map((c) => c.check)).toEqual(["ready", "duplicate", "invalid", "existing"]);
    expect(frame("AP-18")).toContain("2 of 4 · sending invitations");
    expect(frame("AP-19")).toContain("4 invites sent");
    expect(frame("AP-20")).toContain("✓ Copied");
  });

  it("S-00 renders every status-model group from the core table", () => {
    const html = frame("S-00");
    for (const k of ["ACCOUNT", "REGISTRATION", "VERIFICATION", "ATTENDANCE", "EVENT"]) expect(html).toContain(k);
    expect(html).toContain("PROFILE INCOMPLETE");
    expect(html).toContain("M-17 link · M-18 welcome");
  });
});

describe("query helpers", () => {
  it("parses and bounds params, builds hrefs", () => {
    const q = parseApplicantQuery({ tab: "nope", q: "  x ".repeat(80), signin: "google", applicant: "../evil", invite: "link" });
    expect(q.tab).toBe("pending");
    expect(q.q.length).toBeLessThanOrEqual(100);
    expect(q.applicant).toBeUndefined();
    expect(applicantsHref("ai-era", { tab: "waitlist", q: "a b" })).toBe("/admin/events/ai-era/applicants?tab=waitlist&q=a+b");
  });

  it("search covers name, email, company and answers", () => {
    const q = parseApplicantQuery({});
    expect(filterApplicants(DESIGN_APPLICANTS, { ...q, q: "tailspin" }).map((r) => r.name)).toEqual(["Samuel Osei"]);
    expect(filterApplicants(DESIGN_APPLICANTS, { ...q, q: "kyc" }).map((r) => r.name)).toEqual(["Nadia Kowalski", "Samuel Osei"]);
    expect(filterApplicants(DESIGN_APPLICANTS, { ...q, q: "moreau" }).map((r) => r.name)).toEqual(["Léa Moreau"]);
  });

  it("keyboard map ignores fields and modifiers", () => {
    expect(reviewKey({ key: "j" })).toBe("next");
    expect(reviewKey({ key: "K" })).toBe("prev");
    expect(reviewKey({ key: "a" })).toBe("approve");
    expect(reviewKey({ key: "a", metaKey: true })).toBeNull();
    expect(reviewKey({ key: "r", target: { tagName: "TEXTAREA" } as unknown as EventTarget })).toBeNull();
  });
});
