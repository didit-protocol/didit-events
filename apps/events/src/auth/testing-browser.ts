import { randomToken, signToken } from "@didit-events/core/identity/shared";
import { csrfToken } from "./browser";

// Only the Next request context is supplied by tests; guardAction stays real.
export const testOrigin = "https://events.didit.me";
export const testSecret = "browser-test-secret-longer-than-32-characters";
const anonymous = signToken(randomToken(), testSecret, "anonymous");
export const anonymousCsrf = csrfToken(anonymous, testSecret);
export function anonymousHeaders() {
  return new Headers({ origin: testOrigin, host: "events.didit.me", "x-forwarded-proto": "https", cookie: `__Host-anon=${anonymous}; __Host-csrf=${anonymousCsrf}` });
}
