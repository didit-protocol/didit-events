"use client";

import { useEffect, useState } from "react";

/**
 * "Is this you?" on the profile link fields: GET /api/me/profile/suggestions for the name and company being typed
 * (debounced, the previous lookup aborted). Every failure, a 204 (feature off) and a body off the contract read as
 * "no suggestions": the chips simply never appear.
 */
export interface SocialSuggestion { url: string; label: string }
export interface SocialSuggestions { linkedin: SocialSuggestion[]; x: SocialSuggestion[] }
export type SuggestSocial = (query: { name: string; company: string }, signal: AbortSignal) => Promise<SocialSuggestions>;

export const NO_SUGGESTIONS: SocialSuggestions = { linkedin: [], x: [] };
export const SUGGEST_DEBOUNCE_MS = 600;

const list = (v: unknown): SocialSuggestion[] =>
  Array.isArray(v) ? v.filter((s): s is SocialSuggestion => typeof s?.url === "string" && /^https:\/\//.test(s.url) && typeof s?.label === "string").slice(0, 2) : [];

export const httpSuggestSocial: SuggestSocial = async ({ name, company }, signal) => {
  try {
    const res = await fetch(`/api/me/profile/suggestions?${new URLSearchParams({ name, company })}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal });
    if (res.status !== 200) return NO_SUGGESTIONS;
    const body = (await res.json()) as { ok?: unknown; data?: { linkedin?: unknown; x?: unknown } };
    return body?.ok === true ? { linkedin: list(body.data?.linkedin), x: list(body.data?.x) } : NO_SUGGESTIONS;
  } catch {
    return NO_SUGGESTIONS;
  }
};

/** Same gate as the server: two name words of two letters or more, and a company. */
export const canSuggest = (name: string, company: string) => name.trim().split(/\s+/).filter((t) => t.length >= 2).length >= 2 && company.trim().length > 0;

/**
 * `enabled` false (every link slot already filled): no lookup, nothing in flight. Results stay while the guest
 * keeps typing elsewhere; a new name or company replaces them.
 */
export function useSocialSuggestions(name: string, company: string, enabled: boolean, suggest: SuggestSocial = httpSuggestSocial) {
  const ready = enabled && canSuggest(name, company);
  const key = ready ? `${name.trim()}\n${company.trim()}` : "";
  const [found, setFound] = useState<{ key: string; suggestions: SocialSuggestions } | null>(null);
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    const [n, c] = key.split("\n") as [string, string];
    const timer = setTimeout(() => {
      void suggest({ name: n, company: c }, ctrl.signal).then((suggestions) => {
        if (!ctrl.signal.aborted) setFound({ key, suggestions });
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, suggest]);
  const current = found && found.key === key ? found.suggestions : null;
  return { loading: Boolean(key) && !current, suggestions: current ?? NO_SUGGESTIONS };
}
