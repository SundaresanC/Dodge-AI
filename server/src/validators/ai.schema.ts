import { z } from "zod";

export const nlQuerySchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(2000, "Query must be 2000 characters or less")
    .trim(),
});

export type NLQueryInput = z.infer<typeof nlQuerySchema>;
