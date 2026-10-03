import { accountLinks } from "../links";
import { RequestJoinContent, type RequestJoinProps } from "./RequestJoinContent";
import { EventChip, GuestScreen } from "./Screen";
export type { RequestJoinProps } from "./RequestJoinContent";

/** Static event layout stays on the server; only request interactions hydrate. */
export function RequestJoin(props:RequestJoinProps) {
  return <GuestScreen header="events" sheet={{event:props.event,variant:"flow"}} labelledBy="request-title" closeHref={accountLinks.event(props.event.slug)}>
    <EventChip event={props.event} variant="flow" />
    <RequestJoinContent {...props} />
  </GuestScreen>;
}
