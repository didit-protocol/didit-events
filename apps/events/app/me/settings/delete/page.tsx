import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeleteAccountSheet } from "../../../../src/accounts/components/AccountSheets";
import { accountLinks } from "../../../../src/accounts/links";
import { deleteAccountAction } from "./actions";
import { getDeletionImpact } from "./data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delete account · Didit Events", robots: { index: false } };

export default async function DeleteAccountPage() {
  const impact = await getDeletionImpact();
  if (!impact) redirect(accountLinks.login(accountLinks.deleteAccount()));
  return <DeleteAccountSheet upcoming={impact.upcoming} open={impact.open} action={deleteAccountAction} />;
}
