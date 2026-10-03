import { LoginFlow } from "../../accounts/components/LoginFlow";
import { accountLinks } from "../../accounts/links";
import { signInAction } from "../../../app/login/actions";
import { safeNext, type LoginError } from "./signin";

export interface SignInScreenProps { error?: LoginError; next: string; pending?: boolean; fill?: boolean }
/** Historical gallery entry reuses the single account sign-in implementation. */
export function SignInScreen({ error, next, pending }: SignInScreenProps) {
  next = safeNext(next);
  return <LoginFlow layout="modal" title="Sign in to Didit Events" action={signInAction} next={next}
    googleHref={accountLinks.google(next)} signingIn={pending} codeMinutes={5}
    initial={{ step: "choose", ...(error ? { banner: error === "expired" ? "session_expired" : "google_failed" } as const : {}) }} />;
}
