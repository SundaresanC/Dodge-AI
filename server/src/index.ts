/**
 * Single entry point — runs Prisma db push, then starts the Express server.
 * Everything in one Node process so there's no way for a shell `&&` chain to
 * silently swallow a crash.
 */
import { execSync } from "child_process";

process.stderr.write("[boot] index.js starting\n");

process.on("uncaughtException", (err) => {
  process.stderr.write(`[boot] UNCAUGHT EXCEPTION: ${err?.stack ?? err}\n`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[boot] UNHANDLED REJECTION: ${reason}\n`);
});

// ── Step 1: Generate Prisma client + push schema ──
try {
  process.stderr.write("[boot] Running prisma generate…\n");
  execSync("npx prisma generate", { stdio: "inherit", cwd: process.cwd() });
  process.stderr.write("[boot] Running prisma db push…\n");
  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.stderr.write("[boot] Prisma sync complete\n");
} catch (err) {
  process.stderr.write(`[boot] Prisma step failed: ${err}\n`);
  // Non-fatal: the database might already be in sync; continue starting
}

// ── Step 2: Verify SAP data directory ──
{
  const sapPath = process.env.SAP_DATA_PATH ?? "(not set)";
  process.stderr.write(`[boot] SAP_DATA_PATH = ${sapPath}\n`);
  try {
    const { readdirSync, existsSync } = await import("fs");
    if (existsSync(sapPath)) {
      const entries = readdirSync(sapPath);
      process.stderr.write(`[boot] SAP data directory has ${entries.length} entries: ${entries.slice(0, 10).join(", ")}\n`);
    } else {
      process.stderr.write(`[boot] ⚠️  SAP data directory does NOT exist — checking /app/:\n`);
      if (existsSync("/app")) {
        process.stderr.write(`[boot]   /app contents: ${readdirSync("/app").join(", ")}\n`);
      }
      if (existsSync("/app/sap-dataset")) {
        process.stderr.write(`[boot]   /app/sap-dataset contents: ${readdirSync("/app/sap-dataset").join(", ")}\n`);
      }
      if (existsSync("/app/data")) {
        process.stderr.write(`[boot]   /app/data contents: ${readdirSync("/app/data").join(", ")}\n`);
      }
    }
  } catch (e) {
    process.stderr.write(`[boot] Could not inspect SAP path: ${e}\n`);
  }
}

// ── Step 3: Load and start Express app ──
process.stderr.write("[boot] Loading app module…\n");
import("./app.js")
  .then((mod) => {
    process.stderr.write("[boot] App module loaded successfully\n");
    return mod.default;
  })
  .catch((err) => {
    process.stderr.write(`[boot] FATAL — failed to load app: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500);
  });
