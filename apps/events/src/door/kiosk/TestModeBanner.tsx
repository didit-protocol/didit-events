import s from "./kiosk.module.css";

/** D-03: the persistent Test mode strip. Every result under it is what WOULD happen; nobody is checked in. */
export function TestModeBanner() {
  return (
    <div role="status" className={s.test}>
      TEST MODE — nobody is being checked in
    </div>
  );
}
