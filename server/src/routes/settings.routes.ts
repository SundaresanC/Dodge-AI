import { Router } from "express";
import { authenticate, validateBody, asyncHandler } from "../middleware/index.js";
import {
  createModelConfigSchema,
  updateModelConfigSchema,
  activateModelSchema,
} from "../validators/settings.schema.js";
import * as settingsController from "../controllers/settings.controller.js";

const router = Router();

// All settings routes require authentication
router.use(authenticate);

// ─── AI Model Configurations ─────────────────────────────

/**
 * GET    /api/settings/ai-models
 * POST   /api/settings/ai-models
 * PUT    /api/settings/ai-models/:id
 * DELETE /api/settings/ai-models/:id
 * PATCH  /api/settings/ai-models/:id/activate
 * GET    /api/settings/ai-models/:id/verify
 */
router.get("/ai-models", asyncHandler(settingsController.listAIModels));

router.post(
  "/ai-models",
  validateBody(createModelConfigSchema),
  asyncHandler(settingsController.createAIModel)
);

router.put(
  "/ai-models/:id",
  validateBody(updateModelConfigSchema),
  asyncHandler(settingsController.updateAIModel)
);

router.delete("/ai-models/:id", asyncHandler(settingsController.deleteAIModel));

router.patch(
  "/ai-models/:id/activate",
  validateBody(activateModelSchema),
  asyncHandler(settingsController.activateAIModel)
);

router.get("/ai-models/:id/verify", asyncHandler(settingsController.verifyAIModel));

export default router;
