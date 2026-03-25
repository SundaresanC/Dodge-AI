import { Router } from "express";
import {
  authenticate,
  aiLimiter,
  validateBody,
  asyncHandler,
} from "../middleware/index.js";
import { graphChatSchema } from "../validators/graph.schema.js";
import * as graphController from "../controllers/graph.controller.js";

const router = Router();

router.use(authenticate);

/**
 * GET /api/graph/data?limit=35&refresh=false
 * Builds and returns the O2C graph from DuckDB data (cached 5 min).
 */
router.get("/data", asyncHandler(graphController.getGraphData));

/**
 * GET /api/graph/chat/history?page=1&limit=30
 * Returns paginated chat history for the authenticated user, newest first.
 */
router.get("/chat/history", asyncHandler(graphController.getChatHistory));

/**
 * GET /api/graph/chat/sessions
 * Returns grouped chat sessions with preview and message counts.
 */
router.get("/chat/sessions", asyncHandler(graphController.getSessionsList));

/**
 * GET /api/graph/chat/session/:sessionId
 * Returns all messages for a specific chat session, oldest first.
 */
router.get("/chat/session/:sessionId", asyncHandler(graphController.getSessionMessages));

/**
 * DELETE /api/graph/chat/history
 * Clears all graph chat history for the authenticated user.
 */
router.delete("/chat/history", asyncHandler(graphController.clearChatHistory));

/**
 * POST /api/graph/chat
 * Processes a natural-language query about the graph.
 * Returns: answer, data, entities_involved, highlight_nodes, confidence.
 */
router.post(
  "/chat",
  aiLimiter,
  validateBody(graphChatSchema),
  asyncHandler(graphController.graphChat)
);

export default router;
