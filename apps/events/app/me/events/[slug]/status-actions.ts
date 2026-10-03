import type { StatusActions } from "../../../../src/accounts/components/StatusScreen";
import { subscribeAction, verifyAction } from "../../../e/[slug]/actions";
import { joinWaitlistAction } from "../../../e/[slug]/register/actions";
import { newLinkAction, renewAction } from "./actions";

/** The server actions behind the status screen's buttons (a plain module: "use server" files export functions only). */
export const statusActions: StatusActions = {
  verify: verifyAction,
  subscribe: subscribeAction,
  joinWaitlist: joinWaitlistAction,
  renew: renewAction,
  newLink: newLinkAction,
};
