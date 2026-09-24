import { z } from "zod";

const FLAG_KEY_REGEX = /^[a-z][a-z0-9_]*$/;

export const createFeatureFlagSchema = z.object({
  key: z.string().trim().toLowerCase().regex(FLAG_KEY_REGEX, "Lowercase letters, digits and underscores only, starting with a letter"),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().optional().default(false),
  rolloutPct: z.coerce.number().int().min(0).max(100).optional().default(0),
  enabledForPlanKeys: z.array(z.string().trim().toLowerCase()).optional().default([]),
});

export const updateFeatureFlagSchema = z.object({
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().optional(),
  rolloutPct: z.coerce.number().int().min(0).max(100).optional(),
  enabledForUserIds: z.array(z.string()).optional(),
  enabledForPlanKeys: z.array(z.string().trim().toLowerCase()).optional(),
});
