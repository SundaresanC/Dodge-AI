/**
 * DuckDB worker thread.
 * Runs in a separate thread so any native binary crash (SIGABRT/SIGSEGV)
 * kills only this worker — the main Express process stays alive.
 */
import { parentPort, workerData } from "worker_threads";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import path from "path";
import fs from "fs";
import { registerCleanedViews } from "./dataNormalization.js";

interface WorkerMessage {
  id: number;
  type: "query" | "listViews" | "viewNames" | "init";
  sql?: string;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

let _connection: DuckDBConnection | null = null;
const _registeredViews: string[] = [];

async function getConnection(): Promise<DuckDBConnection> {
  if (_connection) return _connection;
  const instance = await DuckDBInstance.create(":memory:");
  _connection = await instance.connect();
  await registerSapViews(_connection);
  await registerCleanedViews(_connection);
  return _connection;
}

async function registerSapViews(conn: DuckDBConnection): Promise<void> {
  const dataRoot = path.resolve(workerData.sapDataPath as string);
  if (!fs.existsSync(dataRoot)) {
    console.warn(`⚠️  DuckDB worker: SAP_DATA_PATH not found: ${dataRoot}`);
    return;
  }

  const entities = fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const entity of entities) {
    const entityDir = path.join(dataRoot, entity);
    const jsonlFiles = fs.readdirSync(entityDir).filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) continue;

    const globPath = path.join(entityDir, "*.jsonl").replace(/\\/g, "/");
    const viewSql = `
      CREATE OR REPLACE VIEW ${entity} AS
        SELECT * FROM read_json_auto('${globPath}', format='newline_delimited', ignore_errors=true)
    `;
    try {
      await conn.run(viewSql);
      _registeredViews.push(entity);
    } catch (err) {
      console.warn(`⚠️  DuckDB worker: could not register view '${entity}':`, err);
    }
  }
  console.log(`✅ DuckDB worker: ${_registeredViews.length} SAP views ready`);
}

if (!parentPort) throw new Error("Must run as a worker thread");

parentPort.on("message", async (msg: WorkerMessage) => {
  const reply: WorkerResponse = { id: msg.id, ok: false };
  try {
    if (msg.type === "init") {
      await getConnection();
      reply.ok = true;
      reply.data = _registeredViews;
    } else if (msg.type === "viewNames") {
      reply.ok = true;
      reply.data = [..._registeredViews];
    } else if (msg.type === "query" && msg.sql) {
      const conn = await getConnection();
      const result = await conn.runAndReadAll(msg.sql);
      const rawRows = result.getRowObjects() as Record<string, unknown>[];
      const rows = rawRows.map(serializeRow);
      const columns =
        rawRows.length > 0
          ? Object.keys(rawRows[0])
          : Array.from({ length: result.columnCount }, (_, i) => result.columnName(i));
      reply.ok = true;
      reply.data = { columns, rows, rowCount: rows.length };
    } else if (msg.type === "listViews") {
      const conn = await getConnection();
      const result = await conn.runAndReadAll(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
      );
      reply.ok = true;
      reply.data = (result.getRowObjects() as { table_name: string }[]).map((r) => r.table_name);
    }
  } catch (err) {
    reply.ok = false;
    reply.error = err instanceof Error ? err.message : String(err);
  }
  parentPort!.postMessage(reply);
});
