import type { ReactNode } from "react";
import { requireEventAccess } from "../../../../../../../src/auth/access";

// The capability gate sits above this tab's loading.tsx (as on Settings): door operators get a real 403, not a
// forbidden() streamed inside the Suspense boundary after the 200 status was sent.
export default async function EventTeamGate({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  await requireEventAccess((await params).id, "team.view");
  return children;
}
