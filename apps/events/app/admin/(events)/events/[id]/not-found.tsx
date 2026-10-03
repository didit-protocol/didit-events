import { EventNotFound } from "../../../../../src/admin/system/SystemPages";

// A-13a: the event layout (and any tab) calls notFound() for an unknown id; the sidebar layout stays around it.
export default function EventNotFoundPage() {
  return <EventNotFound />;
}
