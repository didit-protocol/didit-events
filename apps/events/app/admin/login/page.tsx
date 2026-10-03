import { redirect } from "next/navigation";
import { parseLoginError, safeNext } from "../../../src/admin/login/signin";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams, error = parseLoginError(sp.error);
  const next = safeNext(sp.next);
  const params = new URLSearchParams({ next: new URL(next, "https://admin.invalid").pathname === "/admin/login" ? "/admin" : next });
  if (error === "expired") params.set("reason", "expired");
  else if (error) params.set("error", "google_failed");
  redirect(`/login?${params}`);
}
