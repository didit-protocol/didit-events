## What changed

<!-- One or two sentences. Link the issue if there is one: Closes #123 -->

## Why

## How to test it

<!-- The commands you ran, or the steps to see the change. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass
- [ ] `pnpm build && pnpm size && pnpm check:standalone` pass
- [ ] A change to the schema, a migration or locking also passes `pnpm test` with `TEST_DATABASE_URL` set
- [ ] Tests are added or updated next to the code
- [ ] A schema change comes with a new migration in `packages/core/drizzle` (shipped migrations are not edited)
- [ ] A new environment variable is documented in `.env.example` and in the README
- [ ] No secrets or real guest data are in the change, and no photographs except licensed face fixtures recorded in `scripts/e2e/fixtures/manifest.json`
- [ ] `CHANGELOG.md` has a line under "Unreleased" when users would notice the change
