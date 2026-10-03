# Changelog

Notable changes to Didit Events are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-02

The first public release: the app Didit runs for its own events, published as an example of an identity-native app.

### Added

- Public event pages and a calendar, with request to join and optional host questions.
- Sign-in with a Didit email code or with Google through Didit. No passwords.
- One selfie liveness check per account, which also enrolls the face used at the door.
- Optional checks per event: phone, identity document, name from the document and minimum age. Valid proofs are reused across events.
- Host review: approve, waitlist or decline, with automatic confirmation for open events.
- Face check-in from a browser kiosk (MediaPipe detection, Didit face search), with supervised, strict and test modes and manual check-in as a fallback.
- Admin for events, applicants, guests, the check-in log, event teams, spend limits and a calendar profile.
- Transactional emails through an outbox and Resend, with calendar invites and an editor for hosts.
- A spend ledger with ceilings per event, per day and in total for every billable Didit call.
- An MCP server at `/api/mcp` so agents can manage events with a personal access token.
- Account deletion with a seven-day grace period. After it the app asks Didit to delete the account's verification sessions and, once Didit has confirmed, deletes the account's own records; a deletion Didit does not confirm is flagged for manual follow-up and the local records stay until it is resolved. Audit entries (emptied, not removed), door requests saved in Didit and database backups are outside it: see "Retention and deletion" in the README.
- Postgres with Drizzle migrations, and PGlite for development without a database server.
- Docker image, docker compose file and a standalone Node build.
- Settings for running your own instance: staff email domains, the first owner, the contact address, the sender, the email footer, the OIDC client and the face workflow. The staff domain, the first owner and the face workflow have no default, and the sender and the email footer are required with a Resend key: migrations, the seed and the server stop with a message until they are set. There is no built-in OIDC client: Google sign-in is off until you configure your own.
- A smoke test against fake Didit and Resend servers, and an end-to-end journey over HTTP.

[Unreleased]: https://github.com/didit-protocol/didit-events/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/didit-protocol/didit-events/releases/tag/v0.1.0
