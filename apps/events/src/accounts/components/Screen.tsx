
import { CsrfField } from "../../auth/CsrfField";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Avatar, ButtonLink, HEADER_LOGO_HEIGHT, Logo, StatusIcon, SubmitButton, assetSrc, cx, type StatusIconName, type StatusTone } from "@didit-events/ui";
import google from "@didit-events/ui/assets/google.svg";
import { shortDate, time } from "../../public/format";
import { coverSrc } from "../../public/photos";
import type { PublicEvent } from "../../public/types";
import { accountLinks } from "../links";
import { SiteHeader } from "../../public/components/SiteHeader";
import { SiteHeaderBar } from "../../public/components/SiteHeaderBar";
import header from "../../public/components/SiteHeader.module.css";
import layout from "../../public/components/GuestLayout.module.css";
import s from "./Screen.module.css";

/* Building blocks of the 390 guest flow (design/04 R-*, design/05 U-*). Server components only. */

export type HeaderKind = "events" | "account" | "didit" | "none";

export interface GuestScreenProps {
  header?: HeaderKind;
  /** Signed-in guest's initials for the avatar header ("MG"). */
  initials?: string;
  accountName?: string;
  /** The signed-in guest: the page then uses the public SiteHeader with the avatar menu. */
  account?: { firstName: string; lastName: string; email: string; photoUrl?: string; staffRole?: "owner" | "admin" | "staff" };
  /** Bottom sheet over a dimmed event page. `flow` = the 04 R-* backdrop (220px, faded), `account` = 05 U-*. */
  sheet?: { event?: PublicEvent; variant: "flow" | "account" };
  /** Accessible name of the main region (usually the title's id). */
  labelledBy?: string;
  /** Desktop width of the card (GuestLayout.module.css): `card` 560 (default), `list` 720 (My events). */
  width?: "card" | "list";
  /** Sheets: where the close control goes (default: the event page, else My events). */
  closeHref?: string;
  /** Sheets: the quiet line next to the logo (the event's name), as in the join sheet. */
  topLabel?: string;
  /** Sheets: a client close (e.g. /login goes Back); `closeHref` stays the no-JS target. */
  onClose?: (e: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}

/**
 * Every guest screen. Below 768px: the 390 flow, full screen, CTAs at the bottom. From 768px: a centred card with
 * inline CTAs (`card`/`list` width), and sheets become a centred modal over the dimmed event (`modal` width).
 */
export function GuestScreen({ header = "events", initials, accountName, account, sheet, labelledBy, width = "card", closeHref, topLabel, onClose, children }: GuestScreenProps) {
  // The dimmed cover behind a sheet is the event the sheet is about; a sheet without one (delete account, a plain
  // sign-in) sits on the neutral backdrop instead of implying an event.
  const cover = sheet?.event ? coverSrc(sheet.event.cover, 1080) : null;
  const coverStyle: CSSProperties | null = !cover
    ? null
    : sheet?.variant === "flow"
      ? { backgroundImage: `linear-gradient(160deg, rgba(254,254,254,.6), rgba(254,254,254,0) 70%), url(${cover})` }
      : { backgroundImage: `url(${cover})` };
  const widthClass = width === "list" ? layout.wList : layout.wCard;
  // Signed-in account pages (/me/*) share the public pages' header, full width; the content below is the card.
  // Sheets keep their overlay layout.
  if (account && !sheet && header !== "none" && header !== "didit") {
    const viewer = { firstName: account.firstName, lastName: account.lastName, email: account.email, photoUrl: account.photoUrl, staffRole: account.staffRole };
    return (
      <div className={cx(s.shell, layout.root, widthClass)} data-shared-header="">
        <SiteHeader viewer={viewer} />
        <div className={cx(s.page, s.pageInShell, layout.canvas)}>
          <main className={cx(s.body, layout.card)} aria-labelledby={labelledBy}>
            {children}
          </main>
        </div>
      </div>
    );
  }
  if (sheet) {
    const close = closeHref ?? (sheet.event ? accountLinks.event(sheet.event.slug) : accountLinks.myEvents());
    return (
      <div className={cx(layout.root, layout.wModal)}>
        <div className={cx(s.page, s.pageSheet)}>
          <div className={s.sheetBackdrop} aria-hidden="true">
            <div className={s.backdrop} />
            {coverStyle ? <div className={cx(s.backdropCover, sheet.variant === "flow" && s.backdropCoverFlow)} style={coverStyle} /> : null}
            <div className={s.scrim} />
          </div>
          <main className={cx(s.sheet, layout.modal)} aria-labelledby={labelledBy}>
            <div className={s.sheetTop}>
              <Logo variant="color" height={HEADER_LOGO_HEIGHT} alt="Didit" />
              <span className={s.sheetName}>{topLabel}</span>
              <a href={close} className={s.sheetClose} aria-label="Close" onClick={onClose}>
                ×
              </a>
            </div>
            {children}
          </main>
        </div>
      </div>
    );
  }
  return (
    <div className={cx(layout.root, widthClass)}>
      <div className={cx(s.page, layout.canvas)}>
        {header !== "none" ? <ScreenHeader kind={header} initials={initials} accountName={accountName} /> : null}
        <main className={cx(s.body, layout.card)} aria-labelledby={labelledBy}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** The site header of a flow screen: no Sign in (these screens are the sign-in, or a step of a personal link). */
function ScreenHeader({ kind, initials, accountName }: { kind: Exclude<HeaderKind, "none">; initials?: string; accountName?: string }) {
  if (kind === "didit") {
    return (
      <SiteHeaderBar>
        <span className={header.note}>Secure verification</span>
      </SiteHeaderBar>
    );
  }
  if (kind === "account" && (initials || accountName)) {
    return (
      <SiteHeaderBar>
        <a href={accountLinks.myEvents()} className={header.avatarLink} aria-label={accountName ? `${accountName}, my events` : "My events"}>
          <Avatar name={accountName || initials || ""} initials={initials} size={32} />
        </a>
      </SiteHeaderBar>
    );
  }
  return <SiteHeader signIn={false} />;
}

/** "Thu 8 Oct · 18:30 · Didit HQ" */
export const chipMeta = (e: PublicEvent) => `${shortDate(e.startsAt, e.timeZone)} · ${time(e.startsAt, e.timeZone)} · ${e.venue.name}`;
export const eventName = (e: PublicEvent) => [e.title, e.accent].filter(Boolean).join(" ");

/** The event row at the top of flow screens (links back to the event page). */
export function EventChip({ event, variant = "account" }: { event: PublicEvent; variant?: "flow" | "account" }) {
  const photo = coverSrc(event.cover, 192);
  const bg = variant === "flow" ? `linear-gradient(160deg, rgba(254,254,254,.6), rgba(254,254,254,0) 70%), url(${photo})` : `url(${photo})`;
  return (
    <a href={accountLinks.event(event.slug)} className={s.chip}>
      <span className={cx(s.chipThumb, variant === "flow" && s.chipThumbFlow)} style={{ backgroundImage: bg }} aria-hidden="true" />
      <span className={s.chipText}>
        <span className={s.chipName}>{eventName(event)}</span>
        <span className={s.chipMeta}>{chipMeta(event)}</span>
      </span>
    </a>
  );
}

export const Eyebrow = ({ children, as: Tag = "p", id }: { children: ReactNode; as?: "p" | "h1"; id?: string }) => (
  <Tag className={s.eyebrow} id={id}>
    {children}
  </Tag>
);

export function Title({ id, size = 28, as: Tag = "h1", children }: { id?: string; size?: number; as?: "h1" | "h2"; children: ReactNode }) {
  return (
    <Tag id={id} className={s.title} style={{ "--title-size": `${size}px` } as CSSProperties}>
      {children}
    </Tag>
  );
}

export const Lead = ({ children, id }: { children: ReactNode; id?: string }) => (
  <p className={s.lead} id={id}>
    {children}
  </p>
);

export type CalloutTone = "danger" | "info" | "warning" | "neutral" | "success";

/** The 12px/14px notice box (errors, info, late cancellation, check-in details). Danger is announced assertively. */
export function Callout({ tone, children, live = true }: { tone: CalloutTone; children: ReactNode; live?: boolean }) {
  return (
    <div className={cx(s.callout, s[tone])} role={live ? (tone === "danger" ? "alert" : "status") : undefined}>
      {children}
    </div>
  );
}

/** The 56px round status icon (crisp SVG marks; success draws its check). */
export const FlowIcon = ({ status, icon, size = 56 }: { status: StatusTone; icon?: StatusIconName; size?: 48 | 56 }) => <StatusIcon tone={status} icon={icon} size={size} />;

/** Pushes the CTAs to the bottom of a phone screen; collapses on the desktop card so they follow the content. */
export const Spacer = () => <div className={cx(s.spacer, layout.inline)} aria-hidden="true" />;

export const Foot = ({ children }: { children: ReactNode }) => <p className={s.foot}>{children}</p>;

/** The actions footer of a sheet or a modal step (primary last, on the bottom edge). */
export { SheetFooter } from "./SheetFooter";

/** "Secured by Didit" with the official logo (design-prompt §2: on every sign-in and verification surface). */
export { SecuredByDidit } from "./SecuredByDidit";

/** Primary or secondary navigation button (52px on a flow screen, 44px in a sheet); `modal` = the 44px desktop sign-in buttons. */
export function CtaLink({ href, children, secondary, destructive, modal }: { href: string; children: ReactNode; secondary?: boolean; destructive?: boolean; modal?: boolean }) {
  return (
    <ButtonLink
      href={href}
      variant={secondary ? "secondary" : destructive ? "destructive" : "primary"}
      size={modal || secondary ? "lg" : "xl"}
      block
      className={modal ? undefined : secondary ? s.cta2 : undefined}
    >
      {children}
    </ButtonLink>
  );
}

export const cta2Class = s.cta2;

/** A button that posts a server action (hidden fields + the C-00 loading state while it runs). */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel,
  secondary,
  destructive,
}: {
  action: (form: FormData) => Promise<void>;
  fields: Record<string, string>;
  children: ReactNode;
  pendingLabel?: string;
  secondary?: boolean;
  destructive?: boolean;
}) {
  return (
    <form action={action} className={s.actionForm}><CsrfField />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton
        variant={secondary ? "secondary" : destructive ? "destructive" : "primary"}
        size={secondary ? "lg" : "xl"}
        block
        pendingLabel={pendingLabel}
        className={secondary ? s.cta2 : undefined}
      >
        {children}
      </SubmitButton>
    </form>
  );
}

/** Bordered key/value list (U-17, U-18, U-29, U-41). */
export function Summary({ rows, label }: { rows: { k: string; v: ReactNode }[]; label?: string }) {
  return (
    <dl className={s.box} aria-label={label}>
      {rows.map((r) => (
        <div key={r.k} className={s.summaryRow}>
          <dt className={s.summaryKey}>{r.k}</dt>
          <dd className={s.summaryValue} style={{ margin: 0 }}>
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface GroupRow {
  label: ReactNode;
  detail?: ReactNode;
  /** Right side: a link, a button, a state word or a ✓/○ glyph. */
  action?: ReactNode;
  labelTone?: "success" | "danger";
  google?: boolean;
  href?: string;
  key?: string;
}

/** Settings-style group: small caps title over a bordered list of rows (U-21, U-32, U-38, U-39). */
export function RowGroup({ title, rows, className }: { title: string; rows: GroupRow[]; className?: string }) {
  const titleId = `grp-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className={cx(s.group, className)} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.groupTitle} style={{ margin: 0 }}>
        {title}
      </h2>
      <ul className={s.box}>
        {rows.map((r, i) => {
          const inner = (
            <>
              {r.google ? <GoogleMark size={16} /> : null}
              <span className={s.rowText}>
                <span className={cx(s.rowLabel, r.labelTone === "success" && s.rowLabelSuccess, r.labelTone === "danger" && s.rowLabelDanger)}>{r.label}</span>
                {r.detail ? <span className={s.rowDetail}>{r.detail}</span> : null}
              </span>
              {r.action}
            </>
          );
          return (
            <li key={r.key ?? i} style={{ display: "contents" }}>
              {r.href ? (
                <a href={r.href} className={s.row}>
                  {inner}
                </a>
              ) : (
                <div className={s.row}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Right-side row text: "Edit" (brand), "Disconnect" (muted), "On" (green). */
export function RowAction({ children, tone = "link", href }: { children: ReactNode; tone?: "link" | "muted" | "on"; href?: string }) {
  const cls = cx(s.rowAction, tone === "muted" && s.rowActionMuted, tone === "on" && s.rowActionOn);
  return href ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <span className={cls}>{children}</span>
  );
}

/** ✓ (met, green) or ○ (missing, amber). */
export const MetGlyph = ({ met }: { met: boolean }) => (
  <span className={cx(s.rowGlyph, met ? s.rowGlyphMet : s.rowGlyphMissing)} role="img" aria-label={met ? "Verified" : "Not verified"}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {met ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <circle cx="12" cy="12" r="7.5" />}
    </svg>
  </span>
);

export function GoogleMark({ size = 16 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={assetSrc(google as string | { src: string })} alt="" width={size} height={size} className={s.rowIcon} />;
}

/** Numbered list (R-10 the three steps, R-14 selfie tips). */
export function StepList({ steps, tone = "dark", label }: { steps: { title: string; hint: string }[]; tone?: "dark" | "soft"; label: string }) {
  return (
    <ol className={s.box} aria-label={label}>
      {steps.map((st, i) => (
        <li key={st.title} className={s.stepRow}>
          <span className={cx(s.stepDot, tone === "dark" ? s.stepDotDark : s.stepDotSoft)} aria-hidden="true">
            {i + 1}
          </span>
          <span className={s.stepText}>
            <span className={s.stepTitle}>{st.title}</span>
            <span className={s.stepHint}>{st.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export const styles = s;
