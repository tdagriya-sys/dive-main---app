import { z } from "zod";

// Same shape as validators/contact.ts / validators/auth.ts — redefined here
// rather than exported/shared, matching this codebase's existing convention
// of a small per-file copy over a shared cross-cutting constants module.
const INDIAN_MOBILE_REGEX = /^(?:\+91|0)?[6-9]\d{9}$/;

const CATEGORY_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

export const createTicketSchema = z
  .object({
    subject: z.string().trim().min(3, "Give it a short title").max(150),
    categoryKey: z.string().trim().toLowerCase().min(1, "Pick a category"),
    description: z.string().trim().min(5, "Tell us a bit more").max(4000),
    requestCallback: z.boolean().optional().default(false),
    mobile: z.string().trim().regex(INDIAN_MOBILE_REGEX, "Enter a valid Indian mobile number").optional(),
    preferredWindow: z.string().trim().max(60).optional(),
  })
  .refine((data) => !data.requestCallback || !!data.mobile, {
    message: "A mobile number is required to request a callback",
    path: ["mobile"],
  });
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const replyMessageSchema = z.object({
  body: z.string().trim().min(1, "Say something first").max(4000),
});

export const csatSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

export const addStaffMessageSchema = z.object({
  body: z.string().trim().min(1, "Say something first").max(4000),
  isInternalNote: z.boolean().optional().default(false),
});

export const updateTicketSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export const mergeTicketSchema = z.object({
  targetTicketId: z.string().min(1),
});

export const callbackDoneSchema = z.object({
  done: z.boolean().optional().default(true),
});

export const createTicketCategorySchema = z.object({
  key: z.string().trim().toLowerCase().regex(CATEGORY_KEY_REGEX, "Lowercase letters, digits and underscores only, starting with a letter"),
  label: z.string().trim().min(1).max(80),
  defaultAssigneeId: z.string().optional(),
  defaultPriority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal"),
  slaHours: z.coerce.number().int().min(1).max(24 * 30).optional().default(48),
  isActive: z.boolean().optional().default(true),
});

export const updateTicketCategorySchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  defaultAssigneeId: z.string().nullable().optional(),
  defaultPriority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  slaHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
  isActive: z.boolean().optional(),
});

export const cannedResponseSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  categoryKey: z.string().trim().toLowerCase().optional(),
});

export const updateCannedResponseSchema = cannedResponseSchema.partial();
