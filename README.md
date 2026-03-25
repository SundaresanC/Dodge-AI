# FlowMind AI — SAP Order-to-Cash Intelligence Platform

FlowMind AI is a full-stack natural-language interface for SAP Order-to-Cash (O2C) operational data. Users ask business questions in plain English; the system translates them to DuckDB SQL via an LLM, executes the query against JSONL data files, and renders interactive charts, tables, or an AI-guided graph visualization of the complete O2C document flow (Orders → Deliveries → Invoices → Payments → Accounting).

> **Production stack**: React + Vite frontend (Vercel) · Express + Prisma API (Railway) · PostgreSQL (Railway plugin) · DuckDB in-memory analytics · Gemini / OpenAI / Anthropic (multi-provider AI)

---

## Table of Contents

1. [Architecture Decisions](#1-architecture-decisions)
2. [Database Choice](#2-database-choice)
3. [LLM Prompting Strategy](#3-llm-prompting-strategy)
4. [Guardrails](#4-guardrails)
5. [SAP O2C Dataset](#5-sap-o2c-dataset)
6. [API Reference](#6-api-reference)
7. [Local Development](#7-local-development)
8. [Deploying to Vercel + Railway](#8-deploying-to-vercel--railway)
9. [Environment Variables](#9-environment-variables)

---

## 1. Architecture Decisions

### System Overview

```
┌─────────────────────────────────────────────┐
│  Browser (React SPA)                        │
│  ┌──────────┐  ┌────────────┐  ┌─────────┐  │
│  │ Dashboard│  │ O2C Graph  │  │Settings │  │
│  └────┬─────┘  └─────┬──────┘  └────┬────┘  │
└───────┼──────────────┼───────────────┼───────┘
        │  JWT (access token, 15 min)  │
        ▼                              │
┌──────────────────────────────────────────────┐
│  Express API  (:3001)                        │
│  /api/ai      /api/graph    /api/settings    │
│  /api/auth                                   │
│       │               │                     │
│       ▼               ▼                     │
│  ┌──────────┐   ┌──────────────────────┐    │
│  │ DuckDB   │   │ Prisma ORM           │    │
│  │ in-memory│   │ (PostgreSQL 16)      │    │
│  └────┬─────┘   └──────────────────────┘    │
│       │                                     │
│  JSONL files (SAP O2C dataset on disk)       │
└──────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────┐
│ AI Provider (chosen  │
│ per-user or system)  │
│  Gemini / OpenAI /   │
│  Anthropic           │
└──────────────────────┘
```

### Key Decisions

#### 1.1 Dual Data Store (PostgreSQL + DuckDB)
Two completely separate storage systems are used for two distinct purposes (see [Database Choice](#2-database-choice) for details):
- **PostgreSQL** handles all transactional, relational, mutable data: user accounts, sessions, AI model configurations, query history.
- **DuckDB** handles all analytical queries over the immutable SAP O2C JSONL dataset.

This avoids loading ~100MB of JSONL files into Postgres rows and lets DuckDB do what it does best — columnar, vectorized analytics over flat files.

#### 1.2 View Layering Strategy
Raw entity folders on disk are auto-registered as DuckDB views on startup. On top of those, 9 cleaned/normalized views (prefixed `v_`) are registered in `dataNormalization.ts`. The AI is always told to **prefer cleaned views** over raw tables. This gives the model semantically meaningful column values (e.g. `"Partial"` instead of SAP code `"B"`) without transforming the original files.

#### 1.3 Multi-Provider AI (Per-User Config)
Rather than hardwiring a single AI provider, each user can configure their own API keys per provider (Gemini, OpenAI, Anthropic), stored AES-256-GCM-encrypted in PostgreSQL. When a query runs, the pipeline resolves the active model config for that user, decrypts the key, and calls the appropriate provider SDK. System-level fallback keys in environment variables serve users who have not configured their own.

#### 1.4 AI-Optional Design
The application is fully functional — sign-up, login, settings, graph exploration — without any AI provider key configured. AI features degrade gracefully with an informative error message. The keyword-based guardrail layer also runs without an AI call, so irrelevant queries are rejected before spending any tokens.

#### 1.5 O2C Graph: Canvas + Custom Force Simulation
The graph visualization renders on a raw HTML5 `<canvas>` element using a custom force-directed simulation. This was chosen to avoid the bundle weight of large graph libraries and to allow fine-grained rendering control. Graph data is cached server-side for 5 minutes to avoid re-running the full join pipeline on every page reload.

#### 1.6 JWT Token Rotation with Reuse Detection
Access tokens are short-lived (15 min). Refresh tokens are long-lived (7 days) and stored in the `sessions` table alongside device/IP metadata. On refresh, the old token is atomically swapped for a new one. If a refresh token is replayed after rotation, the server detects the reuse attack and immediately **invalidates all sessions** for that user, forcing a full re-login.

#### 1.7 SPA Routing
The frontend is a single-page application. `vercel.json` contains a single catch-all rewrite `/* → /index.html` so direct URL access and browser refreshes work correctly, since all routing is handled by React Router on the client.

---

## 2. Database Choice

### PostgreSQL — Transactional / Application Data

PostgreSQL 16 (via Railway plugin, managed by Prisma ORM) handles all mutable application state:

| Table | Purpose |
|---|---|
| `users` | Account credentials (bcrypt-hashed passwords, profile, preferences) |
| `sessions` | JWT refresh token store with device metadata and expiry |
| `password_reset_tokens` | Single-use, 30-minute-expiry reset tokens |
| `ai_model_configs` | Per-user AI provider configuration with AES-256-GCM-encrypted API keys |
| `query_history` | Persisted NL query → SQL results (columns, chart type, execution time) |
| `graph_chat_history` | O2C graph chat messages with intent, confidence, and highlighted node IDs |

**Why PostgreSQL over alternatives:**
- ACID guarantees are critical for session and token management (refresh token rotation requires atomic read-delete-write).
- Prisma's migration system provides schema version control that survives Railway deploys.
- The Railway PostgreSQL plugin provisions, backs up, and scales the database with zero configuration overhead.

### DuckDB — Analytical / SAP O2C Dataset

DuckDB runs **in-memory**, embedded directly in the Express server process. It reads JSONL files from disk at startup and registers a view for each entity subfolder.

**Why DuckDB over alternatives:**

| Consideration | DuckDB | PostgreSQL COPY | SQLite | BigQuery / Cloud SQL |
|---|---|---|---|---|
| Columnar JSONL read | Native (`read_json_auto`) | Manual ETL required | Manual ETL required | Import pipeline required |
| In-process, no separate service | Yes | No | Yes | No |
| Analytical query performance | Vectorized execution | Row-by-row | Row-by-row | Excellent but costly |
| Data immutability (read-only SAP export) | Perfect fit | Overkill | Acceptable | Costly at this scale |
| Cold-start overhead | Single disk scan on init | ETL on every deploy | ETL on every deploy | N/A |

DuckDB's `read_json_auto` glob scanning (`*.jsonl`) allows the server to register all 19 entity folders in a single startup pass. Zero ETL pipeline is needed — the JSONL files from the SAP export are used directly.

**The trade-off** is that DuckDB data is not persisted between server restarts (views are re-registered from disk on each boot). This is intentional: the SAP dataset is a static export and is treated as read-only. If the dataset is updated, restarting the server is the correct refresh mechanism.

---

## 3. LLM Prompting Strategy

The NL→SQL pipeline has 11 explicit steps:

```
User query
  │
  ▼ Step 1:  Keyword pre-screen (no AI, fast reject)
  ▼ Step 2:  Resolve active AI model config for user
  ▼ Step 3:  Build system prompt (schema + normalization rules + few-shot examples)
  ▼ Step 4:  Call AI provider
  ▼ Step 5:  Extract SQL from response (fenced block or SELECT fallback)
  ▼ Step 6:  SQL safety validation (must be SELECT-only, no forbidden keywords)
  ▼ Step 7:  Execute against DuckDB
  ▼ Step 8:  Handle empty result (distinct outcome type, still persists to history)
  ▼ Step 9:  Infer visualization type (KPI card / line / bar / pie / table)
  ▼ Step 10: Persist to QueryHistory
  ▼ Step 11: Return result + data quality warning if applicable
```

### System Prompt Construction

The system prompt is built dynamically at query time from three sources:

**Part A — Schema Context** (`schemaContext.ts`): Full DuckDB view definitions listing every column, its inferred type, and a brief description. The model is explicitly told:
- Always wrap column names in double-quotes
- All views are read-only (`SELECT` only)
- Text fields may be `NULL` — use `COALESCE` or `IS NOT NULL` guards
- Prefer the 9 cleaned `v_` views over raw entity views

**Part B — Normalization Context** (`dataNormalization.ts`): Per-entity `RULE:` directives that explain SAP-specific code mappings. For example:
```
RULE: v_sales_orders_cleaned.overallDeliveryStatus:
  'A' = 'Not Delivered'
  'B' = 'Partial Delivery'
  'C' = 'Fully Delivered'
```
This prevents the model from writing queries that filter on raw SAP codes the user would never type.

**Part C — Task Instruction**: A precise instruction block telling the model to:
- Respond with exactly one fenced `sql` code block and nothing else
- Use only column names listed in the schema — never invent names
- Use `LIMIT 1000` on wide result sets
- Prefer `GROUP BY` + `ORDER BY ... DESC` for ranking queries
- Use `TRY_CAST` for numeric conversions on text fields

### Few-Shot Examples

The prompt includes 5 annotated example question → SQL pairs covering the most common query patterns (top-N ranking, monthly aggregation, multi-entity joins, status filtering, count distinct), ensuring the model produces DuckDB-compatible SQL idioms on the first attempt without trial-and-error correction loops.

### Graph Chat Engine

The graph chat sidebar uses a separate, intent-classified pipeline:

1. **`TRACE`** — Document number detected in query. Calls `traceDocument()` which performs a multi-hop DuckDB join across all entity types to find all records connected to that document. Returns highlighted node IDs for the graph canvas (`highlight_nodes`).
2. **`BROKEN_FLOW`** — Negative keywords detected (e.g. "not billed", "undelivered"). Calls `detectBrokenFlows()` which queries `v_o2c_chain_status` for orders that have stalled at a given stage.
3. **`AGGREGATE`** — Everything else. Falls through to the same NL→SQL pipeline as the dashboard query, with an O2C-specific system prompt context.

---

## 4. Guardrails

The system has layered defences against misuse, injection, and hallucination:

### 4.1 Query Relevance Pre-Screen (Zero AI Cost)
Before any AI provider is called, `queryValidator.ts` checks the user's natural-language query against a keyword map of ~100 O2C business terms across 9 entity categories (billing, orders, deliveries, payments, customers, products, etc.).

If no relevant keyword is found, the request is rejected immediately with an HTTP 200 `type: "error"` response that explains why the query is out of scope and suggests valid alternatives. **No AI tokens are spent.**

### 4.2 SELECT-Only SQL Enforcement
All AI-generated SQL passes through `validateSql()` before execution. Two checks:
1. The normalized (comment-stripped, uppercased) SQL must begin with `SELECT`.
2. A word-boundary regex scan rejects any statement containing these forbidden keywords:
   `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `EXEC`, `EXECUTE`, `CALL`, `COPY`, `ATTACH`, `DETACH`, `LOAD`, `INSTALL`, `PRAGMA`, `EXPORT`, `IMPORT`, `VACUUM`

DuckDB's in-memory views are inherently read-only, but this validation layer provides defence-in-depth and prevents any DuckDB-specific extension-loading or file-access commands from being executed.

### 4.3 Rate Limiting
Three separate `express-rate-limit` configurations:
- **General** — 100 requests per 15 minutes per IP
- **AI endpoints** (`/api/ai/*`) — 20 requests per 15 minutes per IP (prevents API key token abuse)
- **Auth endpoints** — separate limit to slow credential stuffing attacks

### 4.4 Authentication on All Data Routes
Every `/api/ai/*`, `/api/graph/*`, and `/api/settings/*` route is protected by the `authenticate` middleware that verifies the JWT access token signature and expiry. There is no unauthenticated path to query the database or call AI providers.

### 4.5 Ownership Checks (IDOR Prevention)
All delete and update operations on user-owned records (query history, AI model configs, graph chat history) verify that `record.userId === req.user.id` before executing. This prevents horizontal privilege escalation.

### 4.6 Encrypted API Key Storage
Per-user AI API keys are never stored in plaintext. Before insert/update, the key is encrypted using AES-256-GCM with a random 12-byte IV and the 32-byte `ENCRYPTION_KEY` from environment variables. The ciphertext, IV, and authentication tag are stored together. The key is decrypted in-memory only at query time.

### 4.7 Password Security
- Passwords hashed with `bcryptjs` at cost factor 12
- Password reset tokens: `crypto.randomBytes(32)` (256-bit entropy), single-use (`used` flag), expire after 30 minutes

### 4.8 HTTP Security Headers
`helmet` is applied as global middleware, setting `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Strict-Transport-Security` (in production).

### 4.9 CORS Lockdown
CORS is configured to allow only the origin specified in `CORS_ORIGIN`. In production this must be set to the exact Vercel deployment URL.

### 4.10 Data Quality Warnings
If an AI-generated query returns an unexpectedly high row count relative to a known entity's expected size, the result includes a `warning` field rendered as an amber callout in the UI, alerting users that the query may have unintended behaviour (e.g. a missing `GROUP BY` causing a Cartesian product).

---

## 5. SAP O2C Dataset

The dataset lives at `sap-order-to-cash-dataset/sap-o2c-data/` (sibling directory to `flow-wizard-ai/`). Each subfolder contains one or more `.jsonl` files (newline-delimited JSON). DuckDB registers a view per folder using `read_json_auto('*.jsonl')`.

### Raw Entity Views (19 views)

| View Name | Description |
|---|---|
| `sales_order_headers` | SO header: customer, date, status, amounts |
| `sales_order_items` | SO line items: material, quantity, price |
| `sales_order_schedule_lines` | Delivery schedule lines per SO item |
| `billing_document_headers` | Invoice headers: billing date, amount, customer |
| `billing_document_items` | Invoice line items |
| `billing_document_cancellations` | Cancelled billing documents |
| `outbound_delivery_headers` | Delivery headers: shipping, picking status |
| `outbound_delivery_items` | Delivery line items |
| `payments_accounts_receivable` | Payment clearing records |
| `journal_entry_items_accounts_receivable` | AR journal postings |
| `business_partners` | Customer master data |
| `business_partner_addresses` | Customer addresses |
| `customer_company_assignments` | BP-to-company assignments |
| `customer_sales_area_assignments` | BP-to-sales-area assignments |
| `products` | Material master records |
| `product_descriptions` | Material descriptions |
| `product_plants` | Material-plant assignments |
| `product_storage_locations` | Storage locations per plant |
| `plants` | Plant master data |

### Normalized Views (9 views — prefer these in queries)

| View Name | Key Transformations |
|---|---|
| `v_sales_orders_cleaned` | SAP status codes decoded to readable labels (`"A"` → `"Not Started"`) |
| `v_sales_items_cleaned` | `TRY_CAST` quantities/prices; `COALESCE` for null plant/material |
| `v_billing_cleaned` | Excludes cancelled docs; amounts cast to `DOUBLE`; `billingDate` as `DATE` |
| `v_billing_items_cleaned` | `TRY_CAST` all numerics; null guards |
| `v_deliveries_cleaned` | Picking/goods movement/POD status codes decoded |
| `v_payments_cleaned` | `"C"` → `"Cleared"`, `"O"` → `"Open"`; amounts as `DOUBLE`; dates as `DATE` |
| `v_products_cleaned` | Excludes `isMarkedForDeletion=true`; weight as `DOUBLE` |
| `v_o2c_chain_status` | **Master aggregate** — joins orders + deliveries + invoices + payments into a single `chainStatus` column: `Paid / Billed / Delivered / Order Only` |

### Dataset Folder Layout

```
parent-folder/
├── flow-wizard-ai/              ← this repo
│   └── server/
└── sap-order-to-cash-dataset/
    └── sap-o2c-data/
        ├── sales_order_headers/
        │   └── part-*.jsonl
        ├── billing_document_headers/
        │   └── part-*.jsonl
        └── ... (19 entity folders total)
```

---

## 6. API Reference

All routes are prefixed `/api`. Protected routes require `Authorization: Bearer <accessToken>`.

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/signup` | — | Create account; returns `accessToken` + `refreshToken` |
| `POST` | `/login` | — | Password auth; returns tokens |
| `POST` | `/refresh` | — | Rotate refresh token; detects and blocks reuse attacks |
| `POST` | `/logout` | — | Revoke current session |
| `POST` | `/logout-all` | ✓ | Revoke all sessions for user |
| `POST` | `/forgot-password` | — | Send password reset email |
| `POST` | `/reset-password` | — | Consume reset token, set new password |
| `GET` | `/me` | ✓ | Current user profile |
| `PUT` | `/me` | ✓ | Update name, timezone, avatarUrl, preferences |
| `POST` | `/change-password` | ✓ | Change password (requires current password) |

### AI Queries — `/api/ai`

| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `POST` | `/nl-query` | ✓ | 20/15 min | Full NL→SQL pipeline; returns `{type, chartType, sql, columns, rows, rowCount, executionMs, model, historyId, title, description, warning?}` |
| `GET` | `/query-history` | ✓ | general | Paginated history (`?page=&limit=`) |
| `DELETE` | `/query-history/:id` | ✓ | general | Delete own history entry |

### O2C Graph — `/api/graph`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/data` | ✓ | Graph nodes and edges; `?refresh=true` bypasses 5-min cache |
| `POST` | `/chat` | ✓ | TRACE / BROKEN_FLOW / AGGREGATE intent; returns answer + `highlight_nodes` |
| `GET` | `/chat/history` | ✓ | All graph chat messages (paginated) |
| `GET` | `/chat/sessions` | ✓ | Chat sessions list |
| `GET` | `/chat/session/:sessionId` | ✓ | All messages in one session |
| `DELETE` | `/chat/history` | ✓ | Clear all graph chat history |

### Settings — `/api/settings`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/ai-models` | ✓ | List AI model configs + system key availability |
| `POST` | `/ai-models` | ✓ | Create config (API key encrypted at rest) |
| `PUT` | `/ai-models/:id` | ✓ | Update config |
| `DELETE` | `/ai-models/:id` | ✓ | Delete config |
| `PATCH` | `/ai-models/:id/activate` | ✓ | Set as active model (deactivates others for same purpose) |
| `GET` | `/ai-models/:id/verify` | ✓ | Test API key validity against provider |

---

## 7. Local Development

### Prerequisites

- **Node.js 22** (matches Docker image; use `nvm use 22`)
- **npm** (included with Node)
- **PostgreSQL 14+** — or use Docker Compose to start one automatically
- **SAP O2C dataset** at the expected path (see Dataset Folder Layout above)

### Option A — Docker Compose (Recommended)

```bash
cd flow-wizard-ai

# 1. Copy and fill the backend environment file
cp server/.env.example server/.env
# Edit server/.env — set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
# (VITE_API_URL is set automatically in docker-compose.yml)

# 2. Build and start all three services (postgres, backend, frontend)
docker compose up --build
```

- Frontend: http://localhost:8080
- Backend API: http://localhost:3001
- Database: your host on port `5433`

Database migrations run automatically inside the backend container on every start.

### Option B — Manual Start

```bash
# ── Backend ──────────────────────────────────────────────
cd flow-wizard-ai/server
npm ci
cp .env.example .env        # fill in values (see Environment Variables section)
npx prisma migrate deploy   # apply migrations to your local Postgres
npm run dev                 # starts on :3001 with tsx watch (hot-reload)

# ── Frontend (new terminal) ───────────────────────────────
cd flow-wizard-ai
npm ci
# create .env containing: VITE_API_URL=http://localhost:3001/api
npm run dev                 # starts on :8080
```

### Generating Secrets

Run this command three times — once each for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Useful Backend Scripts

```bash
npm run db:studio       # Prisma Studio (visual DB browser) at :5555
npm run db:seed         # Seed example data
npm run db:reset        # Drop and recreate the database (dev only — destructive)
npm run build           # Compile TypeScript to dist/
```

---

## 8. Deploying to Vercel + Railway

Recommended production topology: React SPA on Vercel's global CDN, Express API + PostgreSQL on Railway.

```
Users ──▶ Vercel CDN (React SPA)
                │  HTTPS API calls
                ▼
          Railway (Express API + DuckDB in-memory)
                │  Prisma / TCP
                ▼
          Railway (PostgreSQL plugin)
```

### 8.1 Deploy the Backend on Railway

1. **Create a new Railway project** at https://railway.app/new

2. **Add a PostgreSQL database**:
   - In your project dashboard click **+ New** → **Database** → **Add PostgreSQL**
   - Railway provisions the database and injects `DATABASE_URL` into your service automatically

3. **Connect your repository**:
   - Click **+ New** → **GitHub Repo** → select your repo
   - Railway detects `railway.toml` in `flow-wizard-ai/server/` and sets the NIXPACKS builder
   - Set **Root Directory** to `flow-wizard-ai/server`

4. **Set environment variables** under **Variables** in the Railway dashboard:

   ```env
   # Injected automatically by Railway PostgreSQL plugin:
   DATABASE_URL=postgresql://...

   # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   JWT_ACCESS_SECRET=<64-char hex>
   JWT_REFRESH_SECRET=<64-char hex>
   ENCRYPTION_KEY=<64-char hex>

   NODE_ENV=production
   CORS_ORIGIN=https://your-app.vercel.app   # set AFTER you know your Vercel URL
   SAP_DATA_PATH=/app/sap-data

   # At least one AI provider key is required for AI features:
   GEMINI_API_KEY=<your Gemini API key>
   GEMINI_MODEL=gemini-2.5-flash
   # OPENAI_API_KEY=<optional>
   # ANTHROPIC_API_KEY=<optional>
   ```

5. **Make the SAP dataset available to the server** using one of two approaches:

   **Option A — Railway Volume (Recommended)**
   - In your Railway service go to **Volumes** → **Add Volume**, mount path: `/app/sap-data`
   - Upload the entire contents of `sap-order-to-cash-dataset/sap-o2c-data/` to that volume via the Railway CLI or dashboard file manager

   **Option B — Bundle into Docker image**
   - Copy the dataset into the `server/` directory under a `sap-data/` folder before building
   - In `server/Dockerfile`, add to the runner stage:
     ```dockerfile
     COPY --chown=node:node sap-data /app/sap-data
     ```
   - Set `SAP_DATA_PATH=/app/sap-data`

6. **Deploy**: Railway triggers a deploy on every `git push`, or click **Deploy Now** manually.

7. **Verify the health endpoint**:
   ```
   GET https://your-api.up.railway.app/api/health
   ```
   Returns `{ status: "ok", views: [...19 view names...] }` when DuckDB is loaded correctly.
   Copy the Railway URL — you need it for the Vercel deploy.

   > **Migrations**: The `railway.toml` start command (`npm run start`) runs `node dist/index.js` which boots the server. The Prisma migration is applied during the Docker build step. If using NIXPACKS, add a **build command** override in Railway: `npm ci && npm run build && npx prisma migrate deploy`.

### 8.2 Deploy the Frontend on Vercel

1. **Import the project** at https://vercel.com/new:
   - Select your Git repository
   - Set **Root Directory** to `flow-wizard-ai`

2. **Configure the build settings**:

   | Setting | Value |
   |---|---|
   | Framework Preset | `Vite` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Install Command | `npm ci` |

3. **Add the environment variable**:

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://your-api.up.railway.app/api` |

4. **Deploy**: click **Deploy**. Vercel builds the Vite app and deploys it to its global CDN.

5. **SPA routing works out-of-the-box**: `vercel.json` already contains the required catch-all rewrite:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```

6. **Update CORS on Railway**: Now that you know the Vercel URL (e.g. `https://flowmind.vercel.app`), go back to Railway and update:
   ```
   CORS_ORIGIN=https://flowmind.vercel.app
   ```
   Then trigger a redeploy on Railway.

### 8.3 Custom Domain (Optional)

- **Vercel**: Settings → Domains → Add domain. Vercel handles HTTPS via Let's Encrypt automatically.
- After adding the custom domain, update `CORS_ORIGIN` on Railway to use the custom domain.

### 8.4 Docker Compose (Self-Hosted)

Run the full stack locally or on any VPS:

```bash
# From the parent directory containing both flow-wizard-ai/ and sap-order-to-cash-dataset/
cd flow-wizard-ai
docker compose up --build -d
```

Three services start:
- `db` — PostgreSQL 16 on port `5433`
- `backend` — Express API on port `3001` (runs migrations on startup; mounts dataset as read-only volume)
- `frontend` — nginx serving the React SPA on port `8080`, proxying `/api/` to the backend

---

## 9. Environment Variables

### Backend (`server/.env`)

Generate all secret values with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/dbname` |
| `JWT_ACCESS_SECRET` | **Yes** | — | 64-char hex; signs 15-min access tokens |
| `JWT_REFRESH_SECRET` | **Yes** | — | 64-char hex; signs 7-day refresh tokens |
| `ENCRYPTION_KEY` | **Yes** | — | 64-char hex (32 bytes); AES-256-GCM key for stored API keys |
| `SAP_DATA_PATH` | **Yes** | `../../sap-order-to-cash-dataset/sap-o2c-data` | Absolute or relative path to JSONL data folder |
| `NODE_ENV` | Recommended | `development` | Set to `production` in production |
| `CORS_ORIGIN` | Recommended | `http://localhost:8080` | Exact frontend origin; set to your Vercel URL in production |
| `PORT` | No | `3001` | API server port |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token TTL |
| `GEMINI_API_KEY` | No | — | System-default Gemini API key (users can override per-account) |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Default Gemini model ID |
| `OPENAI_API_KEY` | No | — | System-default OpenAI API key |
| `ANTHROPIC_API_KEY` | No | — | System-default Anthropic API key |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window in ms (default: 15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | General rate limit per window per IP |
| `AI_RATE_LIMIT_MAX_REQUESTS` | No | `20` | AI endpoint rate limit per window per IP |
| `SMTP_HOST` | No | — | SMTP server for password reset emails; if absent, reset links are logged to stdout |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | `noreply@sap-o2c.local` | From address for reset emails |
| `APP_URL` | No | `http://localhost:8080` | Base URL used in reset-password email links |

### Frontend (`flow-wizard-ai/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | **Yes** | Full URL to backend API, e.g. `https://your-api.up.railway.app/api` |

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | React | 18.3 |
| Build tool | Vite + SWC | 8.x |
| UI components | shadcn/ui + Radix UI | — |
| Styling | Tailwind CSS | 3.4 |
| Charts | Recharts | 2.x |
| Data fetching | TanStack Query | 5.x |
| Animations | Framer Motion | 12.x |
| Backend framework | Express | 4.x |
| Runtime | Node.js | 22 |
| ORM | Prisma | 6.x |
| Transactional DB | PostgreSQL | 16 |
| Analytics engine | DuckDB (`@duckdb/node-api`) | 1.5.0 |
| AI — Gemini | `@google/genai` | 1.x |
| AI — OpenAI | `openai` | 4.x |
| AI — Anthropic | `@anthropic-ai/sdk` | 0.37 |
| Auth | JWT + bcrypt | — |
| API security | helmet, cors, express-rate-limit | — |
| Unit tests | Vitest + Testing Library | 4.x |
