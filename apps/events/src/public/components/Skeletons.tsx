import { Skeleton } from "@didit-events/ui";
import { SiteHeader } from "./SiteHeader";
import s from "./Skeletons.module.css";

/** loading.tsx for /e/[slug]: the P-01 grid in grey blocks (cover, title, meta, card). */
export function EventPageSkeleton() {
  return (
    <div className={s.page} aria-busy="true" aria-live="polite">
      <span className={s.srOnly}>Loading event…</span>
      <div className={s.header}>
        <Skeleton width={96} height={20} />
        <Skeleton width={120} height={20} />
      </div>
      <div className={s.grid}>
        <div className={s.col}>
          <Skeleton width="100%" height={330} className={s.cover} shimmer />
          <Skeleton width="60%" height={12} />
          <Skeleton width="80%" height={12} />
        </div>
        <div className={s.col}>
          <Skeleton width={180} height={24} shape="pill" />
          <Skeleton width="90%" height={44} />
          <Skeleton width="55%" height={44} />
          <Skeleton width="100%" height={220} className={s.card} shimmer />
          <Skeleton width="100%" height={14} />
          <Skeleton width="85%" height={14} />
        </div>
      </div>
    </div>
  );
}

/** loading.tsx for /events: header, banner and three rows. */
export function CalendarSkeleton() {
  return (
    <div className={s.page} aria-busy="true" aria-live="polite">
      <span className={s.srOnly}>Loading events…</span>
      <div className={s.header}>
        <Skeleton width={96} height={20} />
        <Skeleton width={72} height={32} shape="pill" />
      </div>
      <div className={s.list}>
        <Skeleton width="100%" height={200} className={s.banner} shimmer />
        <Skeleton width={240} height={32} />
        <Skeleton width={180} height={38} />
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.row}>
            <Skeleton width={80} height={16} />
            <Skeleton width="100%" height={130} className={s.card} shimmer />
          </div>
        ))}
      </div>
    </div>
  );
}

/** loading.tsx for the 390 guest screens (G-02, G-03). */
export function GuestSkeleton() {
  return (
    <div className={s.guest} aria-busy="true" aria-live="polite">
      <span className={s.srOnly}>Loading…</span>
      <SiteHeader signIn={false} />
      <div className={s.guestBody}>
        <Skeleton width="100%" height={60} className={s.card} />
        <Skeleton width={64} height={64} className={s.round} />
        <Skeleton width="80%" height={30} />
        <Skeleton width="100%" height={16} />
        <Skeleton width="70%" height={16} />
      </div>
    </div>
  );
}
