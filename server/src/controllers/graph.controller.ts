import type { Request, Response } from "express";
import { buildGraphData, invalidateGraphCache } from "../lib/graphBuilder.js";
import { executeGraphChat } from "../lib/graphChatEngine.js";
import { prisma } from "../lib/prisma.js";
import type { GraphChatInput } from "../validators/graph.schema.js";

// ─── GET /api/graph/data ─────────────────────────────────

/**
 * Returns graph nodes and edges built from real SAP O2C DuckDB data.
 * Results are cached for 5 minutes server-side.
 * Query param: ?refresh=true to bypass cache.
 */
export async function getGraphData(req: Request, res: Response): Promise<void> {
  try {
    if (req.query.refresh === "true") {
      invalidateGraphCache();
    }

    const limit = Math.min(
      60,
      Math.max(10, parseInt(String(req.query.limit ?? "35"), 10))
    );

    const graph = await buildGraphData(limit);

    res.json({
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      stats: graph.stats ?? {},
      buildTimeMs: graph.buildTimeMs ?? 0,
      totalNodes: graph.nodes?.length ?? 0,
      totalEdges: graph.edges?.length ?? 0,
    });
  } catch (err: unknown) {
    console.error("[graph/data] Error building graph:", err);
    res.status(500).json({
      error: true,
      message: "Failed to build graph data",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── POST /api/graph/chat ─────────────────────────────────

/**
 * Handles a natural-language chat message about the O2C graph.
 * Returns a structured response with answer, data rows, and highlight_nodes.
 * ALWAYS persists the exchange to graph_chat_history — awaits the save.
 */
export async function graphChat(req: Request, res: Response): Promise<void> {
  const { query, sessionId, context } = req.body as GraphChatInput;
  const userId = req.user!.userId;
  const sid = sessionId || crypto.randomUUID();

  try {
    const result = await executeGraphChat(userId, query, context);

    // ALWAYS persist — await to guarantee chat history is stored before responding
    try {
      await prisma.graphChatHistory.create({
        data: {
          userId,
          sessionId: sid,
          query,
          answer: result.answer,
          intent: result.intent,
          confidence: result.confidence,
          highlightNodes: result.highlight_nodes ?? [],
          entitiesInvolved: result.entities_involved ?? [],
        },
      });
    } catch (dbErr: unknown) {
      // Log but don't break the response — the user still gets the answer
      console.error("[graph-chat] CRITICAL: history save failed:", {
        userId,
        sessionId: sid,
        query: query.slice(0, 100),
        error: (dbErr as Error)?.message,
        stack: (dbErr as Error)?.stack,
      });
    }

    // Strip internal fields (sql, error details) before sending to frontend
    const { sql: _sql, error: _err, ...clientResult } = result;
    res.json({ ...clientResult, sessionId: sid });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status =
      (err as { statusCode?: number }).statusCode ??
      (err as { status?: number }).status ??
      500;

    console.error("[graph-chat] Query processing error:", {
      userId,
      sessionId: sid,
      query: query.slice(0, 100),
      status,
      error: msg,
    });

    // Even on failure, persist the user query with the error as the answer
    try {
      await prisma.graphChatHistory.create({
        data: {
          userId,
          sessionId: sid,
          query,
          answer: `Error: ${msg.slice(0, 500)}`,
          intent: "AGGREGATE",
          confidence: "low",
          highlightNodes: [],
          entitiesInvolved: [],
        },
      });
    } catch {
      // Swallow DB error on error-path save
    }

    if (status === 429) {
      res.status(429).json({
        error: true,
        message: "AI provider quota exceeded. Please try again later.",
        sessionId: sid,
      });
      return;
    }
    if (status === 401 || status === 403) {
      res.status(402).json({
        error: true,
        message: "AI provider rejected the API key. Update your model config in Settings.",
        sessionId: sid,
      });
      return;
    }
    res.json({
      answer: `An error occurred while processing your query: ${msg.slice(0, 200)}`,
      data: [],
      entities_involved: [],
      highlight_nodes: [],
      confidence: "low",
      error: msg,
      intent: "AGGREGATE",
      sessionId: sid,
    });
  }
}

// ─── GET /api/graph/chat/history ──────────────────────────

/**
 * Returns paginated chat history for the authenticated user, newest first.
 * Query params: ?page=1&limit=30
 */
export async function getChatHistory(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(5, parseInt(String(req.query.limit ?? "30"), 10)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.graphChatHistory.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          sessionId: true,
          query: true,
          answer: true,
          intent: true,
          confidence: true,
          highlightNodes: true,
          entitiesInvolved: true,
          createdAt: true,
        },
      }),
      prisma.graphChatHistory.count({ where: { userId } }),
    ]);

    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: unknown) {
    console.error("[graph/chat/history] Error fetching history:", err);
    res.status(500).json({
      error: true,
      message: "Failed to fetch chat history",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── GET /api/graph/chat/sessions ─────────────────────────

/**
 * Returns a list of chat sessions for the authenticated user.
 * Each session shows its first query, message count, and last activity.
 */
export async function getSessionsList(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;

    const sessions = await prisma.graphChatHistory.groupBy({
      by: ["sessionId"],
      where: { userId },
      _count: { id: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: 50,
    });

    // Fetch the first query of each session for a preview label
    const sessionIds = sessions.map((s) => s.sessionId);
    const firstMessages = sessionIds.length > 0
      ? await prisma.graphChatHistory.findMany({
          where: { userId, sessionId: { in: sessionIds } },
          orderBy: { createdAt: "asc" },
          distinct: ["sessionId"],
          select: { sessionId: true, query: true },
        })
      : [];

    const previewMap = new Map(firstMessages.map((m) => [m.sessionId, m.query]));

    const result = sessions.map((s) => ({
      sessionId: s.sessionId,
      messageCount: s._count.id,
      firstQuery: previewMap.get(s.sessionId) ?? "",
      lastActivity: s._max.createdAt,
      startedAt: s._min.createdAt,
    }));

    res.json({ sessions: result });
  } catch (err: unknown) {
    console.error("[graph/chat/sessions] Error fetching sessions:", err);
    res.status(500).json({
      error: true,
      message: "Failed to fetch chat sessions",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── GET /api/graph/chat/session/:sessionId ───────────────

/**
 * Returns all messages for a specific chat session, oldest first.
 */
export async function getSessionMessages(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { sessionId } = req.params;

    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: true, message: "Missing or invalid sessionId" });
      return;
    }

    const messages = await prisma.graphChatHistory.findMany({
      where: { userId, sessionId: String(sessionId) },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        query: true,
        answer: true,
        intent: true,
        confidence: true,
        highlightNodes: true,
        entitiesInvolved: true,
        createdAt: true,
      },
    });

    res.json({ sessionId, messages });
  } catch (err: unknown) {
    console.error("[graph/chat/session] Error fetching session messages:", err);
    res.status(500).json({
      error: true,
      message: "Failed to fetch session messages",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── DELETE /api/graph/chat/history ───────────────────────

/**
 * Clears all graph chat history for the authenticated user.
 */
export async function clearChatHistory(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { count } = await prisma.graphChatHistory.deleteMany({ where: { userId } });
    res.json({ deleted: count });
  } catch (err: unknown) {
    console.error("[graph/chat/history] Error clearing history:", err);
    res.status(500).json({
      error: true,
      message: "Failed to clear chat history",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
