import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt, isEncryptionAvailable } from "../lib/encryption.js";
import { AppError } from "../middleware/index.js";
import { env } from "../config.js";
import type {
  CreateModelConfigInput,
  UpdateModelConfigInput,
  ActivateModelInput,
} from "../validators/settings.schema.js";
import { aiPurposeEnum, aiProviderEnum } from "../validators/settings.schema.js";
import type { z } from "zod";

type AIProvider = z.infer<typeof aiProviderEnum>;
type AIPurpose = z.infer<typeof aiPurposeEnum>;

// Mask used when returning the key status to the client — never expose the real value
const KEY_MASKED = "••••••••";

// ─── List configs ────────────────────────────────────────

/**
 * GET /api/settings/ai-models
 *
 * Returns all of the user's saved model configs plus which system env keys
 * are available (without exposing the actual key values).
 */
export async function listAIModels(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const configs = await prisma.aIModelConfig.findMany({
    where: { userId },
    orderBy: [{ purpose: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      provider: true,
      modelId: true,
      displayName: true,
      isActive: true,
      purpose: true,
      createdAt: true,
      updatedAt: true,
      // encryptedApiKey intentionally excluded — replaced with hasCustomKey below
      encryptedApiKey: true,
    },
  });

  const sanitised = configs.map(({ encryptedApiKey, ...c }: { encryptedApiKey: string | null; [key: string]: unknown }) => ({
    ...c,
    hasCustomKey: Boolean(encryptedApiKey),
    keyPreview: encryptedApiKey ? KEY_MASKED : null,
  }));

  // System key availability — tells UI which providers work out-of-the-box
  const systemKeys = {
    GEMINI: Boolean(env.GEMINI_API_KEY),
    OPENAI: Boolean(env.OPENAI_API_KEY),
    ANTHROPIC: Boolean(env.ANTHROPIC_API_KEY),
  };

  res.json({ configs: sanitised, systemKeys, encryptionEnabled: isEncryptionAvailable() });
}

// ─── Create config ───────────────────────────────────────

/**
 * POST /api/settings/ai-models
 */
export async function createAIModel(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const body = req.body as CreateModelConfigInput;

  let encryptedApiKey: string | null = null;
  if (body.apiKey) {
    if (!isEncryptionAvailable()) {
      throw new AppError(
        503,
        "Cannot store a custom API key — ENCRYPTION_KEY is not configured on the server."
      );
    }
    encryptedApiKey = encrypt(body.apiKey);
  }

  // If this is set as active, deactivate others with the same purpose
  if (body.isActive) {
    await deactivateOthers(userId, body.purpose as AIPurpose);
  }

  const config = await prisma.aIModelConfig.create({
    data: {
      userId,
      provider: body.provider as AIProvider,
      modelId: body.modelId,
      displayName: body.displayName,
      encryptedApiKey,
      isActive: body.isActive ?? false,
      purpose: (body.purpose ?? "DEFAULT") as AIPurpose,
    },
  });

  const { encryptedApiKey: _k, ...safeConfig } = config;
  res.status(201).json({ ...safeConfig, hasCustomKey: Boolean(_k), keyPreview: _k ? KEY_MASKED : null });
}

// ─── Update config ───────────────────────────────────────

/**
 * PUT /api/settings/ai-models/:id
 */
export async function updateAIModel(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const id = req.params.id as string;
  const body = req.body as UpdateModelConfigInput;

  const existing = await prisma.aIModelConfig.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError(404, "AI model config not found");

  let encryptedApiKey = existing.encryptedApiKey;

  if (body.apiKey !== undefined) {
    if (body.apiKey === null || body.apiKey === "") {
      // Explicit null/empty = remove the stored key (fall back to system env)
      encryptedApiKey = null;
    } else {
      if (!isEncryptionAvailable()) {
        throw new AppError(503, "Cannot store API key — ENCRYPTION_KEY not set on server.");
      }
      encryptedApiKey = encrypt(body.apiKey);
    }
  }

  if (body.isActive && (body.purpose ?? existing.purpose)) {
    await deactivateOthers(userId, (body.purpose ?? existing.purpose) as AIPurpose, id);
  }

  const updated = await prisma.aIModelConfig.update({
    where: { id },
    data: {
      ...(body.provider !== undefined && { provider: body.provider as AIProvider }),
      ...(body.modelId !== undefined && { modelId: body.modelId }),
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.purpose !== undefined && { purpose: body.purpose as AIPurpose }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      encryptedApiKey,
    },
  });

  const { encryptedApiKey: _k, ...safeUpdated } = updated;
  res.json({ ...safeUpdated, hasCustomKey: Boolean(_k), keyPreview: _k ? KEY_MASKED : null });
}

// ─── Delete config ───────────────────────────────────────

/**
 * DELETE /api/settings/ai-models/:id
 */
export async function deleteAIModel(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const existing = await prisma.aIModelConfig.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError(404, "AI model config not found");

  await prisma.aIModelConfig.delete({ where: { id } });
  res.status(204).send();
}

// ─── Activate config ─────────────────────────────────────

/**
 * PATCH /api/settings/ai-models/:id/activate
 * Body: { purpose: "NL_QUERY" | "DEFAULT" }
 *
 * Marks this config as the active model for a given purpose,
 * deactivating any other configs with that purpose.
 */
export async function activateAIModel(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const id = req.params.id as string;
  const { purpose } = req.body as ActivateModelInput;

  const existing = await prisma.aIModelConfig.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError(404, "AI model config not found");

  // Deactivate all others for this purpose
  await deactivateOthers(userId, purpose as AIPurpose, id);

  const updated = await prisma.aIModelConfig.update({
    where: { id },
    data: { isActive: true, purpose: purpose as AIPurpose },
  });

  const { encryptedApiKey: _k, ...safe } = updated;
  res.json({ ...safe, hasCustomKey: Boolean(_k), keyPreview: _k ? KEY_MASKED : null });
}

// ─── Verify a stored key (read-only check) ───────────────

/**
 * GET /api/settings/ai-models/:id/verify
 *
 * Attempts to decrypt the stored key and make a minimal API call to confirm it's valid.
 * Returns { valid: boolean, error?: string }.
 */
export async function verifyAIModel(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const config = await prisma.aIModelConfig.findFirst({ where: { id, userId } });
  if (!config) throw new AppError(404, "AI model config not found");

  let apiKey: string | null = null;
  if (config.encryptedApiKey) {
    try {
      apiKey = decrypt(config.encryptedApiKey);
    } catch {
      res.json({ valid: false, error: "Failed to decrypt the stored API key" });
      return;
    }
  }

  try {
    const { getAIGenerateFn } = await import("../lib/aiProviders.js");
    const gen = await getAIGenerateFn({
      provider: config.provider as import("../lib/aiProviders.js").AIProvider,
      modelId: config.modelId,
      apiKey,
    });
    // Minimal probe — just check model responds
    await gen("Reply with only the word: OK");
    res.json({ valid: true });
  } catch (err: unknown) {
    res.json({ valid: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Helper ──────────────────────────────────────────────

async function deactivateOthers(
  userId: string,
  purpose: AIPurpose,
  exceptId?: string
): Promise<void> {
  await prisma.aIModelConfig.updateMany({
    where: {
      userId,
      purpose,
      isActive: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isActive: false },
  });
}
