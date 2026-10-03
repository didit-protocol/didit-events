# Security

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose
**Report a vulnerability**. Include what you found, how to reproduce it and what an attacker could do with it.

If that form is not available to you, write to [security@didit.me](mailto:security@didit.me). Access to that mailbox
is restricted to the people at Didit who are authorized to handle reports. Never put the details of a vulnerability
in a public issue, pull request or discussion.

We aim to acknowledge a report within three working days and to tell you what we plan to do within ten. Please give
us a reasonable time to fix the problem before you publish details. We are glad to credit you in the fix.

## Supported versions

| Version | Security fixes |
| --- | --- |
| The latest release and the `main` branch | yes |
| Older releases | no: update to the latest release |

The project is before 1.0, so a fix ships as a new release, not as a patch to an old one. Forks and modified copies
are the responsibility of whoever runs them.

## Scope

In scope:

- The code in this repository: the Next.js app in `apps/events`, `packages/core`, `packages/ui` and the scripts.
- The Docker image built from the `Dockerfile` here.
- Any way around the limits of the development sign-in: reaching `/api/auth/dev` under `NODE_ENV=production`, with `DEV_AUTH` unset, or while `APP_URL` is not a localhost address.

Out of scope:

- Didit's own services (`verification.didit.me`, `verify.didit.me`, `apx.didit.me` and others). Report those to Didit through [didit.me](https://didit.me).
- Problems that need a compromised server, database or environment file.
- The development sign-in (`DEV_AUTH=1`) doing what it is meant to do on a developer's own machine: signing in without a code on localhost.
- Missing hardening on a deployment you run yourself (TLS, proxy configuration, database access).

Please do not test against a deployment you do not own, and never use real people's biometric data in a test.

## What is in place

**Authentication**

- Guests and staff sign in with a Didit email code or with Google through Didit (OIDC with PKCE, state and nonce). There are no passwords.
- Sessions are rows in the database. The cookie holds a signed reference and is `Secure`, `HttpOnly`, `SameSite=Lax` with the `__Host-` prefix. Revoking a session or disabling a staff account takes effect on the next request.
- Admin access is role based. Every admin page, server action, API route and MCP tool names one capability, and the server checks it against the matrix in `packages/core/src/access/capabilities.ts`. Event team members see only their events.
- Door mode signs the browser out of the admin and leaves a cookie scoped to one event's door, valid for 16 hours.
- API tokens for the MCP server are stored as SHA-256 hashes, expire after 365 days, are limited to 120 requests per minute and stop working when the token is revoked or the staff account is disabled.

**Request protection**

- State-changing requests must come from the app's own origin and carry a CSRF token bound to the session. This covers route handlers and server actions.
- The MCP endpoint rejects browser `Origin` headers and ignores cookies.
- Request bodies are read with a hard size cap (64 KB by default, 400 KB for a door scan, 1 MB for a webhook), including chunked bodies.
- Uploaded images are decoded, re-encoded and stripped of metadata. Image downloads by URL reject redirects and private addresses.

**Rate limits and spend**

- Sign-in codes expire after five minutes and allow three attempts and one resend.
- Door scans are throttled per door session and capped per event and per day.
- Every billable Didit call reserves budget in a ledger first. Per-event, per-day and total ceilings stop the app from spending past them.

**Webhooks**

- Didit webhooks are verified with HMAC over the canonical JSON body and a timestamp, compared in constant time.
- A verified webhook is only a signal. The worker fetches the decision again from the Didit API before changing anything.
- Verification links are accepted only when they point at `verify.didit.me` over https.

**Browser**

- Every response sends HSTS (production builds), `X-Content-Type-Options: nosniff`, a referrer policy, a permissions policy that allows the camera only for the app's own pages and the Didit verification frame, `X-Frame-Options: DENY` and an enforced Content Security Policy for `object-src`, `base-uri`, `form-action` and `frame-ancestors`.
- Documents also carry the full Content Security Policy with a per-request nonce in report-only mode. The allowed origins and the reason for each are listed in `apps/events/src/system/security-headers.ts`.
- Pages that carry a token in the URL send `Referrer-Policy: no-referrer`.

**Biometric and personal data**

- Selfies, liveness captures and identity documents are processed and stored by Didit. The app does not copy them into its database. It keeps the session id, the outcome of each check and when it expires. It also keeps the raw decision Didit returned (until 30 days after the proof it produced expires, or 30 days after the check ended when it produced no proof) and the body of each webhook (14 days).
- A staff member who opens an applicant's selfie sees it through an authenticated route that fetches it from Didit on demand.
- Door scans are sent to Didit face search. The app never stores the image; it logs which sessions matched and their similarity scores. Didit saves each door search as a request in your application, labelled with the event, so staff can review it there. Deleting an account does not remove those requests: delete them, or set their retention, in the Didit console.
- Guests can delete their account. The account is disabled at once. After a seven-day grace period the app first asks Didit to delete the account's verification sessions, including face data, and deletes its own records of the account only when Didit has confirmed every one. A deletion Didit does not confirm is flagged for manual follow-up, and until it is resolved the account stays disabled with its records still in the database. Audit entries stay with their details emptied. Backups are yours to rotate.
- An event's public page does not show who is going unless the host turns that on (count only, or names).
- Error reports (Sentry, optional and off by default) collect no cookies, bodies, query strings or user identifiers. Emails and tokens are masked before sending.

## Running it safely

- Serve the app over https and set `APP_URL` to that exact origin.
- Generate a fresh `SESSION_SECRET` for each environment and keep `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET` and `RESEND_API_KEY` in a secret store.
- Leave `DEV_AUTH` unset outside local development.
- Set `TRUSTED_PROXY_HOPS` to match your proxy chain, or client addresses can be spoofed.
- Set spend ceilings (`DIDIT_SPEND_CAP_USD`, `DIDIT_APP_DAILY_CAP_USD`, `DIDIT_EVENT_DAILY_CAP_USD`) that fit your events.
- Review who is global staff. The first owner is the address in `SEED_OWNER_EMAIL`, created by the first migration. It and `STAFF_EMAIL_DOMAIN` have no default: the migration and the server refuse to run without them.
- Staff the door, in both door modes. Supervised mode runs face search only and relies on the person at the door to notice a photo held up to the camera. Strict mode adds a liveness check to every scan as a second check; it does not replace that person, and an unattended door is not a supported setup.
- On localhost, and whenever `APP_URL` is not a public https origin, emails load their logo and icons from `https://events.didit.me`. Set `EMAIL_ASSETS_URL` to a deployment of your own if recipients should not make that request.
- Google sign-in needs an OIDC client of your own, and the liveness workflow must be one of your Didit application: the code ships neither.
