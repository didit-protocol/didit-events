import { yourStaffAccountPhrase } from "../team/domain";

/** A-13 copy (design/01b Admin, `sys` data). One place, so the routes and the frames say the same thing. */
export const SYSTEM_COPY = {
  notFound: { code: "404", title: "Event not found", help: "It may have been deleted, or the link is wrong.", cta: "Back to events" },
  forbidden: {
    code: "403",
    title: "No access",
    help: (email: string) => `You signed in as ${email}. Use ${yourStaffAccountPhrase()}, or the email an event host added to their team.`,
    cta: "Switch account",
  },
  broken: {
    code: (requestId?: string) => (requestId ? `500 · ${requestId}` : "500"),
    title: "Something broke on our side",
    help: "Your data is safe. Try again, and if it keeps happening share the request id with whoever runs this site.",
    cta: "Retry",
  },
  offline: "You’re offline. Changes will sync when you’re back.",
  diditApi: { text: "Didit is not responding. New links and verification updates are delayed; check-in may be slower.", cta: "Status page ↗" },
  sessionExpired: {
    title: "Your session expired",
    body: "Sign in again to keep working. Unsaved changes on this page are kept.",
    cta: "Continue with Google",
  },
} as const;

/** Didit's public status page (A-13e "Status page ↗"). */
export const DIDIT_STATUS_URL = "https://status.didit.me";
