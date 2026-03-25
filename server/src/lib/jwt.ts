import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config.js";

export interface TokenPayload {
  userId: string;
  email: string;
}

function parseExpiry(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 900; // fallback 15min
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return num;
    case "m": return num * 60;
    case "h": return num * 3600;
    case "d": return num * 86400;
    default:  return 900;
  }
}

export function signAccessToken(payload: TokenPayload): string {
  const opts: SignOptions = {
    expiresIn: parseExpiry(env.JWT_ACCESS_EXPIRES_IN),
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, opts);
}

export function signRefreshToken(payload: TokenPayload): string {
  const opts: SignOptions = {
    expiresIn: parseExpiry(env.JWT_REFRESH_EXPIRES_IN),
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, opts);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
}

export function getRefreshExpiryDate(): Date {
  const seconds = parseExpiry(env.JWT_REFRESH_EXPIRES_IN);
  return new Date(Date.now() + seconds * 1000);
}
