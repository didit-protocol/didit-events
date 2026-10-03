import type { Metadata } from "next";
import { previewCode } from "../../../../../src/accounts/preview";
import { CancelRoute } from "./CancelRoute";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Cancel your place · Didit Events", robots: { index: false } };

export default async function CancelPage({ params, searchParams }: Props) {
  return <CancelRoute slug={(await params).slug} intent="cancel" preview={previewCode(await searchParams)} />;
}
