# Set up Didit with an AI agent

A prompt for a coding agent (Claude Code, Cursor, Codex and others). Pasted into a fresh clone of this repository, it
makes the agent create a Didit account through the API, get the API key, create the liveness workflow, write
`apps/events/.env.local`, start the app and check the result with commands that must pass.

What you do: give the agent an email address you can read, type the 6-character code Didit sends there, and go through
a short browser checklist at the end, selfie included, on a device with a camera. Everything else is the agent's
work. The database is a Postgres container in Docker or a Postgres server you already run.

Install the [Didit agent skills](https://github.com/didit-protocol/skills) first, from the root of the clone. They
give the agent Didit's API reference (sessions, workflows, webhooks, passive liveness, face search). ClawHub installs
one skill per command:

```sh
npx clawhub@latest install didit-verification-management
npx clawhub@latest install didit-liveness-detection
npx clawhub@latest install didit-face-search
```

ClawHub writes them to `skills/` and `.clawhub/` in the folder you run it from. Both are git-ignored in this
repository. If ClawHub is not available, copy the same three folders from <https://github.com/didit-protocol/skills>.

Then copy everything in the block below and paste it into the agent.

<!--
For maintainers. Every endpoint, field and command in the prompt comes from these sources. Check them again when
one changes.

Didit documentation (https://docs.didit.me):
  https://github.com/didit-protocol/skills      skill names (one folder per skill), the GitHub fallback. `clawhub
                                                install` takes one skill per call; `npx clawhub@latest search didit`
                                                lists the names. Do not take the command from
                                                /getting-started/agent-skills: that page names skills that do not exist
                                                and passes several to one install.
  /integration/programmatic-registration        base URL https://apx.didit.me/auth/v2, POST /programmatic/register/
                                                {email, password} -> 201, POST /programmatic/verify-email/ {email, code}
                                                -> 200 with application.api_key, code lifetime (10 minutes), password
                                                rules, rate limits, reserved test domains answer 500
  /openapi-auth.json                            the same endpoints; the Application schema has no "mode" field
  /integration/sandbox-testing                  live and sandbox are separate applications; sandbox_scenario is
                                                accepted on sandbox applications only; hosted flow "Choose a test
                                                result" (Verified, Needs review, Declined), then the selfie capture
  /sessions-api/create-session                  POST /v3/session/ {workflow_id, vendor_data, sandbox_scenario} -> 201,
                                                400 on live applications when sandbox_scenario is sent
  /sessions-api/delete-session                  DELETE /v3/session/{session_id}/delete/
  /management-api/workflows/create              POST /v3/workflows/ {workflow_label, is_desktop_allowed, features};
                                                status omitted = published
  /management-api/workflows/list, /get          GET /v3/workflows/ is paginated (count, next, previous, results),
                                                GET /v3/workflows/{settings_uuid}/, workflow_id is the stable id, uuid
                                                is one version
  /management-api/webhook/create-destination    POST /v3/webhook/destinations/, secret_shared_key in the response

This repository:
  README.md                                     Quick start, Didit setup, What works with a sandbox application
  apps/events/scripts/provision.mjs             needs DATABASE_URL (Postgres) and DIDIT_API_KEY; prints the workflows
  apps/events/scripts/webhook.mjs               register|remove <url>; writes DIDIT_WEBHOOK_SECRET to .env.local
  packages/core/src/verification/workflow-registry.ts   the face workflow is matched by workflow_id, must be published
                                                and liveness only
  packages/core/src/webhook/signature.test.ts, scripts/webhook.test.mjs   the webhook tests
  scripts/smoke-local.mjs, scripts/e2e/README.md, scripts/e2e/sandbox.mjs  the smoke run and the sandbox journey (it
                                                needs exactly one published workflow labelled
                                                "Didit Events · Selfie renewal"). Both use TEST_DATABASE_URL or start
                                                a postgres:17 container; the smoke run starts its own next dev in
                                                apps/events, which Next refuses while another one runs there
  .gitignore                                    ".env*", "/skills/" and "/.clawhub/"
-->

````text
You are setting up Didit for this repository (Didit Events, a Next.js app) on my machine, from a fresh clone. Do the
steps in order. Run each command from the repository root. Each step ends with a check: go on only when it passes,
and if it does not, show me the output and stop.

RULES (they apply to every step)
- Never print, echo, log or commit an API key, a webhook secret, a password or a token. Do not put one in a command
  line, in a commit, in a file other than the two named below, or in your messages to me. The commands below read
  secrets from files and write them to files so that they never reach the terminal. Use them as written.
- Secrets live in apps/events/.env.local only. The Didit account password lives in apps/events/.env.didit-account,
  and a Postgres URL of mine, if I give you one, in apps/events/.env.postgres. All three are git-ignored (.gitignore
  has ".env*"). Check with: git check-ignore apps/events/.env.local apps/events/.env.didit-account (it must print
  both paths).
- The git checks need a git checkout. Run git rev-parse --is-inside-work-tree first: if it does not print "true"
  (a copy without .git answers "fatal: not a git repository"), skip every git check-ignore and git status check in
  this prompt and tell me that you skipped them.
- Use a sandbox application for all testing. Do not make calls with a live application's key unless I say so.
- Stop and ask me whenever you need the emailed code, a decision or my consent. Never guess a code or an address.
- Do not change application code to make a check pass. If a check fails, report it.
- Read README.md ("Quick start", "Didit setup", "What works with a sandbox application") and .env.example before
  you start. If one of them disagrees with this prompt, tell me and follow the repository.

STEP 0. Didit agent skills
Install Didit's official skills so you have the API reference at hand. ClawHub takes one skill per command:
  npx clawhub@latest install didit-verification-management
  npx clawhub@latest install didit-liveness-detection
  npx clawhub@latest install didit-face-search
ClawHub writes them to skills/ and .clawhub/ in the repository root. Both are git-ignored here, so they stay out of
my commits.
If a command fails, take the same three folders from GitHub:
  git clone --depth 1 https://github.com/didit-protocol/skills /tmp/didit-skills
  mkdir -p skills
  cp -R /tmp/didit-skills/didit-verification-management /tmp/didit-skills/didit-liveness-detection /tmp/didit-skills/didit-face-search skills/
Check: ls skills prints didit-face-search, didit-liveness-detection and didit-verification-management, and each
folder has a SKILL.md. If you cannot install them, say so and continue: the steps below carry every call you need.

STEP 1. Ask me, then prepare the repository
Ask me these in one message and wait for my answers:
  a. A real email address I can read, for the Didit account. Reserved test domains (example.com, example.org, .test,
     .example, .invalid) do not work: Didit sends the code at once and the call fails with 500.
     Or: "I already have a DIDIT_API_KEY". Then skip step 2 and follow "If I already have a key" at the end of
     this step.
  b. My staff email domain (for example yourcompany.com) and my own address on that domain. It becomes the first
     owner of the app. Any domain I own works, and with DEV_AUTH=1 the address needs no mailbox: the local sign-in
     link replaces the email code.
  c. Whether I have a public https URL for this app (a deployment or a tunnel). Most local setups do not.
  d. The database: "Docker" (you start a Postgres container), or "give me a Postgres URL: I create an empty database
     there". The URL is that of a Postgres server I already run, with a user that may create databases. It holds a
     password, so I do not paste it in the chat: I create apps/events/.env.postgres myself with the one line
     POSTGRES_URL=postgres://USER:PASSWORD@HOST:PORT/postgres
     and tell you when it is there.

Then:
  node --version        # must be 22.7 or newer
  corepack enable
  pnpm install

The provisioning script and the validation runs need a real Postgres. Follow my answer to (d).

Database, with Docker (if Docker is not running, ask me to start it or to give you a Postgres URL instead):
  docker run -d --name didit-events-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=pg postgres:17
  until docker exec didit-events-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

Database, with my Postgres URL (no Docker). This creates an empty database on that server and prints no secret.
Its name is in one variable, DB_NAME, which both snippets below read. Export it in every shell that runs one of
them:

```sh
export DB_NAME=didit_events_local
node --env-file=apps/events/.env.postgres --input-type=module <<'EOF'
import { createRequire } from "node:module";
const postgres = createRequire(process.cwd() + "/apps/events/")("postgres");
const sql = postgres(process.env.POSTGRES_URL, { max: 1, onnotice: () => {} });
const name = process.env.DB_NAME;
if (!/^[a-z_][a-z0-9_]*$/.test(name ?? "")) throw new Error("Set DB_NAME to a lowercase name (letters, digits, _)");
const [found] = await sql`select 1 from pg_database where datname = ${name}`;
if (found) console.log(`${name} already exists. It must be empty: ask before you use it.`);
else { await sql`create database ${sql(name)}`; console.log(`created database ${name}`); }
await sql.end();
EOF
```

  Expected: created database didit_events_local
  If it already exists, stop and ask me whether to drop it or to use another name. For another name, change only
  the DB_NAME value.

Write the first part of the configuration. Replace the two placeholders with my answers to (b). With Docker:

```sh
umask 077
cat > apps/events/.env.local <<EOF
DATABASE_URL=postgres://postgres:pg@127.0.0.1:5432/postgres
APP_URL=http://localhost:3000
SESSION_SECRET=$(openssl rand -base64 32)
STAFF_EMAIL_DOMAIN=yourcompany.com
SEED_OWNER_EMAIL=you@yourcompany.com
EOF
```

With my Postgres URL, the same block with this DATABASE_URL line instead (it reads the URL from the file and points
it at the database named in DB_NAME, which must be exported in this shell too):

```sh
DATABASE_URL=$(node --env-file=apps/events/.env.postgres -p 'const u = new URL(process.env.POSTGRES_URL); u.pathname = "/" + process.env.DB_NAME; u.href')
```

Another port: pnpm dev always listens on 3000. If that port is taken (lsof -nP -iTCP:3000 -sTCP:LISTEN prints a
line), pick a free one, write APP_URL=http://localhost:<port> in the block above, and use that port in step 7 and
in every http://localhost:3000 address of steps 7 and 8.

Check: cut -d= -f1 apps/events/.env.local prints DATABASE_URL APP_URL SESSION_SECRET STAFF_EMAIL_DOMAIN
SEED_OWNER_EMAIL (one per line). In a git checkout, git check-ignore apps/events/.env.local prints the path and
git status --short does not list the file.

If I already have a key (answer to 1a): the file is written in a fixed order and step 3 checks it, so the key goes in
now, as the sixth and last line, right after SEED_OWNER_EMAIL and before step 3 appends the rest. Ask me to open
apps/events/.env.local in my editor and add this line at the end myself, not in the chat:
  DIDIT_API_KEY=<my key>
Then verify it without printing it:
  tail -n 1 apps/events/.env.local | cut -d= -f1        # must print DIDIT_API_KEY
  and the check at the end of step 2 must print: GET /v3/workflows/ 200   (401 or 403 means a wrong key)
Whether the key belongs to a sandbox application is tested in step 4, after the workflow exists. Do not go past
step 4 with a key that is not confirmed as sandbox.

STEP 2. Get the Didit API key (if apps/events/.env.local already has DIDIT_API_KEY, skip 2.1 to 2.4 and run only
the check at the end of this step)
Didit's programmatic registration takes two calls on https://apx.didit.me/auth/v2 and no browser.

2.1 Save the account's email and a new password to a git-ignored file. Replace only the email:

```sh
umask 077
printf 'DIDIT_ACCOUNT_EMAIL=%s\nDIDIT_ACCOUNT_PASSWORD=%s\n' 'the-email-from-1a' 'Dd1!'"$(openssl rand -hex 16)" \
  > apps/events/.env.didit-account
```

  (Didit requires at least 8 characters with an uppercase letter, a lowercase letter, a digit and a special
  character. The password above meets that.)

2.2 Register:

```sh
node --env-file=apps/events/.env.didit-account --input-type=module <<'EOF'
const response = await fetch("https://apx.didit.me/auth/v2/programmatic/register/", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.DIDIT_ACCOUNT_EMAIL, password: process.env.DIDIT_ACCOUNT_PASSWORD }),
});
console.log(response.status, await response.text());
EOF
```

  Expected: 201 {"message":"Registration successful. Check your email for the verification code.","email":"..."}
  Also fine: 200 with "A new verification code has been sent to your email." (the account existed, unverified).
  429 means a rate limit (5 registrations per IP per hour): tell me the Retry-After wait and stop.
  400 saying the account already exists: stop and ask me. I can add my existing key to apps/events/.env.local.

2.3 Ask me for the 6-character code from the email (letters and digits, for example A3K9F2). It expires 10 minutes
after it is sent. If it has expired, run 2.2 again for a new one. Do not guess: wrong codes are rate-limited.

2.4 Verify the code. This writes the API key straight into apps/events/.env.local and prints no secret. Replace
only the code:

```sh
DIDIT_EMAIL_CODE='A3K9F2' node --env-file=apps/events/.env.didit-account --input-type=module <<'EOF'
import { appendFileSync } from "node:fs";
const response = await fetch("https://apx.didit.me/auth/v2/programmatic/verify-email/", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.DIDIT_ACCOUNT_EMAIL, code: process.env.DIDIT_EMAIL_CODE }),
});
const data = await response.json();
const key = data?.application?.api_key;
if (!response.ok || typeof key !== "string" || !key) { console.error(response.status, JSON.stringify(data)); process.exit(1); }
appendFileSync("apps/events/.env.local", `DIDIT_API_KEY=${key}\n`);
console.log(response.status, "DIDIT_API_KEY saved. application", data.application.uuid, "organization", data.organization.uuid);
EOF
```

  Expected: 200 DIDIT_API_KEY saved. application <uuid> organization <uuid>
  A wrong or expired code answers 400 ["Invalid or expired verification code."].

The response also carries an access_token and a refresh_token for the account endpoints on apx.didit.me. This setup
does not need them: do not store or print them. Tell me that the account's email and password are in
apps/events/.env.didit-account, so I can sign in at https://business.didit.me later.

Check (prints a status only):

```sh
node --env-file=apps/events/.env.local --input-type=module <<'EOF'
const response = await fetch("https://verification.didit.me/v3/workflows/", { headers: { "x-api-key": process.env.DIDIT_API_KEY } });
console.log("GET /v3/workflows/", response.status);
EOF
```
  Expected: GET /v3/workflows/ 200

STEP 3. Create the liveness workflow and finish the configuration
The app needs one published workflow with a single feature, passive liveness. The command reads the whole list of
workflows (the list is paginated: it follows "next" until the last page), reuses a workflow with the same label if
one exists, creates it otherwise, and appends the remaining values to apps/events/.env.local. Replace CONTACT_EMAIL
with my address from 1b:

```sh
CONTACT_EMAIL='you@yourcompany.com' node --env-file=apps/events/.env.local --input-type=module <<'EOF'
import { appendFileSync } from "node:fs";
const base = "https://verification.didit.me/v3", label = "Didit Events · Selfie renewal";
const call = async (method, path, body) => {
  const response = await fetch(base + path, { method, headers: { "x-api-key": process.env.DIDIT_API_KEY, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (!response.ok) { console.error(method, path, response.status, await response.text()); process.exit(1); }
  return response.json();
};
const all = [];
for (let path = "/workflows/", pages = 0; path; pages += 1) {
  if (pages === 200) { console.error("The workflow list did not end after 200 pages."); process.exit(1); }
  const page = await call("GET", path);
  all.push(...(Array.isArray(page) ? page : page.results ?? []));
  path = !Array.isArray(page) && typeof page.next === "string" && page.next ? "/workflows/" + new URL(page.next, base + "/").search : null;
}
const rows = all.filter(row => row.workflow_label === label && row.status === "published" && !row.is_archived);
if (rows.length > 1) { console.error(`More than one published workflow is labelled "${label}". Archive all but one in the Didit console.`); process.exit(1); }
const made = rows[0] ?? await call("POST", "/workflows/", { workflow_label: label, is_desktop_allowed: true, features: [{ feature: "LIVENESS", config: { face_liveness_method: "PASSIVE" } }] });
const detail = await call("GET", `/workflows/${made.uuid}/`);
const id = detail.workflow_id;
if (!id || detail.status !== "published") { console.error("The workflow has no workflow_id or is not published", detail.status); process.exit(1); }
appendFileSync("apps/events/.env.local", [
  `DIDIT_FACE_WORKFLOW_ID=${id}`, `DIDIT_RENEWAL_WORKFLOW_ID=${id}`, `DIDIT_WORKFLOW_ID=${id}`,
  "DIDIT_SPEND_CAP_USD=100", "DIDIT_APP_DAILY_CAP_USD=25", "DIDIT_EVENT_DAILY_CAP_USD=10",
  `CONTACT_EMAIL=${process.env.CONTACT_EMAIL}`, "DEV_AUTH=1", "",
].join("\n"));
console.log(rows[0] ? "reused" : "created", "workflow_id", id, "max_price", detail.max_price, `(${all.length} workflows read)`);
EOF
```

  Expected: created workflow_id <uuid> max_price <a number above 0> (<n> workflows read)   (or "reused ...")
  The id the app needs is workflow_id, the stable id of the workflow. uuid names one version of it.

The three DIDIT_*_CAP_USD lines are spend ceilings, small on purpose. DEV_AUTH=1 enables the local sign-in links
used below; it works on localhost only and a production build ignores it.

Check: the file now sets these names, in this order, each once. Print names only, never values:
  cut -d= -f1 apps/events/.env.local
  Expected: DATABASE_URL APP_URL SESSION_SECRET STAFF_EMAIL_DOMAIN SEED_OWNER_EMAIL DIDIT_API_KEY
  DIDIT_FACE_WORKFLOW_ID DIDIT_RENEWAL_WORKFLOW_ID DIDIT_WORKFLOW_ID DIDIT_SPEND_CAP_USD DIDIT_APP_DAILY_CAP_USD
  DIDIT_EVENT_DAILY_CAP_USD CONTACT_EMAIL DEV_AUTH (one per line)

STEP 4. Make sure the application is a sandbox application
In Didit, live and sandbox are separate applications, each with its own API key. A sandbox application mocks every
provider and is never billed; a live one runs real, billed checks. Didit's registration guide does not say which mode
the application it creates has, so test it. The sandbox_scenario field is accepted on sandbox applications only and
answers 400 on live ones:

```sh
node --env-file=apps/events/.env.local --input-type=module <<'EOF'
const base = "https://verification.didit.me/v3", headers = { "x-api-key": process.env.DIDIT_API_KEY, "Content-Type": "application/json" };
const response = await fetch(`${base}/session/`, { method: "POST", headers,
  body: JSON.stringify({ workflow_id: process.env.DIDIT_FACE_WORKFLOW_ID, vendor_data: "didit-events-setup-check", sandbox_scenario: "approve" }) });
const data = await response.json();
if (response.status === 201) {
  const removed = await fetch(`${base}/session/${data.session_id}/delete/`, { method: "DELETE", headers });
  console.log("SANDBOX application. Test session created with status", JSON.stringify(data.status), "and deleted:", removed.status);
} else console.log("NOT CONFIRMED AS SANDBOX:", response.status, JSON.stringify(data.detail ?? Object.keys(data)));
EOF
```

  Expected: SANDBOX application. Test session created with status "Not Started" and deleted: <a 2xx status>
  If it prints NOT CONFIRMED AS SANDBOX with 400, the key belongs to a live application. Stop and tell me. I can
  create a sandbox application in the Didit Business Console (https://business.didit.me), put its API key in
  apps/events/.env.local myself, and you then run step 3 again for that application (remove the old workflow and cap
  lines from the file first, so each name stays once).

STEP 5. Migrate, provision, seed
  pnpm db:migrate       # creates the schema and the first owner (SEED_OWNER_EMAIL)

  Provision the workflows of the optional checks (phone, document, name, minimum age 18). The script also verifies the
  liveness workflow and stores each workflow's price in the database:

  node --env-file=apps/events/.env.local --experimental-transform-types apps/events/scripts/provision.mjs 18

  Expected: exit code 0 and a JSON array of 6 objects. Each has key, workflowId, providerVersionId, configHash,
  minPriceMicros, maxPriceMicros (above 0) and verifiedAt. One of them has the workflowId from step 3. This is the
  provisioning check: run the same command again later and it must print the same 6 workflowId values.
  The JSON is on stdout. Node also prints an ExperimentalWarning on stderr: keep the two streams apart when you
  capture the output.

  pnpm seed             # two sample events

STEP 6. Webhook
Didit sends results to /api/webhooks/didit, signed with the secret of a webhook destination. Didit cannot reach
localhost, so:
- If I have no public https URL (1c): skip this step and leave DIDIT_WEBHOOK_SECRET unset. The app then asks Didit
  for each result itself: within seconds while the guest keeps the page open, otherwise every five minutes.
- If I gave you a public https URL, register it with the repository's script. It creates the destination through
  POST https://verification.didit.me/v3/webhook/destinations/ (label, url, enabled, webhook_version "v3",
  subscribed_events ["status.updated", "data.updated"]) and writes the destination's secret_shared_key to
  apps/events/.env.local as DIDIT_WEBHOOK_SECRET without printing it:

  node --env-file=apps/events/.env.local apps/events/scripts/webhook.mjs register https://my-public-host/api/webhooks/didit

  Expected: didit-events-production: registered   (the middle word is development or staging for such hosts)
  Check: grep -c '^DIDIT_WEBHOOK_SECRET=' apps/events/.env.local prints 1. APP_URL must be that same origin for
  the app to work behind it; ask me before you change APP_URL.

STEP 7. Smoke run, then start the app
Run validation 8.3 (pnpm smoke:local) now, before the dev server. The smoke run starts its own next dev in
apps/events, and Next allows one dev server per folder: with pnpm dev running it stops with "Another next dev server
is already running" and the run fails with "Timed out: Next readiness". Keep the result for the table of step 8.

Then:
  pnpm dev              # http://localhost:3000, keep it running in the background

  Another port (see step 1): APP_URL in apps/events/.env.local must be http://localhost:<port>, and you start
  Next.js yourself instead of pnpm dev:
  NEXT_MANUAL_SIG_HANDLE=1 pnpm --filter @didit-events/events exec next dev --port <port>

  Check: curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/healthz prints 200.
  If the server stops with "Not configured", it names the missing variable: fix apps/events/.env.local.

STEP 8. Validate end to end
Run all of these and report each result to me in a table (command, expected, actual, pass or fail).

8.1 Provisioning check. Run the provisioning command of step 5 again, with 2>/dev/null at the end so that only the
    JSON array is captured (the ExperimentalWarning goes to stderr):
    node --env-file=apps/events/.env.local --experimental-transform-types apps/events/scripts/provision.mjs 18 2>/dev/null
    Expected: exit code 0, the same 6 workflowId values.

8.2 Webhook tests (signature verification and the registration script, no network):
    pnpm exec vitest run packages/core/src/webhook/signature.test.ts scripts/webhook.test.mjs
    Expected: "Test Files  2 passed (2)" and exit code 0.

8.3 Smoke run against local fake Didit and Resend servers (a few minutes). You ran it in step 7, before the dev
    server. If you did not, stop the dev server first (by its PID), run it, and start the dev server again: the two
    cannot run together, as step 7 explains.
    With Docker it starts its own Postgres container:
    pnpm smoke:local
    Without Docker, give it my Postgres server with the TEST_DATABASE_URL prefix. It creates a throwaway database
    there and drops it at the end; it never touches the database of DB_NAME:
    TEST_DATABASE_URL="$(node --env-file=apps/events/.env.postgres -p 'process.env.POSTGRES_URL')" pnpm smoke:local
    Expected: one "PASS  <step>" line per step, a final table in which every result is PASS, a line
    "Smoke receipts: <folder>", and exit code 0. No FAIL anywhere.

8.4 Sandbox contract journey. It makes real calls to the sandbox application: the provisioning script, a liveness
    session, webhook destinations (created disabled, then deleted) and a face search. The key is read from the file
    into the variable the journey expects and is not printed:
    DIDIT_SANDBOX_API_KEY="$(node --env-file=apps/events/.env.local -p 'process.env.DIDIT_API_KEY')" pnpm e2e:journey --provider sandbox
    It needs a Postgres too. With Docker it starts its own container. Without Docker, put the same prefix as in 8.3
    in front of the command, on the same line:
    TEST_DATABASE_URL="$(node --env-file=apps/events/.env.postgres -p 'process.env.POSTGRES_URL')"
    It may run while the dev server is up: it uses its own ports and build folder.
    Expected: these five lines among the output, then the PASS lines of the local journey, two lines
    "Journey receipts: <folder>" (one after the sandbox checks, one at the end) and exit code 0:
      PASS  sandbox: provision CLI and exact workflow feature order
      PASS  sandbox: SDK creates liveness-only session addressed by email
      PASS  sandbox: webhook destination register, rotate by replacement, remove
      PASS  sandbox: real portrait face-search through SDK
      PASS  sandbox: remove owned provider resources
    Run this only when step 4 confirmed a sandbox application.
    The journey's second half delivers signed webhooks and decisions for approved and declined selfies to the app
    (stubs, described in scripts/e2e/README.md under "Sandbox boundary"). That is the proof that the app handles a
    finished check; 8.5 is the same path with a person and a camera.

8.5 Browser checklist. Ask me to do these and to answer yes or no for each. Give me the two links with my real
    addresses filled in. With DEV_AUTH=1 a link signs me in without a code. I do this in a normal browser on a
    device with a camera: Didit's flow takes a real selfie, also in sandbox, and a headless browser stops at
    "Selfie capture". Do not try to finish that step yourself.
    [ ] Guest: http://localhost:3000/api/auth/dev?email=<any address, for example guest@example.com> opens the app
        signed in, on /me/events, which says "No events yet".
    [ ] I click "Explore events" (or open http://localhost:3000/events), pick one of the two sample events, press
        "Request to join" and complete the profile.
    [ ] A "Verify you're human" screen follows. I press "Next", and the selfie step shows Didit's verification
        inside the page (an iframe from verify.didit.me) with the sandbox notice "Test data only - no real calls".
    [ ] Didit's first screen has a "Choose a test result" button. It offers Verified, Needs review and Declined. I
        choose "Verified"; the screen then reads "Happy path — all features approve". I press Continue.
    [ ] The flow shows "Prepare for the camera", then "Selfie capture". I take the selfie with my camera and
        finish; the page moves on within seconds and I can send the request.
    [ ] Host, in another browser or a private window:
        http://localhost:3000/api/auth/dev?as=staff&email=<my SEED_OWNER_EMAIL> opens the admin.
    [ ] The request is listed under Requests of that event with the selfie check passed, and "Approve" works.
        A request appears there only after Didit's decision has arrived and I have sent the request: while the
        selfie is unfinished, Requests shows 0.
    [ ] The event's Door tab opens. I enter a door name (the field is required) and press "Start door mode"; the
        camera prompt appears. This is the last item: door mode replaces the admin session, so it signs the host
        out of that browser. To return to the admin, I open the host link again.
    Email codes do not work with a sandbox key (the sandbox never confirms a code); the dev links replace them.
    If I cannot use a camera now, mark the three selfie and request items "not done" in the report. 8.4 already
    covers the app's handling of an approved and a declined result.

FINAL REPORT
Tell me, without any secret value:
- which steps ran and which were skipped, and why;
- the workflow_id written to the three workflow variables, and that the application is a sandbox application;
- the table of 8.1 to 8.4 with expected and actual results, and my answers to 8.5;
- where things are: configuration in apps/events/.env.local, the Didit account's email and password in
  apps/events/.env.didit-account, the database in the Docker container didit-events-db or, with my Postgres URL,
  the database of DB_NAME on that server (URL in apps/events/.env.postgres), the skills in skills/ and
  .clawhub/;
- which checks you skipped because this is not a git checkout;
- anything that failed, with the exact output.
````

## Notes

- The prompt uses a sandbox application for everything. For production you need a live application, its own API key
  and workflow, a public https URL, a registered webhook and a real sign-in. See
  [Didit setup](../README.md#didit-setup) and [Deployment](../README.md#deployment) in the README.
- To start again: `docker rm -f didit-events-db` (or drop the database `didit_events_local` on your own Postgres),
  delete `apps/events/.env.local` and run the prompt again. Answer "I already have a DIDIT_API_KEY" to keep the same
  Didit account.
- Without Docker the prompt needs a Postgres server of yours: the provisioning script does not run on the embedded
  database.
- The same steps by hand, in the Didit Business Console, are under [Didit setup](../README.md#didit-setup).
