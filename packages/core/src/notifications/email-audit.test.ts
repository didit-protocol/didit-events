import { describe, expect, it } from "vitest";
import { EMAIL_CODES, renderEmail } from "../email/index.ts";
import { fitSubject, isEmptyBlock, visibleBlocks } from "../email/layout.ts";
import { DEFAULT_EMAIL_ASSETS_ORIGIN, emailAssetsOrigin, eventImageUrl, isPublicHttpsOrigin, personPhotoUrl, themeArtUrl } from "../email/media.ts";
import { auditEmails, auditRendered, imageUrls, minimalFixtures, richFixtures } from "./email-audit.ts";
import { toEmailEvent, type EventEmailRow } from "./email.ts";
import { emailConfigFromEnv } from "./index.ts";

const LOCAL = "http://localhost:3332";
const row = (cover: unknown): EventEmailRow => ({
  id: "9b0c7f52-3c1e-4a8e-9a55-1f0f6c2d8e11", slug: "door-lab", name: "Door lab", starts_at: new Date("2026-10-08T16:30:00Z"),
  ends_at: new Date("2026-10-08T19:30:00Z"), timezone: "Europe/Madrid", venue: null, address: null, status: "published", cover,
});
const banner = { kind: "asset", version: "00000000-0000-4000-8000-0000000000aa", alt: "B", wide: { version: "00000000-0000-4000-8000-0000000000bb" } };

describe("email asset base", () => {
  it("treats only public https origins as reachable by a mail server", () => {
    for (const u of ["https://events.didit.me", "https://events-staging.example.com/", "https://events.test"]) expect(isPublicHttpsOrigin(u), u).toBe(true);
    for (const u of [LOCAL, "https://localhost:3332", "https://127.0.0.1", "https://10.0.0.4", "https://192.168.1.2", "https://172.20.0.1",
      "https://[::1]:3000", "https://box.local", "https://app.localhost", "http://events.didit.me", "/email", "", undefined]) expect(isPublicHttpsOrigin(u), String(u)).toBe(false);
  });

  it("serves static assets from EMAIL_ASSETS_URL, else a public APP_URL, else production", () => {
    expect(emailAssetsOrigin(LOCAL, "https://cdn.didit.me/")).toBe("https://cdn.didit.me");
    expect(emailAssetsOrigin("https://events-staging.example.com/")).toBe("https://events-staging.example.com");
    expect(emailAssetsOrigin(LOCAL)).toBe(DEFAULT_EMAIL_ASSETS_ORIGIN);
    expect(() => emailAssetsOrigin(LOCAL, "http://localhost:9000")).toThrow("EMAIL_ASSETS_URL");
    expect(() => emailConfigFromEnv({ APP_URL: LOCAL, RESEND_API_KEY: "k", EMAIL_ASSETS_URL: "http://localhost:3332" })).toThrow("EMAIL_ASSETS_URL");
    expect(emailConfigFromEnv({ APP_URL: LOCAL, RESEND_API_KEY: "k", EMAIL_ASSETS_URL: "https://cdn.didit.me" }).assetsUrl).toBe("https://cdn.didit.me");
    expect(emailConfigFromEnv({ APP_URL: LOCAL, RESEND_API_KEY: "k" }).assetsUrl).toBeUndefined();
  });

  it("uses event images on a public APP_URL only; otherwise the theme art (people fall back to initials)", () => {
    const assets = "https://events.didit.me/email";
    expect(eventImageUrl("/api/events/x/cover?v=1", "https://events.didit.me", assets)).toBe("https://events.didit.me/api/events/x/cover?v=1");
    expect(eventImageUrl("/api/events/x/cover?v=1", LOCAL, assets, "sky")).toBe("https://events.didit.me/email/cover-sky.jpg");
    expect(eventImageUrl("http://localhost:3332/x.png", LOCAL, assets)).toBe(themeArtUrl(assets));
    expect(personPhotoUrl("/api/me/photo?v=2", LOCAL)).toBeNull();
    expect(personPhotoUrl("/api/me/photo?v=2", "https://events.didit.me")).toBe("https://events.didit.me/api/me/photo?v=2");
    expect(personPhotoUrl("https://127.0.0.1/p.jpg", "https://events.didit.me")).toBeNull();
  });

  it("binds the hero like the sender: banner on a public origin, theme art with its size on a local one", () => {
    const local = toEmailEvent(row(banner), LOCAL);
    expect(local.coverImageUrl).toBe("https://events.didit.me/email/cover-aqua.jpg");
    expect(local.coverSize).toEqual({ width: 1200, height: 630 });
    expect(toEmailEvent(row({ kind: "theme", theme: "sky" }), LOCAL).coverImageUrl).toBe("https://events.didit.me/email/cover-sky.jpg");
    const prod = toEmailEvent(row(banner), "https://events.didit.me");
    expect(prod.coverImageUrl).toBe("https://events.didit.me/api/events/9b0c7f52-3c1e-4a8e-9a55-1f0f6c2d8e11/cover?v=00000000-0000-4000-8000-0000000000bb");
    expect(prod.coverSize).toBeUndefined();
    const og = toEmailEvent(row({ kind: "theme", theme: "aqua" }), "https://events.didit.me");
    expect(og.coverImageUrl).toBe("https://events.didit.me/e/door-lab/opengraph-image");
    expect(og.coverSize).toEqual({ width: 1200, height: 630 });
  });
});

describe("rendered emails never point at an unreachable image", () => {
  for (const appUrl of [LOCAL, "http://127.0.0.1:3000", "https://events.didit.me"]) {
    it.each(EMAIL_CODES)(`%s (APP_URL ${appUrl}): every image is absolute public https`, (code) => {
      for (const data of [richFixtures({ appUrl }), minimalFixtures({ appUrl })]) {
        const html = renderEmail(code, data[code] as never).html;
        const urls = imageUrls(html);
        expect(urls.length, code).toBeGreaterThan(0);
        for (const u of urls) {
          expect(u, code).toMatch(/^https:\/\//);
          expect(u, code).not.toMatch(/localhost|127\.0\.0\.1/);
        }
        expect(html, code).not.toMatch(/src="\/|background="\/|src="(?!https:|cid:)/);
        if (appUrl.startsWith("https:")) expect(html, code).not.toMatch(/http:\/\/localhost|127\.0\.0\.1/);
      }
    });
  }
});

describe("email audit", () => {
  it.each([LOCAL, "https://events-staging.example.com"])("every template passes with rich and minimal data (APP_URL %s)", (appUrl) => {
    const rows = auditEmails({ appUrl });
    expect(rows).toHaveLength(EMAIL_CODES.length * 2);
    expect(rows.filter((r) => r.problems.length).map((r) => `${r.code}/${r.fixture}: ${r.problems.join("; ")}`)).toEqual([]);
  });

  it("drops empty optional sections in every template (minimal data)", () => {
    const min = minimalFixtures();
    const m11 = renderEmail("M-11", min["M-11"]);
    expect(m11.html).not.toContain(">AGENDA<");
    expect(m11.text).not.toContain("AGENDA");
    expect(m11.html).not.toMatch(/<p [^>]*>\s/);
    expect(renderEmail("M-11", richFixtures()["M-11"]).html).toContain(">AGENDA<");
    for (const code of ["M-13", "E-02"] as const) expect(renderEmail(code, min[code]).html, code).not.toContain(">TONIGHT<");
    const m25 = renderEmail("M-25", min["M-25"]);
    expect(m25.html).not.toContain("ANSWERS");
    expect(m25.html).not.toMatch(/>Company<|>Role<|>Phone</);
    const m02 = renderEmail("M-02", min["M-02"]);
    expect(m02.html).not.toContain(">Where<");
    expect(m02.text).not.toMatch(/Where:/);
    expect(renderEmail("M-17", min["M-17"]).html).not.toContain(">Device<");
    for (const code of EMAIL_CODES) {
      const out = renderEmail(code, min[code] as never);
      expect(out.html, code).not.toMatch(/table-layout:fixed"><\/table>/);
      expect(out.text, code).not.toMatch(/\n\n\n/);
    }
  });

  it("filters empty blocks and entries centrally", () => {
    expect(isEmptyBlock({ kind: "agenda", title: "AGENDA", items: [] })).toBe(true);
    expect(isEmptyBlock({ kind: "qa", title: "ANSWERS", items: [{ q: "Q", a: " " }] })).toBe(true);
    expect(isEmptyBlock({ kind: "note", text: "" })).toBe(true);
    expect(isEmptyBlock({ kind: "rows", rows: [{ k: "Where", v: "" }], labelWidth: 80, size: "md" })).toBe(true);
    expect(visibleBlocks([{ kind: "rows", rows: [{ k: "When", v: "Thu" }, { k: "Where", v: "" }], labelWidth: 80, size: "md" }]))
      .toEqual([{ kind: "rows", rows: [{ k: "When", v: "Thu" }], labelWidth: 80, size: "md" }]);
  });

  it("inline cid: photos are fine (not fetched, not HTTP-checked); broken http(s) images are still flagged", () => {
    for (const fixture of [richFixtures(), richFixtures({ appUrl: "https://events.didit.me" })]) {
      for (const code of ["M-25", "M-26"] as const) {
        const r = renderEmail(code, fixture[code]);
        expect(r.html, code).toContain('src="cid:applicant-1"');
        expect(imageUrls(r.html), code).not.toContainEqual(expect.stringMatching(/^cid:/));
        expect(auditRendered(r), code).toEqual([]);
      }
    }
    const good = renderEmail("M-25", richFixtures()["M-25"]);
    const broken = { ...good, html: good.html.replace('src="cid:applicant-1"', 'src="http://localhost:3332/api/me/photo"') };
    expect(auditRendered(broken).join("\n")).toContain("img: not absolute https: http://localhost:3332/api/me/photo");
    const noSize = { ...good, html: good.html.replace(/(src="cid:applicant-1") width="48" height="48"/, "$1") };
    expect(auditRendered(noSize).join("\n")).toContain("img: inline image without size or alt: cid:applicant-1");
  });

  it("M-28 welcome renders with rich and minimal data: Explore events with its icon, profile link only when given", () => {
    const rich = renderEmail("M-28", richFixtures()["M-28"]), min = renderEmail("M-28", minimalFixtures()["M-28"]);
    expect(rich.subject).toBe("Welcome to Didit Events");
    expect(rich.text).toContain("Welcome, María");
    expect(rich.html).toContain("Complete your profile");
    expect(rich.html).toMatch(/email-icons\/ticket\.png[^>]*>Explore events/);
    expect(min.text).toMatch(/\nWelcome\n/);
    expect(min.html).not.toContain("Complete your profile");
    expect(min.html).toContain(">Email preferences</a>");
  });

  it("M-29 profile reminder lists only the missing items, with Complete my profile and its icon", () => {
    const rich = renderEmail("M-29", richFixtures()["M-29"]), min = renderEmail("M-29", minimalFixtures()["M-29"]);
    expect(rich.subject).toBe("Finish your Didit Events profile");
    expect(rich.preheader).toBe("Hosts decide from your profile. It takes a minute.");
    expect(rich.text).toContain("Hi María, your profile is almost there");
    expect(rich.text).toContain("STILL TO ADD\n[ ] Profile photo\n[ ] Headline\n");
    expect(rich.text).not.toMatch(/Role and company|A link/);
    expect(rich.html).toMatch(/email-icons\/ticket\.png[^>]*>Complete my profile/);
    expect(rich.html).toContain('href="https://events.didit.me/me/profile/edit"');
    expect(min.text).toMatch(/\nYour profile is almost there\n/);
    expect(min.text).toContain("[ ] A link (LinkedIn or website)");
    expect(min.text).not.toContain("Profile photo");
    expect(min.html).toContain(">Email preferences</a>");
    for (const r of [rich, min]) { expect(auditRendered(r)).toEqual([]); expect(r.text).not.toMatch(/—/); }
  });

  it("keeps subjects within 70 characters at a word boundary", () => {
    expect(fitSubject("Short")).toBe("Short");
    const long = fitSubject("New request: María García for Building, Raising & Scaling in the AI Era (waitlist)");
    expect(long.length).toBeLessThanOrEqual(70);
    expect(long).toMatch(/ the…$|AI…$|Era…$|in…$/);
    const m25 = renderEmail("M-25", { ...richFixtures()["M-25"], kind: "waitlist" });
    expect(m25.subject.length).toBeLessThanOrEqual(70);
    expect(m25.html).toContain(`<title>${m25.subject.replace(/&/g, "&amp;")}</title>`);
  });

  it("the approval email carries invite.ics (REQUEST); cancellations carry cancel.ics", () => {
    const rows = auditEmails();
    const m06 = rows.find((r) => r.code === "M-06" && r.fixture === "rich")!;
    expect(m06.attachment).toMatchObject({ filename: "invite.ics", content_type: "text/calendar; charset=UTF-8; method=REQUEST" });
    expect(m06.attachment!.ics).toContain("METHOD:REQUEST");
    expect(rows.find((r) => r.code === "M-20")!.attachment?.filename).toBe("cancel.ics");
    expect(rows.find((r) => r.code === "M-02")!.attachment).toBeUndefined();
  });

  it("the checker catches the regressions it guards against", () => {
    const good = renderEmail("M-11", richFixtures()["M-11"]);
    expect(auditRendered(good)).toEqual([]);
    const broken = {
      ...good,
      subject: `${"x".repeat(71)}`,
      preheader: "",
      text: "",
      html: good.html
        .replace("https://events.didit.me/email/didit-logo.png", "http://localhost:3332/email/didit-logo.png")
        .replace('alt="Didit"', "")
        .replace("border-radius:20px", "border-radius:0")
        .replace(/(<td [^>]*)bgcolor="#1A1A1A"/, "$1")
        .replace("Get directions", "undefined")
        .replace(/href="https:\/\/maps[^"]*"/, 'href="/x"')
        .replace("</table></td></tr>", '<table width="100%" style="width:100%;table-layout:fixed"></table></table></td></tr>'),
    };
    const problems = auditRendered(broken).join("\n");
    for (const expected of ["subject: 71 chars", "preheader: empty", "text: plain-text part missing", "img: not absolute https", "img: no alt",
      "hero: radius", "button: cell without bgcolor", 'html: placeholder "undefined"', "link: not absolute: /x", "section: empty rows table", "asset: unreachable"]) {
      expect(problems).toContain(expected);
    }
  });
});
