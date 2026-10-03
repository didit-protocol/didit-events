"use client";

import type { SocialSuggestion } from "../social-suggest";
import o from "./Onboarding.module.css";

/** `field`: the input the chip fills (it takes focus after the pick, as the chip itself goes away). */
export interface SocialChip extends SocialSuggestion { network: "linkedin" | "x"; field: string }

/**
 * "Is this you? linkedin.com/in/…" buttons under a link field. The row always keeps its height (no jump when the
 * lookup lands or comes back empty) and is a polite live region, so new chips are announced once. `collapseEmpty`
 * (the account editor, where filled links mean no lookup at all) keeps no row and shows no pending pill: the row only
 * appears with real chips, so a lookup that finds nothing never moves the fields below it.
 */
export function SocialChips({ loading, chips, onPick, disabled, collapseEmpty }: { loading: boolean; chips: SocialChip[]; onPick: (chip: SocialChip) => void; disabled?: boolean; collapseEmpty?: boolean }) {
  return (
    <div className={collapseEmpty && !chips.length ? `${o.suggest} ${o.suggestEmpty}` : o.suggest} aria-live="polite" aria-busy={loading || undefined} data-social-chips="">
      {loading && !collapseEmpty ? <span className={o.suggestPending} aria-hidden="true" /> : chips.map((c) => (
        <button key={c.url} type="button" className={o.chip} onClick={(e) => {
            const input = e.currentTarget.form?.elements.namedItem(c.field);
            onPick(c);
            if (input instanceof HTMLInputElement) input.focus();
          }} disabled={disabled || loading} data-network={c.network}>
          <span className={o.chipAsk}>Is this you?</span> <span className={o.chipUrl}>{c.label}</span>
        </button>
      ))}
    </div>
  );
}
