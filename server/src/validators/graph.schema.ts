import { z } from "zod";

export const graphChatSchema = z.object({
  query: z
    .string()
    .min(2, "Query must be at least 2 characters")
    .max(1000, "Query must be 1000 characters or less")
    .trim(),
  sessionId: z
    .string()
    .min(1)
    .max(64)
    .optional(),
  context: z
    .array(
      z.object({
        role: z.enum(["user", "agent"]),
        content: z.string().max(2000),
      })
    )
    .max(10)
    .optional(),
});

export type GraphChatInput = z.infer<typeof graphChatSchema>;
