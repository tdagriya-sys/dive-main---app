import { Response } from "express";
import { z } from "zod";
import { User } from "../models/User";
import { Holding } from "../models/Holding";
import { AaConsent } from "../models/AaConsent";
import { AuthedRequest } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { REFRESH_COOKIE_NAME as REFRESH_COOKIE } from "../config/constants";

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

export async function deleteMe(req: AuthedRequest, res: Response) {
  const user = await User.findById(req.userId);
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Account no longer exists.");

  await Promise.all([
    Holding.deleteMany({ userId: req.userId }),
    AaConsent.deleteMany({ userId: req.userId }),
    User.deleteOne({ _id: req.userId }),
  ]);

  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.json({ message: "Account and all associated data deleted." });
}
