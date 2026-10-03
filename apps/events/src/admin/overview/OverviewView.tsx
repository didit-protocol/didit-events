import { Banner, ClientButtonLink, EmptyState, StatTile, StatusPill, Tag, initials } from "@didit-events/ui";
import { adminLinks } from "../links";
import { RESULTS } from "../log/results";
import { arrivalTime, banner, chart, funnel, isEmptyOverview, peak, phaseOf, tiles, type OverviewPhase } from "./model";
import type { DoorPanelKiosk, OverviewData } from "./types";
import s from "./Overview.module.css";

const ADD_PERSON_48 = (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6" />
  </svg>
);

export interface OverviewViewProps {
  data: OverviewData;
  now: Date;
  /** A-17 live door panel under the funnel (live events with paired kiosks). The drawn A-04 frames predate it. */
  doorPanel?: boolean;
}

/** A-04 Overview: before the event (b), live (a), ended (c), or no guests yet (e). A-04d is `OverviewLoading`. */
export function OverviewView({ data, now, doorPanel }: OverviewViewProps) {
  const phase = phaseOf(data, now);
  const note = banner(data, phase, now);
  // A cancelled event with nobody on it says so: "Add guests" would be the wrong invitation.
  if (isEmptyOverview(data) && phase === "cancelled") return <Banner tone="info" className={`${s.banner} ${s.neutral}`}>{note!.text}</Banner>;
  if (isEmptyOverview(data)) {
    return (
      <EmptyState
        className={s.empty}
        icon={ADD_PERSON_48}
        title="No guests yet."
        description="Add people directly or share the request link."
        action={<ClientButtonLink href={`${adminLinks.tab(data.eventId, "guests")}?add=one`}>Add guests</ClientButtonLink>}
      />
    );
  }
  const bars = chart(data, phase, now);
  const steps = funnel(data);
  return (
    <>
      {note ? (
        <Banner tone="info" className={`${s.banner} ${note.tone === "neutral" ? s.neutral : ""}`}>
          {note.text}
        </Banner>
      ) : null}
      <div className={s.tiles} data-count={phase === "cancelled" ? 4 : undefined}>
        {tiles(data, phase).map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} delta={t.delta} deltaTone={t.tone} />
        ))}
      </div>
      <section className={`${s.card} ${s.funnel}`} aria-labelledby="funnel-title">
        <h2 id="funnel-title" className={s.eyebrow}>
          Funnel
        </h2>
        <ol className={s.steps}>
          {steps.map((f) => (
            <li key={f.label} className={s.step}>
              <div className={s.track} aria-hidden="true">
                <div className={s.fill} style={{ width: `${f.pct}%`, opacity: 0.35 + f.pct / 160 }} />
              </div>
              <div className={s.stepText}>
                <span>{f.label}</span>
                <b>{f.value}</b>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {doorPanel && phase === "live" && data.doors.length ? <DoorPanel doors={data.doors} timeZone={data.timeZone} /> : null}
      <div className={s.bottom}>
        <section className={`${s.card} ${s.chartCard}`} aria-labelledby="arrivals-chart-title">
          <div className={s.cardHead}>
            <h2 id="arrivals-chart-title" className={s.eyebrow}>
              Arrivals · 15-minute buckets
            </h2>
            <span className={s.peak}>Peak {peak(bars)}</span>
          </div>
          <ol className={s.bars} aria-label="Check-ins per 15 minutes">
            {bars.map((b) => (
              <li
                key={b.label}
                className={s.bar}
                style={{ height: Math.max(2, b.count * 8) }}
                data-zero={b.count === 0 ? "" : undefined}
                data-live={b.live ? "" : undefined}
                aria-label={`${b.label}: ${b.count}`}
              />
            ))}
          </ol>
          <div className={s.axis} aria-hidden="true">
            {bars.map((b) => (
              <span key={b.label}>{b.label}</span>
            ))}
          </div>
        </section>
        <ArrivalsFeed data={data} phase={phase} />
      </div>
    </>
  );
}

function ArrivalsFeed({ data, phase }: { data: OverviewData; phase: OverviewPhase }) {
  return (
    <section className={`${s.card} ${s.feedCard}`} aria-labelledby="arrivals-title">
      <div className={s.cardHead}>
        <h2 id="arrivals-title" className={s.eyebrow}>
          Arrivals
        </h2>
        {phase === "live" ? <span className={s.liveTag}>LIVE</span> : null}
      </div>
      {data.arrivals.length ? (
        <ol className={s.feed} aria-live={phase === "live" ? "polite" : undefined}>
          {data.arrivals.map((a) => (
            <li key={a.id} className={s.arrival} data-fresh={phase === "live" ? "" : undefined}>
              <span className={s.avatar} aria-hidden="true">
                {initials(a.name)}
              </span>
              <div className={s.who}>
                <b>{a.name}</b>
                <span>Checked in at {a.door}</span>
              </div>
              <time className={s.time} dateTime={a.at}>
                {arrivalTime(a.at, data.timeZone)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <div className={s.feedEmpty}>
          <b>{phase === "cancelled" ? "No arrivals." : "No arrivals yet."}</b>
          <span>{phase === "cancelled" ? "The event was cancelled before anyone checked in." : "Guests appear here the moment the kiosk welcomes them."}</span>
        </div>
      )}
    </section>
  );
}

const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));

/** A-17 Live door panel: a compact card per kiosk (online / paused, strict / supervised) with its last five results. */
export function DoorPanel({ doors, timeZone }: { doors: DoorPanelKiosk[]; timeZone: string }) {
  return (
    <section className={`${s.card} ${s.doors}`} aria-labelledby="doors-title">
      <h2 id="doors-title" className={s.eyebrow}>
        Doors
      </h2>
      <ul className={s.doorGrid}>
        {doors.map((k) => (
          <li key={k.id} className={s.door}>
            <div className={s.doorHead}>
              <span className={s.doorName}>{k.name}</span>
              {!k.scanning ? <StatusPill status="ended">Face check-in off</StatusPill> : <StatusPill status={k.online ? "live" : "missing"}>{k.online ? "Online" : "Offline"}</StatusPill>}
              <Tag tone={k.mode === "strict" ? "feature" : "soft"}>{k.mode === "strict" ? "Strict" : "Supervised"}</Tag>
            </div>
            {k.recent.length ? (
              <ol className={s.results} aria-label={`Last results at ${k.name}`}>
                {k.recent.slice(0, 5).map((r) => (
                  <li key={r.id} className={s.result}>
                    <Tag tone={RESULTS[r.result].tone}>{RESULTS[r.result].label}</Tag>
                    <span className={s.guest}>{r.guest ?? ""}</span>
                    <time dateTime={r.at}>{time(r.at, timeZone)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={s.doorNote}>{k.scanning ? "No scans yet." : "Paused by staff. Guests see “Please see the team at the desk”."}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A-04d: five tile skeletons, the funnel bar and the two chart boxes (the header stays from the layout). */
export function OverviewLoading() {
  return (
    <>
      <div className={s.skTiles} aria-busy="true" aria-label="Loading overview">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} />
        ))}
      </div>
      <div className={s.skFunnel} aria-hidden="true" />
      <div className={s.skBottom} aria-hidden="true">
        <span />
        <span />
      </div>
    </>
  );
}
