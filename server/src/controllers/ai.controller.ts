import type { Request, Response } from "express";
import type {
  NLQueryInput,
} from "../validators/ai.schema.js";
import { executeNlQuery } from "../lib/nlToSql.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/index.js";

// ─── NL Query ─────────────────────────────────────────────

/**
 * POST /api/ai/nl-query
 * Body: { query: string }
 *
 * Translates natural language to DuckDB SQL using the user's configured AI model,
 * executes the query against the SAP O2C dataset, and returns chart-ready results.
 */
export async function nlQuery(req: Request, res: Response): Promise<void> {
  const { query } = req.body as NLQueryInput;
  const userId = req.user!.userId;

  try {
    const result = await executeNlQuery(userId, query);

    res.json({
      type: result.type,
      chartType: result.chartType,
      sql: result.sql,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      executionMs: result.executionMs,
      model: result.model,
      historyId: result.historyId,
      title: result.title,
      description: result.description,
      warning: result.warning,
      errorType: result.errorType,
      suggestions: result.suggestions,
    });
  } catch (err: unknown) {
    // Surface business-logic errors (model config missing, SQL validation, etc.)
    // as 4xx so the UI can show them inline instead of a generic 500.
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { statusCode?: number; status?: number }).statusCode
      ?? (err as { status?: number }).status
      ?? 500;

    // Map provider-level HTTP errors to clean client messages
    if (status === 429) {
      res.status(429).json({ error: "AI provider quota exceeded. Please try again later or configure a different model in Settings." });
      return;
    }
    if (status === 401 || status === 403) {
      res.status(402).json({ error: "AI provider rejected the API key. Please update your model configuration in Settings." });
      return;
    }
    if (status === 404 && msg.includes("not found")) {
      res.status(400).json({ error: "The configured AI model was not found. Please update your model configuration in Settings." });
      return;
    }
    if (status < 500) {
      res.status(status).json({ error: msg });
      return;
    }
    throw err; // let global error handler deal with unexpected errors
  }
}

// ─── Query History ────────────────────────────────────────

/**
 * GET /api/ai/query-history?page=1&limit=20
 *
 * Returns paginated history of NL queries made by the authenticated user.
 */
export async function queryHistory(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.queryHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        nlQuery: true,
        generatedSql: true,
        chartType: true,
        rowCount: true,
        executionMs: true,
        createdAt: true,
        // Exclude resultSchema from list (can be large)
      },
    }),
    prisma.queryHistory.count({ where: { userId } }),
  ]);

  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}

/**
 * DELETE /api/ai/query-history/:id
 *
 * Deletes a single history entry (ownership-checked).
 */
export async function deleteQueryHistory(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const entry = await prisma.queryHistory.findFirst({ where: { id, userId } });
  if (!entry) throw new AppError(404, "Query history entry not found");

  await prisma.queryHistory.delete({ where: { id } });
  res.status(204).send();
}
