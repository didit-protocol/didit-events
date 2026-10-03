import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MyEventsScreen } from "../../../src/accounts/components/MyEvents";
import { RefreshOnReturn } from "../../../src/accounts/components/RefreshOnReturn";
import { accountLinks } from "../../../src/accounts/links";
import { previewCode } from "../../../src/accounts/preview";
import { getMyEvents } from "./data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My events · Didit Events", robots: { index: false } };

export default async function MyEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const data = await getMyEvents(previewCode(await searchParams));
  if (!data) redirect(accountLinks.login(accountLinks.myEvents()));
  return (
    <>
      <MyEventsScreen account={data.account} events={data.events} now={new Date()} />
      <RefreshOnReturn />
    </>
  );
}
