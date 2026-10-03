import type { ReactNode } from "react";
import { requireEventAccess } from "../../../../../../../src/auth/access";

// The capability gate sits above this tab's loading.tsx: a forbidden() thrown by the page itself would stream inside
// the Suspense boundary after the 200 status was sent. Here it is part of the shell, so operators get a real 403.
export default async function SettingsGate({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  await requireEventAccess((await params).id, "event.edit");
  return children;
}
