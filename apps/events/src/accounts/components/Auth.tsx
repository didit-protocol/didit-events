import type { MouseEvent, ReactNode } from "react";
import { ButtonLink, GoogleButton, HEADER_LOGO_HEIGHT, Icon, Logo } from "@didit-events/ui";
import { coverPhoto, coverSrc } from "../../public/photos";
import type { PublicEvent } from "../../public/types";
import { cta2Class, styles as screen } from "./Screen";
import s from "./Auth.module.css";

/**
 * Sign-in choices of the guest flow (05 U-01, U-23, U-24; DA-01): Continue with Google (Didit sign-in, idp=google),
 * an "or" rule, then Continue with email. `onEmail` switches the step in place; `emailHref` navigates.
 */
export function AuthChoices({
  googleHref,
  googlePending,
  googleDisabled,
  onEmail,
  emailHref,
  size = "xl",
}: {
  googleHref: string;
  googlePending?: boolean;
  googleDisabled?: boolean;
  onEmail?: () => void;
  emailHref?: string;
  size?: "lg" | "xl";
}) {
  return (
    <div className={screen.auth}>
      {googlePending ? (
        <GoogleButton variant="outline" size={size} loading loadingLabel="Signing in with Google…" />
      ) : (
        googleDisabled ? <GoogleButton variant="outline" size={size} disabled /> : <GoogleButton variant="outline" size={size} href={googleHref} />
      )}
      <div className={screen.or}>or</div>
      {onEmail ? (
        <button type="button" onClick={onEmail} className={screen.emailButton}>
          <Icon name="mail" size={18} />
          Continue with email
        </button>
      ) : emailHref ? (
        <ButtonLink href={emailHref} variant="secondary" size="xl" block>
          <Icon name="mail" size={18} />
          Continue with email
        </ButtonLink>
      ) : null}
    </div>
  );
}

/** The DA-* page: a schematic event page, the scrim, and the 440px card with the logo and a close button. */
export function AuthModal({ closeHref, onClose, labelledBy, event, children }: { closeHref: string; onClose?: (e: MouseEvent<HTMLAnchorElement>) => void; labelledBy: string; event?: PublicEvent; children: ReactNode }) {
  return (
    <div className={s.page}>
      <div className={s.behind} aria-hidden="true">
        <div className={s.behindCover} style={{ backgroundImage: `url(${event ? coverSrc(event.cover, 720) : coverPhoto("sky")})` }} />
        <div className={s.behindCol}>
          <div className={`${s.bar} ${s.bar1}`} />
          <div className={`${s.bar} ${s.bar2}`} />
          <div className={s.card0} />
        </div>
      </div>
      <div className={s.scrim}>
        <main role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={s.modal}>
          <div className={s.top}>
            <Logo variant="color" height={HEADER_LOGO_HEIGHT} alt="Didit" />
            <a href={closeHref} className={s.close} aria-label="Close" onClick={onClose}>
              ×
            </a>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

export const authStyles = s;
export { cta2Class };
