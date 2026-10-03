import { CONTACT_EMAIL } from "../../config";
import { cx } from "@didit-events/ui";
import { links } from "../links";
import { SocialIcons } from "./SocialIcons";
import s from "./SiteFooter.module.css";

/**
 * The public footer (event page, calendar): the product line, the legal links and Didit on X and LinkedIn. Like the
 * header it measures its own width: one row on the header's 1000px column from 768px, stacked rows on the 16px phone
 * gutter below it (the logos on their own row above the legal links).
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cx(s.footer, className)}>
      <div className={s.inner}>
        <span className={s.note}>Didit Events · Face check-in by Didit.</span>
        <div className={s.end}>
          <span className={s.legal}>
            <a href={links.privacy()}>Privacy</a> · <a href={links.terms()}>Terms</a> · <a href={links.contact()}>{CONTACT_EMAIL}</a>
          </span>
          <SocialIcons className={s.social} />
        </div>
      </div>
    </footer>
  );
}
