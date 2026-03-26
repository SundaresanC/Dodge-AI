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

// ── Step 1: Run Prisma db push (sync, so we block until done) ──
try {
  process.stderr.write("[boot] Running prisma db push…\n");
  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.stderr.write("[boot] Prisma sync complete\n");
} catch (err) {
  process.stderr.write(`[boot] Prisma db push failed: ${err}\n`);
  // Non-fatal: the database might already be in sync; continue starting
}

// ── Step 2: Load and start Express app ──
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
