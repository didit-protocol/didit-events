
import { CsrfField } from "../../auth/CsrfField";
import { ButtonLink, SubmitButton } from "@didit-events/ui";
import type { CardAction } from "../card";
import s from "./RegistrationCard.module.css";
import { VerificationCsrfField } from "../../verification/CsrfField";

/** Server actions a card button can post to (bound per route; frames pass the same functions). */
export interface CardActions {
  verify: (formData: FormData) => Promise<void>;
  subscribe: (formData: FormData) => Promise<void>;
}

const PENDING: Record<"verify" | "subscribe", string> = { verify: "Opening Didit…", subscribe: "Subscribing…" };

/** One card button: a link, or a one-button form that posts `slug` to a server action. */
export function CardButton({
  action,
  slug,
  actions,
  variant,
  fill,
  className,
}: {
  action: CardAction;
  slug: string;
  actions: CardActions;
  variant: "primary" | "secondary";
  /** Grow to fill the P-02 button row. Default: primary buttons without their own className. */
  fill?: boolean;
  /** Replaces the P-02 button sizing (header / calendar Subscribe, P-01 request button). */
  className?: string;
}) {
  const grow = fill ?? (variant === "primary" && !className);
  const cls = className ?? (grow ? s.cta : variant === "secondary" ? s.cta2 : undefined);
  if ("href" in action) {
    return (
      <ButtonLink
        href={action.href}
        variant={variant}
        size="lg"
        className={cls}
        {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : null)}
      >
        {action.label}
      </ButtonLink>
    );
  }
  return (
    <form action={actions[action.action]} className={grow ? s.ctaForm : undefined}><CsrfField />
      <input type="hidden" name="slug" value={slug} />
      <SubmitButton variant={variant} size="lg" className={cls} pendingLabel={PENDING[action.action]} block={grow}>
        {action.label}
      </SubmitButton>
      {action.action === "verify" ? <VerificationCsrfField /> : null}
    </form>
  );
}
