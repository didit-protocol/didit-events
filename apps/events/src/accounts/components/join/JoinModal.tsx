"use client";

import { JoinFlow, type JoinFlowProps } from "./JoinFlow";
import { JoinShell } from "./JoinShell";

/**
 * The join modal (desktop) / bottom sheet (phones) with its flow: one lazy chunk, opened by JoinLauncher. `flowKey`
 * changes when the guest's state is replaced as a whole (signed out → signed in): the flow starts over inside the same
 * shell. `instant`: it takes the place of the launcher's placeholder, which already played the entrance.
 */
export default function JoinModal({ flowKey, instant, ...props }: JoinFlowProps & { onClose: () => void; flowKey?: string; instant?: boolean }) {
  return (
    <JoinShell eventName={props.event.title} onClose={props.onClose} focusKey={flowKey} instant={instant}>
      <JoinFlow key={flowKey} {...props} />
    </JoinShell>
  );
}
