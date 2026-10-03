import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TokensView, tokenStatus, type TokenRow } from "./TokensView";

const css = readFileSync(new URL("./tokens.module.css", import.meta.url), "utf8");
const NOW = new Date("2026-10-02T12:00:00Z");
const ACTIVE: TokenRow = { id: "b1b67c09-9c5d-471c-b864-8f70cd33269d", name: "Claude Code on my laptop", lastUsedAt: new Date("2026-10-02T08:14:50.267Z"), expiresAt: new Date("2027-10-02T08:00:00Z"), revokedAt: null };
const REVOKED: TokenRow = { ...ACTIVE, id: "c2c67c09-9c5d-471c-b864-8f70cd33269d", name: "Old client", lastUsedAt: null, revokedAt: new Date("2026-09-01T08:00:00Z") };
const view = (tokens: TokenRow[] | null) => renderToStaticMarkup(<TokensView email="owner@didit.me" tokens={tokens} now={NOW} revoke={(t) => <button type="submit">Revoke {t.name}</button>} />);

describe("Personal access tokens page", () => {
  it("uses the admin page box and heading (no second <main>, no raw ISO timestamps)", () => {
    const html = view([ACTIVE, REVOKED]);
    expect(html).not.toContain("<main");
    expect(html).toContain("Personal access tokens</h1>");
    expect(html).toMatch(/<a[^>]*href="\/admin\/team"[^>]*>Back to team<\/a>/);
    // Madrid time, fixed format: the same string on every runtime.
    expect(html).toContain(">2 Oct 2026, 10:14</time>");
    expect(html.replace(/dateTime="[^"]*"/gi, "")).not.toContain("2026-10-02T08:14:50.267Z");
    expect(html).toContain("dev_b1b67c09");
  });

  it("each row carries the dates under the name for the stacked (narrow) card, and only live tokens can be revoked", () => {
    const html = view([ACTIVE, REVOKED]);
    // Two no-wrap halves: the narrow card breaks at the "·", never inside a date.
    expect(html).toContain("<span>Last used 2 Oct 2026, 10:14 ·</span> <span>Expires 2 Oct 2027</span>");
    expect(html).toContain("<span>Last used never ·</span> <span>Expires 2 Oct 2027</span>");
    expect(html.match(/>Revoke /g)).toHaveLength(1);
    expect(tokenStatus(ACTIVE, NOW)).toBe("Active");
    expect(tokenStatus(REVOKED, NOW)).toBe("Revoked");
    expect(tokenStatus({ ...ACTIVE, expiresAt: new Date("2026-10-01T00:00:00Z") }, NOW)).toBe("Expired");
  });

  it("empty and loading states", () => {
    expect(view([])).toContain("No tokens yet.");
    expect(view(null)).toContain('aria-busy="true"');
  });

  it("the page never overflows: no fixed max-content box, cards below 640px of content", () => {
    expect(css).not.toContain("margin: 0 auto");
    expect(css).toContain("container: tokens / inline-size");
    const narrow = css.slice(css.indexOf("@container tokens (max-width: 640px)"));
    expect(narrow).toContain(".head { display: none; }");
    expect(narrow).toContain(".sub { display: block; }");
  });
});
