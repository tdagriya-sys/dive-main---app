import { z } from "zod";

export const totpConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"),
});

// Regular sign-in accepts either a fresh 6-digit TOTP code OR an 8-character
// recovery code ("XXXX-XXXX") — see staffAuthController.ts's totpVerify.
export const totpVerifySchema = z.object({
  code: z.string().trim().min(6, "Enter your 6-digit code or a recovery code").max(20),
});

export const stepUpSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type TotpConfirmInput = z.infer<typeof totpConfirmSchema>;
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;
export type StepUpInput = z.infer<typeof stepUpSchema>;
