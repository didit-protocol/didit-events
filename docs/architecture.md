# Architecture

This page explains how Didit Events is put together. For setup and configuration see the [README](../README.md).

## One app, two packages

| Path | What it holds |
| --- | --- |
| `apps/events` | The Next.js 16 app (App Router). Public calendar and event pages, sign-in, the guest area, the staff admin, the door kiosk and every API route. |
| `packages/core` | Everything that is not UI: database schema and migrations, the Didit client, domain rules, identity and sessions, admission, the door service, email templates, the outbox and the workers. |
| `packages/ui` | Design tokens, fonts and shared React components as CSS Modules, including the kiosk screens and the Open Graph images. |

The app imports the packages as TypeScript source (`transpilePackages`), so there is no separate build step for them.

## Request flow for a guest

1. **Sign in.** The guest proves their email with a Didit email code, or with Google through Didit's OIDC provider. The app creates an account and a server-side session.
2. **Profile.** The guest completes a short profile (name, role, company, one link). It is saved to the account and reused for every event.
3. **Liveness.** The server creates a liveness-only Didit session with the account email as `vendor_data`. The guest takes a selfie in the hosted flow at `verify.didit.me`, once per account. A pass is evidence that a live person was present. It does not identify the person, and by itself it does not stop one person from holding two accounts: a duplicate-face check is a setting of the liveness workflow in Didit, not a rule of the app.
4. **Request.** The guest requests a place at an event. If the event asks for more (phone, identity document, name from the document, minimum age), the server plans one extra workflow that covers only the checks the guest does not already hold.
5. **Decision.** Didit calls `/api/webhooks/didit`. The app verifies the signature, stores the event in an inbox table and returns. A worker then fetches the decision from the Didit API and records which checks passed and until when. Where Didit cannot reach the app (localhost), the page the guest is on asks for the result, and the reconciler covers the rest.
6. **Approval.** A host approves, waitlists or declines. Approval creates no new verification. If a proof expired while the request waited, the place stays approved and the guest is asked to renew.
7. **Door.** At the event the kiosk recognises the guest's face and checks them in.

Proofs are reusable: a guest who verified for one event brings the same proofs to the next until they expire.

## The door

The door is a page of the same app (`/admin/events/{id}/door/kiosk`). There is nothing to install or pair.

- A team member starts door mode. The browser is signed out of the admin and keeps a cookie that only works for that event's door.
- Face detection runs in the browser with MediaPipe. The kiosk tracks up to six faces and sends one cropped frame per face to `/api/door/{id}/scan`.
- The server sends the crop to Didit face search. A match is only a hint: inside one transaction the server locks the account, the registration and the event, reads the guest's place and proofs again, and only then records the check-in.
- **Supervised** mode, the default, runs face search only and assumes a person is watching the door: nothing in it tells a face from a photo of one. **Strict** mode also runs passive liveness on the frame and refuses a check-in that fails it. Strict costs two Didit calls per scan instead of one, and it needs the face large enough in the frame.
- Every door search is saved as a request in the Didit application, labelled with the event. The app keeps the result (matched sessions and similarity), never the image.
- **Test mode** runs the same recognition without checking anyone in.
- Staff can check a guest in by hand, with a written reason and the same checks.

## Data

Postgres, through Drizzle. Migrations are plain SQL in `packages/core/drizzle` and run with `pnpm db:migrate`, or
automatically when the container starts. With no `DATABASE_URL` the app runs on PGlite, an embedded Postgres, which is
enough for development and for most tests. Tests that need real locking run against Postgres. PGlite serves one
process at a time, and the command-line tools that take a `DATABASE_URL` (provisioning, `mcp:token`) need Postgres;
the README has the full table under "Which database".

The app stores accounts, profiles, events, registrations, the outcome of each check and audit history. It does not
store selfies or identity documents: those stay with Didit and are fetched on demand for staff who are allowed to
see them.

## Money

Every Didit call that costs money reserves budget in a ledger before it is sent and settles afterwards. Hosted
workflows reserve their maximum price, which is read from Didit and stored in the `didit_workflows` table with a hash
of the workflow configuration. A workflow with no stored price is never used. The price gets there in two ways:

- **The liveness workflow** (`DIDIT_FACE_WORKFLOW_ID`) is looked up the first time a guest starts the selfie check.
  The app checks that it is published and liveness only, stores its price and checks it again once a day while it is
  in use. This needs no provisioning and works on PGlite and on Postgres.
- **The workflows for extra checks** (phone, document, name, age) are created and priced by the provisioning script,
  which needs Postgres. The event editor offers a check only while its workflow was verified in the last seven days.

Three ceilings apply: per event per day, for the whole app per day, and an optional total.
When a ceiling is reached the call is refused, not queued.

## Background work

Three workers run inside the server process and start with it:

- **Inbox.** Processes stored webhooks.
- **Outbox.** Delivers emails through Resend. Each email is a row written in the same transaction as the change that caused it, with a key that makes delivery idempotent.
- **Jobs.** Reminders, expiry, account deletion and the reconciler, which asks Didit about sessions whose webhook never arrived.

`WORKERS=0` turns them off. That is for tests: there is no command that runs the workers in a separate process yet,
so a server started with `WORKERS=0` processes no webhooks, emails or jobs. Because of the workers the app needs a
long-running Node process.

## Access control

- **Global staff** (owner, admin, staff) are rows in the `staff` table and reach every event. Their addresses must be on a domain in `STAFF_EMAIL_DOMAIN`. The first migration creates the first owner from `SEED_OWNER_EMAIL`. Neither has a default: the migration, the seed and the server refuse to run without them.
- **Event teams** (host, operator) are per event and can be any email address.
- `packages/core/src/access/capabilities.ts` is the matrix of what each role may do. Every admin page, server action, API route and MCP tool names one capability and the server checks it.

## MCP

`/api/mcp` is a stateless Streamable HTTP endpoint for AI agents. It authenticates with a personal access token
and exposes the admin as tools: events, applicants, guests, check-in, event teams, the calendar, the staff team and a
status check for stuck webhooks and emails.
Tools call the same services as the admin UI, so they follow the same rules and write the same audit history.

## Emails

Templates live in `packages/core/src/email/templates`, one file per message, and render to HTML and text from typed
data. Sign-in codes are sent by Didit. Everything else goes through the outbox and Resend. Approved guests also get a
calendar invitation that later messages update or cancel.
