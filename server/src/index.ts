/**
 * Bootstrap entry point — installs crash handlers BEFORE any application
 * code is imported so we can see errors that kill the process in Docker.
 *
 * ES modules hoist static `import` declarations above all other code,
 * so a regular import can't be preceded by crash-handler setup.
 * Here we use dynamic `import()` which executes sequentially.
 */
console.log("🚀 bootstrap: starting…");

process.on("uncaughtException", (err) => {
  console.error("💀 UNCAUGHT EXCEPTION:", err);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  console.error("💀 UNHANDLED REJECTION:", reason);
});

console.log("🚀 bootstrap: crash handlers installed, loading app…");
import("./app.js")
  .then((mod) => {
    console.log("✅ bootstrap: app module loaded");
    return mod.default;
  })
  .catch((err) => {
    console.error("💀 bootstrap: failed to load app:", err);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500);
  });
