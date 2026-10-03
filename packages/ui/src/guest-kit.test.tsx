import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Checkbox, CodeInput, GoogleButton, GUEST_PILL_STATUS_KEYS, PILL_STATUS_KEYS, StatusPill, Textarea, TextField, ToneIcon } from "./index";

// Primitives added for the U5 guest flow (design/04 R-*, design/05 U-* and DA-*).

describe("CodeInput", () => {
  it("renders one labelled one-time-code input and six decorative boxes", () => {
    const html = renderToStaticMarkup(<CodeInput name="code" label="6-digit code" defaultValue="481" />);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('aria-label="6-digit code"');
    expect(html).not.toContain("maxLength");
    expect(html.match(/aria-hidden="true" class="box/g)).toHaveLength(6);
    // Digits fill the first boxes; the next empty box is marked for the focus ring.
    expect(html).toMatch(/>4<\/span><span[^>]*>8<\/span><span[^>]*>1<\/span><span aria-hidden="true" class="box next">/);
  });

  it("keeps digits only and caps the length", () => {
    const html = renderToStaticMarkup(<CodeInput name="code" label="Code" defaultValue="4a8-1 9 0 3 7" />);
    expect(html).toContain('value="481903"');
  });

  it("invalid: aria-invalid + described by the error; forced focus look for the gallery", () => {
    const html = renderToStaticMarkup(<CodeInput name="code" label="Code" value="481930" invalid describedBy="err" state="focus" />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="err"');
    expect(html).toContain('data-state="focus"');
    expect(html).toContain("invalid");
  });

  it("supports other lengths", () => {
    const html = renderToStaticMarkup(<CodeInput name="pin" label="PIN" length={4} />);
    expect(html.match(/class="box/g)).toHaveLength(4);
    expect(html).toContain("repeat(4, 1fr)");
  });
});

describe("guest sizes and variants", () => {
  it("TextField and Textarea xl (48px guest fields)", () => {
    expect(renderToStaticMarkup(<TextField label="Email" size="xl" error="Enter a valid email address" />)).toContain("fieldXl");
    expect(renderToStaticMarkup(<Textarea label="Why" size="xl" />)).toContain("fieldXl");
  });

  it("Checkbox lg + invalid (consent box)", () => {
    const html = renderToStaticMarkup(<Checkbox size="lg" invalid aria-label="Consent" />);
    expect(html).toContain("boxLg");
    expect(html).toContain("boxInvalid");
    expect(html).toContain('aria-invalid="true"');
    expect(renderToStaticMarkup(<Checkbox aria-label="x" />)).not.toContain("boxLg");
  });

  it("ToneIcon 48 and 56", () => {
    expect(renderToStaticMarkup(<ToneIcon tone="warning" glyph="!" size={56} />)).toContain("tone56");
    expect(renderToStaticMarkup(<ToneIcon tone="brand" glyph="✉" size={48} />)).toContain("tone48");
  });

  it("GoogleButton outline: bare G, xl and lg, loading label", () => {
    const xl = renderToStaticMarkup(<GoogleButton variant="outline" href="/api/auth/oidc/start" />);
    expect(xl).toContain("outline");
    expect(xl).toContain('href="/api/auth/oidc/start"');
    expect(xl).not.toContain("disc");
    // v9: it is the shared Button, so "Continue with Google" and the button next to it are the same size at every width.
    const classOf = (markup: string) => /class="([^"]*)"/.exec(markup)![1]!.split(" ");
    for (const size of ["lg", "xl"] as const) {
      const google = classOf(renderToStaticMarkup(<GoogleButton variant="outline" size={size} />));
      const plain = classOf(renderToStaticMarkup(<Button size={size} block>Email me a code</Button>));
      expect(google).toEqual(expect.arrayContaining(["button", "outline", size, "block"]));
      expect(plain).toEqual(expect.arrayContaining(["button", size, "block"]));
    }
    expect(classOf(xl)).toEqual(expect.arrayContaining(["button", "outline", "xl", "block"]));
    const busy = renderToStaticMarkup(<GoogleButton variant="outline" loading loadingLabel="Signing in with Google…" />);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("Signing in with Google…");
    // The staff A-01 button is unchanged.
    expect(renderToStaticMarkup(<GoogleButton />)).toContain("disc");
  });

  it("guest pill statuses render without changing the C-00 sixteen", () => {
    expect(PILL_STATUS_KEYS).toHaveLength(16);
    for (const s of GUEST_PILL_STATUS_KEYS) expect(renderToStaticMarkup(<StatusPill status={s} />)).toContain(`data-status="${s}"`);
    expect(renderToStaticMarkup(<StatusPill status="profile-verified">Verified by Didit</StatusPill>)).toContain("Verified by Didit");
  });
});
