/**
 * DuckDB proxy — all DuckDB operations run inside a worker thread so that
 * any native binary crash (SIGABRT / SIGSEGV) only kills the worker and
 * leaves the main Express process alive.
 */
import { Worker } from "worker_threads";
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

// ── Worker lifecycle ──────────────────────────────────────

let _worker: Worker | null = null;
let _available = false;
let _viewNames: string[] = [];
let _msgId = 0;
const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (_worker) return _worker;
  if (!_available && _worker === null) {
    try {
      const workerPath = path.join(__dirname, "duckdb-worker.js");
      _worker = new Worker(workerPath, { workerData: { sapDataPath: env.SAP_DATA_PATH } });

      _worker.on("message", (msg: { id: number; ok: boolean; data?: unknown; error?: string }) => {
        const pending = _pending.get(msg.id);
        if (!pending) return;
        _pending.delete(msg.id);
        if (msg.ok) pending.resolve(msg.data);
        else pending.reject(new Error(msg.error ?? "DuckDB worker error"));
      });

      _worker.on("error", (err) => {
        console.warn("⚠️  DuckDB worker error — AI queries unavailable:", err.message);
        _available = false;
        _worker = null;
        for (const p of _pending.values()) p.reject(new Error("DuckDB worker crashed"));
        _pending.clear();
      });

      _worker.on("exit", (code) => {
        if (code !== 0) {
          console.warn(`⚠️  DuckDB worker exited (code ${code}) — AI queries unavailable`);
          _available = false;
          _worker = null;
          for (const p of _pending.values()) p.reject(new Error("DuckDB worker exited"));
          _pending.clear();
        }
      });

    } catch (err) {
      console.warn("⚠️  Could not start DuckDB worker:", err);
      return null;
    }
  }
  return _worker;
}

function send(type: string, sql?: string): Promise<unknown> {
  const worker = getWorker();
  if (!worker) return Promise.reject(new Error("DuckDB unavailable"));
  const id = ++_msgId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, sql });
  });
}

// ── Public API ────────────────────────────────────────────

/**
 * Initialises the DuckDB worker (pre-warm). Non-fatal if DuckDB is unavailable.
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
 * Resolves SAP data folder from config, then registers one VIEW per entity.
 * Uses glob-style paths so multi-part JSONL entities are automatically merged.
 */
async function registerSapViews(conn: DuckDBConnection): Promise<void> {
  const dataRoot = path.resolve(env.SAP_DATA_PATH);

  if (!fs.existsSync(dataRoot)) {
    console.warn(
      `⚠️  SAP_DATA_PATH not found: ${dataRoot}. NL query will be unavailable.`
    );
    return;
  }

  const entities = fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const entity of entities) {
    const entityDir = path.join(dataRoot, entity);
    const jsonlFiles = fs
      .readdirSync(entityDir)
      .filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) continue;

    // DuckDB accepts glob patterns – use a stable wildcard so new files are
    // automatically picked up without a server restart.
    //
    // On Windows, paths must use forward slashes inside DuckDB SQL strings.
    const globPath = path.join(entityDir, "*.jsonl").replace(/\\/g, "/");

    const viewSql = `
      CREATE OR REPLACE VIEW ${entity} AS
        SELECT * FROM read_json_auto('${globPath}', format='newline_delimited', ignore_errors=true)
    `;

    try {
      await conn.run(viewSql);
      _registeredViews.push(entity);
    } catch (err) {
      console.warn(`⚠️  Could not register DuckDB view for '${entity}':`, err);
    }
  }
}

/**
 * Executes a read-only SQL query via the DuckDB worker.
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

