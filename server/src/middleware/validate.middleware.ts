import type { Request, Response, NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

/**
 * Creates middleware that validates `req.body` against the given Zod schema.
 * On success, replaces `req.body` with the parsed (and coerced) value.
 * On failure, returns 400 with structured validation errors.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        res.status(400).json({ error: "Validation failed", details: errors });
        return;
      }
      next(err);
    }
  };
}

/**
 * Creates middleware that validates `req.query` against the given Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as Record<string, string>;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        res
          .status(400)
          .json({ error: "Invalid query parameters", details: errors });
        return;
      }
      next(err);
    }
  };
}

/**
 * Creates middleware that validates `req.params` against the given Zod schema.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as Record<string, string>;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        res
          .status(400)
          .json({ error: "Invalid path parameters", details: errors });
        return;
      }
      next(err);
    }
  };
}
