"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

export type SubmitButtonProps = Omit<ButtonProps, "type" | "loading"> & {
  /** Label while the form's action is in flight (e.g. "Sending request…"). Defaults to the children. */
  pendingLabel?: string;
  /** Forces the pending look (frame gallery / docs only). */
  pending?: boolean;
};

/** A submit button that shows the C-00 loading state while its parent <form>'s action runs. */
export function SubmitButton({ pendingLabel, pending: forced, children, ...rest }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const busy = forced || pending;
  return (
    <Button type="submit" loading={busy} {...rest}>
      {busy && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
