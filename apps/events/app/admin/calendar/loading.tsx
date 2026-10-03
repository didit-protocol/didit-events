import { Skeleton } from "@didit-events/ui";
import { PageHeading } from "../../../src/admin/shell/PageHeading";
import shell from "../../../src/admin/shell/AdminShell.module.css";

export default function CalendarLoading() {
  return (
    <div className={shell.page} aria-busy="true">
      <PageHeading title="Calendar" description="The public calendar page at /events: banner, logo, name, bio and links." />
      <Skeleton height={200} />
      <Skeleton height={320} />
    </div>
  );
}
