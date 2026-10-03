"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const snapshot = () => {
  const match = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("__Host-csrf="));
  try { return match ? decodeURIComponent(match.slice("__Host-csrf=".length)) : ""; } catch { return ""; }
};
/** B2 issues the readable CSRF cookie alongside the authenticated __Host-session cookie. */
export function VerificationCsrfField() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "");
  return <input type="hidden" name="csrf" value={value} />;
}
