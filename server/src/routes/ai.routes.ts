import { Router } from "express";
import {
  authenticate,
  aiLimiter,
  validateBody,
  asyncHandler,
} from "../middleware/index.js";
import {
  nlQuerySchema,
} from "../validators/ai.schema.js";
import * as aiController from "../controllers/ai.controller.js";

const router = Router();

router.use(authenticate);
router.use(aiLimiter);

// ─── NL Query (SAP O2C data explorer) ───────────────────

/**
 * POST /api/ai/nl-query
 * Translates natural language to SQL and executes it against DuckDB.
 */
router.post(
  "/nl-query",
  validateBody(nlQuerySchema),
  asyncHandler(aiController.nlQuery)
);

// ─── Query History ───────────────────────────────────────

/**
 * GET /api/ai/query-history
 * Paginated list of past NL queries for the authenticated user.
 */
router.get("/query-history", asyncHandler(aiController.queryHistory));

/**
 * DELETE /api/ai/query-history/:id
 * Removes a single history entry.
 */
router.delete("/query-history/:id", asyncHandler(aiController.deleteQueryHistory));

export default router;
