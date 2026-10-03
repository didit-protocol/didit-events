import { ButtonLink, CopyField, SearchField, SegmentedNav } from "@didit-events/ui";
import { adminLinks } from "../links";
import { ApplicantsReview, type ApplicantsFrameState, type ApplicantsReviewProps } from "./ApplicantsReview";
import { applicantsHref, listState } from "./query";
import { SegCount } from "./SegCount";
import { APPLICANT_TABS, type ApplicantCounts, type ApplicantQuery, type ApplicantRow, type ApplicantsEvent, type SignalFilter, type SignInFilter } from "./types";
import s from "./Applicants.module.css";

const INBOX_44 = "M4 4h16v12H5.2L4 17.5zM8 9h8M8 12h5";
const SEARCH_44 = "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5";

const SIGN_IN: { key: SignInFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "google", label: "Google" },
  { key: "email", label: "Email code" },
];
const SIGNAL: { key: SignalFilter; label: string }[] = [
  { key: "all", label: "All signals" },
  { key: "verified-before", label: "Verified before" },
  { key: "returning", label: "Attended before" },
  { key: "duplicate", label: "Possible duplicate" },
  { key: "new", label: "New account" },
];

export interface ApplicantsViewProps {
  eventId: string;
  query: ApplicantQuery;
  counts: ApplicantCounts;
  /** Null while loading (AP-23). */
  rows: ApplicantRow[] | null;
  event: ApplicantsEvent;
  frame?: ApplicantsFrameState;
  inline?: boolean;
  /** The page only: hosts the `?applicant=` drawer over the list (see `ApplicantsReview`). */
  drawer?: ApplicantsReviewProps["drawer"];
}

/** AP-01…AP-25 tab body: the toolbar (segments, search, filters, capacity) and the review table. */
export function ApplicantsView({ eventId, query, counts, rows, event, frame, inline, drawer }: ApplicantsViewProps) {
  const base = adminLinks.tab(eventId, "applicants");
  const list = listState(query);
  const signIn = SIGN_IN.find((x) => x.key === query.signIn)!;
  const signal = SIGNAL.find((x) => x.key === query.signal)!;
  const full = event.approved >= event.capacity;
  const toolbar = (
    <div className={s.toolbar}>
      <SegmentedNav
        label="Applicant status"
        className={s.seg}
        items={APPLICANT_TABS.map((t) => ({
          href: applicantsHref(eventId, { ...list, tab: t.key }),
          current: query.tab === t.key,
          label: (
            <>
              {t.label} <span className={s.segCount}><SegCount tab={t.key} count={counts[t.key]} /></span>
            </>
          ),
        }))}
      />
      <form role="search" action={base} className={s.search}>
        {query.tab !== "pending" ? <input type="hidden" name="tab" value={query.tab} /> : null}
        <SearchField key={query.q} name="q" label="Search applicants" placeholder="Search applicants" defaultValue={query.q} />
      </form>
      <details className={s.filter}>
        <summary>Sign-in: {signIn.key === "all" ? "All" : signIn.label} ▾</summary>
        <div className={s.filterPanel}>
          {SIGN_IN.map((o) => (
            <a key={o.key} href={applicantsHref(eventId, { ...list, signIn: o.key })} aria-current={o.key === query.signIn || undefined}>
              {o.label}
            </a>
          ))}
        </div>
      </details>
      <details className={s.filter}>
        <summary>{query.signal === "all" ? "Signals" : signal.label} ▾</summary>
        <div className={s.filterPanel}>
          {SIGNAL.map((o) => (
            <a key={o.key} href={applicantsHref(eventId, { ...list, signal: o.key })} aria-current={o.key === query.signal || undefined}>
              {o.label}
            </a>
          ))}
        </div>
      </details>
      <span className={s.spacer} />
      <div className={s.meter}>
        <div className={s.meterLabel}>
          <span id="ap-cap">Approved</span>
          <b>
            {event.approved} / {event.capacity}
          </b>
        </div>
        <div className={s.meterTrack} role="meter" aria-labelledby="ap-cap" aria-valuemin={0} aria-valuemax={event.capacity} aria-valuenow={event.approved} aria-valuetext={`${event.approved} of ${event.capacity} places`}>
          <div className={s.meterFill} data-full={full ? "" : undefined} style={{ width: `${Math.min(100, (event.approved / event.capacity) * 100)}%` }} />
        </div>
      </div>
    </div>
  );

  const searching = query.q !== "" || query.signIn !== "all" || query.signal !== "all";
  const empty = searching ? (
    <div className={s.empty}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <path d={SEARCH_44} />
      </svg>
      <h3 className={s.emptyTitle}>{query.q ? `No applicants match “${query.q}”.` : "No applicants match these filters."}</h3>
      <p className={s.emptyHelp}>Search covers name, email, company and answers.</p>
      <ButtonLink variant="secondary" className={s.emptyCta} href={applicantsHref(eventId, { tab: query.tab })}>
        Clear search
      </ButtonLink>
    </div>
  ) : (
    <div className={s.empty}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <path d={INBOX_44} />
      </svg>
      <h3 className={s.emptyTitle}>{query.tab === "pending" ? "No pending requests." : `No ${APPLICANT_TABS.find((t) => t.key === query.tab)!.label.toLowerCase()} applicants.`}</h3>
      <p className={s.emptyHelp}>New requests appear here the moment someone confirms their email. Share the link to get more.</p>
      <CopyField className={s.emptyCopy} label="Public request link" value={`https://${event.requestLink}`} display={event.requestLink} />
    </div>
  );

  return <ApplicantsReview eventId={eventId} query={query} rows={rows} event={event} counts={counts} toolbar={toolbar} empty={empty} frame={frame} inline={inline} drawer={drawer} />;
}
