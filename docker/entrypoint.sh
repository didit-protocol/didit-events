#!/bin/sh
# Container entrypoint: apply pending Drizzle migrations, then start the Next.js standalone server.
# A failed migration exits non-zero, so the container stops instead of serving on an old schema.
set -eu
node /app/migrate/migrate.mjs
cd /app/apps/events
exec node server.js
