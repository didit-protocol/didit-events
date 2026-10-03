import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsScreen } from "../../../src/accounts/components/SettingsScreen";
import { accountLinks } from "../../../src/accounts/links";
import { disconnectGoogleAction, signOutAction, signOutAllAction, toggleMarketingAction } from "./actions";
import { getSettings } from "./data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · Didit Events", robots: { index: false } };

export default async function SettingsPage() {
  const account = await getSettings();
  if (!account) redirect(accountLinks.login(accountLinks.settings()));
  return <SettingsScreen account={account} actions={{ signOutAll: signOutAllAction, signOut: signOutAction, toggleMarketing: toggleMarketingAction, disconnectGoogle: disconnectGoogleAction }} />;
}
