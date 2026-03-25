import rateLimit from "express-rate-limit";
import { env } from "../config.js";

/**
 * General API rate limiter.
 * Default: 100 requests per 15-minute window per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again later.",
  },
});

/**
 * Stricter rate limiter for AI endpoints (expensive operations).
 * Default: 20 requests per 15-minute window per IP.
 */
export const aiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AI_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "AI rate limit exceeded. Please wait before making more AI requests.",
  },
});

/**
 * Auth endpoint limiter to prevent brute-force attacks.
 * 10 attempts per 15-minute window per IP.
 */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
});
