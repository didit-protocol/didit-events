import { Skeleton } from "@didit-events/ui";
import s from "../../../../../../../src/admin/settings/Settings.module.css";

// A-11 while the settings load: the section nav and three section skeletons.
export default function EventSettingsLoading() {
  return (
    <div className={s.layout} aria-busy="true" aria-label="Loading settings">
      <div className={s.nav}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="70%" height={12} />
        ))}
      </div>
      <div className={s.content}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.section}>
            <Skeleton width={160} height={14} />
            <Skeleton height={36} />
          </div>
        ))}
      </div>
    </div>
  );
}
