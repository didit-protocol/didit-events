# Didit Events: Next.js 16 served by the standalone Node server.
#
# Multi-stage: install the workspace and build apps/events with pnpm, then run only the traced standalone output as
# the unprivileged node user. Server settings are read from the environment when the container starts, so one image
# serves every environment. CONTACT_EMAIL, STAFF_EMAIL_DOMAIN and NEXT_PUBLIC_SENTRY_DSN are the exception: the pages
# get them at build time. Give the container the same CONTACT_EMAIL and STAFF_EMAIL_DOMAIN when it runs.
FROM node:26-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CI=true
RUN corepack enable

FROM base AS build
# Manifests first so the dependency layer is cached across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/events/package.json apps/events/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @didit-events/events...
COPY . .
# Frozen into the pages at build time. The staff domain has no default: the Team page would be built for someone
# else's domain. An empty CONTACT_EMAIL is rejected, so the neutral default of the code is repeated here.
ARG CONTACT_EMAIL=events@example.com
ARG STAFF_EMAIL_DOMAIN=
RUN test -n "$STAFF_EMAIL_DOMAIN" || { echo "STAFF_EMAIL_DOMAIN is not set: pass --build-arg STAFF_EMAIL_DOMAIN=yourcompany.com (docker compose reads it from .env)" >&2; exit 1; }
ENV CONTACT_EMAIL=$CONTACT_EMAIL
ENV STAFF_EMAIL_DOMAIN=$STAFF_EMAIL_DOMAIN
ARG NEXT_PUBLIC_ENVIRONMENT=production
ENV NEXT_PUBLIC_ENVIRONMENT=$NEXT_PUBLIC_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN pnpm --filter @didit-events/events build
# Migrations run from a production-only bundle of @didit-events/core: drizzle-orm and postgres are compiled into the
# Next.js server chunks, so the standalone tree cannot resolve them for docker/migrate.mjs.
RUN pnpm --filter @didit-events/core deploy --legacy --prod /migrate \
    && cp docker/migrate.mjs /migrate/migrate.mjs

FROM node:26-slim AS prod
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 NEXT_MANUAL_SIG_HANDLE=1
COPY --from=build --chown=node:node /app/apps/events/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/events/.next/static ./apps/events/.next/static
# public/ (email logo, fonts, face detection model) is not part of the standalone output.
COPY --from=build --chown=node:node /app/apps/events/public ./apps/events/public
COPY --from=build --chown=node:node /migrate ./migrate
COPY --chown=node:node docker/entrypoint.sh ./entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "/app/entrypoint.sh"]
