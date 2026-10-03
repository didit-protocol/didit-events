import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { joinHref } from "../../../../src/accounts/links";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Request to join · Didit Events", robots: { index: false } };

/** Flow v3: the request lives in the event page's join modal; old links (emails, bookmarks) land there. */
export default async function RegisterRoute({ params }: Props) {
  redirect(joinHref((await params).slug));
}
