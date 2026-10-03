/**
 * Didit Brand v5 values used by the email templates. Email clients cannot read CSS custom properties, so these are
 * the literal values of the matching `packages/ui/src/tokens.css` variables (tokens.test.ts keeps them in sync).
 * Translucent tokens are pre-blended over the white card because Outlook ignores rgba().
 */
export const EMAIL_TOKENS = {
  white: "#FEFEFE", // --white
  ultraSoft: "#F8F8F8", // --ultra-soft
  soft: "#F4F4F6", // --soft
  midHigh: "#6E6E73", // --mid-high
  high: "#4B5058", // --high
  black: "#1A1A1A", // --black
  brand: "#2567FF", // --brand
  brandDeep: "#07479E", // --brand-deep
  successFg: "#0E7A3D", // --success-fg
  /** rgba(157,161,161,.4) (--mid at 40%, the design's hairline) over --white. */
  line: "#D7D9D9",
  /** --chip rgba(0,0,0,.04) over --white: the secondary pill button. */
  chip: "#F4F4F4",
  /** Fallback behind the hero band photo (bg-sky) when a client blocks background images. */
  skyFallback: "#DCE6F7",
} as const;

/** The CSS variable each literal mirrors (null = derived, see above). */
export const EMAIL_TOKEN_SOURCES: Record<keyof typeof EMAIL_TOKENS, string | null> = {
  white: "--white",
  ultraSoft: "--ultra-soft",
  soft: "--soft",
  midHigh: "--mid-high",
  high: "--high",
  black: "--black",
  brand: "--brand",
  brandDeep: "--brand-deep",
  successFg: "--success-fg",
  line: null,
  chip: null,
  skyFallback: null,
};

/**
 * Corner radii in px, mirroring `packages/ui/src/tokens.css` (tokens.test in email.test.ts keeps them in sync).
 * `cover`: the public event page cover (EventPage.module.css `.coverDesktop`, var(--radius-md)), reused by the email hero.
 */
export const EMAIL_RADII = { cover: 20 } as const;
export const EMAIL_RADIUS_SOURCES: Record<keyof typeof EMAIL_RADII, string> = { cover: "--radius-md" };

export const EMAIL_FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
