import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerificationScreen } from "../../../../src/accounts/components/ProfileScreens";
import { accountLinks } from "../../../../src/accounts/links";
import { deleteVerificationAction } from "./actions";
import { getVerification } from "./data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verification · Didit Events", robots: { index: false } };

export default async function VerificationPage() {
  const account = await getVerification();
  if (!account) redirect(accountLinks.login(accountLinks.verification()));
  return <VerificationScreen account={account} deleteData={deleteVerificationAction} />;
}
