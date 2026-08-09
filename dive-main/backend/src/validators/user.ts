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

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
