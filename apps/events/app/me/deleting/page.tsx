import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeletingScreen } from "../../../src/accounts/components/DeletingScreen";
import { pendingDeletion } from "../../../src/accounts/deletion";
import { accountLinks, safeNext } from "../../../src/accounts/links";
import { keepAccountAction } from "./actions";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account is being deleted · Didit Events", robots: { index: false } };

/** v5: where /me/* lands while this browser's account deletion is in its grace period. */
export default async function DeletingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pending = await pendingDeletion();
  const { next } = await searchParams;
  const back = safeNext(typeof next === "string" ? next : undefined, accountLinks.myEvents());
  if (!pending) redirect(back);
  return <DeletingScreen graceUntil={pending.graceUntil} action={keepAccountAction} next={back} />;
}
