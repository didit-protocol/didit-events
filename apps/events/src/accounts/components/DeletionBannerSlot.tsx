"use client";

import { lazy, Suspense, type ComponentProps } from "react";

// The banner (v5 deletion grace period) is its own chunk: the root layout ships only this slot to every route.
const DeletionBanner = lazy(() => import("./DeletionBanner").then((m) => ({ default: m.DeletionBanner })));

export function DeletionBannerSlot(props: ComponentProps<typeof DeletionBanner>) {
  return (
    <Suspense fallback={null}>
      <DeletionBanner {...props} />
    </Suspense>
  );
}
