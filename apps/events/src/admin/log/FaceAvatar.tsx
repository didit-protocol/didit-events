import s from "./Log.module.css";

/** The neutral avatar of a face that matched nobody on the list ("Unknown face"). */
export function FaceAvatar({ size = 32, label = "Unknown face" }: { size?: number; label?: string }) {
  return (
    <span role="img" aria-label={label} className={s.face} style={{ width: size, height: size }}>
      <svg width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c1.2-3.4 3.9-5 7-5s5.8 1.6 7 5" />
      </svg>
    </span>
  );
}
