import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshExpiryDate,
} from "../lib/jwt.js";
import { AppError } from "../middleware/index.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import type {
  SignupInput,
  LoginInput,
  RefreshInput,
  ChangePasswordInput,
  UpdateProfileInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "../validators/auth.schema.js";

const BCRYPT_ROUNDS = 12;

function sanitizeUser(user: { id: string; email: string; name: string; avatarUrl: string | null; timezone: string; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}

// Helper to clean up expired sessions asynchronously
function cleanupExpiredSessions(userId: string) {
  prisma.session.deleteMany({
    where: {
      userId,
      expiresAt: { lt: new Date() },
    },
  }).catch((err: unknown) => console.error("Session cleanup failed:", err));
}

export async function signup(req: Request, res: Response): Promise<void> {
  const { name, email, password } = req.body as SignupInput;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw AppError.conflict("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  const tokenPayload = { userId: user.id, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: getRefreshExpiryDate(),
      userAgent: req.headers["user-agent"] ?? "Unknown Device",
      ipAddress: req.ip ?? "Unknown IP",
    },
  });

  res.status(201).json({
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw AppError.unauthorized("Invalid email or password");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw AppError.unauthorized("Invalid email or password");
  }

  const tokenPayload = { userId: user.id, email: user.email };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: getRefreshExpiryDate(),
      userAgent: req.headers["user-agent"] ?? "Unknown Device",
      ipAddress: req.ip ?? "Unknown IP",
    },
  });

  // Background cleanup
  cleanupExpiredSessions(user.id);

  res.json({
    user: sanitizeUser(user),
    accessToken,
    refreshToken,
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken: oldToken } = req.body as RefreshInput;

  // Verify the token cryptographically
  let payload;
  try {
    payload = verifyRefreshToken(oldToken);
  } catch {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  // Check if session exists in DB (prevents reuse of revoked tokens)
  const session = await prisma.session.findUnique({
    where: { refreshToken: oldToken },
  });

  if (!session || session.expiresAt < new Date()) {
    // If token was valid but session is gone, it might be a reuse attack
    if (session) {
      await prisma.session.deleteMany({ where: { userId: session.userId } });
    }
    throw AppError.unauthorized("Session expired or revoked");
  }

  // Rotate: delete old session, create new one
  const newAccessToken = signAccessToken({
    userId: payload.userId,
    email: payload.email,
  });
  const newRefreshToken = signRefreshToken({
    userId: payload.userId,
    email: payload.email,
  });

  await prisma.$transaction([
    prisma.session.delete({ where: { id: session.id } }),
    prisma.session.create({
      data: {
        userId: payload.userId,
        refreshToken: newRefreshToken,
        expiresAt: getRefreshExpiryDate(),
        userAgent: req.headers["user-agent"] ?? session.userAgent,
        ipAddress: req.ip ?? session.ipAddress,
      },
    }),
  ]);

  // Background cleanup
  cleanupExpiredSessions(payload.userId);

  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;

  // Delete the specific session
  await prisma.session.deleteMany({
    where: { refreshToken },
  });

  res.json({ success: true, message: "Logged out successfully" });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  // We identify the user via the access token from the authenticate middleware
  const userId = req.user!.userId;

  // Delete all sessions for the user
  const result = await prisma.session.deleteMany({
    where: { userId },
  });

  res.json({ success: true, message: `Revoked ${result.count} sessions` });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      timezone: true,
      preferences: true,
      createdAt: true,
      sessions: {
        where: { expiresAt: { gt: new Date() } },
        select: {
          id: true,
          userAgent: true,
          ipAddress: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" }
      }
    },
  });

  if (!user) {
    throw AppError.notFound("User not found");
  }

  res.json({ user });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const data = req.body as UpdateProfileInput;
  const userId = req.user!.userId;

  // We need to merge preferences specifically if they are provided
  let updateData: any = { ...data };
  
  if (data.preferences) {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    
    if (!existingUser) throw AppError.notFound("User not found");
    
    updateData.preferences = {
      ...(existingUser.preferences as object),
      ...data.preferences,
    };
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  res.json({
    user: sanitizeUser(updatedUser),
    preferences: updatedUser.preferences,
  });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;
  const userId = req.user!.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) throw AppError.notFound("User not found");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw AppError.unauthorized("Incorrect current password");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Security best practice: Revoke all other sessions when password changes
  // We keep the current session active if possible, but since we don't know which
  // session ID corresponds to this request (we only have accessToken),
  // we could either revoke ALL sessions, or leave them. Revoking all is safest.
  await prisma.session.deleteMany({
    where: { userId },
  });

  res.json({
    success: true,
    message: "Password changed successfully. Please log in again.",
  });
}

// ── Forgot Password ──────────────────────────────────────

const RESET_TOKEN_EXPIRY_MINUTES = 30;

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;

  const user = await prisma.user.findUnique({ where: { email } });

  // Always respond with success to prevent email enumeration
  if (!user) {
    res.json({
      success: true,
      message: "If an account with that email exists, a reset link has been sent.",
    });
    return;
  }

  // Invalidate any existing unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, used: false },
    data: { used: true },
  });

  // Generate a cryptographically secure token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt,
    },
  });

  // Send email (or log to console in dev mode)
  await sendPasswordResetEmail(email, token);

  res.json({
    success: true,
    message: "If an account with that email exists, a reset link has been sent.",
  });
}

// ── Reset Password ───────────────────────────────────────

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body as ResetPasswordInput;

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!resetToken) {
    throw AppError.badRequest("Invalid or expired reset link. Please request a new one.");
  }

  if (resetToken.used) {
    throw AppError.badRequest("This reset link has already been used. Please request a new one.");
  }

  if (resetToken.expiresAt < new Date()) {
    // Mark as used so it can't be retried
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    });
    throw AppError.badRequest("This reset link has expired. Please request a new one.");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await prisma.$transaction([
    // Update password
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    // Mark token as used (one-time use)
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    }),
    // Revoke all existing sessions (security best practice)
    prisma.session.deleteMany({
      where: { userId: resetToken.userId },
    }),
  ]);

  res.json({
    success: true,
    message: "Password has been reset successfully. You can now log in with your new password.",
  });
}
