import type { ButtonHTMLAttributes, MouseEvent } from "react";
import google from "../assets/google.svg";
import { assetSrc } from "../Logo";
import { Button, ButtonLink } from "./Button";
import styles from "./GoogleButton.module.css";

export type GoogleButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  loading?: boolean;
  label?: string;
  loadingLabel?: string;
  /** Renders a link (e.g. the OIDC start URL) instead of a button. */
  href?: string;
  /** With `href`: runs before the navigation (it may cancel it to show something in place first). */
  onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** dark = the staff A-01 pill (44px black, G in a white disc); outline = the guest sign-in (05 U-*, DA-*): white, bordered, bare G. */
  variant?: "dark" | "outline";
  /** outline only: the shared button sizes, xl = 52px / 500 16px (mobile U-*), lg = 44px / 500 15px (desktop DA-*, the join modal). */
  size?: "lg" | "xl";
};

/**
 * "Continue with Google" (A-01, U-01, DA-01): default and signing-in states. It is the shared Button (full width) with
 * the G in front, so its height, padding, radius and phone tap target are those of any other button of the same size.
 */
export function GoogleButton({
  loading,
  label = "Continue with Google",
  loadingLabel = "Signing in…",
  href,
  onNavigate,
  variant = "dark",
  size = "xl",
  className,
  ...rest
}: GoogleButtonProps) {
  const outline = variant === "outline";
  const look = { variant: outline ? "outline" : "primary", size: outline ? size : "lg", block: true, className } as const;
  const content = (
    <>
      {loading ? null : outline ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assetSrc(google as string | { src: string })} alt="" width={20} height={20} className={styles.bare} />
      ) : (
        <span className={styles.disc} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetSrc(google as string | { src: string })} alt="" width={12} height={12} />
        </span>
      )}
      {loading ? loadingLabel : label}
    </>
  );
  if (href && !loading) {
    return (
      <ButtonLink href={href} onClick={onNavigate} {...look}>
        {content}
      </ButtonLink>
    );
  }
  return (
    <Button {...look} loading={loading} {...rest}>
      {content}
    </Button>
  );
}
