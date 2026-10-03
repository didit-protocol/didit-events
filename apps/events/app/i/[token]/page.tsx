import type { Metadata } from "next";
import { InviteScreen } from "../../../src/accounts/components/InviteScreen";
import { initialsOf } from "../../../src/accounts/components/StatusScreen";
import { previewCode } from "../../../src/accounts/preview";
import { acceptInviteAction } from "./actions";
import { getInvite } from "./data";

export const metadata: Metadata = { title: "You are invited · Didit Events", robots: { index: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { view, guest } = await getInvite(token, previewCode(await searchParams));
  return <InviteScreen view={view} token={token} accept={acceptInviteAction} initials={guest ? initialsOf(guest) : undefined} />;
}
