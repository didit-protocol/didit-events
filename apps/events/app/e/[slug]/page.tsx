import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventPage } from "../../../src/public/components/EventPage";
import { GateMessage } from "../../../src/public/components/Messages";
import { SimpleEventPage } from "../../../src/public/components/SimpleEventPage";
import { longDate, timeRange, venueLabel } from "../../../src/public/format";
import { ogImagePath } from "../../../src/public/og";
import { requestAction, signOutAction, subscribeAction, verifyAction } from "./actions";
import { getEvent, getEventPage, getJoinInitial } from "./data";
import { getProfile } from "../../events/data";
import { JoinLauncher } from "../../../src/accounts/components/join/JoinLauncher";
import { signInAction } from "../../login/actions";
import { removePhotoAction, savePhotoAction } from "../../me/profile/photo/actions";
import { keepAccountAction } from "../../me/deleting/actions";
import { VerificationPreparing } from "../../../src/verification/Preparing";
import { staffViewer } from "../../../src/server/b4-policy";
import { joinHref } from "../../../src/accounts/links";
import { requestInApp } from "../../../src/auth/inapp-server";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEvent((await params).slug);
  if (!event) return { title: "Event not found · Didit Events" };
  const name = [event.title, event.accent].filter(Boolean).join(" ");
  const description = `${longDate(event.startsAt, event.timeZone)}, ${timeRange(event.startsAt, event.endsAt, event.timeZone)} · ${venueLabel(event.venue)}. ${event.summary}`;
  // Relative URLs resolve against metadataBase (APP_URL) to absolute og:image / twitter:image.
  const image = { url: ogImagePath(event), width: 1200, height: 630, alt: name, type: "image/png" };
  return { title: `${name} · Didit Events`, description, openGraph: { title: name, description, type: "website", images: [image] }, twitter: { card: "summary_large_image", title: name, description, images: [image] } };
}

export default async function EventRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const { preview, preparing, join } = await searchParams;
  if (typeof preparing === "string") return <VerificationPreparing slug={slug} retryKey={preparing} action={verifyAction} />;
  const now = new Date();
  const data = await getEventPage(slug, now, typeof preview === "string" ? preview : undefined);
  if (!data) notFound();

  if (data.template === "simple") {
    // A signed-in guest who already asked sees their status; otherwise the gate (closed/full/ended) replaces the form.
    if (data.card) return <SimpleEventPage event={data.event} action={requestAction} card={data.card} cardActions={{ verify: verifyAction, subscribe: subscribeAction }} />;
    if (data.gate !== "open") return <GateMessage event={data.event} gate={data.gate} />;
    return <SimpleEventPage event={data.event} action={requestAction} viewer={data.viewer} staff={data.viewer ? null : await staffViewer()} signOut={signOutAction} />;
  }
  // Flow v3: ?join=1 opens the join modal over the page (sign in, missing details, face, request).
  const joining = join === "1";
  // Independent of each other: read together, not one after another inside the JSX.
  const [staff, presenter, initial, inApp] = await Promise.all([data.viewer ? null : staffViewer(), presenterOf(), joining ? getJoinInitial(slug, now) : null, joining ? requestInApp(joinHref(slug)) : null]);
  return (
    <EventPage
      event={data.event}
      related={data.related}
      viewer={data.viewer}
      staff={staff}
      card={data.card}
      now={now}
      actions={{ verify: verifyAction, subscribe: subscribeAction }}
      presenter={presenter}
      join={<JoinLauncher event={data.event} open={joining} initial={initial} signIn={signInAction} inApp={inApp} photo={{ upload: savePhotoAction, remove: removePhotoAction }} keepAccount={keepAccountAction} />}
    />
  );
}

/** The calendar header's name + tagline (the saved /admin/calendar row wins; built-in copy otherwise). */
async function presenterOf(): Promise<{ name: string; tagline: string }> {
  const profile = await getProfile();
  return { name: profile.name, tagline: profile.showTagline === false ? "" : profile.tagline };
}
