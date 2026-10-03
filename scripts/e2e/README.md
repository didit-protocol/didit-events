# Events v2 HTTP journey

Run from the repository root with Node 22 or newer and PostgreSQL (or Docker):

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:55501/postgres pnpm e2e:journey
TEST_DATABASE_URL=postgres://postgres@localhost:55501/postgres pnpm e2e:journey --runs 3
TEST_DATABASE_URL=postgres://postgres@localhost:55501/postgres pnpm e2e:journey --provider sandbox
```

Each run creates and drops a random `journey_*` database. Without `TEST_DATABASE_URL`, it starts its own PostgreSQL 17 container. A URL pointing at `didit_events` is rejected. Events and both fake providers use allocated loopback ports; Events explicitly excludes 3310 and 3311. The harness owns the processes it stops and gives application workers time to drain before stopping providers. The Next app has a separate build directory for the run. Mutation routes are compiled with harmless GET requests before timed steps run.

No browser runs. The HTTP client keeps separate cookie jars and sends CSRF headers. Server actions use the installed Next Flight codec and the generated action manifest. This exercises the same routes, loaders, services, workers, SDK and PostgreSQL transactions used by the apps. HTTP cannot prove camera capture, browser SDK behavior or visual layout.

## Fake provider

The default run provisions minimal workflows, signs up four guests through OTP, completes their profiles, delivers signed face decisions and exercises request-time phone verification. It covers decline/retry, event editing and publication, hidden guests, MCP approval, withdrawals, late cancellation, email preview/test delivery, an event operator starting door mode in Events, door scans (live and Test mode), billing counters and security probes.

`scripts/smoke-fakes.mjs` extends the existing smoke provider. A decision stub supplies a real local JPEG URL in `liveness_checks[].reference_image` and the portrait fields. The harness POSTs canonical-JSON V2 HMAC webhooks with a matching timestamp. The inbox worker must re-fetch the decision through the SDK; both the fetch and the JPEG hash are checked. Application evidence is never inserted directly by the journey. The app deliberately discards provider media when storing its reduced decision.

Face search and passive liveness parse multipart JPEG bytes. Their hashes select deterministic scenarios; an unknown image is rejected. Assertions verify the exact image posted to the Events door API reaches the provider, both strict-mode calls use `save_api_request=false`, and every dispatched scan increments counters and spend reservations. Face detection and similarity are stubbed in this mode. The multi-face fixture returns Didit's `MULTIPLE_FACES_DETECTED` warning with one eligible match, proving the server enforces the one-person rule even if a client bypasses framing guidance.

Resend is local in both modes. Captures include recipient, sender, reply-to, subject, HTML, text and idempotency key. No test email leaves the machine. The logo URL is fetched from the running app.

## Sandbox boundary

Only sandbox mode reads a real key, from `DIDIT_SANDBOX_API_KEY`. It does not use an inherited API key. It discovers the sandbox app's published `Didit Events · Selfie renewal` workflow, verifies it contains only liveness, and passes its stable ID as `DIDIT_RENEWAL_WORKFLOW_ID` to the actual provisioning CLI. Production retains the existing default pin. Changing the configured pin in a database with a ready registry requires review.

The sandbox checks run `apps/events/scripts/provision.mjs 18` and verify all six distinct minimal workflow configurations, feature order and provider prices. They create and retrieve a real email-addressed liveness session through the SDK, register two disabled webhook destinations, rotate by replacement, delete both, and perform real face search with a committed portrait. PATCH alone does not rotate a Didit signing secret. The incomplete session is deleted in cleanup; the receipt distinguishes deletion acknowledgment from confirmed biometric erasure. Provisioned workflows remain available for subsequent runs.

Human selfie and OTP completion are not attempted against the provider. After the real contract checks, sandbox mode runs the full local journey in a second disposable database with signed webhook and decision stubs. Those injected results are explicitly separate from the real sandbox session. The sandbox contract receipts therefore prove real workflow/session/webhook-management/face-search integration; the injected journey proves the app's handling of approved and declined results.

## Receipts and the loop

Every named step prints PASS or FAIL and records timing and evidence in `/tmp/events-journey-*/results.json`. Each directory is private to the operator. Successful journeys also write `provider-receipts.json`, containing synthetic sessions, decision-fetch paths, JPEG hashes, provider call counts and captured emails. Application logs and server-action responses remain beside those receipts. Sandbox receipts omit keys, signing secrets and hosted session URLs.

`--runs 3` uses three fresh databases and server sets, runs sequentially and stops on the first failure. Fix the owning app, add a regression test and restart the three-run gate after a failure. Tests do not change expected product behavior to obtain a pass.

After three passes and the sandbox contract pass, run:

```sh
pnpm typecheck && pnpm lint
CI=true TEST_DATABASE_URL=postgres://postgres@localhost:55501/postgres pnpm test
pnpm build && pnpm size && pnpm check:standalone
pnpm --filter @didit-events/core exec drizzle-kit generate --name check
TEST_DATABASE_URL=postgres://postgres@localhost:55501/postgres pnpm smoke:local
```

Drift passes only when generation reports no schema changes.
