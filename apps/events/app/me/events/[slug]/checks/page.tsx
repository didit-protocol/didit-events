import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { RegistrationChecks } from "../../../../../src/accounts/components/RegistrationChecks";
import { CtaLink, EventChip, GuestScreen, Lead, MetGlyph, RowGroup, SecuredByDidit, Spacer, Title } from "../../../../../src/accounts/components/Screen";
import { initialsOf } from "../../../../../src/accounts/components/StatusScreen";
import { extraLabel, reasonCopy } from "../../../../../src/accounts/request-join";
import { displayName } from "../../../../../src/public/viewer-name";
import { getMyEvent } from "../data";

// Personal, session-bound page: never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Complete your checks · Didit Events", robots: { index: false } };

export default async function ChecksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getMyEvent(slug);
  if (page.kind !== "ok") notFound();
  const registration = page.status.registration;
  const status = `/me/events/${encodeURIComponent(slug)}`;
  if (!registration || registration.readiness === "ready") redirect(status);
  const { account } = page;
  return (
    <GuestScreen header="account" initials={initialsOf(account)} accountName={displayName(account)} account={account} labelledBy="checks-title">
      <EventChip event={page.event} />
      <Title id="checks-title">Your place is saved</Title>
      <Lead>Complete the checks from your original request before entering the event.</Lead>
      {registration.missing.length ? (
        <RowGroup title="CHECKS TO COMPLETE" rows={registration.missing.map((m) => ({ key: m.check, label: extraLabel(m), detail: reasonCopy(m.reason), action: <MetGlyph met={false} /> }))} />
      ) : null}
      <Spacer />
      {registration.readiness === "legacy_completion" ? <CtaLink href={`/onboarding?returnTo=${encodeURIComponent(status)}`}>Complete your profile</CtaLink> : <RegistrationChecks registration={registration} />}
      <CtaLink href={status} secondary>
        Back to event status
      </CtaLink>
      <SecuredByDidit />
    </GuestScreen>
  );
}
