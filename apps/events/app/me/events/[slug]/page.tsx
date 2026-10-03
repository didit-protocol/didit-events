import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StatusScreen } from "../../../../src/accounts/components/StatusScreen";
import { RefreshOnReturn } from "../../../../src/accounts/components/RefreshOnReturn";
import { accountLinks } from "../../../../src/accounts/links";
import { previewCode } from "../../../../src/accounts/preview";
import { getMyEvent } from "./data";
import { statusActions } from "./status-actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "My registration · Didit Events", robots: { index: false } };

export default async function MyEventRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = await getMyEvent(slug, {
    preview: previewCode(sp),
    requested: sp.requested === "1",
    cancelled: typeof sp.cancelled === "string" ? sp.cancelled : undefined,
    withdrawn: sp.withdrawn === "1",
  });
  if (page.kind === "not_found") notFound();
  if (page.kind === "sign_in") redirect(accountLinks.login(accountLinks.myEvent(slug)));
  if (page.kind === "not_registered") redirect(accountLinks.register(slug));
  return (
    <>
      <StatusScreen event={page.event} account={page.account} status={page.status} actions={statusActions} now={new Date()} />
      <RefreshOnReturn />
    </>
  );
}
