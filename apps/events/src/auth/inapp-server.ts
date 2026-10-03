import { headers } from "next/headers";
import { inAppInfo, type InAppInfo } from "./inapp";

/** The in-app browser flag of this request (null in a real browser). `path`: the same-origin path being rendered. */
export async function requestInApp(path: string): Promise<InAppInfo | null> {
  let origin: string | null = null;
  try {
    origin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : null;
  } catch {
    origin = null;
  }
  return inAppInfo((await headers()).get("user-agent"), origin, path);
}
