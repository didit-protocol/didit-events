"use client";

import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";
import s from "./EventForm.module.css";

/**
 * The editor parts below the fold (and the leave guard), code-split with React.lazy: they server-render with the
 * page, and their client code loads as separate chunks so the editor's first-load JS stays within its budget
 * (scripts/size-budgets.json). React.lazy instead of next/dynamic keeps the loadable runtime out of the route.
 */
function split<P extends object>(load: () => Promise<ComponentType<P>>, placeholder = true) {
  const Lazy = lazy(async () => ({ default: await load() }));
  function Split(props: P) {
    return (
      <Suspense fallback={placeholder ? <div className={s.sectionLoading} aria-hidden="true" /> : null}>
        <Lazy {...(props as ComponentProps<typeof Lazy>)} />
      </Suspense>
    );
  }
  return Split;
}

export const MarkdownEditor = split(() => import("./MarkdownEditor").then((m) => m.MarkdownEditor));
export const AgendaField = split(() => import("./AgendaField").then((m) => m.AgendaField));
export const FormBuilder = split(() => import("./FormBuilder").then((m) => m.FormBuilder));
export const VerificationSection = split(() => import("./VerificationSection").then((m) => m.VerificationSection));
export const DoorSection = split(() => import("./DoorSection").then((m) => m.DoorSection));
export const EmailEditor = split(() => import("./EmailEditor").then((m) => m.EmailEditor));
// The leave-page guard must be active from the first render (a quick Cancel click must still be caught): not split.
export { LeaveGuard } from "./LeaveGuard";
