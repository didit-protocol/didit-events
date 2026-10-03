import { getVerificationRuntime } from "@didit-events/core";
import { currentGuest } from "../../../../src/accounts/session";
import { guestPage } from "../../../../src/auth/access";
export const getVerification = () => currentGuest("/me/profile/verification");

export async function deleteVerificationData(): Promise<"queued" | "sign_in"> {
  const principal = await guestPage("/me/profile/verification", 900);
  await getVerificationRuntime().requestEvidenceDeletion(principal);
  return "queued";
}
