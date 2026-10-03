import type { Metadata } from "next";
import { LinkedScreen } from "../../src/accounts/components/LinkedScreen";
import { LoginFlow } from "../../src/accounts/components/LoginFlow";
import { initialsOf } from "../../src/accounts/components/StatusScreen";
import { accountLinks, safeNext } from "../../src/accounts/links";
import type { SignInStep } from "../../src/accounts/types";
import { requestInApp } from "../../src/auth/inapp-server";
import { signInAction } from "./actions";
import { LoginEscape } from "./LoginEscape";
import { CODE_TTL_MINUTES, currentGuest, eventForNext } from "./data";

export const metadata: Metadata = { title: "Sign in · Didit Events", robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** The first step from the URL: B2's OIDC callback returns here with ?error=… or ?reason=expired; the OIDC start sends
 * an in-app browser back with ?error=inapp (a real browser that opens such a link sees the plain sign-in). */
function initialStep(sp: Record<string, string | string[] | undefined>, inApp: boolean): SignInStep {
  const email = one(sp.email)?.slice(0, 254);
  const error = one(sp.error);
  if (error === "google_cancelled" || error === "google_failed") return { step: "choose", banner: error, email };
  if (error === "inapp" && inApp) return { step: "choose", banner: "inapp", email };
  if (one(sp.reason) === "expired") return { step: "choose", banner: "session_expired", email };
  if (one(sp.step) === "email") return { step: "email", email };
  return { step: "choose", email };
}

/**
 * Guest sign-in. One flow, mounted once: a full-screen sheet below 768px and the same sheet as a centred modal over
 * the dimmed event from 768px (GuestScreen's sheet layout does the switch in CSS). Two mounted copies, one per
 * breakpoint, each kept their own step, email and code, so rotating a tablet lost what was typed.
 */
export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next));
  const [event, inApp] = await Promise.all([eventForNext(next), requestInApp(accountLinks.login(next))]);

  if (one(sp.step) === "linked") {
    const guest = await currentGuest();
    if (guest) return <LinkedScreen email={guest.email} initials={initialsOf(guest)} next={next} />;
  }

  const initial = initialStep(sp, inApp !== null);
  // Hosts and staff arrive from /admin (next=/admin…): the sheet says so instead of the guest "request a place" copy.
  // Decided here, on the server, so the first paint already has its final title and lead.
  const admin = /^\/admin(?:[/?#]|$)/.test(next);
  const title = admin ? "Sign in to Didit Events admin" : event ? "Request to join" : "Sign in to Didit Events";
  const lead = admin ? "Sign in with your Didit Events account to manage events. No password." : undefined;
  const common = {
    action: signInAction,
    next,
    event,
    googleHref: accountLinks.google(next),
    inApp,
    codeMinutes: CODE_TTL_MINUTES,
    googlePending: one(sp.google) === "returning",
  };
  return (
    <>
      <LoginEscape next={next} />
      <LoginFlow layout="sheet" initial={initial} title={title} lead={lead} {...common} />
    </>
  );
}
