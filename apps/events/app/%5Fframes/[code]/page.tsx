import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FRAMES_APP, FrameView, framesEnabled, getFrame } from "../../../frames";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Frame", robots: { index: false, follow: false } };

export default async function FramePage({ params }: { params: Promise<{ code: string }> }) {
  if (!framesEnabled()) notFound();
  const { code } = await params;
  const decoded = decodeURIComponent(code);
  if (!getFrame(decoded, FRAMES_APP)) notFound();
  return <FrameView app={FRAMES_APP} code={decoded} />;
}
