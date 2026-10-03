import { MarkLoader } from "@didit-events/ui";
import j from "./Join.module.css";

/** Its space is held while a step (or the flow's own code) downloads, so nothing jumps when it arrives. */
export function StepLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className={j.stepLoading}>
      <MarkLoader size={40} label={label} />
    </div>
  );
}
