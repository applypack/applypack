# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npm install --ignore-scripts && npx prisma generate

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# npm run build is tsc plus the PDF fonts beside dist/ (ADR 0039). The built-in
# database is for `npm start` (ADR 0054); compose runs its own Postgres.
RUN npx prisma generate && npm run build \
 && rm -rf node_modules/embedded-postgres node_modules/@embedded-postgres

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini \
 && npm install -g @anthropic-ai/claude-code @google/gemini-cli @openai/codex
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Static assets served by the dashboard (keyword matcher for /jobs/:id/target).
COPY --from=build /app/src/web/public ./src/web/public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
