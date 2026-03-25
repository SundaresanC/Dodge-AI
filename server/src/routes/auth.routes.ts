import { Router } from "express";
import {
  authLimiter,
  validateBody,
  asyncHandler,
  authenticate,
} from "../middleware/index.js";
import {
  signupSchema,
  loginSchema,
  refreshSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../validators/auth.schema.js";
import * as authController from "../controllers/auth.controller.js";

const router = Router();

// ── Public Routes (Rate Limited) ──────────────────────────

router.post(
  "/signup",
  authLimiter,
  validateBody(signupSchema),
  asyncHandler(authController.signup)
);

router.post(
  "/login",
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.login)
);

router.post(
  "/refresh",
  validateBody(refreshSchema),
  asyncHandler(authController.refresh)
);

router.post(
  "/logout",
  validateBody(refreshSchema),
  asyncHandler(authController.logout)
);

router.post(
  "/forgot-password",
  authLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler(authController.forgotPassword)
);

router.post(
  "/reset-password",
  authLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler(authController.resetPassword)
);

// ── Authenticated Routes ──────────────────────────────────

// All routes below require a valid access token
router.use(authenticate);

router.post(
  "/logout-all",
  asyncHandler(authController.logoutAll)
);

router.get(
  "/me",
  asyncHandler(authController.me)
);

router.put(
  "/me",
  validateBody(updateProfileSchema),
  asyncHandler(authController.updateProfile)
);

router.post(
  "/change-password",
  validateBody(changePasswordSchema),
  asyncHandler(authController.changePassword)
);

export default router;
