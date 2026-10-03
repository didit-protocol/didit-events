# Contributing

Thanks for your interest. Didit Events is published as an example of an identity-native app, and fixes and
improvements are welcome.

## Before you start

- For a bug, open an issue with the steps to reproduce it.
- For a larger change, open an issue first so we can agree on the approach.
- For a security problem, do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Setup

Follow the quick start in the [README](README.md). You need Node 22 (22.7 or newer; `nvm use` reads `.nvmrc`) and
pnpm 11 through `corepack enable`. `pnpm smoke:local` and `pnpm test` run against a fake Didit, so you can work
on most changes without a Didit account. To click through the interface you need a free sandbox application: the fake
servers do not stay up after the smoke run. It works without Docker too, on the embedded database (README, "Without
Docker").

## Making a change

1. Create a branch from `main`.
2. Keep the change small and focused. Match the style of the code around it.
3. Add or update tests next to the code (`*.test.ts`, `*.test.tsx`).
4. Run the checks CI runs, in the same order:

   ```sh
   pnpm typecheck && pnpm lint
   pnpm test
   pnpm build && pnpm size && pnpm check:standalone
   ```

   `pnpm size` fails when a route grows past its budget in `scripts/size-budgets.json`. If your change needs the
   room, raise the budget in the same pull request and say why.

   CI runs `pnpm test` with a Postgres service, which adds the locking and migration suites. Without
   `TEST_DATABASE_URL` they are skipped on your machine, so a change to the schema, a migration or anything that
   takes a lock must also pass with it set (the README shows the two commands under Testing).

   CI needs no secrets and no repository settings, and runs the same way on a fork. The tests carry their own
   fixture settings; the build step sets a placeholder `STAFF_EMAIL_DOMAIN` in the workflow file.
5. Open a pull request that says what changed and why. The template has a short checklist.
6. If users would notice the change, add a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).

## Ground rules

- Never commit secrets or real guest data.
- No photographs of private people, and none you took yourself. The only portraits in the repository are the face fixtures in `scripts/e2e/fixtures`: public-domain or openly licensed images with the source and license recorded in `manifest.json`. A new one follows the rules in that folder's README. Everything else (avatars, covers, mock guests) is synthetic.
- Schema changes go through a new migration in `packages/core/drizzle`. Do not edit a migration that has shipped.
- Every billable Didit call must reserve budget first.
- Tests use the fake Didit server, never a real key. The one exception already exists and is opt-in: `pnpm e2e:journey --provider sandbox`. Do not add another, and do not make CI depend on a key.
- A new admin page, action, API route or MCP tool names one capability from `packages/core/src/access/capabilities.ts`.
- A new environment variable is documented in `.env.example` (purpose, default, example, where to get it) and gets one row in the Configuration table of the README. Both are edited by hand: there is no generator in this repository, so check that the two say the same.

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you will follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
