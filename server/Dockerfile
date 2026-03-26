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

# Install unzip for dataset extraction
RUN apt-get update -y && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps (node:22 has all libs DuckDB needs)
COPY package*.json ./
RUN npm ci --omit=dev

# Explicitly install DuckDB linux binary if missing
RUN npm ls @duckdb/node-bindings-linux-x64 2>/dev/null || npm install --no-save @duckdb/node-bindings-linux-x64

# Compiled application
COPY --from=builder /app/dist ./dist

# Prisma schema — generate client for this platform
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Bundle the SAP dataset directly into the image
COPY sap-data.zip /tmp/sap-data.zip
RUN mkdir -p /app/sap-dataset && unzip /tmp/sap-data.zip -d /app/sap-dataset && rm /tmp/sap-data.zip
RUN echo "SAP data contents:" && ls /app/sap-dataset/sap-o2c-data/

EXPOSE 3001
CMD ["node", "dist/index.js"]
