import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FRAMES_APP, FrameIndex, framesEnabled } from "../../frames";

// The folder is `%5Fframes` because Next.js treats `_frames` as a private (non-routed) folder; the URL is /_frames.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Frames", robots: { index: false, follow: false } };

export default function FramesIndexPage() {
  if (!framesEnabled()) notFound();
  return <FrameIndex app={FRAMES_APP} />;
}
