"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Drawer, Skeleton, Tag, type TagTone } from "@didit-events/ui";
import { safeHttpsUrl } from "../form/url";
import { fmtWhen } from "../person/format";
import { Kv, muted, PersonAvatar, PersonSubtitle, PersonSubtitlePreview, PersonTitle, Section, type Row } from "../person/PersonPanel";
import { SelfieReveal } from "../person/SelfieReveal";
import type { PersonTone } from "../person/types";
import { useAdminRouter } from "../useAdminRouter";
import { PEOPLE_TZ, REGISTRATION_LABEL, relativeWhen, VERIFICATION_LABEL } from "./query";
import type { PeopleDetail, PeopleRow, RegistrationStatus } from "./types";
import { VerificationTag } from "./VerificationTag";
import p from "../person/Person.module.css";
import s from "./People.module.css";

export interface PeopleDrawerProps {
  /** Null while loading: the header shows `preview` (the list row) when there is one, and only the sections wait. */
  detail: PeopleDetail | null;
  preview?: PeopleRow | null;
  /** False while the drawer closes (it stays mounted to slide out). */
  open?: boolean;
  /** Moves the URL (close). The host keeps the drawer mounted; without one it is a page navigation. */
  go?: (href: string) => void;
  /** The detail could not be loaded; `onRetry` asks again. */
  loadError?: boolean;
  onRetry?: () => void;
  /** Where "close" goes (the list with its filters). */
  closeHref: string;
  /** Frame gallery / tests: render in place. */
  inline?: boolean;
  /** Relative "last active" is measured from here: an ISO instant from the server, so the server render and
   *  hydration agree (never a clock read during render). */
  now: string;
}

const STATUS_TONE: Record<RegistrationStatus, TagTone> = { requested: "feature", approved: "success", waitlisted: "warning", rejected: "danger", withdrawn: "neutral", cancelled: "neutral", revoked: "danger" };
const VERIFICATION_ROW_TONE: Record<PeopleDetail["verification"]["state"], PersonTone> = { verified: "ok", expired: "warn", in_review: "review", declined: "danger", in_progress: "muted", not_started: "muted" };
const ROLE_LABEL = { owner: "Owner", admin: "Admin", staff: "Staff", host: "Host", operator: "Door operator" } as const;

/** People drawer: header, Profile, Verification (selfie on demand), Events, Attendance, Team roles, Activity. */
export function PeopleDrawer({ detail: d, preview, open = true, go, loadError, onRetry, closeHref, inline, now }: PeopleDrawerProps) {
  const router = useAdminRouter();
  const close = () => (go ? go(closeHref) : router.push(closeHref, { scroll: false }));
  const tz = PEOPLE_TZ;
  const contentKey = inline ? undefined : (d?.id ?? preview?.id);

  if (!d) {
    return (
      <Drawer
        open={open}
        inline={inline}
        onClose={close}
        className={s.drawer}
        width={560}
        contentKey={contentKey}
        eyebrow="Person"
        media={preview ? <PersonAvatar person={preview} /> : undefined}
        title={preview ? <PersonTitle person={{ name: preview.name, verified: preview.verified, timeZone: tz }} /> : <Skeleton width={180} height={18} />}
        titleAside={preview ? <VerificationTag row={preview} /> : undefined}
        subtitle={preview ? <PersonSubtitlePreview headline={preview.headline} company={preview.company} email={preview.email} /> : undefined}
      >
        {loadError ? (
          <div className={s.callout} role="alert">
            <b>Couldn’t load this person.</b>{" "}
            <button type="button" className={s.retry} onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading person">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={s.skSection}>
                <Skeleton width="30%" height={10} />
                <Skeleton width="80%" height={10} />
                <Skeleton width="65%" height={10} />
              </div>
            ))}
          </div>
        )}
      </Drawer>
    );
  }

  const person = { ...d, timeZone: tz };
  const v = d.verification;
  const at = new Date(now);
  const rate = d.attendance.approved ? Math.round((d.attendance.attended / d.attendance.approved) * 100) : null;

  return (
    <Drawer
      open={open}
      inline={inline}
      onClose={close}
      className={s.drawer}
      width={560}
      contentKey={contentKey}
      eyebrow="Person"
      media={<PersonAvatar person={person} />}
      title={<PersonTitle person={person} />}
      titleAside={<VerificationTag row={{ verification: v.state, deletion: d.deletedAt ? "deleted" : d.deletingAt ? "deleting" : null }} />}
      subtitle={<PersonSubtitle person={person} />}
    >
      {d.deletingAt || d.deletedAt ? (
        <div className={s.callout}>
          <b>{d.deletedAt ? "Account deleted" : "Account being deleted"}</b> {fmtWhen(d.deletedAt ?? d.deletingAt, tz, true)}. Their profile and verification are removed; registrations stay for the event records.
        </div>
      ) : null}

      <Section title="Profile">
        <Kv
          rows={[
            ["Headline", ...(d.headline ? ([d.headline] as [string]) : muted("Not on profile"))],
            ["Company", ...(d.company ? ([d.company] as [string]) : muted("Not on profile"))],
            ["Role", ...(d.role ? ([d.role] as [string]) : muted("Not on profile"))],
            ["Bio", ...(d.bio.trim() ? ([<span key="b" className={p.bio}>{d.bio}</span>] as [ReactNode]) : muted("No bio yet"))],
            [
              "Links",
              ...(d.links.length
                ? ([
                    <ul key="l" className={p.links}>
                      {d.links.map((l) => {
                        const href = safeHttpsUrl(l.href);
                        return (
                          <li key={l.href}>
                            <span className={p.linkKind}>{l.kind}</span>
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                                {l.label || new URL(href).host.replace(/^www\./, "")}
                              </a>
                            ) : (
                              <span>{l.label}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>,
                  ] as [ReactNode])
                : muted("None")),
            ],
            ["Profile", `Version ${d.profileVersion}${d.profileCompletedAt ? ` · completed ${fmtWhen(d.profileCompletedAt, tz)}` : " · not completed"}`],
            ["Onboarded", ...(d.onboardedAt ? ([fmtWhen(d.onboardedAt, tz, true)] as [string]) : muted("Not yet"))],
            ["Last active", ...(d.lastActiveAt ? ([`${relativeWhen(d.lastActiveAt, at)} · ${fmtWhen(d.lastActiveAt, tz, true)}`] as [string]) : muted("—"))],
          ]}
        />
      </Section>

      <Section title="Verification">
        <Kv
          rows={[
            ["Status", v.reason ? `${VERIFICATION_LABEL[v.state]} · ${v.reason}` : VERIFICATION_LABEL[v.state], VERIFICATION_ROW_TONE[v.state]],
            ["Method", ...(v.method ? ([v.method] as [string]) : muted("—"))],
            ["Verified at", ...(v.verifiedAt ? ([fmtWhen(v.verifiedAt, tz, true)] as [string]) : muted("—"))],
            ...(v.validUntil ? ([["Valid until", fmtWhen(v.validUntil, tz), v.state === "expired" ? "warn" : undefined]] as Row[]) : []),
            ["Email verified", ...(d.emailVerifiedAt ? ([fmtWhen(d.emailVerifiedAt, tz, true), "ok"] as [string, PersonTone]) : muted("Not verified"))],
            ["Account created", fmtWhen(d.createdAt, tz, true)],
            ["Sign-in", ...(d.signIn.length ? ([d.signIn.join(" · ")] as [string]) : muted("Never signed in"))],
            [
              "Didit session",
              ...(v.sessionId
                ? ([
                    <span key="d" className={p.session}>
                      <code>{v.sessionId}</code>
                      {v.diditUrl ? (
                        <a href={v.diditUrl} target="_blank" rel="noopener noreferrer">
                          Open in Didit ↗
                        </a>
                      ) : null}
                    </span>,
                  ] as [ReactNode])
                : muted("No session yet")),
            ],
          ]}
        />
        {d.selfieUrl ? <SelfieReveal src={d.selfieUrl} name={d.name} /> : null}
      </Section>

      <Section title={`Events · ${d.registrations.length}`}>
        {d.registrations.length ? (
          <ul className={s.events} aria-label="Registrations">
            {d.registrations.map((r) => (
              <li key={r.id} className={s.eventRow}>
                <span className={s.eventMain}>
                  <Link href={r.href}>{r.eventName}</Link>
                  <span>
                    {fmtWhen(r.eventStartsAt, r.timeZone)} · Requested {fmtWhen(r.requestedAt, r.timeZone, true)}
                  </span>
                  {r.checkedInAt ? <span className={s.eventIn}>Checked in {fmtWhen(r.checkedInAt, r.timeZone, true)}</span> : null}
                </span>
                <Tag tone={STATUS_TONE[r.status]}>{REGISTRATION_LABEL[r.status]}</Tag>
              </li>
            ))}
          </ul>
        ) : (
          <p className={p.muted}>No registrations yet.</p>
        )}
      </Section>

      <Section title="Attendance">
        <dl className={s.stats}>
          <div>
            <dt>Registered</dt>
            <dd>{d.attendance.registered}</dd>
          </div>
          <div>
            <dt>Approved</dt>
            <dd>{d.attendance.approved}</dd>
          </div>
          <div>
            <dt>Attended</dt>
            <dd>{d.attendance.attended}</dd>
          </div>
          <div>
            <dt>No-shows</dt>
            <dd>{d.attendance.noShows}</dd>
          </div>
        </dl>
        {rate !== null ? <p className={p.muted}>Came to {rate}% of the events they were approved for.</p> : null}
      </Section>

      <Section title="Team roles">
        <Kv
          rows={[
            ["Didit staff", ...(d.staff ? ([`${ROLE_LABEL[d.staff.role]}${d.staff.disabledAt ? ` · access disabled ${fmtWhen(d.staff.disabledAt, tz)}` : ` · since ${fmtWhen(d.staff.since, tz)}`}`] as [string]) : muted("No"))],
            [
              "Event teams",
              ...(d.memberships.length
                ? ([
                    <ul key="m" className={s.members}>
                      {d.memberships.map((m) => (
                        <li key={`${m.eventId}:${m.role}`}>
                          <Link href={m.href}>{m.eventName}</Link> · {ROLE_LABEL[m.role]}
                        </li>
                      ))}
                    </ul>,
                  ] as [ReactNode])
                : muted("None")),
            ],
          ]}
        />
      </Section>

      <Section title="Activity">
        {d.activity.length ? (
          <ol className={p.timeline}>
            {d.activity.map((a) => (
              <li key={a.key} data-state="done" data-tone={a.tone === "ok" ? undefined : a.tone}>
                <span className={p.dot} aria-hidden="true" />
                <span className={p.stepText}>
                  <b>{a.label}</b>
                  {a.detail ? <span>{a.detail}</span> : null}
                </span>
                <time className={p.stepAt} dateTime={a.at}>
                  {fmtWhen(a.at, tz, true)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className={p.muted}>Nothing yet.</p>
        )}
      </Section>
    </Drawer>
  );
}
