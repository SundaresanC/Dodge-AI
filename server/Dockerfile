FROM node:22-slim AS builder
WORKDIR /app
# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22 AS runner
WORKDIR /app

# Install OpenSSL (Prisma) and unzip (dataset)
RUN apt-get update -y && apt-get install -y openssl unzip && rm -rf /var/lib/apt/lists/*

# Copy package files and reinstall production deps fresh in this environment
# This ensures DuckDB downloads the correct pre-built binary for node:22 (not the builder's slim env)
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled application
COPY --from=builder /app/dist ./dist

# Prisma schema + migrations (prisma CLI came from npm ci above)
COPY --from=builder /app/prisma ./prisma

# Bundle the SAP dataset directly into the image (only 0.12MB compressed)
COPY sap-data.zip /tmp/sap-data.zip
RUN mkdir -p /app/data && unzip /tmp/sap-data.zip -d /app/data && rm /tmp/sap-data.zip

EXPOSE 3001
# index.js handles prisma db push internally — no shell chain needed
CMD ["node", "dist/index.js"]
