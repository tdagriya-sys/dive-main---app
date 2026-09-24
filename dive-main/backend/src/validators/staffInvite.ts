import { z } from "zod";

// Indian mobile numbers: optional +91/0 prefix, then a 10-digit number
// starting 6-9 — mirrors validators/auth.ts's signup rule exactly, since
// accepting an invite creates a real User document with the same required
// fields as a normal signup.
const INDIAN_MOBILE_REGEX = /^(?:\+91|0)?[6-9]\d{9}$/;
const PASSWORD_RULES = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[0-9]/, "Password must include a number");

export const inviteStaffSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    staffRole: z.enum(["superadmin", "admin", "employee"]),
    roleId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  })
  .refine((data) => data.staffRole !== "employee" || !!data.roleId, {
    message: "roleId is required when inviting an employee",
    path: ["roleId"],
  });

export const acceptStaffInviteSchema = z
  .object({
    token: z.string().min(1, "Missing invite token"),
    name: z.string().trim().min(2, "Name is required"),
    mobile: z.string().regex(INDIAN_MOBILE_REGEX, "Enter a valid Indian mobile number"),
    age: z.coerce.number().int().min(18, "You must be at least 18"),
    password: PASSWORD_RULES,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const updateEmployeeSchema = z.object({
  staffRole: z.enum(["admin", "employee"]).optional(), // never "superadmin" via this generic edit — see employeesController.ts
  roleId: z.string().regex(/^[0-9a-fA-F]{24}$/).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const createRoleSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]*$/, "Key must be lowercase letters/numbers/underscores, starting with a letter"),
  label: z.string().trim().min(2, "Label is required"),
  description: z.string().trim().optional(),
  permissions: z.array(z.string()).default([]),
});

export const updateRoleSchema = z.object({
  label: z.string().trim().min(2).optional(),
  description: z.string().trim().optional(),
  permissions: z.array(z.string()).optional(),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type AcceptStaffInviteInput = z.infer<typeof acceptStaffInviteSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
