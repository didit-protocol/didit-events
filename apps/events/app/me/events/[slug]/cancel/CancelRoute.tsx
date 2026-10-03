import { notFound, redirect } from "next/navigation";
import { CancelSheet } from "../../../../../src/accounts/components/CancelSheet";
import { StartedScreen } from "../../../../../src/accounts/components/StartedScreen";
import { accountLinks } from "../../../../../src/accounts/links";
import { cancelAction } from "./actions";
import { getCancelPage } from "./data";

/** Shared by /me/events/[slug]/cancel and /withdraw. */
export async function CancelRoute({ slug, intent, preview }: { slug: string; intent: "cancel" | "withdraw"; preview?: string }) {
  const page = await getCancelPage(slug, new Date(), intent, preview);
  if (page.kind === "not_found") notFound();
  if (page.kind === "sign_in") redirect(accountLinks.login(accountLinks.cancel(slug)));
  if (page.kind === "nothing") redirect(accountLinks.myEvent(slug));
  if (page.mode.mode === "started") return <StartedScreen event={page.event} account={page.account} />;
  return <CancelSheet event={page.event} mode={page.mode} action={cancelAction} />;
}
