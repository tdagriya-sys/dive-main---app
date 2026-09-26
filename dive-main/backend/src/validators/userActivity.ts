import { z } from "zod";

// Query string for the admin User Activity page and its CSV export. Everything is
// optional; `type` is a comma-separated list of event types.
export const userActivityQuerySchema = z.object({
  user: z.string().trim().max(120).optional(),
  type: z.string().trim().max(600).optional(),
  group: z.enum(["account", "security", "portfolio", "billing", "support"]).optional(),
  // "2026-09-26" (a whole IST day) or a full ISO timestamp.
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type UserActivityQuery = z.infer<typeof userActivityQuerySchema>;
