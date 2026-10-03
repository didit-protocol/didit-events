import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingJoin } from "../../src/accounts/components/join/OnboardingJoin";
import { GuestScreen } from "../../src/accounts/components/Screen";
import { joinHref, joinSlug } from "../../src/accounts/links";
import { getViewer } from "../e/[slug]/data";
import { getOnboarding } from "./data";

export const metadata: Metadata = { title: "Your account · Didit Events", robots: { index: false } };

/**
 * Deep-link fallback only (flow v3): the guest journey never sends anyone here from an event (sign-in returns to the
 * event's join modal). A direct link renders the same modal content full page, with the site header: only the missing
 * profile fields, the face when there is none, then back to where they were going.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const target = typeof params.returnTo === "string" ? params.returnTo : typeof params.next === "string" ? params.next : undefined;
  const slug = target ? joinSlug(target) : null;
  if (slug) redirect(joinHref(slug));
  const [view, viewer] = await Promise.all([getOnboarding(target), getViewer()]);
  return (
    <GuestScreen labelledBy="onboarding-title" account={viewer ?? undefined}>
      <OnboardingJoin initial={view} returnTo={view.returnTo} />
    </GuestScreen>
  );
}
