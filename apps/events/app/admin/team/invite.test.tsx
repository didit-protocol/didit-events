import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { INVITE_ERRORS } from "../../../src/admin/team/policy";
import { InviteForm } from "../../../src/admin/team/InviteForm";
import { ROLE_SUMMARY } from "../../../src/admin/team/roles";
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '\"');

describe("A-19 InviteForm renders the returned state", () => {
  const render = (initialState: Parameters<typeof InviteForm>[0]["initialState"]) => decode(renderToStaticMarkup(<InviteForm roles={["admin", "staff"]} initialState={initialState} />));

  it("invalid: the email and role are kept with their messages", () => {
    const html = render({ status: "invalid", email: "maria@gmail.com", role: "admin", errors: { email: INVITE_ERRORS.domain, role: INVITE_ERRORS.role } });
    expect(html).toContain('value="maria@gmail.com"');
    expect(html).toContain(INVITE_ERRORS.domain);
    expect(html).toContain(INVITE_ERRORS.role);
    expect(html).toMatch(/<option value="admin" selected="">/);
  });

  it("sent: the success banner and an empty field", () => {
    const html = render({ status: "sent", email: "marta.vidal@didit.me" });
    expect(html).toContain("Invite sent to marta.vidal@didit.me. They can sign in with Google now.");
    expect(html).not.toContain('value="marta.vidal@didit.me"');
  });

  it("failed: an error banner, the draft kept, no success message", () => {
    const html = render({ status: "failed", email: "uma.bramwell@didit.me", role: "admin", message: INVITE_ERRORS.failed("uma.bramwell@didit.me") });
    expect(html).toContain("Couldn’t send the invite to uma.bramwell@didit.me. Nothing was saved. Try again.");
    expect(html).toContain('value="uma.bramwell@didit.me"');
    expect(html).toMatch(/<option value="admin" selected="">/);
    expect(html).not.toContain("Invite sent to");
  });

  it("idle: no messages, staff preselected", () => {
    const html = render(undefined);
    for (const m of [INVITE_ERRORS.email, INVITE_ERRORS.domain, INVITE_ERRORS.role]) expect(html).not.toContain(m);
    expect(html).toMatch(/<option value="staff" selected="">/);
    expect(html).toContain(ROLE_SUMMARY.staff);
  });
});

describe("A-19 role guide", () => {
  it("lists every role with its summary, and the ROLE cell carries it as a tooltip", async () => {
    const { TeamView } = await import("../../../src/admin/team/TeamView");
    const { TEAM, TEAM_NOW } = await import("../../../src/admin/team/fixtures");
    const { ALBERTO } = await import("../../../src/admin/fixtures");
    const { ROLE_CAN } = await import("../../../src/admin/team/roles");
    const html = decode(renderToStaticMarkup(<TeamView viewer={ALBERTO} members={TEAM} now={TEAM_NOW} manage />));
    expect(html).toContain("What each role can do");
    for (const role of ["owner", "admin", "staff"] as const) {
      expect(html).toContain(ROLE_SUMMARY[role]);
      for (const line of ROLE_CAN[role]) expect(html).toContain(line);
    }
    const member = TEAM.find((m) => !m.disabledAt)!;
    expect(html).toContain(`title="${ROLE_SUMMARY[member.role]}"`);
    const readOnly = renderToStaticMarkup(<TeamView viewer={ALBERTO} members={TEAM} now={TEAM_NOW} manage={false} />);
    expect(readOnly).not.toContain("What each role can do");
  });
});

describe("A-19 Resend invite", () => {
  it("shows on rows nobody has signed in with yet, only for managers who could disable them", async () => {
    const { TeamView } = await import("../../../src/admin/team/TeamView");
    const { TEAM, TEAM_NOW, INVITED } = await import("../../../src/admin/team/fixtures");
    const { ALBERTO } = await import("../../../src/admin/fixtures");
    const members = [...TEAM, INVITED, { ...INVITED, email: "off@didit.me", name: "off", disabledAt: "2026-10-21T14:58:00+02:00" }];
    const html = decode(renderToStaticMarkup(<TeamView viewer={ALBERTO} members={members} now={TEAM_NOW} manage />));
    expect(html.match(/>Resend invite</g)).toHaveLength(1);
    expect(html).toContain(`aria-label="Resend invite to ${INVITED.name}"`);
    const readOnly = renderToStaticMarkup(<TeamView viewer={ALBERTO} members={members} now={TEAM_NOW} manage={false} />);
    expect(readOnly).not.toContain("Resend invite");
  });
});
