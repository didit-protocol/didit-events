import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { CsrfProvider } from "../src/auth/CsrfField";
import { pendingDeletion } from "../src/accounts/deletion";
import { DeletionBannerSlot } from "../src/accounts/components/DeletionBannerSlot";
import { keepAccountAction } from "./me/deleting/actions";
import { inter } from "@didit-events/ui/fonts";
import "@didit-events/ui/tokens.css";
import { DEFAULT_OG_IMAGE } from "../src/public/og";

export const metadata: Metadata = {
  // Absolute URLs for og:image and friends (the event OG cover route).
  metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
  title: "Didit Events",
  description: "Event registration and guest check-in, verified by Didit.",
  openGraph: { images: [DEFAULT_OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [DEFAULT_OG_IMAGE] },
};

/** Phones: device width, no zoom lock (accessibility), content under the notch handled by env(safe-area-inset-*). */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Read on every render, including the layout refresh after an action rotates cookies.
  const csrf = (await cookies()).get("__Host-csrf")?.value ?? "";
  // v5: while this browser's account deletion is in its grace period, every page offers "Keep my account".
  const deleting = await pendingDeletion();
  return (
    <html lang="en" className={inter.variable}>
      <body><CsrfProvider token={csrf}>{deleting ? <DeletionBannerSlot graceUntil={deleting.graceUntil} action={keepAccountAction} /> : null}{children}</CsrfProvider></body>
    </html>
  );
}
