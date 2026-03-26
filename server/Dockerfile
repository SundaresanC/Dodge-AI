FROM node:22-slim AS builder
WORKDIR /app
# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Install ALL deps (including DuckDB linux binary) in the builder
RUN npm ci
COPY . .
RUN npm run build
# Prune devDependencies so we can copy a lean node_modules to runner
RUN npm prune --omit=dev

FROM node:22-slim AS runner
WORKDIR /app

# Install OpenSSL (Prisma) and unzip (dataset)
RUN apt-get update -y && apt-get install -y openssl unzip && rm -rf /var/lib/apt/lists/*

# Copy production node_modules directly from builder (already pruned)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Compiled application
COPY --from=builder /app/dist ./dist

# Prisma schema (generate client in this environment for correct binary target)
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Bundle the SAP dataset directly into the image (only 0.12MB compressed)
# Uses /app/sap-dataset (NOT /app/data) to avoid Railway volume mounts shadowing it
COPY sap-data.zip /tmp/sap-data.zip
RUN mkdir -p /app/sap-dataset && unzip /tmp/sap-data.zip -d /app/sap-dataset && rm /tmp/sap-data.zip

# Verify the data is in place
RUN ls -la /app/sap-dataset/sap-o2c-data/ | head -20

EXPOSE 3001
CMD ["node", "dist/index.js"]
