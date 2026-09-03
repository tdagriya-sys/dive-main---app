import { Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { Holding } from "../models/Holding";
import { AaConsent } from "../models/AaConsent";
import { RefreshToken } from "../models/RefreshToken";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { REFRESH_COOKIE_NAME as REFRESH_COOKIE } from "../config/constants";
import { profileUpdateSchema, passwordChangeSchema, plannerStateSchema } from "../validators/user";
import { publicUser } from "../utils/publicUser";
import { invalidateDiveScoreCache } from "../services/diveScoreService";
import { invalidateReportPurchase } from "../services/paymentService";

const preferencesSchema = z.object({
  risk: z.enum(["Conservative", "Balanced", "Aggressive"]).optional(),
  returnExpectation: z.string().optional(),
  diversificationGoal: z.string().optional(),
  diversificationPriority: z.string().optional(), // frontend field name alias
  preferred: z.array(z.string()).optional(),
  preferredCategories: z.array(z.string()).optional(),
  excluded: z.array(z.string()).optional(),
  excludedCategories: z.array(z.string()).optional(),
});

export async function updatePreferences(req: AuthedRequest, res: Response) {
  const input = preferencesSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  if (input.risk) user.preferences.risk = input.risk;
  if (input.returnExpectation) user.preferences.returnExpectation = input.returnExpectation;
  if (input.diversificationGoal || input.diversificationPriority) {
    user.preferences.diversificationGoal = input.diversificationGoal || input.diversificationPriority!;
  }
  if (input.preferred || input.preferredCategories) {
    user.preferences.preferredCategories = input.preferred || input.preferredCategories!;
  }
  if (input.excluded || input.excludedCategories) {
    user.preferences.excludedCategories = input.excluded || input.excludedCategories!;
  }
  await user.save();
  res.json({ preferences: user.preferences });
}

export async function updateProfile(req: AuthedRequest, res: Response) {
  const input = profileUpdateSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  if (input.name !== undefined) user.name = input.name;
  if (input.age !== undefined) user.age = input.age;
  await user.save();
  // Age drives the Context Engine's persona/corpus-tier bucketing
  // (contextEngine.ts), which feeds several DiveScoreBreakdown sub-scores —
  // a stale cached breakdown would keep showing the old persona otherwise.
  if (input.age !== undefined) {
    invalidateDiveScoreCache(req.userId!);
    await invalidateReportPurchase(req.userId!);
  }

  res.json({ user: publicUser(user) });
}

// Requires the current password (not just an authenticated session) before
// accepting a new one — a stolen access token alone shouldn't be enough to
// lock the real owner out. On success, revokes every live refresh token for
// this user (see models/RefreshToken.ts) so a change made because a password
// leaked actually ends every other still-logged-in session, not just this one.
// Best-effort persistence for Divve Planner's inputs — mirrors
// updatePreferences above (partial merge-patch, direct subdocument field
// assignment so Mongoose's change tracking picks it up). The frontend
// debounces calls here while a slider is being dragged, so this can receive
// several requests a second during active use; it stays deliberately
// lightweight (no cache invalidation, no side effects) since planner inputs
// don't feed the DIVE Score or any other computed value.
export async function updatePlannerState(req: AuthedRequest, res: Response) {
  const input = plannerStateSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  if (input.mode !== undefined) user.plannerState.mode = input.mode;
  if (input.lumpsumAmount !== undefined) user.plannerState.lumpsumAmount = input.lumpsumAmount;
  if (input.sipMonthly !== undefined) user.plannerState.sipMonthly = input.sipMonthly;
  if (input.sipStepUp !== undefined) user.plannerState.sipStepUp = input.sipStepUp;
  if (input.sipYears !== undefined) user.plannerState.sipYears = input.sipYears;
  if (input.sipExpandedMonthly !== undefined) user.plannerState.sipExpandedMonthly = input.sipExpandedMonthly;
  await user.save();

  res.json({ plannerState: user.plannerState });
}

// Guided tour (frontend/src/components/Walkthrough.jsx) — only ever flips
// this one way, so no request body/validation needed, unlike the other
// /me/* routes above. Returns the full publicUser() shape (not just the
// flag) to match updateProfile/updatePlannerState's own convention, so the
// caller can just setUser(data.user) directly.
export async function markWalkthroughSeen(req: AuthedRequest, res: Response) {
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  user.hasSeenWalkthrough = true;
  await user.save();

  res.json({ user: publicUser(user) });
}

export async function changePassword(req: AuthedRequest, res: Response) {
  const input = passwordChangeSchema.parse(req.body);
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!matches) throw new ApiError(401, "INVALID_CURRENT_PASSWORD", "Current password is incorrect.");

  user.passwordHash = await bcrypt.hash(input.newPassword, 10);
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() });

  res.json({ message: "Password updated. For your security, every device (including this one) will need to log in again once the current session expires." });
}

export async function deleteMe(req: AuthedRequest, res: Response) {
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  await Promise.all([
    Holding.deleteMany({ userId: req.userId }),
    AaConsent.deleteMany({ userId: req.userId }),
    User.deleteOne({ _id: req.userId }),
  ]);
  invalidateDiveScoreCache(req.userId!);

  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.json({ message: "Account and all associated data deleted." });
}
