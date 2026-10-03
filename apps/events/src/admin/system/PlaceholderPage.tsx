import { Skeleton } from "@didit-events/ui";
import s from "./System.module.css";

/** The dimmed page behind the A-13d/e/f frames: an event title, five stat skeletons and one big box. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className={s.placeholder} aria-hidden="true">
      <span className={s.placeholderTitle}>{title}</span>
      <div className={s.placeholderTiles}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={s.placeholderTile}>
            <Skeleton width="50%" height={8} />
            <Skeleton width="40%" height={24} />
          </div>
        ))}
      </div>
      <div className={s.placeholderBox} />
    </div>
  );
}
