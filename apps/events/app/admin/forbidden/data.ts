import { cookies } from "next/headers";
import { COOKIE_NAMES } from "@didit-events/core/http/policy";
import { identity } from "../../../src/auth/runtime";
import { photoSrc } from "../../../src/accounts/photo";

/** The account that is signed in but has no staff access (name and photo when the account has them). */
export interface NonStaffIdentity { email: string; name?: string; photoUrl?: string }

/** A guest identity is optional: A-13b also renders after a rejected staff sign-in. */
export async function getNonStaffIdentity(): Promise<NonStaffIdentity | null> {
  const cookie = (await cookies()).get(COOKIE_NAMES.session)?.value;
  if (!cookie) return null;
  const session = await identity.sessions.resolve(cookie);
  if (!session) return null;
  if (session.principal === "staff" && session.staffEmail) return { email: session.staffEmail };
  if (!session.accountId) return null;
  const account = await identity.accounts.get(session.accountId);
  if (!account) return null;
  const a = account as { email: string; firstName?: string | null; lastName?: string | null; photoUrl?: string | null; updatedAt?: Date | null };
  const name = [a.firstName, a.lastName].map((x) => x?.trim()).filter(Boolean).join(" ");
  return { email: a.email, name: name || undefined, photoUrl: photoSrc(a.photoUrl, a.updatedAt) };
}
