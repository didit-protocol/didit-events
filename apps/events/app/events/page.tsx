import type { Metadata } from "next";
import { CalendarPage } from "../../src/public/components/CalendarPage";
import { subscribeAction, verifyAction } from "../e/[slug]/actions";
import { getCalendar, getProfile, getViewer } from "./data";
import { DEFAULT_OG_IMAGE } from "../../src/public/og";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Title and description follow the calendar profile edited in /admin/calendar. */
export async function generateMetadata(): Promise<Metadata> {
  const profile = await getProfile();
  const images = profile.coverUrl?.startsWith("/api/calendar/") ? [{ url: profile.coverUrl }] : [DEFAULT_OG_IMAGE];
  return { title: profile.name, description: profile.description, openGraph: { title: profile.name, description: profile.description, images },
    twitter: { card: "summary_large_image", title: profile.name, description: profile.description, images } };
}

/** P-03 calendar: Upcoming (default) and Past (?when=past). */
export default async function EventsRoute({ searchParams }: Props) {
  const tab = (await searchParams).when === "past" ? "past" : "upcoming";
  const [{ calendar, events }, viewer] = await Promise.all([getCalendar(tab, new Date()), getViewer()]);
  return <CalendarPage calendar={calendar} tab={tab} events={events} viewer={viewer} actions={{ verify: verifyAction, subscribe: subscribeAction }} />;
}
