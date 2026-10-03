import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileScreen } from "../../../src/accounts/components/ProfileScreens";
import { accountLinks } from "../../../src/accounts/links";
import { previewCode } from "../../../src/accounts/preview";
import { getProfile } from "./data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your profile · Didit Events", robots: { index: false } };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await getProfile(previewCode(await searchParams));
  if (!account) redirect(accountLinks.login(accountLinks.profile()));
  return <ProfileScreen account={account} />;
}
