import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InviteScreen } from "../../../../../src/public/components/InviteScreen";
import { InviteMessage } from "../../../../../src/public/components/Messages";
import { startFromLinkAction } from "./actions";
import { getInvite } from "./data";
import { VerificationPreparing } from "../../../../../src/verification/Preparing";

type Props = { params: Promise<{ slug: string; token: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

// The token is a bearer secret: never index this page or send it on in a Referer header (plan §2 link_tokens).
export const metadata: Metadata = { title: "Your verification link · Didit Events", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function InviteRoute({ params, searchParams }: Props) {
  const { slug, token } = await params;
  const invite = await getInvite(slug, token);
  if (!invite) notFound();
  if (invite.state !== "valid") return <InviteMessage event={invite.event} state={invite.state} />;
  const preparing = (await searchParams)?.preparing;
  if (typeof preparing === "string") return <VerificationPreparing slug={slug} token={token} retryKey={preparing} action={startFromLinkAction} />;
  return <InviteScreen event={invite.event} firstName={invite.firstName} token={token} start={startFromLinkAction} />;
}
