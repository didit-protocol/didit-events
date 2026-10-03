/**
 * U5 frames for the /_frames gallery: R-01…R-34 (design/04 AI Era Event, R-32…R-34 from design-prompt §3),
 * U-01…U-42 and DA-01…DA-05 (design/05 Accounts and Applicants; the magic-link frames U-08…U-12, DA-03 and DA-05
 * are the Didit email-code versions of design-prompt §2). Each renders the real component with fixtures.
 */
import type { CSSProperties, ReactNode } from "react";
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { acceptInviteAction } from "../../app/i/[token]/actions";
import { signInAction } from "../../app/login/actions";
import { profileAction, registerAction, requestWithProfileAction } from "../../app/e/[slug]/register/actions";
import { cancelAction } from "../../app/me/events/[slug]/cancel/actions";
import { statusActions } from "../../app/me/events/[slug]/status-actions";
import { changeNameAction, saveProfileAction } from "../../app/me/profile/edit/actions";
import { removePhotoAction, savePhotoAction, uploadPhotoAction } from "../../app/me/profile/photo/actions";
import { deleteVerificationAction } from "../../app/me/profile/verification/actions";
import { deleteAccountAction } from "../../app/me/settings/delete/actions";
import { disconnectGoogleAction, signOutAction, toggleMarketingAction } from "../../app/me/settings/actions";
import { STATUS_PREVIEWS } from "./status-previews";
import { requirementRows } from "../../app/e/[slug]/register/data";
import { DeleteAccountSheet, NameChangeSheet } from "./components/AccountSheets";
import { CancelSheet } from "./components/CancelSheet";
import { DiditHosted, type DiditStep } from "./components/DiditHosted";
import { EditProfileForm } from "./components/EditProfileForm";
import { GoogleChooser } from "./components/GoogleChooser";
import { InviteScreen } from "./components/InviteScreen";
import { LinkedScreen } from "./components/LinkedScreen";
import { LoginFlow } from "./components/LoginFlow";
import { MyEventsScreen } from "./components/MyEvents";
import { PhotoEditor } from "./components/PhotoEditor";
import { ProfileForm } from "./components/ProfileForm";
import { ProfileScreen, VerificationScreen } from "./components/ProfileScreens";
import { RegisterFlow } from "./components/RegisterFlow";
import { RequirementsScreen } from "./components/Requirements";
import { SettingsScreen } from "./components/SettingsScreen";
import { StartedScreen } from "./components/StartedScreen";
import { StatusScreen } from "./components/StatusScreen";
import { DemoOnboardingJoin as OnboardingJoin, DemoProfileSteps, DemoRequestJoin as RequestJoin } from "./flow-fixtures";
import { ONBOARDING_VIEWS } from "./onboarding-fixtures";
import { PENDING_REGISTRATION, REQUEST_CONTEXTS, QUESTION_IDS } from "./request-fixtures";
import { AI_ERA, FIXED_NOW, MARIA, MARIA_EMAIL, MARIA_NEW, MY_EVENTS } from "./fixtures";
import { accountLinks } from "./links";
import { REGISTER_STATES, SIGN_IN_STATES } from "./states";

const CANVAS = "#E9E9EB";

function Shell({ label, w, h, children }: { label: string; w: number; h: number; children: ReactNode }) {
  const style = { width: w, height: h, borderRadius: 4, overflow: "hidden", background: "#FEFEFE", "--page-min-h": `${h}px` } as CSSProperties;
  return (
    <div data-screen-label={label} style={style}>
      {children}
    </div>
  );
}

const frame = (code: string, name: string, render: () => ReactNode, w = 390, h = 844): FrameDef => ({
  code,
  name,
  app: "events",
  viewport: { w, h },
  background: CANVAS,
  render: () => (
    <Shell label={`${code} ${name}`} w={w} h={h}>
      {render()}
    </Shell>
  ),
});

const register = (code: string) => {
  const p = REGISTER_STATES[code]!;
  return function renderRegister() {
    return <RegisterFlow event={AI_ERA} initial={p.initial} action={registerAction} sending={p.sending} focus={p.focus} code={p.code} />;
  };
};

const signIn = (code: string) => {
  const p = SIGN_IN_STATES[code]!;
  return function renderSignIn() {
    return (
      <LoginFlow
      layout={p.layout}
      initial={p.initial}
      action={signInAction}
      next={accountLinks.register(AI_ERA.slug)}
      event={AI_ERA}
      title={p.layout === "modal" ? "Sign in to request a place" : "Request to join"}
      googleHref={accountLinks.google(accountLinks.register(AI_ERA.slug))}
      googlePending={p.googlePending}
      signingIn={p.signingIn}
      focus={p.focus}
      code={p.code}
      />
    );
  };
};

const status = (code: string) => {
  const p = STATUS_PREVIEWS[code]!;
  return function renderStatus() {
    return <StatusScreen event={AI_ERA} account={p.account ?? MARIA} status={p.status} actions={statusActions} />;
  };
};

const hosted = (step: DiditStep) =>
  function renderHosted() {
    return <DiditHosted step={step} />;
  };

const settingsActions = { signOut: signOutAction, toggleMarketing: toggleMarketingAction, disconnectGoogle: disconnectGoogleAction };

export const accountFrames: FrameDef[] = [
  /* ── 04 R-01…R-34: registration and verification ── */
  frame("R-01", "Register · empty", register("R-01")),
  frame("R-02", "Register · errors", register("R-02")),
  frame("R-03", "Register · sending code", register("R-03")),
  frame("R-04", "Email code · entry", register("R-04")),
  frame("R-05", "Email code · wrong code", register("R-05")),
  frame("R-06", "Email code · expired", register("R-06")),
  frame("R-07", "Email code · too many attempts", register("R-07")),
  frame("R-08", "Request sent · pending", register("R-08")),
  frame("R-09", "Already registered", register("R-09")),
  frame("R-10", "Approved · start verification", status("R-10")),
  frame("R-11", "Didit · confirm your name", hosted("name")),
  frame("R-12", "Didit · email code", hosted("code")),
  frame("R-13", "Didit · email code wrong", hosted("code_wrong")),
  frame("R-14", "Didit · selfie intro", hosted("selfie_intro")),
  frame("R-15", "Didit · camera blocked", hosted("camera_blocked")),
  frame("R-16", "Didit · liveness · adjust", hosted("adjust")),
  frame("R-17", "Didit · liveness · hold still", hosted("hold")),
  frame("R-18", "Didit · processing", hosted("processing")),
  frame("R-19", "You are in · face ticket", status("R-19")),
  frame("R-20", "In review", status("R-20")),
  frame("R-21", "Declined · retry left", status("R-21")),
  frame("R-22", "Declined · no retries", status("R-22")),
  frame("R-23", "Waitlisted", status("R-23")),
  frame("R-24", "Not approved", status("R-24")),
  frame("R-25", "Verification link expired", status("R-25")),
  frame("R-26", "Cancel · confirm", () => <CancelSheet event={AI_ERA} mode={{ mode: "confirm" }} action={cancelAction} />),
  frame("R-27", "Registration cancelled", status("R-27")),
  frame("R-28", "Event full · join waitlist", () => <StatusScreen event={AI_ERA} account={MARIA} status={{ kind: "full", capacity: AI_ERA.capacity }} actions={statusActions} />),
  frame("R-29", "Registration closed", () => (
    <StatusScreen event={AI_ERA} account={MARIA} status={{ kind: "closed", closedAt: AI_ERA.registrationClosesAt! }} actions={statusActions} />
  )),
  frame("R-30", "Event day · checked in", status("R-30")),
  frame("R-31", "Event ended", status("R-31")),
  frame("R-32", "Verified a different email", status("R-32")),
  frame("R-33", "Sign-in locked", signIn("R-33")),
  frame("R-34", "Verification link used on another account", status("R-34")),

  /* ── 05 U-01…U-42: guest account ── */
  frame("U-01", "Request to join · choose sign-in", signIn("U-01")),
  frame("U-02", "Google · account chooser", () => (
    <GoogleChooser
      event={AI_ERA}
      accounts={[
        { name: "María García", email: MARIA_EMAIL, initials: "MG" },
        { name: "María García", email: "maria@globex.test", initials: "MG" },
      ]}
    />
  )),
  frame("U-03", "Google · signing in", signIn("U-03")),
  frame("U-04", "Google · cancelled", signIn("U-04")),
  frame("U-05", "Google · blocked or failed", signIn("U-05")),
  frame("U-06", "Email · entry", signIn("U-06")),
  frame("U-07", "Email · invalid", signIn("U-07")),
  frame("U-08", "Email code · sent", signIn("U-08")),
  frame("U-09", "Email code · too many attempts", signIn("U-09")),
  frame("U-10", "Email code · wrong code", signIn("U-10")),
  frame("U-11", "Email code · expired", signIn("U-11")),
  frame("U-12", "Email code · resent", signIn("U-12")),
  frame("U-13", "Signing you in", signIn("U-13")),
  frame("U-14", "New account · Google profile", () => (
    <ProfileForm event={AI_ERA} email={MARIA_EMAIL} method="google" initial={{ values: { fullName: "María García", company: "Globex" } }} action={profileAction} focus="role" />
  )),
  frame("U-15", "New account · email code profile", () => <ProfileForm event={AI_ERA} email={MARIA_EMAIL} method="email" initial={{ values: {} }} action={profileAction} focus="fullName" />),
  frame("U-16", "Profile · errors", () => (
    <ProfileForm
      event={AI_ERA}
      email={MARIA_EMAIL}
      method="email"
      initial={{ values: { company: "Globex", role: "Head of Risk" }, errors: { fullName: "Enter your full name", consent: "Tick the box to continue" } }}
      action={profileAction}
    />
  )),
  frame("U-17", "Request sent · pending", status("U-17")),
  frame("U-18", "Returning · already requested", status("U-18")),
  frame("U-19", "One account per email", () => <LinkedScreen email={MARIA_EMAIL} initials="MG" next={accountLinks.myEvents()} />),
  frame("U-20", "My events", () => <MyEventsScreen account={MARIA} events={MY_EVENTS} now={FIXED_NOW} />),
  frame("U-21", "Account settings", () => <SettingsScreen account={MARIA} actions={settingsActions} />),
  frame("U-22", "Delete account · confirm", () => <DeleteAccountSheet upcoming={1} open={2} action={deleteAccountAction} typed="DEL" />),
  frame("U-23", "Signed out · session expired", signIn("U-23")),
  frame("U-24", "Accept a direct invite", () => (
    <InviteScreen
      view={{ state: "signed_out", event: AI_ERA, invitedBy: "Alejandro, Didit", message: "Would love to have you on the SF vs EU panel crowd.", email: "alex@adatum.test" }}
      token="demo"
      accept={acceptInviteAction}
    />
  )),
  frame("U-25", "Invite · wrong account", () => (
    <InviteScreen view={{ state: "wrong_account", event: AI_ERA, email: "alex@adatum.test", signedInAs: MARIA_EMAIL }} token="demo" accept={acceptInviteAction} initials="MG" />
  )),
  frame("U-26", "Cancel attendance · reason", () => <CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 48, late: false }} action={cancelAction} initial={{ reason: "Schedule conflict" }} />),
  frame("U-27", "Cancel · other reason", () => (
    <CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 48, late: false }} action={cancelAction} initial={{ reason: "Other", note: "A colleague from Globex is going instead" }} focusNote />
  )),
  frame("U-28", "Cancel · late (under 24h)", () => <CancelSheet event={AI_ERA} mode={{ mode: "cancel", hoursToStart: 5, late: true }} action={cancelAction} initial={{ reason: "Feeling unwell" }} />),
  frame("U-29", "Attendance cancelled", status("U-29")),
  frame("U-30", "Withdraw pending request", () => <CancelSheet event={AI_ERA} mode={{ mode: "withdraw" }} action={cancelAction} initial={{ reason: "Changed my mind" }} />),
  frame("U-31", "Cannot cancel · event started", () => <StartedScreen event={AI_ERA} account={MARIA} />),
  frame("U-32", "Profile · verified", () => <ProfileScreen account={MARIA} />),
  frame("U-33", "Profile · new, not verified", () => <ProfileScreen account={MARIA_NEW} />),
  frame("U-34", "Edit profile", () => <EditProfileForm account={MARIA} action={saveProfileAction} photo={{ upload: savePhotoAction, remove: removePhotoAction }} focus="bio" />),
  frame("U-35", "Photo · crop", () => <PhotoEditor initials="MG" action={uploadPhotoAction} />),
  frame("U-36", "Photo · upload error", () => <PhotoEditor initials="MG" action={uploadPhotoAction} initialError="The file is 14 MB. Use a JPG or PNG under 5 MB." />),
  frame("U-37", "Edit · changing a verified name", () => <NameChangeSheet action={changeNameAction} initialName="María García López" />),
  frame("U-38", "Verification details", () => <VerificationScreen account={MARIA} deleteData={deleteVerificationAction} />),
  frame("U-39", "Event page · all requirements met", () => <RequirementsScreen event={AI_ERA} account={MARIA} rows={requirementRows(MARIA, false)} request={requestWithProfileAction} />),
  frame("U-40", "Event page · one item missing", () => <RequirementsScreen event={AI_ERA} account={MARIA} rows={requirementRows(MARIA, true)} request={requestWithProfileAction} />),
  frame("U-41", "Approved · verification reused", status("U-41")),
  frame("U-42", "Selfie expired · re-verify only that", status("U-42")),

  /* ── 05 DA-01…DA-05: desktop sign-in modal (1440 × 900) ── */
  frame("DA-01", "Sign in · choose", signIn("DA-01"), 1440, 900),
  frame("DA-02", "Email · invalid", signIn("DA-02"), 1440, 900),
  frame("DA-03", "Email code sent", signIn("DA-03"), 1440, 900),
  frame("DA-04", "Google failed", signIn("DA-04"), 1440, 900),
  frame("DA-05", "Code expired", signIn("DA-05"), 1440, 900),

  /* ── Event model v2: onboarding (email → profile → face check → done), 390 ── */
  frame("O-01", "Onboarding fallback · profile, new", () => <OnboardingJoin initial={ONBOARDING_VIEWS.profileNew} returnTo="/events" />),
  frame("O-02", "Onboarding fallback · profile, resumed", () => <OnboardingJoin initial={ONBOARDING_VIEWS.profileResume} returnTo="/events" />),
  frame("O-03", "Onboarding fallback · profile, one detail left", () => <OnboardingJoin initial={{ ...ONBOARDING_VIEWS.profileResume, missingProfileFields: ["links"], profile: { ...ONBOARDING_VIEWS.profileResume.profile, headline: "Head of Risk" } }} returnTo="/events" />),
  frame("O-04", "Onboarding fallback · face check", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceRequired} returnTo="/events" />),
  frame("O-05", "Onboarding fallback · preparing the check", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceCreating} returnTo="/events" />),
  frame("O-06", "Onboarding fallback · resume the check", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceInProgress} returnTo="/events" />),
  frame("O-07", "Onboarding fallback · in review", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceInReview} returnTo="/events" />),
  frame("O-08", "Onboarding fallback · declined", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceDeclined} returnTo="/events" />),
  frame("O-09", "Onboarding fallback · check expired", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceLinkExpired} returnTo="/events" />),
  frame("O-10", "Onboarding fallback · account unavailable", () => <OnboardingJoin initial={ONBOARDING_VIEWS.unavailable} returnTo="/events" />),
  frame("O-11", "Face renewal · expired", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceExpired} returnTo="/events" />),
  frame("O-12", "Onboarding fallback · done", () => <OnboardingJoin initial={ONBOARDING_VIEWS.complete} returnTo="/e/ai-era" />),
  frame("O-13", "Onboarding fallback · signed out", () => <OnboardingJoin initial={ONBOARDING_VIEWS.signedOut} returnTo="/events" />),

  /* ── Event model v2: request to join, signed in (only what is missing, then one tap), 390 ── */
  frame("Q-01", "Request · one tap", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.oneTap} />),
  frame("Q-02", "Request · event questions", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.questions} />),
  frame("Q-03", "Request · question errors", () => (
    <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.questions} initialErrors={{ [QUESTION_IDS.why]: "Answer this question", [QUESTION_IDS.track]: "Choose an option", phone_number: "Add your phone number", eventConsent: "Tick the box to continue" }} />
  )),
  frame("Q-04", "Request · missing profile fields only", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.profile} />),
  frame("Q-05", "Request · face check first", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.face} />),
  frame("Q-06", "Request · face check expired", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.faceExpired} />),
  frame("Q-07", "Request · event extras (phone, age)", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.extras} />),
  frame("Q-08", "Request · below minimum age", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.extrasBelowMinimum} />),
  frame("Q-09", "Request · join the waitlist", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.waitlist} />),
  frame("Q-10", "Request sent · complete your profile", () => <DemoProfileSteps event={AI_ERA} registration={PENDING_REGISTRATION} onboarding={REQUEST_CONTEXTS.oneTap.onboarding} at="result" />),
  frame("Q-11", "Complete your profile · one screen per gap", () => (
    <DemoProfileSteps event={AI_ERA} registration={PENDING_REGISTRATION} onboarding={{ ...REQUEST_CONTEXTS.oneTap.onboarding, photoUrl: null }} photo={{ upload: savePhotoAction, remove: removePhotoAction }} at={0} />
  )),
  frame("Q-12", "Complete your profile · done", () => <DemoProfileSteps event={AI_ERA} registration={PENDING_REGISTRATION} onboarding={REQUEST_CONTEXTS.oneTap.onboarding} at="done" />),

  /* ── Desktop guest layouts (1440 × 900): centred cards and the request modal ── */
  frame("DG-01", "Desktop · status card", status("U-17"), 1440, 900),
  frame("DG-02", "Desktop · My events", () => <MyEventsScreen account={MARIA} events={MY_EVENTS} now={FIXED_NOW} />, 1440, 900),
  frame("DG-03", "Desktop · request to join modal", register("R-01"), 1440, 900),
  frame("DG-04", "Desktop · withdraw request modal", () => <CancelSheet event={AI_ERA} mode={{ mode: "withdraw" }} action={cancelAction} />, 1440, 900),
  frame("DG-05", "Desktop · onboarding fallback profile", () => <OnboardingJoin initial={ONBOARDING_VIEWS.profileResume} returnTo="/events" />, 1440, 900),
  frame("DG-06", "Desktop · onboarding fallback face", () => <OnboardingJoin initial={ONBOARDING_VIEWS.faceRequired} returnTo="/events" />, 1440, 900),
  frame("DG-07", "Desktop · request one tap", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.oneTap} />, 1440, 900),
  frame("DG-08", "Desktop · request questions", () => <RequestJoin event={AI_ERA} initial={REQUEST_CONTEXTS.questions} />, 1440, 900),
];

/** Every frame code this lane owns (the registry test iterates these). */
export const ACCOUNT_FRAME_CODES = accountFrames.map((f) => f.code);
