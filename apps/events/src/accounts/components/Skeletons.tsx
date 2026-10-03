import { Skeleton, cx } from "@didit-events/ui";
import layout from "../../public/components/GuestLayout.module.css";
import { SiteHeaderBar } from "../../public/components/SiteHeaderBar";
import s from "./Screen.module.css";

/**
 * loading.tsx for the 390 guest flow: header, chip, icon, title and body lines, the CTA. `sheet` routes (sign-in,
 * request, cancel, delete) load inside the frame GuestScreen gives them: a full-screen step below 768px and the centred
 * modal over the dimmed backdrop from 768px, so the loaded sheet replaces the skeleton in place instead of a phone
 * column turning into a modal.
 */
export function FlowSkeleton({ sheet, rows = 0 }: { sheet?: boolean; rows?: number }) {
  if (sheet)
    return (
      <div className={cx(layout.root, layout.wModal)} aria-busy="true">
        <span className={s.srOnly} role="status">
          Loading…
        </span>
        <div className={cx(s.page, s.pageSheet)} aria-hidden="true">
          <div className={s.sheetBackdrop}>
            <div className={s.backdrop} />
            <div className={s.scrim} />
          </div>
          <div className={cx(s.sheet, layout.modal)}>
            <div className={s.sheetTop}>
              <Skeleton width={78} height={24} />
              <span className={s.sheetName} />
              <Skeleton width={32} height={32} shape="pill" />
            </div>
            <Skeleton width="70%" height={28} />
            <Skeleton width="90%" height={14} />
            <Skeleton width="60%" height={14} />
            {Array.from({ length: rows }, (_, i) => (
              <Skeleton key={i} height={56} />
            ))}
            <Skeleton height={44} shape="pill" />
            <Skeleton height={44} shape="pill" />
          </div>
        </div>
      </div>
    );
  return (
    <div className={s.page} aria-busy="true">
      <span className={s.srOnly} role="status">
        Loading…
      </span>
      <SiteHeaderBar>
        <Skeleton width={32} height={32} shape="pill" />
      </SiteHeaderBar>
      <div className={s.body} aria-hidden="true">
        <Skeleton height={64} />
        <Skeleton width={56} height={56} shape="pill" />
        <Skeleton width="70%" height={28} />
        <Skeleton width="90%" height={14} />
        <Skeleton width="60%" height={14} />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={56} />
        ))}
        <div className={s.spacer} />
        <Skeleton height={52} />
      </div>
    </div>
  );
}
