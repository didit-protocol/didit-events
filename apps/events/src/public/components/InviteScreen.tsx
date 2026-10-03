
import { CsrfField } from "../../auth/CsrfField";
import { Icon, SubmitButton, cx, type IconName } from "@didit-events/ui";
import { shortDate, time } from "../format";
import type { PublicEvent } from "../types";
import { SiteHeader } from "./SiteHeader";
import { SecuredByDidit } from "../../accounts/components/SecuredByDidit";
import layout from "./GuestLayout.module.css";
import s from "./InviteScreen.module.css";

const STEPS: { icon: IconName; title: string; hint: string }[] = [
  { icon: "user", title: "Confirm your name", hint: "First and last name, as on your ID" },
  { icon: "mail", title: "Verify your email", hint: "We send a 6-digit code" },
  { icon: "face-scan", title: "Take a quick selfie", hint: "A short liveness check" },
];

export interface InviteScreenProps {
  event: PublicEvent;
  firstName: string;
  token: string;
  /** Server action that opens the Didit hosted flow for this link. */
  start: (form: FormData) => Promise<void>;
}

/** G-02 default: the personal verification link, three Didit steps and "Start verification". */
export function InviteScreen({ event, firstName, token, start }: InviteScreenProps) {
  const tz = event.timeZone;
  return (
    <div className={layout.root}>
      <div className={cx(s.page, layout.canvas)}>
        <SiteHeader signIn={false} />
        <main className={cx(s.body, layout.card)}>
          <div className={s.intro}>
            <span className={s.hi}>{`HI ${firstName.toUpperCase()}`}</span>
            <h1 className={s.title}>
              You&apos;re invited to <span className={s.accent}>{event.title}</span>
            </h1>
            <p className={s.when}>
              {`${shortDate(event.startsAt, tz)} · ${time(event.startsAt, tz)}–${time(event.endsAt, tz)}`}
              <br />
              {`${event.venue.name}, ${event.venue.shortAddress}`}
            </p>
          </div>
          <ol className={s.steps} aria-label="Three steps with Didit">
            {STEPS.map((st) => (
              <li key={st.title} className={s.step}>
                <span className={s.stepIcon} aria-hidden="true">
                  <Icon name={st.icon} size={20} />
                </span>
                <span className={s.stepText}>
                  <span className={s.stepTitle}>{st.title}</span>
                  <span className={s.stepHint}>{st.hint}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className={s.privacy}>
            <Icon name="shield" size={18} className={s.shield} />
            Your selfie is used only to recognise you at the door. Handled by Didit.
          </p>
          <form action={start} className={cx(s.bottom, layout.inlineBottom)}><CsrfField />
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="slug" value={event.slug} />
            <SubmitButton size="xl" block pendingLabel="Opening Didit…" aria-describedby="invite-duration">
              Start verification
            </SubmitButton>
            <span id="invite-duration" className={s.duration}>
              Takes about 2 minutes
            </span>
            <SecuredByDidit />
          </form>
        </main>
      </div>
    </div>
  );
}
