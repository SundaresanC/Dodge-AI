FROM node:22-slim AS builder
WORKDIR /app
# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

# Install OpenSSL required by Prisma at runtime + unzip for dataset
RUN apt-get update -y && apt-get install -y openssl unzip && rm -rf /var/lib/apt/lists/*

# Copy the full node_modules from builder — keeps prisma CLI and DuckDB native binaries intact
COPY --from=builder /app/node_modules ./node_modules

# Compiled application
COPY --from=builder /app/dist ./dist

# Prisma schema + migrations
COPY --from=builder /app/prisma ./prisma

COPY package*.json ./

# Bundle the SAP dataset directly into the image (only 0.12MB compressed)
COPY sap-data.zip /tmp/sap-data.zip
RUN mkdir -p /app/data && unzip /tmp/sap-data.zip -d /app/data && rm /tmp/sap-data.zip

EXPOSE 3001
# Use db push (idempotent) instead of migrate deploy to avoid P3009 on partial deploys
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --skip-generate && node dist/index.js"]
