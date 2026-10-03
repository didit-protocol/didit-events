import { describe, expect, it } from "vitest";
import { renderEmail } from "../email/index.ts";
import { emailFixtures } from "../email/fixtures.ts";
import { emailAssetsUrl, emailFontAssetsUrl } from "../email/media.ts";
import { sender } from "./email.ts";

describe("EMAIL_FROM display name", () => {
  it("a configured display name is the one sent", () => {
    expect(sender("Didit Events", "Example Events <events@example.test>")).toBe("Example Events <events@example.test>");
    expect(sender("Didit Events", '"Example Events" <events@example.test>')).toBe("Example Events <events@example.test>");
    expect(sender("Didit Events", "  Example Events<events@example.test>  ")).toBe("Example Events <events@example.test>");
  });

  it("\"Didit Events\" is only the default: no EMAIL_FROM, or a bare address", () => {
    expect(sender("Didit Events", undefined)).toBe("Didit Events <events@updates.didit.me>");
    expect(sender("Didit Events", "events@example.test")).toBe("Didit Events <events@example.test>");
    expect(sender("Didit Events", "<events@example.test>")).toBe("Didit Events <events@example.test>");
    expect(sender("Didit Events", "Didit Events <events@updates.didit.me>")).toBe("Didit Events <events@updates.didit.me>");
  });

  it("a name can never break out of the header", () => {
    expect(sender("Didit Events", 'Evil "Name\r\nBcc: x@y.test <events@example.test>')).toBe("Evil NameBcc: x@y.test <events@example.test>");
  });
});

describe("the email font comes from EMAIL_ASSETS_URL, else APP_URL", () => {
  it("a local instance reads its own copy: nothing from the production site", () => {
    expect(emailFontAssetsUrl("http://localhost:3332")).toBe("http://localhost:3332/email");
    expect(emailFontAssetsUrl("http://localhost:3332/")).toBe("http://localhost:3332/email");
    expect(emailFontAssetsUrl("https://events.example.org")).toBe("https://events.example.org/email");
    expect(emailFontAssetsUrl("http://localhost:3332", "https://assets.example.org/")).toBe("https://assets.example.org/email");
    // Images still need a host a mail provider can reach: the logo and theme art keep the public fallback.
    expect(emailAssetsUrl("http://localhost:3332")).toBe("https://events.didit.me/email");
  });

  it("the rendered @font-face follows the font folder; the other assets keep theirs", () => {
    const data = { ...emailFixtures["M-10"], baseUrl: "http://localhost:3332", assetsUrl: emailAssetsUrl("http://localhost:3332"), fontAssetsUrl: emailFontAssetsUrl("http://localhost:3332") };
    const { html } = renderEmail("M-10", data);
    expect(html).toContain("url('http://localhost:3332/email/Inter-Variable.woff2')");
    expect(html).not.toContain("events.didit.me/email/Inter-Variable.woff2");
    expect(html).toContain("https://events.didit.me/email/didit-logo.png");
    // Without a font folder the font sits with the other assets, as before.
    const { fontAssetsUrl: _, ...plain } = data;
    expect(renderEmail("M-10", plain).html).toContain("url('https://events.didit.me/email/Inter-Variable.woff2')");
  });

  it("M-10 (host rejected): “Not approved”, never “full”; the product wording stays", () => {
    const { html, text } = renderEmail("M-10", emailFixtures["M-10"]);
    expect(html).toContain("Not approved this time");
    expect(`${html}${text}`).not.toMatch(/This one is full/);
    expect(text).toContain("Subscribe to Didit Events");
  });
});
