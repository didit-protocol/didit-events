import { redirect } from "next/navigation";
import { accountLinks } from "../../src/accounts/links";

/** /me is the guest's home: My events. */
export default function MePage() {
  redirect(accountLinks.myEvents());
}
