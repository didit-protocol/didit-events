import { Skeleton } from "@didit-events/ui";
import s from "../../../../../../../src/door/Door.module.css";

// While the Door tab loads: the launcher card and the doors line (the header and the open tab stay from the layout).
export default function DoorTabLoading() {
  return (
    <div className={s.page} aria-busy="true" aria-label="Loading door">
      <div className={s.card}>
        <Skeleton width={160} height={18} />
        <Skeleton width="85%" height={10} />
        <Skeleton height={36} />
        <Skeleton width={150} height={36} />
      </div>
      <Skeleton width="60%" height={10} />
    </div>
  );
}
