import { Skeleton } from "@didit-events/ui";
import s from "../../../../../../../src/admin/event-team/EventTeam.module.css";

// While the team loads: the two cards (the header stays from the layout).
export default function EventTeamLoading() {
  return (
    <div className={s.page} aria-busy="true" aria-label="Loading team">
      {[0, 1].map((i) => (
        <div key={i} className={s.card}>
          <Skeleton width={120} height={14} />
          <Skeleton width="70%" height={10} />
          <Skeleton height={36} />
        </div>
      ))}
    </div>
  );
}
