import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MyEventsScreen } from "../accounts/components/MyEvents";
import { ProfileForm } from "../accounts/components/ProfileForm";
import { initialsOf } from "../accounts/components/StatusScreen";
import { fullName, profileDefaults, type GuestAccount } from "../accounts/types";
import { cardContent } from "./card";
import { SiteHeader } from "./components/SiteHeader";
import { RequestCard } from "./components/RegistrationCard";
import { ProfileScreen } from "../accounts/components/ProfileScreens";
import { SettingsScreen } from "../accounts/components/SettingsScreen";
import { AI_ERA, FIXED_NOW } from "./fixtures";
import { displayName, greetingName } from "./viewer-name";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const NAMELESS = { firstName: "", lastName: "", email: "maria.garcia@gmail.com" };
const GUEST: GuestAccount = { id: "a1", ...NAMELESS, links: [], verification: { state: "none" }, marketingOptIn: false, eventsAttended: 0 };

describe("viewer name fallbacks (email-code guest without names)", () => {
  it("displayName / greetingName / initials fall back to the email local part, then a neutral label", () => {
    expect(displayName({ firstName: "María", lastName: "García", email: "m@x.io" })).toBe("María García");
    expect(displayName({ firstName: " ", lastName: "", email: "maria.garcia@gmail.com" })).toBe("maria.garcia");
    expect(displayName({ firstName: "", lastName: "" })).toBe("Your account");
    expect(greetingName(NAMELESS)).toBe("maria.garcia");
    expect(greetingName({ firstName: "María", email: "m@x.io" })).toBe("María");
    // The avatar letter (avatarInitial): first name, else the email's first letter.
    expect(initialsOf(NAMELESS)).toBe("M");
    expect(initialsOf({ firstName: "María", lastName: "García" })).toBe("M");
  });

  it("the public header never labels the account menu \" , account menu\"", () => {
    for (const Header of [SiteHeader]) {
      const html = renderToStaticMarkup(<Header viewer={NAMELESS} />);
      expect(html).toContain('aria-label="maria.garcia@gmail.com, account menu"');
      expect(html).not.toMatch(/aria-label=" *, account menu"/);
      expect(html).toContain('aria-label="maria.garcia@gmail.com"'); // the avatar
      expect(html).toContain(">M<");
    }
  });

  it("/me shows a name in the greeting and the avatar header", () => {
    const html = renderToStaticMarkup(<MyEventsScreen account={GUEST} events={[]} now={FIXED_NOW} />);
    expect(html).toContain("Hi there");
    expect(html).not.toMatch(/Hi\s*</);
    expect(html).toContain('aria-label="maria.garcia@gmail.com, account menu"');
    expect(html).toContain(">M<");
  });

  it("registration card greetings use the fallback", () => {
    expect(cardContent({ kind: "going", viewer: NAMELESS }, AI_ERA).title).toBe("You are in, maria.garcia");
  });
});

describe("register profile step defaults", () => {
  it("Full name is empty (never a lone space) when the account has no names", () => {
    expect(fullName(NAMELESS)).toBe("");
    expect(profileDefaults(GUEST).values.fullName).toBe("");
    expect(profileDefaults({ firstName: " María ", lastName: "García" }).values.fullName).toBe("María García");
    const html = renderToStaticMarkup(<ProfileForm event={AI_ERA} email={GUEST.email} method="email" initial={profileDefaults(GUEST)} action={async (s) => s} />);
    const fullNameInput = html.match(/<input[^>]*name="fullName"[^>]*>/)![0];
    expect(fullNameInput).not.toContain('value=" "');
    expect(fullNameInput).toMatch(/value=""/);
  });
});

describe("remaining screens use the name fallback (review follow-up)", () => {
  it("the public RequestCard shows the email local part, never a lone space", () => {
    const html = renderToStaticMarkup(<RequestCard event={AI_ERA} viewer={NAMELESS} actions={{} as never} />);
    expect(html).toContain("maria.garcia");
    expect(html).not.toMatch(/>\s+<\/span>/);
  });
  it("the /me profile heading and the settings PROFILE row are never empty", () => {
    const profile = renderToStaticMarkup(<ProfileScreen account={GUEST} />);
    expect(profile).toMatch(/id="profile-name"[^>]*>maria\.garcia</);
    const settings = renderToStaticMarkup(<SettingsScreen account={GUEST} actions={{} as never} />);
    expect(settings).toContain("maria.garcia");
  });
});
