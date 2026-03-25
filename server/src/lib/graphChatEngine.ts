/**
 * Graph Chat Engine — multi-step reasoning for O2C graph queries.
 *
 * Pipeline:
 *   1. Validate query is O2C-related
 *   2. Detect intent (TRACE / BROKEN_FLOW / AGGREGATE / LOOKUP / INVALID)
 *   3. Execute the appropriate handler
 *   4. Return structured response with highlight_nodes for the UI
 */

import { validateQueryRelevance } from "./queryValidator.js";
import { duckdbQuery } from "./duckdb.js";
import { traceDocument, detectBrokenFlows, getCachedGraph } from "./graphBuilder.js";
import { resolveGenerateFn } from "./nlToSql.js";
import { getSchemaContext } from "./schemaContext.js";
import { getNormalizationContext } from "./dataNormalization.js";

// ─── Public types ────────────────────────────────────────

export type IntentType =
  | "TRACE"
  | "BROKEN_FLOW"
  | "AGGREGATE"
  | "LOOKUP"
  | "INVALID";

export interface ConversationTurn {
  role: "user" | "agent";
  content: string;
}

export interface GraphChatResponse {
  answer: string;
  data: Record<string, unknown>[];
  entities_involved: string[];
  highlight_nodes: string[];
  confidence: "high" | "medium" | "low";
  error: string | null;
  sql?: string;
  intent: IntentType;
}

// ─── Intent detection ────────────────────────────────────

const TRACE_PATTERNS = [
  /\btrace\b/i,
  /\bfollow\b.*\bflow\b/i,
  /\bshow.*(flow|journey|chain|path)\b/i,
  /\b(flow|chain|journey|history)\s+(for|of)\b/i,
  /\bwhere.*(go|end up|lead)\b/i,
  /\blinked to\b/i,
  /\bfind.*(linked|connected|related)\b/i,
];

const BROKEN_FLOW_PATTERNS = [
  /\bnot (billed|invoiced)\b/i,
  /\bno (delivery|deliveries|invoice|invoices|payment|payments)\b/i,
  /\b(without|missing).*(delivery|bill|invoice|payment)\b/i,
  /\b(undelivered|unbilled|unpaid)\b/i,
  /\bgap|broken|incomplete|missing link\b/i,
  /\bdelivered but not billed\b/i,
  /\bordered but not delivered\b/i,
  /\bbilled but not paid\b/i,
];

const DOC_NUMBER_RE = /\b(\d{6,12})\b/;

function detectIntent(query: string): {
  type: IntentType;
  docNumber?: string;
} {
  for (const p of TRACE_PATTERNS) {
    if (p.test(query)) {
      const numMatch = DOC_NUMBER_RE.exec(query);
      return { type: "TRACE", docNumber: numMatch?.[1] };
    }
  }

  for (const p of BROKEN_FLOW_PATTERNS) {
    if (p.test(query)) return { type: "BROKEN_FLOW" };
  }

  // Bare document number in query
  const numMatch = DOC_NUMBER_RE.exec(query);
  if (numMatch) {
    const n = numMatch[1];
    // Only treat as LOOKUP if query reads like it's about that specific doc
    if (/\b(find|show|what|which|get|lookup|look up|tell me about)\b/i.test(query) || query.trim() === n) {
      return { type: "TRACE", docNumber: n };
    }
  }

  return { type: "AGGREGATE" };
}

// ─── Handlers ────────────────────────────────────────────

async function handleTrace(
  docNumber: string | undefined,
  _query: string
): Promise<GraphChatResponse> {
  if (!docNumber) {
    return {
      answer:
        "I need a document number to trace a flow. Please include the order, delivery, or invoice number in your query (e.g. 'Trace invoice 91150187').",
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "low",
      error: null,
      intent: "TRACE",
    };
  }

  const trace = await traceDocument(docNumber);

  if (!trace.found) {
    return {
      answer: `No record found for document number **${docNumber}**. Please verify the document ID exists in the dataset.`,
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "high",
      error: null,
      intent: "TRACE",
    };
  }

  const typeLabels: Record<string, string> = {
    invoice: "Invoice",
    order: "Sales Order",
    delivery: "Outbound Delivery",
    payment: "Payment",
    journal_entry: "Journal Entry",
    customer: "Customer",
    product: "Product",
    order_item: "Order Item",
  };

  const entityTypes = [...new Set(trace.nodes.map((n) => n.type))];
  const entityLabels = entityTypes.map((t) => typeLabels[t] ?? t);
  const highlightIds = trace.nodes.map((n) => n.id);

  // Build a readable flow description
  const flowParts: string[] = [];
  for (const e of trace.edges) {
    const srcNode = trace.nodes.find((n) => n.id === e.source);
    const tgtNode = trace.nodes.find((n) => n.id === e.target);
    if (srcNode && tgtNode) {
      flowParts.push(`**${srcNode.label}** → ${e.label} → **${tgtNode.label}**`);
    }
  }

  const answer =
    `Here is the complete document trail for **${typeLabels[trace.docType] ?? trace.docType} ${docNumber}**, ` +
    `spanning **${trace.nodes.length} connected records** across ${entityLabels.join(", ")}.\n\n` +
    (flowParts.length > 0
      ? "**Document Flow:**\n" + flowParts.slice(0, 8).join("\n")
      : "The document exists but has no connected records yet.");

  return {
    answer,
    data: trace.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, ...n.properties })),
    entities_involved: entityLabels,
    highlight_nodes: highlightIds,
    confidence: "high",
    error: null,
    intent: "TRACE",
  };
}

async function handleBrokenFlow(query: string): Promise<GraphChatResponse> {
  let flowType: "undelivered" | "unbilled" | "unpaid" | "all" = "all";

  if (/not delivered|undelivered|no delivery/i.test(query)) flowType = "undelivered";
  else if (/not billed|unbilled|no invoice/i.test(query)) flowType = "unbilled";
  else if (/not paid|unpaid|no payment/i.test(query)) flowType = "unpaid";

  const results = await detectBrokenFlows(flowType);
  const nonEmpty = results.filter((r) => r.records.length > 0);

  if (nonEmpty.length === 0) {
    return {
      answer: "No broken flows detected — the O2C pipeline looks complete for the sampled data.",
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "high",
      error: null,
      intent: "BROKEN_FLOW",
    };
  }

  const parts = nonEmpty.map(
    (r) => `**${r.type}**: ${r.description}`
  );

  // Highlight affected orders in the graph
  const highlightIds: string[] = [];
  for (const r of nonEmpty) {
    for (const rec of r.records.slice(0, 10)) {
      if (rec.salesOrder) highlightIds.push(`order:${rec.salesOrder}`);
      if (rec.billingDocument) highlightIds.push(`invoice:${rec.billingDocument}`);
      if (rec.deliveryDocument) highlightIds.push(`delivery:${rec.deliveryDocument}`);
    }
  }

  return {
    answer:
      "Detected the following gaps in the Order-to-Cash flow:\n\n" +
      parts.join("\n"),
    data: nonEmpty.flatMap((r) =>
      r.records.map((rec) => ({ flowType: r.type, ...rec }))
    ),
    entities_involved: nonEmpty.map((r) => r.type),
    highlight_nodes: highlightIds,
    confidence: "high",
    error: null,
    intent: "BROKEN_FLOW",
  };
}

async function handleAggregate(
  userId: string,
  query: string,
  context?: ConversationTurn[]
): Promise<GraphChatResponse> {
  // Use the AI model to generate SQL, then execute
  let resolved: { generateFn: (p: string) => Promise<string>; providerLabel: string } | null = null;

  try {
    resolved = await resolveGenerateFn(userId);
  } catch {
    return {
      answer:
        "No AI model is configured. Please add an API key in Settings so I can analyze your data.",
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "low",
      error: "no_model",
      intent: "AGGREGATE",
    };
  }

  const { generateFn, providerLabel } = resolved;

  const [schemaCtx, normCtx] = await Promise.all([
    getSchemaContext(),
    Promise.resolve(getNormalizationContext()),
  ]);

  const prompt = buildGraphQueryPrompt(schemaCtx, normCtx, query, context);
  const aiResponse = await generateFn(prompt);

  const sql = extractSqlFromResponse(aiResponse);
  if (!sql) {
    return {
      answer:
        "I could not generate a valid query for that question. Try rephrasing with specific entity names like 'customers', 'billing documents', 'orders', or 'products'.",
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "low",
      error: null,
      intent: "AGGREGATE",
    };
  }

  try {
    const { rows, columns } = await duckdbQuery(sql);

    if (rows.length === 0) {
      return {
        answer: "Your query ran successfully but returned no matching records. You may want to broaden your criteria or try a different question.",
        data: [],
        entities_involved: [],
        highlight_nodes: [],
        confidence: "medium",
        error: null,
        sql,
        intent: "AGGREGATE",
      };
    }

    const answer = buildAggregateAnswer(query, rows, columns, providerLabel);

    return {
      answer,
      data: rows.slice(0, 20),
      entities_involved: inferEntitiesFromColumns(columns),
      highlight_nodes: extractHighlightNodes(rows, columns),
      confidence: "high",
      error: null,
      sql,
      intent: "AGGREGATE",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      answer: `There was an issue processing your request: ${formatQueryError(msg)}. Try rephrasing your question.`,
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "low",
      error: msg,
      sql,
      intent: "AGGREGATE",
    };
  }
}

// ─── Main entry point ────────────────────────────────────

export async function executeGraphChat(
  userId: string,
  query: string,
  context?: ConversationTurn[]
): Promise<GraphChatResponse> {
  // Step 1: Guardrail — reject unrelated queries
  const relevance = validateQueryRelevance(query);
  if (!relevance.valid) {
    return {
      answer:
        "This system only supports queries related to the provided SAP Order-to-Cash dataset.\n\n" +
        (relevance.reason ?? "") +
        (relevance.suggestions?.length
          ? "\n\nTry asking:\n" + relevance.suggestions.map((s) => `• ${s}`).join("\n")
          : ""),
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "high",
      error: "irrelevant_query",
      intent: "INVALID",
    };
  }

  // Step 2: Detect intent
  const { type, docNumber } = detectIntent(query);

  // Step 3: Execute
  switch (type) {
    case "TRACE":
      return handleTrace(docNumber, query);
    case "BROKEN_FLOW":
      return handleBrokenFlow(query);
    case "AGGREGATE":
      return handleAggregate(userId, query, context);
    default:
      return {
        answer: "I could not understand that query. Try asking about orders, deliveries, invoices, payments, or customers.",
        data: [],
        entities_involved: [],
        highlight_nodes: [],
        confidence: "low",
        error: null,
        intent: "INVALID",
      };
  }
}

// ─── Prompt builder for aggregate queries ────────────────

function buildGraphQueryPrompt(
  schemaCtx: string,
  normCtx: string,
  query: string,
  context?: ConversationTurn[]
): string {
  // Build conversation history block for follow-up awareness
  let conversationBlock = "";
  if (context && context.length > 0) {
    const recentTurns = context.slice(-6); // last 3 Q&A pairs max
    conversationBlock =
      "\nCONVERSATION HISTORY (use for follow-up context):\n" +
      recentTurns
        .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 300)}`)
        .join("\n") +
      "\n";
  }

  return `You are an expert SAP analyst. Generate a single DuckDB SQL SELECT query to answer the user's question about the SAP Order-to-Cash dataset.

${normCtx}

SCHEMA:
${schemaCtx}
${conversationBlock}
STRICT RULES:
- Output ONLY a SQL code block: \`\`\`sql ... \`\`\`
- Use ONLY SELECT statements (no INSERT/UPDATE/DELETE/CREATE/DROP)
- LIMIT results to 20 rows
- Do NOT use SELECT *; name every column
- Prefer cleaned views (v_billing_cleaned, v_sales_orders_cleaned etc.)
- Use TRY_CAST for numeric operations on raw tables
- If this is a follow-up question, use the conversation history to understand what the user is referring to

EXAMPLES:
Q: Which products are associated with the highest number of billing documents?
\`\`\`sql
SELECT bi.material, COUNT(DISTINCT bi.billingDocument) AS billing_count
FROM v_billing_items_cleaned bi
GROUP BY bi.material
ORDER BY billing_count DESC
LIMIT 20
\`\`\`

Q: Top 5 customers by total billing amount
\`\`\`sql
SELECT b.soldToParty, SUM(b.totalNetAmount) AS total, COUNT(*) AS invoice_count
FROM v_billing_cleaned b
GROUP BY b.soldToParty
ORDER BY total DESC
LIMIT 5
\`\`\`

USER QUESTION: ${query}`;
}

// ─── Helpers ─────────────────────────────────────────────

function extractSqlFromResponse(response: string): string | null {
  const match = /```sql\s*([\s\S]+?)\s*```/i.exec(response);
  if (match) return match[1].trim();
  const bare = /\b(SELECT\s+[\s\S]+?)(;|$)/i.exec(response);
  if (bare) return bare[1].trim().replace(/;$/, "");
  return null;
}

function buildAggregateAnswer(
  query: string,
  rows: Record<string, unknown>[],
  columns: string[],
  _model: string
): string {
  // Produce a business-friendly insight instead of raw DB output
  const count = rows.length;
  const friendlyQuery = query.replace(/[?.!]+$/, "").trim();

  // Humanize column names for inline references
  const humanCols = columns.map(humanizeColumnName);

  // Build insight header
  let answer = `Here are the results for your question about **${friendlyQuery}**:\n\n`;

  // Summarize top result if there are numeric or count columns
  const numericCol = columns.find((c) =>
    typeof rows[0]?.[c] === "number" || /count|total|sum|amount|qty|quantity|avg|average|net|gross/i.test(c)
  );
  const labelCol = columns.find((c) => c !== numericCol);

  if (numericCol && labelCol && rows.length > 0) {
    const topRow = rows[0];
    const topLabel = String(topRow[labelCol] ?? "Unknown");
    const topValue = topRow[numericCol];
    const humanNumCol = humanizeColumnName(numericCol);

    answer = `Here are the top results for **${friendlyQuery}**:\n\n`;
    answer += `**Top result:** ${topLabel} with **${formatNumber(topValue)}** ${humanNumCol.toLowerCase()}\n\n`;

    if (count > 3) {
      // Add a brief summary of the top entries
      const topN = Math.min(count, 5);
      const topEntries = rows.slice(0, topN).map((r) =>
        `• **${String(r[labelCol] ?? "—")}** — ${formatNumber(r[numericCol])} ${humanNumCol.toLowerCase()}`
      );
      answer += topEntries.join("\n") + "\n\n";

      if (count > topN) {
        answer += `_Showing top ${topN} of ${count} results in the table below._`;
      }
    }
  } else {
    // No clear numeric column — just describe the data
    if (count === 1) {
      answer += `Found **1 matching record** with the following details.`;
    } else {
      answer += `Found **${count} matching records**. Key fields: ${humanCols.join(", ")}.`;
    }
  }

  return answer;
}

/** Convert snake_case / camelCase column names to human-readable labels */
function humanizeColumnName(col: string): string {
  const COLUMN_LABELS: Record<string, string> = {
    material: "Product",
    billing_document_count: "Billing Documents",
    billing_count: "Billing Documents",
    billingDocument: "Billing Document",
    salesOrder: "Sales Order",
    deliveryDocument: "Delivery",
    businessPartner: "Customer",
    soldToParty: "Customer",
    accountingDocument: "Journal Entry",
    total: "Total Amount",
    totalNetAmount: "Net Amount",
    total_net_amount: "Net Amount",
    invoice_count: "Invoice Count",
    order_count: "Order Count",
    delivery_count: "Delivery Count",
    payment_count: "Payment Count",
    qty: "Quantity",
    quantity: "Quantity",
    orderQuantity: "Order Quantity",
    netAmount: "Net Amount",
    grossAmount: "Gross Amount",
    creationDate: "Created On",
    billingDate: "Billing Date",
    deliveryDate: "Delivery Date",
    documentDate: "Document Date",
    pricingDate: "Pricing Date",
    customerName: "Customer Name",
    productDescription: "Product Description",
    materialDescription: "Material Description",
    paymentTerms: "Payment Terms",
    overallStatus: "Status",
    deliveryStatus: "Delivery Status",
    billingStatus: "Billing Status",
    salesOrganization: "Sales Organization",
    distributionChannel: "Distribution Channel",
    division: "Division",
    plant: "Plant",
    storageLocation: "Storage Location",
  };

  if (COLUMN_LABELS[col]) return COLUMN_LABELS[col];

  // Convert camelCase or snake_case to Title Case
  return col
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNumber(val: unknown): string {
  if (val === null || val === undefined) return "—";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  if (Number.isInteger(num)) return num.toLocaleString();
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function inferEntitiesFromColumns(columns: string[]): string[] {
  const map: Record<string, string> = {
    billingDocument: "Invoice",
    salesOrder: "Order",
    deliveryDocument: "Delivery",
    accountingDocument: "Journal Entry",
    businessPartner: "Customer",
    soldToParty: "Customer",
    material: "Product",
    customer: "Customer",
  };
  const found = new Set<string>();
  for (const col of columns) {
    const match = map[col];
    if (match) found.add(match);
  }
  return [...found];
}

function extractHighlightNodes(
  rows: Record<string, unknown>[],
  columns: string[]
): string[] {
  const primaryIds: string[] = [];
  const idCols = ["billingDocument", "salesOrder", "deliveryDocument", "businessPartner", "material", "accountingDocument"];
  const typeMap: Record<string, string> = {
    billingDocument: "invoice",
    salesOrder: "order",
    deliveryDocument: "delivery",
    businessPartner: "customer",
    material: "product",
    accountingDocument: "journal_entry",
  };
  for (const col of columns) {
    if (idCols.includes(col)) {
      const prefix = typeMap[col];
      for (const row of rows.slice(0, 10)) {
        if (row[col]) primaryIds.push(`${prefix}:${row[col]}`);
      }
    }
  }
  // Expand to include connected nodes in the graph for full path highlighting
  return getConnectedNodes(primaryIds);
}

/**
 * Given a set of node IDs, finds all directly connected nodes in the
 * cached graph so the frontend can highlight entire O2C chains,
 * not just the primary result nodes.
 */
function getConnectedNodes(nodeIds: string[]): string[] {
  if (nodeIds.length === 0) return [];

  // Use the graph cache to find connections
  const graph = getCachedGraph();
  if (!graph) return nodeIds; // No graph available, return originals

  const result = new Set(nodeIds);
  const graphNodeIds = new Set(graph.nodes.map((n) => n.id));

  // Only expand IDs that actually exist in the graph
  const validSeeds = nodeIds.filter((id) => graphNodeIds.has(id));

  // Build adjacency map once for O(1) neighbor lookups
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  // Multi-hop BFS (up to 3 hops) to capture full O2C chains
  // Order → Delivery → Invoice → JE/Payment = 3-4 hops
  const MAX_HOPS = 3;
  let frontier = new Set(validSeeds);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const nextFrontier = new Set<string>();
    for (const nodeId of frontier) {
      const neighbors = adjacency.get(nodeId);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!result.has(neighbor) && graphNodeIds.has(neighbor)) {
          result.add(neighbor);
          nextFrontier.add(neighbor);
        }
      }
    }
    if (nextFrontier.size === 0) break;
    frontier = nextFrontier;
  }

  return [...result];
}

function formatQueryError(msg: string): string {
  if (msg.includes("Catalog Error")) return "Referenced table or column does not exist. Try a different phrasing.";
  if (msg.includes("Binder Error")) return "Column reference is ambiguous or invalid.";
  if (msg.includes("Parser Error")) return "The generated SQL has a syntax error.";
  return msg.slice(0, 200);
}
