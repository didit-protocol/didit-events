import { Banner } from "@didit-events/ui";
import { DIDIT_STATUS_URL, SYSTEM_COPY } from "./copy";
import s from "./System.module.css";

/** A-13e: the full-width strip shown while the Didit API is degraded (server-rendered from the system status). */
export function DiditApiBanner() {
  return (
    <Banner
      tone="warning"
      className={s.strip}
      action={
        <a className={s.stripCta} href={DIDIT_STATUS_URL} target="_blank" rel="noreferrer">
          {SYSTEM_COPY.diditApi.cta}
        </a>
      }
    >
      <span className={s.dot} aria-hidden="true" />
      <span>{SYSTEM_COPY.diditApi.text}</span>
    </Banner>
  );
}
