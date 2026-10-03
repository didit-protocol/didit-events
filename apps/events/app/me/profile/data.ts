import { currentGuest } from "../../../src/accounts/session";
import type { GuestAccount } from "../../../src/accounts/types";

export async function getProfile(_preview?: string): Promise<GuestAccount | null> {
  return currentGuest("/me/profile");
}
