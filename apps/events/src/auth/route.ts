import { IdentityError } from "@didit-events/core/identity";
import { PolicyError } from "@didit-events/core/http/policy";
import { ZodError } from "zod";
export function routeError(error: unknown) {
  const status = error instanceof IdentityError || error instanceof PolicyError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 422 : 503;
  return new Response(status === 403 ? "<!doctype html><html lang=\"en\"><title>Access denied</title><h1>Access denied</h1><p>An active Didit staff invitation is required.</p><a href=\"/login\">Sign in as a guest</a></html>" : status === 503 ? "Sign-in is temporarily unavailable. Please try again." : "This request is invalid or has expired. Please sign in again.", { status, headers: { "Content-Type": status === 403 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
