import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

/** outline = the white, bordered pill of "Continue with Google". */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "danger-outline" | "outline" | "icon";
/** xs = the 28px row action of design/05 AP-01 (0 12px, 500 12px). */
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";
/** Forces a visual state (frame gallery / docs only). */
export type ForcedState = "hover" | "pressed" | "focus";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  state?: ForcedState;
  children?: ReactNode;
}

export type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> };
export type ButtonLinkProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** The button class list, shared with ClientButtonLink (./ClientLink.tsx). */
export function classes({ variant = "primary", size = "md", block }: CommonProps, className?: string) {
  return cx(styles.button, styles[variant === "danger-outline" ? "dangerOutline" : variant], size !== "md" && styles[size], block && styles.block, className);
}

export const spinnerSize = (size?: ButtonSize) => (size === "xs" ? 10 : size === "sm" ? 12 : size === "xl" ? 16 : 14);

/** C-00 button: primary / secondary / ghost / destructive / danger-outline (01b: Revoke, End event) / icon; default, hover, pressed, focus, disabled, loading. */
export function Button({ variant, size, loading, block, state, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={classes({ variant, size, block }, className)}
      data-state={state}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={spinnerSize(size)} /> : null}
      {variant === "icon" && loading ? null : children}
    </button>
  );
}

/** A link styled as a button (navigation, not actions). A document load; ClientButtonLink navigates on the client. */
export function ButtonLink({ variant, size, block, state, className, children, loading, ...rest }: ButtonLinkProps) {
  return (
    <a className={classes({ variant, size, block }, className)} data-state={state} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={spinnerSize(size)} /> : null}
      {variant === "icon" && loading ? null : children}
    </a>
  );
}
