import { CtaLink, FlowIcon, GuestScreen, Lead, Spacer, Title } from "./Screen";

/** 05 U-19: Google and the email code resolve to one account by verified email, never two accounts for one email. */
export function LinkedScreen({ email, initials, next }: { email: string; initials: string; next: string }) {
  return (
    <GuestScreen header="account" initials={initials} labelledBy="linked-title">
      <FlowIcon status="success" />
      <Title id="linked-title">Same account, new way in</Title>
      <Lead>{`${email} already had an account created with Google. You are now signed in to it with your email code too.`}</Lead>
      <Spacer />
      <CtaLink href={next}>Continue</CtaLink>
    </GuestScreen>
  );
}
