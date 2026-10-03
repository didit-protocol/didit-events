import { guestPage } from "../../../src/auth/access";
import { currentGuest } from "../../../src/accounts/session";
import { clearSession } from "../../../src/auth/actions";
import { identity } from "../../../src/auth/runtime";
export const getSettings = () => currentGuest("/me/settings");
export async function signOut() { await identity.sessions.revoke((await guestPage("/me/settings")).sessionId); await clearSession(); }
export async function setMarketing(on: boolean) { await identity.profile.preference(await guestPage("/me/settings"), on); }
export async function disconnectGoogle() { await identity.profile.disconnectGoogle(await guestPage("/me/settings", 900)); await clearSession(); }
