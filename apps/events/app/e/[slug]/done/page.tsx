import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OutcomeMessage } from "../../../../src/public/components/Messages";
import { verifyAction } from "../actions";
import { getViewer } from "../data";
import { getOutcome } from "./data";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Verification · Didit Events", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function DoneRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const raw = sp.verificationSessionId ?? sp.session;
  // The guest is signed in here: keep the site header (nav, avatar menu) of the screens before and after.
  const [outcome, viewer, h] = await Promise.all([getOutcome(slug, typeof raw === "string" ? raw : undefined), getViewer(), headers()]);
  if (!outcome) notFound();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "events.didit.me"}`;
  return <OutcomeMessage event={outcome.event} state={outcome.state} attemptsLeft={outcome.attemptsLeft} verify={verifyAction} origin={origin} viewer={viewer} />;
}
