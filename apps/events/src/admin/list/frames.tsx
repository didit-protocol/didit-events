/** A-02 Events list (design/01 Admin): four 1440×900 states plus the 1024 and 390 layouts of the populated list. */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { ALBERTO } from "../fixtures";
import { adminFrame } from "../frame";
import { AdminShell } from "../shell/AdminShell";
import { EventsList } from "./EventsList";
import { filterEvents, statusCounts } from "./filter";
import { ADMIN_EVENTS } from "./fixtures";
import type { AdminEventRow, StatusFilter } from "./types";

const list = (all: AdminEventRow[], q = "", status: StatusFilter = "all", loading = false) =>
  function EventsListFrame() {
    return (
      <AdminShell fill active="events" user={ALBERTO}>
        <EventsList events={loading ? null : filterEvents(all, { q, status })} counts={statusCounts(all)} q={q} status={status} />
      </AdminShell>
    );
  };

export const listFrames: FrameDef[] = [
  adminFrame("A-02a", "A-02 Events list / populated", 1440, 900, list(ADMIN_EVENTS)),
  adminFrame("A-02b", "A-02 Events list / loading", 1440, 900, list(ADMIN_EVENTS, "", "all", true)),
  adminFrame("A-02c", "A-02 Events list / empty", 1440, 900, list([])),
  adminFrame("A-02d", "A-02 Events list / no results", 1440, 900, list(ADMIN_EVENTS, "valencia")),
  adminFrame("A-02-1024", "A-02 Events 1024", 1024, 900, list(ADMIN_EVENTS)),
  adminFrame("A-02-390", "A-02 Events 390", 390, 844, list(ADMIN_EVENTS)),
];
