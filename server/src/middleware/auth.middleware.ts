import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../lib/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Verifies the JWT access token from the Authorization header.
 * Populates `req.user` with `{ userId, email }` on success.
 * Returns 401 if missing or invalid.
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed authorization header" });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}

/**
 * Requires `req.user` to be present.
 * Use after `authenticate` to assert the user exists.
 */
export function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}
