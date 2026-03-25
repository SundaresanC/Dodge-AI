import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { env } from "../config.js";
import { registerCleanedViews } from "./dataNormalization.js";
import path from "path";
import fs from "fs";

interface DuckDBResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

let _connection: DuckDBConnection | null = null;
const _registeredViews: string[] = [];

/**
 * Returns (and lazily creates) the single DuckDB in-memory connection.
 * Views over SAP JSONL files are registered on first init.
 */
export async function getDuckDBConnection(): Promise<DuckDBConnection> {
  if (_connection) return _connection;

  const instance = await DuckDBInstance.create(":memory:");
  _connection = await instance.connect();

  await registerSapViews(_connection);
  await registerCleanedViews(_connection);
  console.log("✅ DuckDB initialised — SAP O2C views and normalization layer ready");

  return _connection;
}

/** Returns the list of SAP entity views registered at startup. */
export function getSapViewNames(): string[] {
  return [..._registeredViews];
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
 * Executes a read-only SQL query against the DuckDB in-memory database.
 * Returns columns and serialisable rows (BigInt values are converted to strings).
 */
export async function duckdbQuery(sql: string): Promise<DuckDBResult> {
  const conn = await getDuckDBConnection();

  const result = await conn.runAndReadAll(sql);
  const rawRows = result.getRowObjects() as Record<string, unknown>[];

  const rows = rawRows.map(serializeRow);

  const columns =
    rawRows.length > 0
      ? Object.keys(rawRows[0])
      : Array.from({ length: result.columnCount }, (_, i) =>
          result.columnName(i)
        );

  return { columns, rows, rowCount: rows.length };
}

/**
 * Returns the list of registered SAP view names (= the entity folder names).
 */
export async function listSapViews(): Promise<string[]> {
  const conn = await getDuckDBConnection();
  const result = await conn.runAndReadAll(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
  );
  return (result.getRowObjects() as { table_name: string }[]).map(
    (r) => r.table_name
  );
}

// ─── Helpers ─────────────────────────────────────────────

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, serializeValue(v)])
  );
}

function serializeValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [
        k,
        serializeValue(val),
      ])
    );
  }
  return v;
}
