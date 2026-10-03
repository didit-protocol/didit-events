import { Avatar, IconTile, StatusIcon, StatusPill, cx } from "@didit-events/ui";
import { cardContent } from "../card";
import { displayName } from "../viewer-name";
import type { CardState, PublicEvent, Viewer } from "../types";
import { CardButton, type CardActions } from "./CardButton";
import s from "./RegistrationCard.module.css";

export interface RegistrationCardProps {
  event: PublicEvent;
  state: CardState;
  actions: CardActions;
  className?: string;
}

/**
 * P-02a–n: the registration card, one layout for every status (band + pill, status icon, title, body, Didit progress,
 * buttons, footnote). The body is a polite live region so a status change after an action is announced.
 */
export function RegistrationCard({ event, state, actions, className }: RegistrationCardProps) {
  const c = cardContent(state, event);
  return (
    <section className={cx(s.card, className)} aria-labelledby={`reg-${event.slug}`} data-card={state.kind}>
      <div className={s.band}>
        <h2 id={`reg-${event.slug}`} className={s.bandTitle}>
          {c.band}
        </h2>
        {c.pill ? <StatusPill status={c.pill.status}>{c.pill.label}</StatusPill> : null}
      </div>
      <div className={s.body} aria-live="polite">
        {/* A settled state from the server: the check does not pop again on every load (the join modal plays it once). */}
        {c.icon ? <StatusIcon tone={c.icon.status} icon={c.icon.icon} size={44} animate={false} /> : null}
        <p className={s.title}>{c.title}</p>
        <p className={s.text}>{c.body}</p>
        {c.progress ? (
          <ol className={s.progress} aria-label="Didit verification steps">
            {c.progress.map((p) => (
              <li key={p.label} className={s.step} data-bar={p.bar} data-reached={p.reached || undefined}>
                <span className={s.bar} aria-hidden="true" />
                <span className={s.stepLabel}>
                  {p.label}
                  <span className={s.srOnly}>{p.bar === "done" ? " (done)" : p.bar === "current" ? " (in progress)" : ""}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {/* The design keeps the (possibly empty) button row in the flow, so its 14px gap is part of the card. */}
        <div className={s.actions}>
          {c.cta ? <CardButton action={c.cta} slug={event.slug} actions={actions} variant="primary" /> : null}
          {c.cta2 ? <CardButton action={c.cta2} slug={event.slug} actions={actions} variant="secondary" /> : null}
        </div>
        {c.foot ? (
          <p className={s.foot}>
            {c.foot.text}
            {c.foot.link ? (
              <a href={c.foot.link.href} className={s.footLink}>
                {c.foot.link.label}
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** P-01 desktop: the signed-in, not-yet-registered card (approval + face check-in notes, who you are, Request to join). */
export function RequestCard({ event, viewer, actions, className }: { event: PublicEvent; viewer: Viewer; actions: CardActions; className?: string }) {
  const c = cardContent({ kind: "request", viewer }, event);
  const name = displayName(viewer);
  return (
    <section className={cx(s.request, className)} aria-labelledby={`reg-${event.slug}`} data-card="request">
      <h2 id={`reg-${event.slug}`} className={s.requestBand}>
        {c.band}
      </h2>
      <div className={s.requestBody}>
        <div className={s.feature}>
          <IconTile icon="user-check" variant="soft" />
          <div className={s.featureText}>
            <span className={s.featureTitle}>{c.title}</span>
            <span className={s.featureBody}>{c.body}</span>
          </div>
        </div>
        <div className={s.feature}>
          <IconTile icon="face-scan" variant="soft" />
          <div className={s.featureText}>
            <span className={s.featureTitle}>Face check-in by Didit</span>
            <span className={s.featureBody}>Once approved, verify in 2 minutes. At the door, just look at the screen.</span>
          </div>
        </div>
        <hr className={s.rule} />
        <p className={s.welcome}>Welcome! To join the event, please register below.</p>
        <div className={s.who}>
          <Avatar name={name} email={viewer.email} src={viewer.photoUrl} size={32} />
          <div className={s.whoText}>
            <span className={s.whoName}>{name}</span>
            <span className={s.whoEmail}>{viewer.email}</span>
          </div>
        </div>
        {c.cta ? <CardButton action={c.cta} slug={event.slug} actions={actions} variant="primary" className={s.requestCta} /> : null}
      </div>
    </section>
  );
}
