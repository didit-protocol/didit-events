import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";
import { classes, spinnerSize, type ButtonLinkProps } from "./Button";
import { Spinner } from "./Spinner";
import styles from "./Display.module.css";

/*
 * Links that navigate on the client (next/link, prefetched) instead of loading a document: the admin's page-to-page
 * navigation. They live apart from Button and Display so that pages without them do not ship next/link.
 * Never for a link whose response changes cookies (sign-in, sign-out, door mode), a download or a route handler.
 */

/** ButtonLink, as client navigation. For pages of this app only. */
export function ClientButtonLink({ variant, size, block, state, className, children, loading, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classes({ variant, size, block }, className)} data-state={state} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={spinnerSize(size)} /> : null}
      {variant === "icon" && loading ? null : children}
    </Link>
  );
}

/* ── Breadcrumbs ─────────────────────────────────────────────── */
export interface Crumb {
  label: ReactNode;
  /** A page of this app ("/…") is client navigation; anything else is a plain link. */
  href?: string;
}

export function Breadcrumbs({ items, className, label = "Breadcrumb" }: { items: Crumb[]; className?: string; label?: string }) {
  return (
    <nav aria-label={label} className={cx(styles.crumbs, className)}>
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {last ? <span aria-current="page">{c.label}</span> : c.href ? /^\/(?!\/)/.test(c.href) ? <Link href={c.href}>{c.label}</Link> : <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
              {last ? null : (
                <span className={styles.sep} aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
