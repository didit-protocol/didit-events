import { DEFAULT_STAFF_EMAIL_DOMAIN, isStaffEmail, staffEmailDomains } from "./staff-email.ts";

/** No built-in OIDC client: Google sign-in is off until DIDIT_OIDC_CLIENT_ID and DIDIT_OIDC_CLIENT_SECRET are set. */
export const DEFAULT_OIDC_CLIENT_ID = "";
/** A placeholder that exists in no Didit application, for the tests and the local fake server. An instance sets DIDIT_FACE_WORKFLOW_ID (requireInstanceIdentity). */
export const DEFAULT_FACE_WORKFLOW_ID = "00000000-0000-4000-8000-00000000face";
export const DEFAULT_SEED_OWNER_EMAIL = "events.owner@didit.me";

/** Explicit empty identifiers are preserved; only an unset variable selects the default above. */
export const oidcClientId = (env = process.env): string => env.DIDIT_OIDC_CLIENT_ID ?? DEFAULT_OIDC_CLIENT_ID;
export const faceWorkflowId = (env = process.env): string => env.DIDIT_FACE_WORKFLOW_ID ?? DEFAULT_FACE_WORKFLOW_ID;

/** Forks excluding the default domain must choose an owner who can authenticate. */
export function seedOwnerEmail(env = process.env): string {
  if (env.SEED_OWNER_EMAIL === undefined) {
    if (!staffEmailDomains(env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_EMAIL_DOMAIN).includes(DEFAULT_STAFF_EMAIL_DOMAIN)) {
      throw new Error("SEED_OWNER_EMAIL is required when STAFF_EMAIL_DOMAIN excludes didit.me");
    }
    return DEFAULT_SEED_OWNER_EMAIL;
  }
  const email = env.SEED_OWNER_EMAIL.trim().toLowerCase();
  if (email.length > 254 || !isStaffEmail(email, staffEmailDomains(env.STAFF_EMAIL_DOMAIN ?? DEFAULT_STAFF_EMAIL_DOMAIN))) {
    throw new Error("SEED_OWNER_EMAIL must be an email in STAFF_EMAIL_DOMAIN");
  }
  return email;
}

/**
 * An instance names its own staff domain, first owner, liveness workflow, sender and email footer: nothing here can be borrowed from
 * another deployment. Called by the entry points (db:migrate, seed, the Docker migration, server start), so nothing is
 * created or served without them.
 */
export function requireInstanceIdentity(env = process.env): void {
  const needed: Record<string, string> = {
    STAFF_EMAIL_DOMAIN: "your team's email domain",
    SEED_OWNER_EMAIL: "your own address on that domain",
    DIDIT_FACE_WORKFLOW_ID: "the id of the liveness workflow in your Didit application (README, Didit setup, step 2)",
  };
  const missing = Object.keys(needed).filter(name => !env[name]?.trim()).map(name => `${name}: ${needed[name]}`);
  if (env.RESEND_API_KEY?.trim() && !env.EMAIL_FROM?.trim()) missing.push("EMAIL_FROM: a sender on a domain verified in Resend (needed because RESEND_API_KEY is set)");
  if (env.RESEND_API_KEY?.trim() && !env.EMAIL_FOOTER?.trim()) missing.push("EMAIL_FOOTER: your organization's name and postal address, the line under every email (needed because RESEND_API_KEY is set)");
  if (missing.length) {
    throw new Error(`Not configured. Set in apps/events/.env.local or the environment:\n  ${missing.join("\n  ")}\nSee "Quick start" in the README.`);
  }
  seedOwnerEmail(env);
}
