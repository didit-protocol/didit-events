import type { ReactNode } from "react";
import { Avatar, Tag, type TagTone } from "@didit-events/ui";
import { safeHttpsUrl } from "../form/url";
import { fmtWhen } from "./format";
import { PersonBadge } from "./PersonBadge";
import { personPhoto } from "./PersonCell";
import { SelfieReveal } from "./SelfieReveal";
import type { PersonCheck, PersonTone, PersonVerificationState, PersonView } from "./types";
import s from "./Person.module.css";

const CHECK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export function PersonAvatar({ person, size = 56 }: { person: Pick<PersonView, "name" | "email" | "photoUrl">; size?: 48 | 56 | 64 }) {
  return <Avatar name={person.name} email={person.email} src={personPhoto(person.photoUrl)} size={size} className={s.avatar} />;
}

/** Drawer title: name + badge. */
export function PersonTitle({ person }: { person: Pick<PersonView, "name" | "verified" | "timeZone"> }) {
  return (
    <span className={s.title}>
      <span>{person.name}</span>
      <PersonBadge verified={person.verified ?? undefined} timeZone={person.timeZone} />
    </span>
  );
}

/** Drawer subtitle: headline · role · company, email with its verified mark, profile links. */
export function PersonSubtitle({ person }: { person: Pick<PersonView, "headline" | "role" | "company" | "email" | "emailVerifiedAt" | "timeZone" | "links" | "accountDeleted"> }) {
  const work = [person.headline, [person.role, person.company].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
  return (
    <span className={s.sub}>
      {work ? <span className={s.work}>{work}</span> : null}
      <span className={s.email}>
        {person.accountDeleted ? null : person.email}
        {person.emailVerifiedAt ? (
          <span className={s.emailOk} title={`Email verified ${fmtWhen(person.emailVerifiedAt, person.timeZone)}`}>
            {CHECK}
            <span className={s.sr}>Email verified {fmtWhen(person.emailVerifiedAt, person.timeZone)}</span>
          </span>
        ) : (
          <span className={s.emailNo}>{person.accountDeleted ? "· account deleted" : "· email not verified"}</span>
        )}
      </span>
      {person.links.length ? (
        <span className={s.headLinks}>
          {person.links.map((l) => {
            const href = safeHttpsUrl(l.href);
            return href ? (
              <a key={l.href} href={href} target="_blank" rel="noopener noreferrer nofollow">
                {l.kind} ↗
              </a>
            ) : null;
          })}
        </span>
      ) : null}
    </span>
  );
}

/** The subtitle while the detail loads: what the list row already knows (work line, email); the verified mark and links come with the detail. */
export function PersonSubtitlePreview({ headline, role, company, email }: { headline?: string; role?: string; company?: string; email: string }) {
  const known = (x?: string) => !!x && x !== "—";
  const work = [headline, [role, company].filter(known).join(" · ")].filter(known).join(" — ");
  return (
    <span className={s.sub}>
      {work ? <span className={s.work}>{work}</span> : null}
      <span className={s.email}>{email}</span>
    </span>
  );
}

export type Row = [ReactNode, ReactNode, PersonTone?];

/** Label / value rows of a drawer section (shared by the Guests, Requests and People drawers). */
export function Kv({ rows }: { rows: Row[] }) {
  return (
    <dl className={s.kv}>
      {rows.map(([k, v, tone], i) => (
        <div key={i} className={s.kvRow}>
          <dt>{k}</dt>
          <dd data-tone={tone}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.section} aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const STATE: Record<PersonVerificationState, [string, PersonTone]> = {
  verified: ["Verified", "ok"],
  expired: ["Expired: needs a new selfie", "warn"],
  in_review: ["In review at Didit", "review"],
  declined: ["Declined by Didit", "danger"],
  in_progress: ["In progress", "muted"],
  not_started: ["Not verified yet", "muted"],
};
const CHECK_STATE: Record<PersonCheck["state"], [string, PersonTone]> = { verified: ["Verified", "ok"], missing: ["Missing", "muted"], expired: ["Expired", "warn"], in_review: ["In review", "review"], revoked: ["Revoked", "danger"] };
const TAG: Record<PersonTone, TagTone> = { ok: "success", warn: "warning", review: "feature", danger: "danger", muted: "neutral" };

function checkLine(c: PersonCheck, tz: string): string {
  const parts = [CHECK_STATE[c.state][0] + (c.check === "age" && c.minimum ? ` · ${c.minimum}+` : "")];
  if (c.state === "verified" && c.verifiedAt) parts.push(fmtWhen(c.verifiedAt, tz));
  if (c.validUntil) parts.push(`${c.state === "expired" ? "expired" : "valid until"} ${fmtWhen(c.validUntil, tz)}`);
  return parts.join(" · ");
}

export const muted = (text: string): [string, PersonTone] => [text, "muted"];

/**
 * The person body shared by the Guests and Requests drawers: Profile, Request, Verification (with the staff-only
 * selfie), Check-in and Timeline. `children` go between Verification and Check-in (the guest invite link).
 */
export function PersonSections({ person: p, children }: { person: PersonView; children?: ReactNode }) {
  const tz = p.timeZone;
  const v = p.verification;
  const [stateText, stateTone] = STATE[v.state];
  const answers = p.request.answers.filter((a) => !a.legacy);
  const legacy = p.request.answers.filter((a) => a.legacy);
  const checks = v.checks.filter((c) => c.check !== "face");
  const record = (
    <>
      <Section title="Check-in">
        <Kv
          rows={
            p.checkIn
              ? [
                  ["Time", fmtWhen(p.checkIn.at, tz, true), "ok"],
                  ["Door", p.checkIn.door],
                  ...(p.checkIn.match !== undefined ? ([["Match confidence", `${p.checkIn.match}% match`]] as Row[]) : []),
                  ...(p.checkIn.by ? ([["By", p.checkIn.by]] as Row[]) : []),
                  ...(p.checkIn.note ? ([["Note", p.checkIn.note]] as Row[]) : []),
                ]
              : [["Time", ...muted(p.started ? "Not checked in" : "Doors not open yet")]]
          }
        />
      </Section>

      <Section title="Timeline">
        <ol className={s.timeline}>
          {p.timeline.map((t) => (
            <li key={t.key} data-state={t.done ? "done" : "pending"} data-tone={t.tone}>
              <span className={s.dot} aria-hidden="true" />
              <span className={s.stepText}>
                <b>{t.label}</b>
                {t.who ? <span>{t.who}</span> : !t.done ? <span>Pending</span> : null}
                {t.reason ? <span className={s.reason}>“{t.reason}”</span> : null}
              </span>
              {t.at ? (
                <time className={s.stepAt} dateTime={t.at}>
                  {fmtWhen(t.at, tz, true)}
                </time>
              ) : (
                <span className={s.stepAt} />
              )}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
  // The account is gone (or going): no profile, answers, checks or photos, only what was decided about the request.
  if (p.accountDeleted) {
    return (
      <>
        <Section title="Account deleted">
          <p className={s.muted}>This person deleted their account. Their profile, answers, photo and verification are no longer available; the decisions on this request stay below.</p>
        </Section>
        {children}
        {record}
      </>
    );
  }
  return (
    <>
      <Section title="Profile">
        <Kv
          rows={[
            ["Headline", ...(p.headline ? [p.headline] as [string] : muted("Not on profile"))],
            ["Company", ...(p.company ? [p.company] as [string] : muted("Not on profile"))],
            ["Role", ...(p.role ? [p.role] as [string] : muted("Not on profile"))],
            ["Bio", ...(p.bio.trim() ? [<span key="b" className={s.bio}>{p.bio}</span>] as [ReactNode] : muted("No bio yet"))],
            [
              "Links",
              ...(p.links.length
                ? ([
                    <ul key="l" className={s.links}>
                      {p.links.map((l) => {
                        const href = safeHttpsUrl(l.href);
                        const host = href ? new URL(href).host.replace(/^www\./, "") : l.href;
                        return (
                          <li key={l.href}>
                            <span className={s.linkKind}>{l.kind}</span>
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                                {l.label || host}
                                <span className={s.linkHost}> · {host}</span>
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
            ["Profile created", ...(p.createdAt ? [fmtWhen(p.createdAt, tz)] as [string] : muted("—"))],
          ]}
        />
        {p.updatedSinceRequest ? (
          <p className={s.note}>
            Profile updated since the request{p.updatedSinceRequest.from ? ` (version ${p.updatedSinceRequest.from} → ${p.updatedSinceRequest.to})` : ""}. You see the current one.
          </p>
        ) : null}
      </Section>

      <Section title="Request">
        <Kv
          rows={[
            ["Requested", ...(p.request.requestedAt ? [fmtWhen(p.request.requestedAt, tz, true)] as [string] : muted("—"))],
            ...p.request.extras.map((x): Row => [x.label, `${x.value} · ${x.verified ? `Verified${x.verifiedAt ? ` ${fmtWhen(x.verifiedAt, tz)}` : ""}` : "Not verified"}`, x.verified ? "ok" : "warn"]),
            [
              "Consent",
              ...(p.request.consent
                ? ([
                    `Accepted ${fmtWhen(p.request.consent.acceptedAt, tz, true)} · profile shared with hosts${p.request.consent.checks.length ? ` · checks: ${p.request.consent.checks.join(", ")}` : ""}${p.request.consent.policyVersion != null ? ` · policy v${p.request.consent.policyVersion}` : ""}`,
                  ] as [string])
                : muted("No consent receipt (added by staff or imported)")),
            ],
          ]}
        />
        {p.request.purged ? (
          <p className={s.muted}>Answers were removed after the retention period.</p>
        ) : answers.length ? (
          <dl className={s.answers}>
            {answers.map((a) => (
              <div key={a.id}>
                <dt>
                  {a.label}
                  {a.required ? <span className={s.muted}> · required</span> : null}
                </dt>
                <dd data-empty={a.value ? undefined : ""}>{a.value || "No answer"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={s.muted}>This event asked no questions.</p>
        )}
        {legacy.length ? (
          <>
            <h4 className={s.subhead}>Earlier form answers</h4>
            <dl className={s.answers}>
              {legacy.map((a) => (
                <div key={a.id}>
                  <dt>{a.label}</dt>
                  <dd>{a.value || "No answer"}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </Section>

      <Section title="Verification">
        {v.readiness ? (
          <span className={s.ready}>
            <Tag tone={TAG[v.readiness.tone]}>{v.readiness.text}</Tag>
          </span>
        ) : null}
        <Kv
          rows={[
            ["Status", v.reason ? `${stateText} · ${v.reason}` : stateText, stateTone],
            ["Method", ...(v.method ? [v.method] as [string] : muted("—"))],
            ["Verified at", ...(v.verifiedAt ? [fmtWhen(v.verifiedAt, tz, true)] as [string] : muted("—"))],
            ...(v.validUntil ? ([["Valid until", fmtWhen(v.validUntil, tz), v.state === "expired" ? "warn" : undefined]] as Row[]) : []),
            ["Email", ...(p.emailVerifiedAt ? [`Verified ${fmtWhen(p.emailVerifiedAt, tz)}`, "ok"] as [string, PersonTone] : muted("Not verified"))],
            ...checks.map((c): Row => [c.label, checkLine(c, tz), CHECK_STATE[c.state][1]]),
            [
              "Didit session",
              ...(v.sessionId
                ? ([
                    <span key="d" className={s.session}>
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
        {v.selfieUrl ? <SelfieReveal src={v.selfieUrl} name={p.name} /> : null}
      </Section>

      {children}

      {record}
    </>
  );
}
