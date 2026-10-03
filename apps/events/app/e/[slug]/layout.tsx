import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { eventExists } from "./data";

/**
 * /e/<unknown> is a real HTTP 404. The pages below sit inside loading boundaries: by the time their own notFound()
 * runs the skeleton has been sent with a 200. This layout is above those boundaries, so its notFound() sets the status
 * (app/e/not-found.tsx shows the same "We can't find this event" page).
 */
export default async function EventLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  if (!(await eventExists((await params).slug))) notFound();
  return children;
}
