import { z } from "zod";
import { env } from "../config/env";

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").optional(),
  age: z.coerce.number().int().min(env.minSignupAge, `You must be at least ${env.minSignupAge}`).optional(),
});

// Same strength rule as signup (validators/auth.ts) — a password change
// shouldn't be allowed to set a weaker password than signup would have
// accepted in the first place.
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/[a-z]/, "Password must include a lowercase letter")
      .regex(/[0-9]/, "Password must include a number"),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

// Every field optional — the frontend sends a merge-patch of whatever
// changed (matching how setPlannerState works locally), not the full object
// every time.
export const plannerStateSchema = z.object({
  mode: z.enum(["lumpsum", "sip"]).nullable().optional(),
  lumpsumAmount: z.coerce.number().min(0).optional(),
  sipMonthly: z.coerce.number().min(0).optional(),
  sipStepUp: z.coerce.number().min(0).max(100).optional(),
  sipYears: z.coerce.number().int().min(1).max(100).optional(),
  sipExpandedMonthly: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type PlannerStateInput = z.infer<typeof plannerStateSchema>;
