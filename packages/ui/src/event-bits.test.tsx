import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarStack, Avatar, Button, DateBadge, EmailField, IconTile, SegmentedNav, SubmitButton, TextField, ToneIcon } from "./index";
import { EventCoverOg } from "./og/EventCoverOg";

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("guest-page primitives", () => {
  it("DateBadge is decorative (the date is in the adjacent text) in both sizes", () => {
    const lg = html(<DateBadge month="Oct" day={8} />);
    expect(lg).toContain('aria-hidden="true"');
    expect(lg).toContain(">Oct<");
    expect(lg).toContain(">8<");
    expect(html(<DateBadge month="Oct" day="8" size="md" />)).toMatch(/class="date dateMd"/);
  });

  it("IconTile: outline lg/md, soft", () => {
    expect(html(<IconTile icon="pin" />)).toMatch(/class="tile tileLg"/);
    expect(html(<IconTile icon="pin" size="md" />)).toMatch(/tileMd/);
    expect(html(<IconTile icon="user-check" variant="soft" />)).toMatch(/tileSoft[\s\S]*width="18"/);
  });

  it("ToneIcon: text glyph or drawn check, three sizes, every tone", () => {
    expect(html(<ToneIcon tone="warning" glyph="…" />)).toContain("<span>…</span>");
    const check = html(<ToneIcon tone="success" glyph="check" size={88} />);
    expect(check).toContain("<svg");
    expect(check).toMatch(/tone88/);
    for (const tone of ["success", "success-soft", "warning", "danger", "feature", "brand", "neutral"] as const) {
      expect(html(<ToneIcon tone={tone} glyph="!" size={64} />)).toMatch(/class="tone \w+ tone64"/);
    }
  });

  it("AvatarStack exposes one accessible summary, hides the initials", () => {
    const out = html(<AvatarStack initials={["IN", "DH", "NK"]} label="84 going" />);
    expect(out).toContain('role="img" aria-label="84 going"');
    expect(out.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(out).toMatch(/stackSoft[\s\S]*stackBrand[\s\S]*stackSuccess/);
  });

  it("SegmentedNav marks the current link", () => {
    const out = html(
      <SegmentedNav
        label="Events"
        items={[
          { label: "Upcoming", href: "/events", current: true },
          { label: "Past", href: "/events?when=past" },
        ]}
      />,
    );
    expect(out).toContain('<nav aria-label="Events"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toContain('href="/events?when=past"');
  });

  it("Avatar supports the 28 and 56 sizes", () => {
    expect(html(<Avatar name="Alberto" size={28} />)).toContain("width:28px");
    expect(html(<Avatar name="Alberto" size={56} />)).toContain("font-size:20px");
  });

  it("Button xl and Field lg", () => {
    expect(html(<Button size="xl">Request to attend</Button>)).toMatch(/class="button primary xl"/);
    const field = html(<TextField label="First name" size="lg" error="Enter your first name" />);
    expect(field).toMatch(/class="field fieldLg"/);
    expect(field).toContain('aria-invalid="true"');
    expect(html(<EmailField label="Email" size="lg" />)).toContain('type="email"');
  });

  it("SubmitButton is a submit button that can show its pending label", () => {
    expect(html(<SubmitButton>Send</SubmitButton>)).toMatch(/^<button type="submit"/);
    const busy = html(
      <SubmitButton pending pendingLabel="Sending…">
        Send
      </SubmitButton>,
    );
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("Sending…");
    expect(busy).not.toContain(">Send<");
  });
});

/** Satori (next/og) rejects a <div> with several children unless it sets display flex (or none). */
function satoriViolations(node: ReactNode, path = "root"): string[] {
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<{ style?: { display?: string }; children?: ReactNode }>;
  const kids = Children.toArray(el.props.children);
  const out: string[] = [];
  if (el.type === "div" && kids.length > 1 && el.props.style?.display !== "flex" && el.props.style?.display !== "none") out.push(path);
  kids.forEach((k, i) => out.push(...satoriViolations(k, `${path}>${String(el.type)}[${i}]`)));
  return out;
}

describe("EventCoverOg", () => {
  const tree = EventCoverOg({
    title: "Building, Raising & Scaling in the",
    accent: "AI Era",
    date: "Thu 8 Oct 2026",
    doors: "18:30 CEST",
    venue: "Didit HQ, Barcelona",
    panels: ["How to build AI-native companies", "Raising in SF vs EU"],
    photo: "data:image/jpeg;base64,",
    logo: "data:image/png;base64,",
  });

  it("is Satori-safe: every multi-child div is a flex box", () => {
    expect(satoriViolations(tree)).toEqual([]);
  });

  it("renders the copy, accent words in brand blue, no CSS variables", () => {
    const out = html(tree);
    for (const t of ["Building,", "AI", "Era", "Thu 8 Oct 2026", "18:30 CEST", "Didit HQ, Barcelona", "01", "Raising in SF vs EU", "DIDIT EVENTS · BARCELONA"]) {
      expect(out).toContain(t);
    }
    expect(out).toMatch(/color:#2567FF[^>]*>AI</);
    expect(out).not.toContain("var(--");
  });
});
