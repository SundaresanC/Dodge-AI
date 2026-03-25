import { duckdbQuery, listSapViews } from "./duckdb.js";

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
}

// Cached on first call so the build-time DESCRIBE queries only run once.
let _schemaContext: string | null = null;
let _tableSchemas: TableSchema[] | null = null;

/**
 * Returns cached schema context string for inclusion in AI prompts.
 * Describes every SAP view as: tableName (col: TYPE, col: TYPE, …)
 */
export async function getSchemaContext(): Promise<string> {
  if (_schemaContext) return _schemaContext;
  const schemas = await buildTableSchemas();
  _schemaContext = schemas
    .map(
      (t) =>
        `TABLE ${t.tableName} (\n  ${t.columns.map((c) => `${c.name} ${c.type}`).join(",\n  ")}\n)`
    )
    .join("\n\n");
  return _schemaContext;
}

/**
 * Returns the raw array of table schemas (useful for the settings API response).
 */
export async function getTableSchemas(): Promise<TableSchema[]> {
  if (_tableSchemas) return _tableSchemas;
  _tableSchemas = await buildTableSchemas();
  return _tableSchemas;
}

/**
 * Invalidates the cached schema so it re-builds on the next call.
 * Call this if the SAP data folder changes at runtime.
 */
export function invalidateSchemaCache(): void {
  _schemaContext = null;
  _tableSchemas = null;
}

async function buildTableSchemas(): Promise<TableSchema[]> {
  const views = await listSapViews();
  const schemas: TableSchema[] = [];

  for (const view of views) {
    try {
      const result = await duckdbQuery(
        `DESCRIBE SELECT * FROM ${view} LIMIT 0`
      );
      const columns: ColumnInfo[] = result.rows.map((row) => ({
        name: String(row["column_name"] ?? row["name"] ?? ""),
        type: String(row["column_type"] ?? row["type"] ?? ""),
      }));
      schemas.push({ tableName: view, columns });
    } catch {
      // Skip views that fail to describe (e.g. invalid JSONL data)
    }
  }

  return schemas;
}
