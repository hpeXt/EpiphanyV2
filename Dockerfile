FROM node:20-alpine AS base

# Install pnpm (match version in package.json)
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy all workspace config files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared-contracts/package.json ./packages/shared-contracts/
COPY packages/core-logic/package.json ./packages/core-logic/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/database/package.json ./packages/database/

# Install ALL dependencies (needed for turbo and workspace resolution)
RUN pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy all node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter=web build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public

# Set the correct permission for prerender cache
RUN mkdir -p apps/web/.next
RUN chown nextjs:nodejs apps/web/.next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
