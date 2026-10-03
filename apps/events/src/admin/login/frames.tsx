/** A-01 Sign in (design/01 Admin): five 1440×820 frames on the #F8F8F8 frame box. */
import type { FrameDef } from "@didit-events/ui/frames/registry";
import { adminFrame } from "../frame";
import { SignInScreen, type SignInScreenProps } from "./SignInScreen";

const frame = (code: string, label: string, props: Omit<SignInScreenProps, "next" | "fill">) =>
  adminFrame(code, label, 1440, 820, () => <SignInScreen fill next="/admin" {...props} />, { background: "#F8F8F8" });

export const loginFrames: FrameDef[] = [
  frame("A-01a", "A-01 Sign in / default", {}),
  frame("A-01b", "A-01 Sign in / loading", { pending: true }),
  frame("A-01c", "A-01 Sign in / not a Didit account", { error: "domain" }),
  frame("A-01d", "A-01 Sign in / failed", { error: "failed" }),
  frame("A-01e", "A-01 Sign in / session expired", { error: "expired" }),
];
