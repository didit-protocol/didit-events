import type { Metadata } from "next";
import { previewCode } from "../../../../../src/accounts/preview";
import { CancelRoute } from "../cancel/CancelRoute";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Withdraw your request · Didit Events", robots: { index: false } };

export default async function WithdrawPage({ params, searchParams }: Props) {
  return <CancelRoute slug={(await params).slug} intent="withdraw" preview={previewCode(await searchParams)} />;
}
