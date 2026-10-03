import { cx } from "@didit-events/ui";
import s from "./SocialIcons.module.css";

/** The official X and LinkedIn marks (24px brand paths, drawn in the text colour) and Didit's own profiles. */
export const SOCIAL = {
  x: {
    label: "Didit on X",
    href: "https://x.com/didit",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  linkedin: {
    label: "Didit on LinkedIn",
    href: "https://www.linkedin.com/company/91001155",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0h.003z",
  },
} as const;

export type SocialKind = keyof typeof SOCIAL;

/** One mark as a link: the 20px logo in a 44px touch target, named by `label` (default: Didit's profile). */
export function SocialLink({ kind, href = SOCIAL[kind].href, label = SOCIAL[kind].label, className }: { kind: SocialKind; href?: string; label?: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx(s.link, className)} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true" focusable="false">
        <path d={SOCIAL[kind].path} />
      </svg>
    </a>
  );
}

/** Didit on X and LinkedIn (site footer). */
export function SocialIcons({ className }: { className?: string }) {
  return (
    <ul className={cx(s.list, className)} aria-label="Didit on social media">
      <li>
        <SocialLink kind="x" />
      </li>
      <li>
        <SocialLink kind="linkedin" />
      </li>
    </ul>
  );
}
