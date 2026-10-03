import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ALBERTO } from "../fixtures";
import { INVITED, PAU_DISABLED, TEAM, TEAM_NOW } from "./fixtures";

vi.mock("../../../app/admin/team/actions", () => ({ inviteStaffAction: vi.fn(), resendInviteAction: vi.fn(), disableStaffAction: vi.fn(), restoreStaffAction: vi.fn() }));

const css = readFileSync(new URL("./Team.module.css", import.meta.url), "utf8");
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("A-19 Team, responsive", () => {
  it("every managed row carries a role · last-active line for the stacked (narrow) layout", async () => {
    const { TeamView } = await import("./TeamView");
    const html = decode(renderToStaticMarkup(<TeamView viewer={ALBERTO} members={[...TEAM.slice(0, 4), PAU_DISABLED, INVITED]} now={TEAM_NOW} manage />));
    expect(html).toContain('<span class="sub">Admin · ');
    expect(html).toContain('<span class="sub">Staff · Not signed in yet</span>');
    expect(html).toContain('<span class="sub">Disabled · ');
    // Read-only list: the role is not shown to staff, so there is no line either.
    expect(renderToStaticMarkup(<TeamView viewer={ALBERTO} members={TEAM} now={TEAM_NOW} manage={false} />)).not.toContain('class="sub"');
  });

  it("the tokens link is a heading action, only when the page passes it", async () => {
    const { TeamView } = await import("./TeamView");
    const html = renderToStaticMarkup(<TeamView viewer={ALBERTO} members={TEAM} now={TEAM_NOW} manage tokensHref="/admin/team/tokens" />);
    expect(html).toMatch(/<a[^>]*href="\/admin\/team\/tokens"[^>]*>Access tokens<\/a>/);
    // No stray inline-styled paragraph above the heading: the heading opens the page.
    expect(html).toMatch(/^<div class="page page"><div class="head">/);
    expect(renderToStaticMarkup(<TeamView viewer={ALBERTO} members={TEAM} now={TEAM_NOW} manage />)).not.toContain("/admin/team/tokens");
  });

  it("the actions track fits both row buttons, and narrow columns stack the row instead of overlapping Role", () => {
    expect(css).toMatch(/\.colsManage \{ grid-template-columns: [^}]* 200px; \}/);
    expect(css).not.toContain("96px");
    expect(css).toContain("container: team / inline-size");
    expect(css).not.toContain("@container admin");
    const narrow = css.slice(css.indexOf("@container team (max-width: 640px)"));
    expect(narrow).toContain(".colsManage { grid-template-columns: minmax(0, 1fr);");
    expect(narrow).toContain(".colsManage .sub { display: block; }");
    expect(narrow).toContain(".roleHint { white-space: normal; }");
    // Phones: the member list comes before the invite row and the role cards, and each card keeps the email.
    expect(narrow).toContain(".table { order: 1; }");
    expect(narrow).toContain(".invite { order: 2; }");
    expect(narrow).toContain(".roles { order: 3; }");
    expect(narrow).toContain(".mail { display: block; }");
  });
});
