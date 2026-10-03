import { Banner, Button, Skeleton, cx } from "@didit-events/ui";
import shell from "../shell/AdminShell.module.css";
import s from "./RouteStates.module.css";

/**
 * Error body for the A-03/A-10/A-11/A-20 route error boundaries (error.tsx is the client part; this stays tiny).
 * `tight` = inside the event tabs layout (the header and tabs stay above it).
 */
export function RouteError({ what, onRetry, tight }: { what: string; onRetry: () => void; tight?: boolean }) {
  return (
    <div className={cx(tight ? s.tight : shell.page)}>
      <Banner tone="danger" action={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}>
        We couldn’t load {what}. Try again, or reload the page if it keeps happening.
      </Banner>
    </div>
  );
}

/** A-03 loading: the header and the two columns as skeleton bars. */
export function EventFormSkeleton() {
  return (
    <div className={cx(shell.page, s.skeleton)} aria-busy="true" aria-label="Loading event">
      <div className={s.col}>
        <Skeleton width={160} height={12} />
        <Skeleton width={220} height={28} />
      </div>
      <div className={s.grid}>
        <div className={s.col}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={s.field}>
              <Skeleton width={90} height={12} />
              <Skeleton height={36} />
            </div>
          ))}
          <Skeleton height={120} />
        </div>
        <Skeleton height={260} />
      </div>
    </div>
  );
}
