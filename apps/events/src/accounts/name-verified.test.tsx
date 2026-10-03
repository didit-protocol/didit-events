// A name is "verified" only when an ID document proved it (name_from_id). The face check alone proves a real person:
// "Human verified", with an editable name.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CsrfProvider } from "../auth/CsrfField";
import { EditProfileForm } from "./components/EditProfileForm";
import { ProfileScreen, VerificationScreen } from "./components/ProfileScreens";
import { SettingsScreen } from "./components/SettingsScreen";
import { MARIA, MARIA_FACE_ONLY, MARIA_NEW, MARIA_SELFIE_EXPIRED } from "./fixtures";
import { nameVerified, type GuestAccount } from "./types";

const noop = async () => {};
const edit = (account: GuestAccount) => renderToStaticMarkup(<CsrfProvider token="t"><EditProfileForm account={account} action={async () => ({})} photo={{ upload: async () => ({}), remove: async () => ({}) }} /></CsrfProvider>);
const profile = (account: GuestAccount) => renderToStaticMarkup(<CsrfProvider token="t"><ProfileScreen account={account} /></CsrfProvider>);
const verification = (account: GuestAccount) => renderToStaticMarkup(<CsrfProvider token="t"><VerificationScreen account={account} deleteData={noop} /></CsrfProvider>);
const settings = (account: GuestAccount) => renderToStaticMarkup(<CsrfProvider token="t"><SettingsScreen account={account} actions={{ signOut: noop, signOutAll: noop, toggleMarketing: noop, disconnectGoogle: noop }} /></CsrfProvider>);
/** The detail and the met glyph of a "VERIFIED DATA" row. */
const row = (html: string, label: string) => new RegExp(`>${label}</[^>]+>(?:<[^>]+>)*([^<]*)<[\\s\\S]*?aria-label="(Verified|Not verified)"`).exec(html)?.slice(1, 3);

describe("verified name = proven by an ID document", () => {
  it("nameVerified: true only with ID proof", () => {
    expect([MARIA, MARIA_SELFIE_EXPIRED, MARIA_FACE_ONLY, MARIA_NEW].map(nameVerified)).toEqual([true, true, false, false]);
    expect(nameVerified({ verification: { state: "verified", verifiedAt: "", selfieValidUntil: "", nameFromId: false } })).toBe(false);
  });

  it("edit profile: the name is locked (with Change) only when an ID proved it; a face-only account edits it", () => {
    const locked = edit(MARIA);
    expect(locked).toContain("Full name · verified by ID");
    expect(locked).toMatch(/<input[^>]*readOnly=""[^>]*value="María García"|<input[^>]*value="María García"[^>]*readOnly=""/);
    expect(locked).toMatch(/<a href="\/me\/profile\/edit\?change=name"[^>]*>Change<\/a>/);
    expect(locked).not.toContain('name="fullName"');
    for (const account of [MARIA_FACE_ONLY, MARIA_NEW]) {
      const open = edit(account);
      expect(open).toMatch(/<input[^>]*name="fullName"[^>]*value="María García"|<input[^>]*value="María García"[^>]*name="fullName"/);
      expect(open).not.toMatch(/Full name · verified|change=name|readOnly/);
    }
  });

  it("profile: 'Verified by Didit' with ID proof, 'Human verified' with the face check alone, and the name row follows", () => {
    const id = profile(MARIA), face = profile(MARIA_FACE_ONLY), none = profile(MARIA_NEW);
    expect(id).toContain(">Verified by Didit<");
    expect(id).toContain('aria-label="Verified by Didit"');
    expect(id).not.toContain("Human verified<");
    expect(row(id, "Full name")).toEqual(["Verified · matches your ID document", "Verified"]);
    expect(row(id, "ID document")).toEqual(["Verified", "Verified"]);
    expect(face).toContain(">Human verified<");
    expect(face).toContain('aria-label="Human verified"');
    expect(face).not.toContain("Verified by Didit");
    expect(row(face, "Full name")).toEqual(["Not verified · needs an ID document", "Not verified"]);
    expect(row(face, "ID document")).toEqual(["Not verified · not needed yet", "Not verified"]);
    expect(row(face, "Selfie · liveness")).toEqual(["Human verified · valid until 1 Oct 2027", "Verified"]);
    expect(none).toContain(">Not verified yet<");
    expect(row(none, "Full name")).toEqual(["Not verified · needs an ID document", "Not verified"]);
  });

  it("verification details: the name is listed as verified only with ID proof", () => {
    const groups = (html: string) => {
      const [, verified = "", missing = ""] = html.split(/>(?:VERIFIED|NOT VERIFIED)</);
      return { verified, missing };
    };
    const id = groups(verification(MARIA)), face = groups(verification(MARIA_FACE_ONLY));
    expect(id.verified).toContain("Full name · María García");
    expect(id.verified).toContain("Read from your ID document");
    expect(id.missing).not.toContain("Full name");
    expect(face.verified).not.toContain("Full name");
    expect(face.verified).toContain("Human verified · liveness passed");
    expect(face.missing).toContain("Only an ID document verifies a name");
    expect(verification(MARIA_FACE_ONLY)).not.toContain("matched to selfie");
  });

  it("settings: the identity row names what was proven", () => {
    expect(settings(MARIA)).toContain("Verified by Didit");
    expect(settings(MARIA_FACE_ONLY)).toContain("Human verified");
    expect(settings(MARIA_FACE_ONLY)).not.toContain("Verified by Didit");
  });
});
