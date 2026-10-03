import { Logo, cx } from "@didit-events/ui";
import s from "./SecuredByDidit.module.css";

/**
 * "Secured by Didit" with the official Didit logo: the one caption on every sign-in and verification surface
 * (email code, Google via Didit, profile, face check, request extras). Screen readers get the plain sentence; the
 * visible wordmark is decorative so it is not announced twice.
 */
export function SecuredByDidit({ align = "center", className }: { align?: "center" | "start"; className?: string }) {
  return (
    <p className={cx(s.caption, align === "start" && s.start, className)} data-secured-by-didit="">
      <span className={s.srOnly}>Secured by Didit</span>
      <span className={s.visual} aria-hidden="true">
        <svg className={s.lock} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>Secured by</span>
        <Logo variant="color" height={14} alt="" className={s.logo} />
      </span>
    </p>
  );
}
