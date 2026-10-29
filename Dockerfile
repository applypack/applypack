# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
# Every stage runs the Prisma CLI: no update check, no telemetry (#524).
ENV CHECKPOINT_DISABLE=1
# The lockfile, exactly: an image built today and one built next month hold
# the same dependencies.
RUN npm ci --ignore-scripts && npx prisma generate

FROM node:24-alpine AS build
WORKDIR /app
ENV CHECKPOINT_DISABLE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# npm run build is tsc over tsconfig.build.json (no tests, no checkout-only
# tools) plus the PDF fonts beside dist/ (ADR 0039). Then the
# dev dependencies go (the compiler, tsx, tailwind, the types), and the
# client is generated again because a prune can take it with them. The
# built-in database is for `npm start` (ADR 0054); compose runs its own
# Postgres.
RUN npx prisma generate && npm run build \
 && npm prune --omit=dev && npx prisma generate \
 && rm -rf node_modules/embedded-postgres node_modules/@embedded-postgres

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CHECKPOINT_DISABLE=1
# The three CLI engines (docs/ai-engines.md), pinned for the same reason as
# the lockfile. Bump them together, after a Test on /settings → AI engine.
ARG CLAUDE_CODE_VERSION=2.1.274
ARG GEMINI_CLI_VERSION=0.61.0
ARG CODEX_VERSION=0.157.1
RUN apk add --no-cache tini \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@google/gemini-cli@${GEMINI_CLI_VERSION}" "@openai/codex@${CODEX_VERSION}"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Static assets served by the dashboard (keyword matcher for /jobs/:id/target).
COPY --from=build /app/src/web/public ./src/web/public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
