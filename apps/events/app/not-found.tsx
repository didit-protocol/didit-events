import type { Metadata } from "next";
import { ButtonLink, EmptyState } from "@didit-events/ui";

export const metadata: Metadata = { title: "Page not found · Didit Events", robots: { index: false } };

/** Unknown URLs: the same calm message as the other dead ends, with a way back to the calendar. */
export default function NotFound() {
  return (
    <main style={{ width: "min(560px, calc(100% - 32px))", margin: "64px auto" }}>
      <EmptyState title="We couldn’t find this page" description="The link may be old or mistyped." action={<ButtonLink variant="secondary" href="/events">Explore events</ButtonLink>} />
    </main>
  );
}
