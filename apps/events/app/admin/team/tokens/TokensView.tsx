import type { ReactNode } from "react";
import { ClientButtonLink, Skeleton, StatusPill } from "@didit-events/ui";
import { adminLinks } from "../../../../src/admin/links";
import { fmtWhen } from "../../../../src/admin/person/format";
import { PEOPLE_TZ } from "../../../../src/admin/people/query";
import { PageHeading } from "../../../../src/admin/shell/PageHeading";
import shell from "../../../../src/admin/shell/AdminShell.module.css";
import s from "./tokens.module.css";

export interface TokenRow {
  id: string;
  name: string;
  staffEmail?: string;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TokensViewProps {
  /** Whose tokens these are (shown in the description). */
  email: string;
  /** Null while loading. */
  tokens: TokenRow[] | null;
  now: Date;
  /** The create form (a client component) and each row's Revoke control: the page wires the server actions. */
  form?: ReactNode;
  revoke?: (token: TokenRow) => ReactNode;
}

const when = (d: Date, withTime = false) => fmtWhen(d.toISOString(), PEOPLE_TZ, withTime);
export const tokenStatus = (t: TokenRow, now: Date) => (t.revokedAt ? "Revoked" : t.expiresAt.getTime() <= now.getTime() ? "Expired" : "Active");

/**
 * Personal access tokens (owners and admins): create one, then the list. A table on wide columns and one card per
 * token on narrow ones (same DOM; tokens.module.css switches on the page box's width). Dates are formatted on the
 * server in the admin time zone ("2 Oct 2026, 10:14"), never as raw ISO strings.
 */
export function TokensView({ email, tokens, now, form, revoke }: TokensViewProps) {
  return (
    <div className={`${shell.page} ${s.page}`} aria-busy={tokens === null || undefined}>
      <PageHeading
        title="Personal access tokens"
        description={email ? `Connect an MCP client to Didit Events as ${email}. Revoking a token stops its access immediately.` : "Connect an MCP client to Didit Events. Revoking a token stops its access immediately."}
        actions={
          <ClientButtonLink variant="secondary" size="sm" href={adminLinks.team()}>
            Back to team
          </ClientButtonLink>
        }
      />
      {form}
      <section className={s.section} aria-labelledby="your-tokens">
        <h2 id="your-tokens" className={s.title}>
          Active team tokens
        </h2>
        {tokens === null ? (
          <div className={s.skLine} aria-hidden="true">
            <Skeleton height={36} />
            <Skeleton height={52} />
            <Skeleton height={52} />
          </div>
        ) : tokens.length === 0 ? (
          <div className={s.empty}>
            <span className={s.emptyTitle}>No tokens yet.</span>
            <span className={s.emptyHelp}>Create one above to connect a client.</span>
          </div>
        ) : (
          <div role="table" aria-label="Active team tokens" className={s.table}>
            <div role="rowgroup">
              <div role="row" className={`${s.row} ${s.head}`}>
                <span role="columnheader">Name</span>
                <span role="columnheader">Last used</span>
                <span role="columnheader">Expires</span>
                <span role="columnheader">Status</span>
                <span role="columnheader" className={s.srOnly}>
                  Actions
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {tokens.map((t) => {
                const status = tokenStatus(t, now);
                const used = t.lastUsedAt ? when(t.lastUsedAt, true) : "Never";
                return (
                  <div key={t.id} role="row" className={s.row}>
                    <span role="cell" className={s.token}>
                      <span className={s.tokenName}>{t.name}</span>
                      <span className={s.tokenId}>{t.staffEmail ?? email}</span>
                      <span className={s.tokenId}>dev_{t.id.slice(0, 8)}</span>
                      {/* Narrow layout only (CSS): the hidden LAST USED and EXPIRES columns, under the name. */}
                      <span className={s.sub}>
                        <span>Last used {used === "Never" ? "never" : used} ·</span> <span>Expires {when(t.expiresAt)}</span>
                      </span>
                    </span>
                    <span role="cell" className={s.secondary}>
                      {t.lastUsedAt ? <time dateTime={t.lastUsedAt.toISOString()}>{used}</time> : used}
                    </span>
                    <span role="cell" className={s.secondary}>
                      <time dateTime={t.expiresAt.toISOString()}>{when(t.expiresAt)}</time>
                    </span>
                    <span role="cell">
                      <StatusPill status={status === "Active" ? "live" : "ended"}>{status}</StatusPill>
                    </span>
                    <span role="cell" className={s.actions}>
                      {t.revokedAt ? null : revoke?.(t)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
