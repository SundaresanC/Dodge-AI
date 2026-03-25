import { z } from "zod";

// Provider and purpose must match the Prisma enum values exactly
export const aiProviderEnum = z.enum(["GEMINI", "OPENAI", "ANTHROPIC"]);
export const aiPurposeEnum = z.enum(["NL_QUERY", "DEFAULT"]);

export const createModelConfigSchema = z.object({
  provider: aiProviderEnum,
  modelId: z
    .string()
    .min(1, "Model ID is required")
    .max(100, "Model ID must be 100 characters or less"),
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(80, "Display name must be 80 characters or less"),
  /**
   * Optional API key. If omitted the system environment variable for the
   * provider is used. Never returned to the client after save.
   */
  apiKey: z
    .string()
    .min(10, "API key must be at least 10 characters")
    .max(500)
    .optional()
    .nullable(),
  purpose: aiPurposeEnum.default("DEFAULT"),
  isActive: z.boolean().default(false),
});

export const updateModelConfigSchema = createModelConfigSchema.partial().extend({
  // Allow updating the key independently (e.g. key rotation)
  apiKey: z
    .string()
    .min(10, "API key must be at least 10 characters")
    .max(500)
    .optional()
    .nullable(),
});

export const activateModelSchema = z.object({
  purpose: aiPurposeEnum,
});

export type CreateModelConfigInput = z.infer<typeof createModelConfigSchema>;
export type UpdateModelConfigInput = z.infer<typeof updateModelConfigSchema>;
export type ActivateModelInput = z.infer<typeof activateModelSchema>;
