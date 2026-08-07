import { z } from "zod";
import { env } from "../config/env";

// Indian mobile numbers: optional +91/0 prefix, then a 10-digit number starting 6-9
const INDIAN_MOBILE_REGEX = /^(?:\+91|0)?[6-9]\d{9}$/;

export const signupStartSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required"),
    mobile: z.string().regex(INDIAN_MOBILE_REGEX, "Enter a valid Indian mobile number"),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    age: z.coerce.number().int().min(env.minSignupAge, `You must be at least ${env.minSignupAge} to sign up`),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/[a-z]/, "Password must include a lowercase letter")
      .regex(/[0-9]/, "Password must include a number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const signupVerifySchema = z.object({
  mobile: z.string().regex(INDIAN_MOBILE_REGEX),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your email or mobile number"),
  password: z.string().min(1, "Password is required"),
});

export type SignupStartInput = z.infer<typeof signupStartSchema>;
export type SignupVerifyInput = z.infer<typeof signupVerifySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
