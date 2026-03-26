/**
 * DuckDB proxy — all DuckDB operations run inside a forked child process so
 * that any native binary crash (SIGABRT / SIGSEGV) only kills the child and
 * leaves the main Express process alive.
 */
import { fork, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { env } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DuckDBResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

// ── Child process lifecycle ────────────────────────────────

let _child: ChildProcess | null = null;
let _available = false;
let _viewNames: string[] = [];
let _msgId = 0;
const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function rejectAll(reason: string): void {
  for (const p of _pending.values()) p.reject(new Error(reason));
  _pending.clear();
}

function getChild(): ChildProcess | null {
  if (_child) return _child;
  try {
    const childPath = path.join(__dirname, "duckdb-worker.js");
    _child = fork(childPath, [], {
      env: { ...process.env, SAP_DATA_PATH: env.SAP_DATA_PATH },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    _child.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
    _child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

    _child.on("message", (msg: { id: number; ok: boolean; data?: unknown; error?: string }) => {
      const pending = _pending.get(msg.id);
      if (!pending) return;
      _pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg.data);
      else pending.reject(new Error(msg.error ?? "DuckDB child error"));
    });

    _child.on("error", (err) => {
      console.warn("⚠️  DuckDB child error — AI queries unavailable:", err.message);
      _available = false;
      _child = null;
      rejectAll("DuckDB child process error");
    });

    _child.on("exit", (code, signal) => {
      if (code !== 0 || signal) {
        console.warn(`⚠️  DuckDB child exited (code=${code} signal=${signal}) — AI queries unavailable`);
        _available = false;
        _child = null;
        rejectAll("DuckDB child process exited");
      }
    });

  } catch (err) {
    console.warn("⚠️  Could not fork DuckDB child:", err);
    return null;
  }
  return _child;
}

function send(type: string, sql?: string): Promise<unknown> {
  const child = getChild();
  if (!child) return Promise.reject(new Error("DuckDB unavailable"));
  const id = ++_msgId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    child.send({ id, type, sql });
  });
}

// ── Public API ────────────────────────────────────────────

/**
 * Initialises the DuckDB child process (pre-warm). Non-fatal if DuckDB is unavailable.
 */
export async function getDuckDBConnection(): Promise<void> {
  try {
    const views = (await send("init")) as string[];
    _viewNames = views;
    _available = true;
    console.log("✅ DuckDB initialised — SAP O2C views and normalization layer ready");
  } catch (err) {
    console.warn("⚠️  DuckDB init failed (non-fatal — AI queries will be unavailable):", err);
    _available = false;
  }
}

/** Returns the list of SAP entity views registered at startup. */
export function getSapViewNames(): string[] {
  return [..._viewNames];
}

/**
 * Executes a read-only SQL query via the DuckDB child process.
 */
export async function duckdbQuery(sql: string): Promise<DuckDBResult> {
  if (!_available) throw new Error("DuckDB is not available on this deployment");
  return send("query", sql) as Promise<DuckDBResult>;
}

/**
 * Returns the list of SAP view names from the worker.
 */
export async function listSapViews(): Promise<string[]> {
  if (!_available) return [];
  return send("listViews") as Promise<string[]>;
}

