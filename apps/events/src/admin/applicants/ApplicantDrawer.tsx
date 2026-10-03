"use client";
import { actionCsrf } from "../../auth/client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Banner, Button, ButtonLink, Drawer, Skeleton, StatusPill, Textarea } from "@didit-events/ui";
import { saveNoteAction } from "../../../app/admin/(events)/events/[id]/(tabs)/applicants/actions";
import { handleSessionExpired } from "../system/session";
import { useAdminRouter } from "../useAdminRouter";
import { personFromDrawer } from "../person/build";
import { PersonAvatar, PersonSections, PersonSubtitle, PersonSubtitlePreview, PersonTitle } from "../person/PersonPanel";
import { actionsFor } from "./present";
import { reviewKey } from "./query";
import { keyIntent, modalOpen } from "./reviewFlow";
import type { ApplicantDetail, ApplicantRow, ApplicantsEvent, ApplicantTab, DrawerSection } from "./types";
import { useReview, type ReviewFrameState } from "./useReview";
import s from "./Applicants.module.css";

export interface ApplicantDrawerProps {
  eventId: string;
  /** Null while loading: the header shows `row` (what the list already knows) and only the sections wait. */
  detail: ApplicantDetail | null;
  row: ApplicantRow | null;
  /** False while the drawer closes (it stays mounted to slide out). */
  open?: boolean;
  event: ApplicantsEvent;
  index: number;
  total: number;
  prevHref?: string;
  nextHref?: string;
  closeHref: string;
  /** Moves the URL (‹ ›, J/K, close, the advance after a decision). The host swaps the content in place; without one it is a page navigation. */
  go?: (href: string) => void;
  /** A decision went through: the host drops what it cached about the applicants. */
  onDecided?: () => void;
  /** The detail could not be loaded; `onRetry` asks again. */
  loadError?: boolean;
  onRetry?: () => void;
  inline?: boolean;
  frame?: ReviewFrameState;
}

const PILL: Record<ApplicantTab, "pending" | "waitlist" | "approved" | "rejected" | "cancelled"> = { pending: "pending", waitlist: "waitlist", approved: "approved", rejected: "rejected", cancelled: "cancelled" };

function Section({ eventId, id, section }: { eventId: string; id: string; section: DrawerSection }) {
  const [note, setNote] = useState(section.note?.value ?? "");
  const [status, setStatus] = useState("");
  return (
    <section className={s.dSection} aria-label={section.title}>
      <h3>{section.title}</h3>
      {section.rows.length ? (
        <dl className={s.kv}>
          {section.rows.map((kv, i) => (
            <div key={i} style={{ display: "contents" }}>
              <dt>{kv.k}</dt>
              <dd data-tone={kv.tone}>{kv.href ? <a href={kv.href}>{kv.v}</a> : kv.v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {section.note ? (
        <>
          <Textarea
            label="Staff note"
            hideLabel
            className={s.note}
            placeholder={section.note.placeholder}
            value={note}
            maxLength={500}
            rows={2}
            onChange={(e) => setNote(e.currentTarget.value)}
            onBlur={async () => {
              if (note === (section.note?.value ?? "")) return;
              const r = await saveNoteAction(eventId, id, note, actionCsrf());
              if (handleSessionExpired(r)) return;
              setStatus("error" in r ? "Couldn’t save the note." : "Note saved.");
            }}
          />
          <span className={s.sr} aria-live="polite">
            {status}
          </span>
        </>
      ) : null}
    </section>
  );
}

/** The shared person view: the loader's, else (frame fixtures) derived from the v2 drawer DTO. */
const personOf = (d: ApplicantDetail) => d.person ?? (d.v2 ? personFromDrawer({ name: d.name, email: d.email, timeZone: d.timeZone ?? "UTC" }, d.v2) : null);

/** AP-03, AP-04, AP-05, AP-26: the applicant drawer, with ‹ › / J/K between applicants and A / W / R decisions. */

export function ApplicantDrawer({ eventId, detail, row, open = true, event, index, total, prevHref, nextHref, closeHref, go: goTo, onDecided, loadError, onRetry, inline, frame }: ApplicantDrawerProps) {
  const router = useAdminRouter();
  const go = goTo ?? ((href: string) => router.push(href, { scroll: false }));
  const review = useReview({
    eventId,
    event,
    frame,
    onDone: () => {
      onDecided?.();
      go(nextHref ?? closeHref);
    },
  });
  const close = () => go(closeHref);

  // The drawer is itself an aria-modal: only another dialog over it (reject, capacity, session) blocks its keys.
  const navRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (inline || !open || !row) return;
    const onKey = (e: KeyboardEvent) => {
      const own = navRef.current?.closest('[aria-modal="true"]');
      const intent = keyIntent(reviewKey(e), { row, registration: event.registration, blocked: review.dialogOpen || modalOpen(document, own), busy: review.pending || review.busy === row.id });
      if (!intent) return;
      e.preventDefault();
      if (intent.kind === "move") {
        const href = intent.dir === 1 ? nextHref : prevHref;
        if (href) go(href);
        return;
      }
      review.act(intent.decision, [intent.row]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nav = (
    <span className={s.dNav} ref={navRef}>
      {prevHref ? (
        <ButtonLink variant="icon" size="sm" href={prevHref} aria-label="Previous applicant (K)">
          ‹
        </ButtonLink>
      ) : (
        <Button variant="icon" size="sm" disabled aria-label="Previous applicant (K)">
          ‹
        </Button>
      )}
      {nextHref ? (
        <ButtonLink variant="icon" size="sm" href={nextHref} aria-label="Next applicant (J)">
          ›
        </ButtonLink>
      ) : (
        <Button variant="icon" size="sm" disabled aria-label="Next applicant (J)">
          ›
        </Button>
      )}
    </span>
  );

  const busy = review.busy === row?.id || review.pending;
  const person = detail ? personOf(detail) : null;
  const tab = row?.tab ?? detail?.tab;
  const footer = row ? (
    row.tab === "pending" ? (
      <>
        <Button variant="danger-outline" className={s.reject} disabled={busy} onClick={() => review.act("reject", [row])} aria-keyshortcuts="R">
          Reject
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => review.act("waitlist", [row])} aria-keyshortcuts="W">
          Waitlist
        </Button>
        <Button data-primary="" loading={review.busy === row.id} disabled={event.registration === "full" || busy} onClick={() => review.act("approve", [row])} aria-keyshortcuts="A">
          Approve and send link
        </Button>
      </>
    ) : (
      actionsFor(row, event)
        .filter((a) => a.decision !== "open")
        .map((a) => (
          <Button key={a.label} variant={a.kind === "danger" ? "danger-outline" : a.kind === "primary" ? "primary" : "secondary"} disabled={busy} onClick={() => a.decision !== "open" && review.act(a.decision, [row])}>
            {a.label}
          </Button>
        ))
    )
  ) : undefined;

  const drawer = (
    <Drawer
      open={open}
      inline={inline}
      onClose={close}
      width={520}
      className={s.drawer}
      contentKey={inline ? undefined : (row?.id ?? detail?.id)}
      eyebrow={index > 0 ? `Applicant · ${index} of ${total}` : "Applicant"}
      headerActions={detail || row ? nav : undefined}
      title={person ? <PersonTitle person={person} /> : detail ? detail.name : row ? <PersonTitle person={{ name: row.name, verified: row.person?.verified ?? null, timeZone: row.person?.timeZone ?? "UTC" }} /> : <Skeleton width={180} height={16} />}
      titleAside={tab ? <StatusPill status={PILL[tab]} /> : undefined}
      subtitle={person ? <PersonSubtitle person={person} /> : detail ? detail.email : row ? <PersonSubtitlePreview role={row.role} company={row.company} email={row.email} /> : undefined}
      media={
        person ? (
          <PersonAvatar person={person} />
        ) : detail ? (
          <Avatar name={detail.name} initials={detail.initials} size={56} className={s.dAvatar} />
        ) : row ? (
          <PersonAvatar person={{ name: row.name, email: row.email, photoUrl: row.person?.photoUrl ?? null }} />
        ) : (
          <Skeleton width={56} height={56} shape="pill" />
        )
      }
      headerFooter={
        detail?.flag ? (
          <Banner tone={detail.flag.tone === "ok" ? "success" : "warning"} className={s.dFlag}>
            {detail.flag.text}
          </Banner>
        ) : undefined
      }
      footer={footer}
    >
      {detail ? (
        <>
          {person ? <PersonSections person={person} /> : null}
          {detail.sections.map((sec) => (
            <Section key={sec.title} eventId={eventId} id={detail.id} section={sec} />
          ))}
        </>
      ) : loadError ? (
        <Banner
          tone="danger"
          className={s.dFlag}
          action={
            <button type="button" className={s.bannerCta} onClick={onRetry}>
              Retry
            </button>
          }
        >
          Couldn’t load this applicant.
        </Banner>
      ) : (
        <div className={s.dSkeleton} aria-busy="true" aria-label="Loading applicant">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} width={`${80 - i * 10}%`} />
          ))}
        </div>
      )}
    </Drawer>
  );

  return (
    <>
      {inline ? (
        <>
          <div className={s.drawerScrim} aria-hidden="true" />
          <div className={s.drawerFrame}>{drawer}</div>
        </>
      ) : (
        drawer
      )}
      {review.dialogs()}
      {review.progressToast}
    </>
  );
}
