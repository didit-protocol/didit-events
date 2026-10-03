import { redirect } from "next/navigation";
import { IdentityError } from "@didit-events/core/identity";
import { pendingAccountAction, type PendingAccountAction } from "../../../src/auth/fresh-action";
import { identity } from "../../../src/auth/runtime";
import { ReproofForm } from "./ReproofForm";

export const metadata = { title: "Confirm it’s you · Didit Events", robots: { index: false } };
export default async function ReproofPage() {
  let pending: PendingAccountAction;
  try { pending = await pendingAccountAction();
  } catch (error) {
    if (error instanceof IdentityError && error.code === "InvalidPendingAction") redirect("/me/settings");
    throw error;
  }
  const account = await identity.accounts.get(pending.accountId);
  if (!account) redirect("/me/settings");
  return <ReproofForm email={account.email} next={pending.next} />;
}
