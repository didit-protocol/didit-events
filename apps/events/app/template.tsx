import { ViewTransition, type ReactNode } from "react";

/**
 * Route changes inside the app (router.push / replace, <Link>, a redirect after an action) cross-fade the page: the
 * template remounts when the top-level route changes, so the old page exits and the new one enters in one View
 * Transition (class "page" in packages/ui tokens.css). `default="none"`: updates inside a page (a form step, a
 * refresh) never animate the whole page. Plain-link navigations get the same fade from `@view-transition` there.
 */
export default function RootTemplate({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      {children}
    </ViewTransition>
  );
}
