FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

# Copy the full node_modules from builder — this keeps the prisma CLI
# (devDep) and DuckDB native binaries intact for the current platform,
# avoiding a second download and ensuring `npx prisma migrate deploy` works.
COPY --from=builder /app/node_modules ./node_modules

# Compiled application
COPY --from=builder /app/dist ./dist

# Prisma schema + migrations (required for `prisma migrate deploy` at startup)
COPY --from=builder /app/prisma ./prisma

COPY package*.json ./

EXPOSE 3001
# Use db push (idempotent schema sync) instead of migrate deploy to avoid
# P3009 failures when tables already exist from a previous partial deploy
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --skip-generate && node dist/index.js"]
