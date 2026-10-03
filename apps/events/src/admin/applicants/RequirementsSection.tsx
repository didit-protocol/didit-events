import { ClientButtonLink } from "@didit-events/ui";
import { adminLinks } from "../links";
import type { RequirementSettings } from "./types";
import st from "../settings/Settings.module.css";

const ITEMS: [keyof RequirementSettings, string][] = [
  ["name", "Full name"],
  ["email", "Email"],
  ["liveness", "Selfie · liveness"],
  ["document", "ID document"],
  ["age18", "Age 18+"],
];

/** Event settings → "Verification requirements" (U3): a summary and the AP-27 editor (`?requirements=1`). */
export function RequirementsSection({ eventId, requirements }: { eventId: string; requirements: RequirementSettings }) {
  const on = ITEMS.filter(([k]) => requirements[k] === true).map(([, l]) => l);
  return (
    <section id="requirements" aria-labelledby="requirements-title" className={st.section}>
      <div className={st.titleRow}>
        <h2 id="requirements-title" className={st.title}>
          Verification requirements
        </h2>
        <ClientButtonLink variant="secondary" size="sm" href={`${adminLinks.tab(eventId, "settings")}?requirements=1`}>
          Edit requirements
        </ClientButtonLink>
      </div>
      <p className={st.note}>
        Guests verify: {on.join(" · ")}. Verifications newer than {requirements.reuseMonths} months are reused, so returning guests skip straight to their ticket.
      </p>
    </section>
  );
}
