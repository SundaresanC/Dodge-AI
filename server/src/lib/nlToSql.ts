/**
 * NL → SQL → DuckDB intelligent pipeline.
 *
 * Complete flow:
 *   1.  Validate query relevance (keyword pre-screen — no AI needed)
 *   2.  Resolve user's active AI model config (or system default)
 *   3.  Build prompt: full schema + normalization context + few-shot examples
 *   4.  Call the AI model
 *   5.  Extract the SQL block from the response
 *   6.  Validate: SELECT-only, no DML/DDL/dangerous keywords
 *   7.  Execute against DuckDB (catch execution errors gracefully)
 *   8.  Handle empty results as a distinct outcome
 *   9.  Infer the best visualization type from result shape
 *  10.  Persist to QueryHistory (only for successful queries)
 *  11.  Return structured result with title, description, and optional warning
 *
 * Error outcomes are returned as HTTP 200 with type:"error" so the UI can render
 * an informative inline card instead of a toast.  Only true infrastructure errors
 * (DB down, AI provider unreachable) propagate as thrown exceptions.
 */

import { prisma } from "./prisma.js";
import { decrypt } from "./encryption.js";
import { getSchemaContext } from "./schemaContext.js";
import { getNormalizationContext } from "./dataNormalization.js";
import { validateQueryRelevance } from "./queryValidator.js";
import { duckdbQuery } from "./duckdb.js";
import { getAIGenerateFn, getSystemDefaultProvider, type AIProvider } from "./aiProviders.js";

// ─── Public types ────────────────────────────────────────

/**
 * Discriminated result returned by executeNlQuery for ALL outcomes.
 *
 * type === "chart"  → render with chartType (bar / line / pie / kpi)
 * type === "table"  → render as tabular data
 * type === "empty"  → query ran OK, 0 rows returned
 * type === "error"  → could not answer query (see errorType + description)
 */
export interface NLQueryResult {
  type: "chart" | "table" | "empty" | "error";
  chartType: ChartType;
  sql: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  model: string;
  historyId: string | null;
  title: string;
  description: string;
  /** Populated when the result may be affected by data-quality issues */
  warning?: string;
  /** Populated for type === "error" */
  errorType?: "invalid_query" | "sql_generation" | "unsafe_sql" | "sql_error" | "no_model";
  suggestions?: string[];
}

export type ChartType = "line" | "bar" | "pie" | "kpi" | "table" | "none";

// ─── Main entry point ────────────────────────────────────

export async function executeNlQuery(
  userId: string,
  nlQuery: string
): Promise<NLQueryResult> {

  // ── Step 1: Query relevance pre-screen (no AI needed) ────────
  const relevance = validateQueryRelevance(nlQuery);
  if (!relevance.valid) {
    return buildErrorResult(
      "invalid_query",
      nlQuery,
      "Query Not Applicable to Dataset",
      relevance.reason ??
        "This query cannot be answered using the SAP Order-to-Cash dataset.",
      relevance.suggestions
    );
  }

  // ── Step 2: Resolve AI model (may throw → lets controller handle infra errors) ──
  const { generateFn, providerLabel } = await resolveGenerateFn(userId);

  // ── Step 3: Build prompt with schema + normalization context ─
  const [schemaContext, normContext] = await Promise.all([
    getSchemaContext(),
    Promise.resolve(getNormalizationContext()),
  ]);
  const prompt = buildPrompt(schemaContext, normContext, nlQuery);

  // ── Step 4: Call AI (may throw → infrastructure error) ──────
  const aiResponse = await generateFn(prompt);

  // ── Step 5: Extract SQL ──────────────────────────────────────
  const sql = extractSql(aiResponse);
  if (!sql) {
    return buildErrorResult(
      "sql_generation",
      nlQuery,
      "Could Not Generate SQL",
      "The AI model could not produce a valid SQL query for your question. " +
        "Try rephrasing with more specific column or table names.",
      [
        "Top 10 customers by total billing amount",
        "Monthly revenue trend for 2025",
        "Delivery status breakdown",
      ]
    );
  }

  // ── Step 6: SQL safety validation ───────────────────────────
  try {
    validateSql(sql);
  } catch (err) {
    return buildErrorResult(
      "unsafe_sql",
      nlQuery,
      "Unsafe Query Blocked",
      err instanceof Error
        ? err.message
        : "The generated SQL contains unsafe operations and was blocked.",
      undefined,
      sql
    );
  }

  // ── Step 7: Execute against DuckDB ──────────────────────────
  let columns: string[];
  let rows: Record<string, unknown>[];
  let rowCount: number;
  let executionMs: number;

  try {
    const t0 = Date.now();
    ({ columns, rows, rowCount } = await duckdbQuery(sql));
    executionMs = Date.now() - t0;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return buildErrorResult(
      "sql_error",
      nlQuery,
      "Query Execution Failed",
      formatDuckDBError(raw),
      [
        "Try rephrasing your question with different terms",
        "Check that you referenced valid table and column names",
      ],
      sql
    );
  }

  // ── Step 8: Handle empty result ──────────────────────────────
  if (rowCount === 0) {
    await persistHistory(userId, nlQuery, sql, "table", 0, executionMs!, [], providerLabel);
    return {
      type: "empty",
      chartType: "none",
      sql,
      columns: [],
      rows: [],
      rowCount: 0,
      executionMs: executionMs!,
      model: providerLabel,
      historyId: null,
      title: buildTitle(nlQuery),
      description:
        "The query ran successfully but returned no matching records. " +
        "Try broadening your filters, adjusting date ranges, or rephrasing your question.",
    };
  }

  // ── Step 9: Infer visualization type ─────────────────────────
  const { type, chartType } = inferVisualizationType(columns!, rows!);

  // ── Step 10: Persist successful query to history ─────────────
  const historyId = await persistHistory(
    userId, nlQuery, sql, chartType, rowCount!, executionMs!, columns!, providerLabel
  );

  // ── Step 11: Data quality warning ────────────────────────────
  const warning = buildDataQualityWarning(sql, rowCount!);

  return {
    type,
    chartType,
    sql,
    columns: columns!,
    rows: rows!,
    rowCount: rowCount!,
    executionMs: executionMs!,
    model: providerLabel,
    historyId,
    title: buildTitle(nlQuery),
    description: buildDescription(type, chartType, rowCount!, executionMs!),
    warning,
  };
}

// ─── SQL extraction ──────────────────────────────────────

/**
 * Extracts the first ```sql ... ``` block from an AI response.
 * Falls back to grabbing text that starts with SELECT if no code fence found.
 */
export function extractSql(text: string): string | null {
  // Try fenced code block first (```sql ... ``` or just ``` ... ```)
  const fenced = text.match(/```(?:sql)?\s*\n?([\s\S]+?)```/i);
  if (fenced) return fenced[1].trim();

  // Fallback: find a line that starts with SELECT
  const selectMatch = text.match(/(SELECT[\s\S]+?)(;|$)/i);
  if (selectMatch) return selectMatch[1].trim();

  return null;
}

// ─── SQL safety validation ───────────────────────────────

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "CALL",
  "COPY",
  "ATTACH",
  "DETACH",
  "LOAD",
  "INSTALL",
  "PRAGMA",
  "EXPORT",
  "IMPORT",
  "VACUUM",
];

/**
 * Throws AppError(400) if the SQL contains any DML/DDL or dangerous DuckDB-specific keywords.
 * The check is performed on a normalised, comment-stripped version of the SQL.
 */
export function validateSql(sql: string): void {
  // Strip comments (single-line and multi-line)
  const stripped = sql
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .toUpperCase();

  // Must start with SELECT
  if (!/^\s*SELECT\b/.test(stripped)) {
    throw Object.assign(
      new Error("Only SELECT queries are allowed. The AI produced a non-SELECT statement."),
      { statusCode: 400 }
    );
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    // Use word-boundary check to avoid false positives (e.g. "SELECTED")
    if (new RegExp(`\\b${kw}\\b`).test(stripped)) {
      throw Object.assign(
        new Error(
          `Generated query contains the forbidden keyword "${kw}". Only SELECT queries are permitted.`
        ),
        { statusCode: 400 }
      );
    }
  }
}

// ─── Visualization type inference ───────────────────────

const TIME_PATTERNS = /date|time|month|year|week|day|period|quarter|created|updated/i;

function isLikelyNumeric(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return (
    typeof value === "number" ||
    (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "")
  );
}

function isLikelyDate(col: string, value: unknown): boolean {
  if (TIME_PATTERNS.test(col)) return true;
  if (typeof value === "string" && /^\d{4}-\d{2}/.test(value)) return true;
  return false;
}

/**
 * Returns both the result display type ("chart" | "table") and the specific
 * chart sub-type.  Includes KPI card detection for single-row aggregations.
 */
export function inferVisualizationType(
  columns: string[],
  rows: Record<string, unknown>[]
): { type: "chart" | "table"; chartType: ChartType } {
  if (columns.length === 0 || rows.length === 0) {
    return { type: "table", chartType: "table" };
  }

  const sample = rows[0];
  const numericCols = columns.filter((c) => isLikelyNumeric(sample[c]));
  const dateCols = columns.filter((c) => isLikelyDate(c, sample[c]));
  const categoricalCols = columns.filter(
    (c) => !isLikelyNumeric(sample[c]) && !isLikelyDate(c, sample[c])
  );

  // KPI card: single row with 1–6 numeric columns → summary metrics card
  if (rows.length === 1 && numericCols.length >= 1 && numericCols.length <= 6) {
    return { type: "chart", chartType: "kpi" };
  }

  // Line chart: time-like column + at least one numeric column
  if (dateCols.length >= 1 && numericCols.length >= 1) {
    return { type: "chart", chartType: "line" };
  }

  // Pie chart: exactly 2 columns (label + value), ≤ 10 rows
  if (
    columns.length === 2 &&
    categoricalCols.length === 1 &&
    numericCols.length === 1 &&
    rows.length <= 10
  ) {
    return { type: "chart", chartType: "pie" };
  }

  // Bar chart: categorical + numeric, ≤ 50 rows
  if (categoricalCols.length >= 1 && numericCols.length >= 1 && rows.length <= 50) {
    return { type: "chart", chartType: "bar" };
  }

  return { type: "table", chartType: "table" };
}

// Keep the legacy export for backward compatibility with schemaContext.ts callers
export function inferChartType(
  columns: string[],
  rows: Record<string, unknown>[]
): ChartType {
  return inferVisualizationType(columns, rows).chartType;
}

// ─── Helper builders ─────────────────────────────────────

function buildTitle(nlQuery: string): string {
  const q = nlQuery.trim();
  // Capitalise first letter; trim to 80 chars
  const titled = q.charAt(0).toUpperCase() + q.slice(1);
  return titled.length > 80 ? titled.slice(0, 77) + "…" : titled;
}

function buildDescription(
  type: "chart" | "table",
  chartType: ChartType,
  rowCount: number,
  executionMs: number
): string {
  const rows = rowCount.toLocaleString();
  const ms = executionMs.toLocaleString();
  if (type === "chart" && chartType === "kpi") {
    return `${rows} summary metric${rowCount !== 1 ? "s" : ""} — executed in ${ms}ms.`;
  }
  if (type === "chart") {
    return `Displaying ${rows} data point${rowCount !== 1 ? "s" : ""} as a ${chartType} chart — executed in ${ms}ms.`;
  }
  return `${rows} row${rowCount !== 1 ? "s" : ""} returned — executed in ${ms}ms.`;
}

function buildErrorResult(
  errorType: NLQueryResult["errorType"],
  _nlQuery: string,
  title: string,
  description: string,
  suggestions?: string[],
  sql?: string | null
): NLQueryResult {
  return {
    type: "error",
    chartType: "none",
    sql: sql ?? null,
    columns: [],
    rows: [],
    rowCount: 0,
    executionMs: 0,
    model: "none",
    historyId: null,
    title,
    description,
    errorType,
    suggestions,
  };
}

/**
 * Converts a raw DuckDB error message into a user-friendly explanation.
 */
function formatDuckDBError(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes("table") && lower.includes("not found")) {
    const match = raw.match(/Table with name "?([a-z0-9_]+)"?/i);
    const table = match ? `"${match[1]}"` : "the referenced table";
    return (
      `Table ${table} was not found in the dataset. ` +
      `The AI may have referenced a table that does not exist. Try rephrasing your query.`
    );
  }
  if (lower.includes("column") && (lower.includes("not found") || lower.includes("does not exist"))) {
    const match = raw.match(/column "?([a-z0-9_]+)"?/i);
    const col = match ? `"${match[1]}"` : "a referenced column";
    return (
      `Column ${col} does not exist in the referenced table. ` +
      `The AI may have guessed an incorrect field name. Try rephrasing your query.`
    );
  }
  if (lower.includes("binder error") || lower.includes("catalog error")) {
    return (
      "The generated SQL referenced a table or column that does not exist in the dataset. " +
      "Try rephrasing your question or specifying the exact entity (e.g. 'billing documents', 'sales orders')."
    );
  }
  if (lower.includes("parse error") || lower.includes("syntax error")) {
    return "The AI produced a SQL statement with a syntax error. Try rephrasing your query.";
  }
  if (lower.includes("type") && lower.includes("mismatch")) {
    return "A data type mismatch occurred in the query. The cleaned views (v_billing_cleaned, v_sales_orders_cleaned…) handle type casting — try phrasing your question to use those entities.";
  }

  // Fallback: return a shortened version of the original error
  const shortened = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
  return `Query execution error: ${shortened}`;
}

/**
 * Returns a warning message if the SQL uses raw tables instead of cleaned views
 * (indicating results may contain NULLs or uncasted types).
 */
function buildDataQualityWarning(sql: string, _rowCount: number): string | undefined {
  const RAW_TABLE_TO_CLEANED: Record<string, string> = {
    "billing_document_headers": "v_billing_cleaned",
    "sales_order_headers": "v_sales_orders_cleaned",
    "sales_order_items": "v_sales_items_cleaned",
    "outbound_delivery_headers": "v_deliveries_cleaned",
    "payments_accounts_receivable": "v_payments_cleaned",
    "products": "v_products_cleaned",
  };

  const usedRaw = Object.entries(RAW_TABLE_TO_CLEANED)
    .filter(([table]) =>
      // Match bare table name after FROM or JOIN (not inside a view name like v_billing_cleaned)
      new RegExp(`\\b(FROM|JOIN)\\s+${table}\\b`, "i").test(sql)
    )
    .map(([, cleaned]) => cleaned);

  if (usedRaw.length > 0) {
    return (
      `This result uses raw data tables. NULL values and uncast types may affect accuracy. ` +
      `For cleaner analysis, ask questions that use: ${usedRaw.join(", ")}.`
    );
  }

  return undefined;
}

/**
 * Saves a query to the history table and returns the new record ID.
 */
async function persistHistory(
  userId: string,
  nlQuery: string,
  sql: string,
  chartType: ChartType,
  rowCount: number,
  executionMs: number,
  columns: string[],
  _model: string
): Promise<string> {
  const history = await prisma.queryHistory.create({
    data: {
      userId,
      nlQuery,
      generatedSql: sql,
      resultSchema: { columns },
      chartType,
      executionMs,
      rowCount,
    },
  });
  return history.id;
}

// ─── AI model resolution ─────────────────────────────────

export async function resolveGenerateFn(userId: string) {
  // Look for user's active NL_QUERY config first, then DEFAULT
  const config = await prisma.aIModelConfig.findFirst({
    where: {
      userId,
      isActive: true,
      purpose: { in: ["NL_QUERY", "DEFAULT"] },
    },
    orderBy: [
      // NL_QUERY purpose takes priority over DEFAULT
      { purpose: "asc" },
      { updatedAt: "desc" },
    ],
  });

  if (config) {
    let apiKey: string | null = null;
    if (config.encryptedApiKey) {
      try {
        apiKey = decrypt(config.encryptedApiKey);
      } catch {
        // If decryption fails (e.g. key rotation), fall through to system env
      }
    }
    const generateFn = await getAIGenerateFn({
      provider: config.provider as AIProvider,
      modelId: config.modelId,
      apiKey,
    });
    return { generateFn, providerLabel: `${config.provider}/${config.modelId}` };
  }

  // Fall back to system environment defaults
  const systemDefault = getSystemDefaultProvider();
  if (!systemDefault) {
    throw Object.assign(
      new Error(
        "No AI model is configured. Please add an API key in Settings → AI Models, " +
          "or set GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY in your .env file."
      ),
      { statusCode: 503 }
    );
  }

  const generateFn = await getAIGenerateFn(systemDefault);
  return {
    generateFn,
    providerLabel: `${systemDefault.provider}/${systemDefault.modelId}`,
  };
}

// ─── Prompt builder ──────────────────────────────────────

function buildPrompt(
  schemaContext: string,
  normContext: string,
  userQuestion: string
): string {
  return `You are an expert data analyst working with a SAP Order-to-Cash (O2C) database exposed via DuckDB.

## Available Tables (raw)

${schemaContext}

${normContext}

## Strict Rules

1. Produce EXACTLY ONE valid DuckDB SQL SELECT statement inside a \`\`\`sql block.
2. NEVER produce INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE, or any DDL/DML.
3. NEVER use SELECT * — always name the specific columns you need.
4. Use only column names and table names visible above — do not invent columns.
5. ALWAYS add LIMIT 500 (or less) — never return unbounded results.
6. Prefer cleaned views (v_billing_cleaned, v_sales_orders_cleaned, etc.) over raw tables.
7. Use TRY_CAST for any numeric fields sourced from raw tables.
8. Use readable column aliases: AS total_revenue, AS customer_name, AS order_count.
9. DuckDB supports: STRFTIME, DATE_TRUNC, TRY_CAST, COALESCE, UNNEST, PIVOT.
10. If the question is ambiguous but answerable, make a reasonable assumption.

## Few-Shot Examples

Question: "Who are the top 10 customers by total billing amount?"
\`\`\`sql
SELECT
  bp.businessPartnerFullName  AS customer_name,
  bp.businessPartner          AS customer_id,
  SUM(b.totalNetAmount)       AS total_billing_amount,
  COUNT(b.billingDocument)    AS invoice_count,
  b.currency
FROM v_billing_cleaned b
JOIN business_partners bp ON b.soldToParty = bp.businessPartner
GROUP BY bp.businessPartner, bp.businessPartnerFullName, b.currency
ORDER BY total_billing_amount DESC
LIMIT 10
\`\`\`

Question: "Show monthly billing revenue trend for 2025"
\`\`\`sql
SELECT
  STRFTIME(billingDate, '%Y-%m') AS billing_month,
  SUM(totalNetAmount)            AS total_revenue,
  COUNT(billingDocument)         AS invoice_count
FROM v_billing_cleaned
WHERE STRFTIME(billingDate, '%Y') = '2025'
GROUP BY billing_month
ORDER BY billing_month
LIMIT 500
\`\`\`

Question: "What is the delivery status breakdown?"
\`\`\`sql
SELECT
  goodsMovementStatus   AS delivery_status,
  COUNT(*)              AS count
FROM v_deliveries_cleaned
GROUP BY goodsMovementStatus
ORDER BY count DESC
LIMIT 50
\`\`\`

Question: "Top 10 materials by total order quantity"
\`\`\`sql
SELECT
  material,
  SUM(requestedQuantity)  AS total_quantity,
  COUNT(salesOrder)       AS order_count,
  requestedQuantityUnit   AS unit
FROM v_sales_items_cleaned
GROUP BY material, requestedQuantityUnit
ORDER BY total_quantity DESC
LIMIT 10
\`\`\`

Question: "How many total sales orders are there?"
\`\`\`sql
SELECT
  COUNT(DISTINCT salesOrder)                                    AS total_orders,
  SUM(totalNetAmount)                                           AS total_net_value,
  COUNT(DISTINCT soldToParty)                                   AS unique_customers,
  AVG(totalNetAmount)                                           AS avg_order_value
FROM v_sales_orders_cleaned
\`\`\`

Question: "Open vs cleared payments breakdown"
\`\`\`sql
SELECT
  paymentStatus,
  COUNT(*)                          AS transaction_count,
  SUM(amountInCompanyCodeCurrency)  AS total_amount,
  currency
FROM v_payments_cleaned
GROUP BY paymentStatus, currency
ORDER BY total_amount DESC
LIMIT 50
\`\`\`

---

User question: "${userQuestion}"

SQL:`;
}
