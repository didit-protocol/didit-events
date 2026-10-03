import ns from "./NotStaff.module.css";
import { switchAccountAction } from "../../../app/me/settings/actions";
import { CsrfField } from "../../auth/CsrfField";
import { Avatar, Button, ButtonLink, Logo, ToneIcon } from "@didit-events/ui";
import { accountLinks } from "../../accounts/links";
import { CONTACT_EMAIL } from "../../config";
import { adminLinks } from "../links";
import { LOGIN_COPY } from "../login/signin";
import { SYSTEM_COPY } from "./copy";
import { SystemMessage } from "./SystemMessage";

/** A-13a: /admin/events/[id] for an id that does not exist (the event layout calls notFound()). */
export function EventNotFound() {
  const copy = SYSTEM_COPY.notFound;
  return <SystemMessage code={copy.code} title={copy.title} help={copy.help} action={<ButtonLink href={adminLinks.home()}>{copy.cta}</ButtonLink>} />;
}

/** A-13b: an account without staff access can return to the site or sign out. */
export function NotStaff({ email, name, photoUrl, next = adminLinks.home() }: { email?: string; name?: string; photoUrl?: string; next?: string }) {
  if (!email) {
    const copy = SYSTEM_COPY.forbidden;
    return <SystemMessage code={copy.code} title={copy.title} help={LOGIN_COPY.lead} action={<><ButtonLink href="/events" variant="secondary">View site</ButtonLink><ButtonLink href={accountLinks.login(next)}>Sign in</ButtonLink></>} />;
  }
  const didit = email.toLowerCase().endsWith("@didit.me");
  const subject = encodeURIComponent("Didit Events admin access");
  const body = encodeURIComponent(`Hi, please give ${email} access to the Didit Events admin.`);
  return (
    <main className={ns.page}>
      <section className={ns.card} aria-labelledby="not-staff-title">
        <Logo variant="color" height={24} className={ns.logo} />
        <ToneIcon tone="neutral" glyph="!" size={56} />
        <span className={ns.eyebrow}>No access</span>
        <h1 id="not-staff-title" className={ns.title}>This account doesn’t have access here</h1>
        <p className={ns.lead}>
          {didit
            ? "You’re signed in, but this Didit account isn’t on the Didit Events team yet, or your role can’t open this page. An owner can invite you from Team."
            : "This account isn’t on this event’s team, or its role can’t open this page. Ask the event’s host to add you from the event’s Team tab, then sign in with the email they invited."}
        </p>
        <div className={ns.account} aria-label="Signed in account">
          <Avatar name={name ?? ""} email={email} src={photoUrl} size={40} />
          <span className={ns.who}>
            {name ? <span className={ns.name}>{name}</span> : null}
            <span className={ns.email}>{email}</span>
          </span>
          <span className={ns.chip}>Signed in</span>
          <span className={ns.srOnly}>Signed in as {email}</span>
        </div>
        <div className={ns.actions}>
          <ButtonLink href="/events" block>Go to Didit Events</ButtonLink>
          <form action={switchAccountAction}><CsrfField /><Button type="submit" variant="secondary" block>Use a different account</Button></form>
        </div>
        <p className={ns.request}>Need access? <a href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}>Ask the Didit Events team</a></p>
      </section>
    </main>
  );
}
