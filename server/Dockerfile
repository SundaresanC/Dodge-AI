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
COPY package*.json ./
RUN npm ci --omit=dev && npm ls @duckdb/node-bindings-linux-x64 || npm install --no-save @duckdb/node-bindings-linux-x64

# Compiled application
COPY --from=builder /app/dist ./dist

# Prisma schema + migrations (prisma CLI came from npm ci above)
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Bundle the SAP dataset directly into the image (only 0.12MB compressed)
# Uses /app/sap-dataset (NOT /app/data) to avoid Railway volume mounts shadowing it
COPY sap-data.zip /tmp/sap-data.zip
RUN mkdir -p /app/sap-dataset && unzip /tmp/sap-data.zip -d /app/sap-dataset && rm /tmp/sap-data.zip

# Verify the data is in place
RUN ls -la /app/sap-dataset/sap-o2c-data/ | head -20

EXPOSE 3001
# index.js handles prisma db push internally — no shell chain needed
CMD ["node", "dist/index.js"]
