"use client";

import { Suspense, lazy } from "react";
import type { DoorAppProps } from "./DoorApp";

const DoorApp = lazy(() => import("./DoorApp").then((m) => ({ default: m.DoorApp })));

/**
 * The kiosk island of /door/kiosk, loaded on demand: the page server-renders in door mode and hydration waits for the
 * kiosk chunk. The Door tab (the launcher in the admin shell) is another route and never references it.
 * React.lazy, not next/dynamic: its loader runtime would add ~1.5 KB to the route's first-load JS.
 */
export function LazyDoorApp(props: DoorAppProps) {
  return (
    <Suspense fallback={null}>
      <DoorApp {...props} />
    </Suspense>
  );
}
