"use client";

import { createContext, useContext } from "react";
import type { ApplicantCounts, ApplicantTab } from "./types";

/** The segment counts with the list's optimistic moves applied (provided by `ApplicantsReview` around its toolbar). */
export const CountsContext = createContext<ApplicantCounts | null>(null);

/** One toolbar segment count: the server number until a decision moves rows, then the moved number. */
export function SegCount({ tab, count }: { tab: ApplicantTab; count: number }) {
  return useContext(CountsContext)?.[tab] ?? count;
}
