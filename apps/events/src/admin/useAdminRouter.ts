"use client";

import { useContext } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

export interface AdminRouter {
  push: (href: string, options?: { scroll?: boolean }) => void;
  refresh: () => void;
}

/** Outside the app router (render tests, a static frame export) navigation falls back to plain page loads. */
const FALLBACK: AdminRouter = {
  push: (href) => window.location.assign(href),
  refresh: () => window.location.reload(),
};

/**
 * `useRouter()` without the "app router not mounted" invariant: the admin's client components also server-render in
 * the /_frames gallery tests, where no router is mounted.
 */
export function useAdminRouter(): AdminRouter {
  return useContext(AppRouterContext) ?? FALLBACK;
}
