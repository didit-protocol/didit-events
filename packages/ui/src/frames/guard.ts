/**
 * The /_frames gallery is for dev and test builds only: on in development and test, and in a production build only
 * when FRAMES=1 is set at runtime.
 */
export function framesEnabled(env: { FRAMES?: string; NODE_ENV?: string } = process.env): boolean {
  return env.FRAMES === "1" || env.NODE_ENV !== "production";
}
