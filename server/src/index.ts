import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config.js";
import { generalLimiter, errorHandler } from "./middleware/index.js";
import { getDuckDBConnection, getSapViewNames } from "./lib/duckdb.js";
import { getSchemaContext } from "./lib/schemaContext.js";

import authRoutes from "./routes/auth.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import graphRoutes from "./routes/graph.routes.js";

const app = express();

// ── Global Middleware ────────────────────────────────────

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Request logging
if (env.NODE_ENV !== "test") {
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Rate limiting
app.use(generalLimiter);

// ── Health Check ─────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  const views = getSapViewNames();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    version: "1.0.0",
    duckdb: {
      ready: views.length > 0,
      viewCount: views.length,
      views,
    },
  });
});

// ── API Routes ───────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/graph", graphRoutes);

// ── 404 Handler ──────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Global Error Handler (must be last) ──────────────────

app.use(errorHandler);

// ── Start Server ─────────────────────────────────────────

app.listen(env.PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │                                         │
  │   SAP O2C Explorer — API Server         │
  │                                         │
  │   → Local:   http://localhost:${env.PORT}     │
  │   → Mode:    ${env.NODE_ENV.padEnd(24)}│
  │                                         │
  └─────────────────────────────────────────┘
  `);

  // Pre-warm DuckDB connection and schema cache
  getDuckDBConnection()
    .then(() => getSchemaContext())
    .then(() => console.log("✅ SAP O2C schema context ready"))
    .catch((err) => console.warn("⚠️  DuckDB pre-warm failed (non-fatal):", err));
});

export default app;
