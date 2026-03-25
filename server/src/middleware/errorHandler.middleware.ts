import type { Request, Response, NextFunction } from "express";
import { env } from "../config.js";

/**
 * Custom error class with HTTP status code.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, details);
  }

  static unauthorized(message = "Unauthorized") {
    return new AppError(401, message);
  }

  static forbidden(message = "Forbidden") {
    return new AppError(403, message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, message);
  }

  static conflict(message: string) {
    return new AppError(409, message);
  }

  static internal(message = "Internal server error") {
    return new AppError(500, message);
  }
}

/**
 * Global error handler — must be registered last in the middleware chain.
 * Catches both AppError and unexpected errors, returning consistent JSON.
 * Logs full context for reproducibility.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log all errors with request context for debugging
  console.error("[ErrorHandler]", {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.body ? JSON.stringify(req.body).slice(0, 500) : undefined,
    userId: (req as unknown as { user?: { userId: string } }).user?.userId,
    errorName: err.name,
    errorMessage: err.message,
    stack: err.stack?.split("\n").slice(0, 5).join("\n"),
  });

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: true,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const statusCode = 500;
  const message =
    env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(statusCode).json({ error: true, message });
}

/**
 * Catches async errors in route handlers and forwards them to the error handler.
 * Wraps an async handler to avoid unhandled promise rejections.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
