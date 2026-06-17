# ── Stage 1 : deps ────────────────────────────────────────────────────────────
# Install dependencies and generate the Prisma client.
# Kept as a separate stage so the next stages can reuse the layer cache.
FROM oven/bun:1-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# DATABASE_URL is required by prisma.config.ts at load time even for
# `prisma generate`, which never connects to the database. A placeholder
# is enough to satisfy the config validator during the build.
RUN bun install --frozen-lockfile && \
    DATABASE_URL=postgresql://build-placeholder bunx prisma generate

# ── Stage 2 : ci ──────────────────────────────────────────────────────────────
# Full source tree on top of deps — used by the GitHub Actions test job.
# node_modules and generated/ come from the deps stage; only source files are
# copied from the build context, so the cache is preserved on most pushes.
FROM deps AS ci
COPY . .

# ── Stage 3 : runner ──────────────────────────────────────────────────────────
# Minimal production image: no dev tooling, no test files, non-root user.
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules  ./node_modules
COPY --from=deps /app/generated     ./generated
COPY --from=ci   /app/src           ./src
COPY --from=ci   /app/index.ts      ./index.ts
COPY --from=ci   /app/package.json  ./package.json

EXPOSE 3001
USER bun
CMD ["bun", "run", "index.ts"]
