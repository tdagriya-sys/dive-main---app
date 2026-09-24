import { z } from "zod";
import { highlightStyleSchema, calloutSchema, buttonSchema } from "./adminSetting";

const CHANNEL = z.enum(["in_app", "email", "popup"]);
const KEY_REGEX = /^[a-z][a-z0-9_]*$/;
const AUDIENCE = z.enum(["all", "segment", "user_ids", "external"]);
const EXTERNAL_LIST_KEY = z.string().trim().min(1).max(80);
const SUBSCRIPTION_FILTER =z.enum(["active_subscription", "lapsed_payer", "trial_only", "never_engaged"]);
const REPORT_FILTER = z.enum(["purchased_report", "never_purchased_report"]);

export const createNotificationCategorySchema = z.object({
  key: z.string().trim().toLowerCase().regex(KEY_REGEX, "Lowercase letters, digits and underscores only, starting with a letter"),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  defaultChannels: z.array(CHANNEL).min(1).optional().default(["in_app"]),
  userOptOutAllowed: z.boolean().optional().default(true),
  emailSender: z.enum(["system", "marketing"]).optional().default("system"),
});
export const updateNotificationCategorySchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  defaultChannels: z.array(CHANNEL).min(1).optional(),
  userOptOutAllowed: z.boolean().optional(),
  emailSender: z.enum(["system", "marketing"]).optional(),
});

export const createNotificationTemplateSchema = z.object({
  key: z.string().trim().toLowerCase().regex(KEY_REGEX, "Lowercase letters, digits and underscores only, starting with a letter"),
  name: z.string().trim().min(1).max(120),
  categoryKey: z.string().trim().toLowerCase().min(1),
  subject: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(8000),
  channels: z.array(CHANNEL).min(1).optional().default(["in_app"]),
  highlightStyle: highlightStyleSchema,
  callout: calloutSchema,
  button: buttonSchema,
  isActive: z.boolean().optional().default(true),
});
// `null` explicitly clears an optional block (highlight style / callout /
// button); an omitted field still means "leave unchanged" — without this
// there was no way to remove a callout from a template once it was set.
export const updateNotificationTemplateSchema = createNotificationTemplateSchema
  .omit({ key: true })
  .partial()
  .extend({
    highlightStyle: highlightStyleSchema.nullable(),
    callout: calloutSchema.nullable(),
    button: buttonSchema.nullable(),
  });

const segmentQuerySchema = z.object({
  signupFrom: z.coerce.date().optional(),
  signupTo: z.coerce.date().optional(),
  hasHoldings: z.boolean().optional(),
  minHoldingsCount: z.coerce.number().int().min(0).optional(),
  activeSinceDays: z.coerce.number().int().min(1).max(3650).optional(),
  subscriptionFilter: SUBSCRIPTION_FILTER.optional(),
  reportFilter: REPORT_FILTER.optional(),
});

export const audiencePreviewSchema = z.object({
  audience: z.enum(["all", "segment", "user_ids"]),
  segmentQuery: segmentQuerySchema.optional(),
  userIds: z.array(z.string()).optional(),
});

export const createNotificationCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    templateKey: z.string().trim().toLowerCase().optional(),
    inlineContent: z.object({ subject: z.string().trim().min(1).max(200), bodyMarkdown: z.string().trim().min(1).max(8000), highlightStyle: highlightStyleSchema, callout: calloutSchema, button: buttonSchema }).optional(),
    categoryKey: z.string().trim().toLowerCase().min(1),
    channels: z.array(CHANNEL).min(1).optional().default(["in_app"]),
    audience: AUDIENCE,
    segmentQuery: segmentQuerySchema.optional(),
    userIds: z.array(z.string()).optional(),
    externalListKey: EXTERNAL_LIST_KEY.optional(),
  })
  .refine((d) => !!d.templateKey || !!d.inlineContent, { message: "Provide either a templateKey or inlineContent", path: ["templateKey"] })
  .refine((d) => d.audience !== "user_ids" || (d.userIds && d.userIds.length > 0), { message: "userIds is required for the user_ids audience", path: ["userIds"] })
  .refine((d) => d.audience !== "external" || !!d.externalListKey, { message: "Choose which email list this campaign goes to", path: ["externalListKey"] })
  .refine((d) => d.audience !== "external" || (d.channels.length === 1 && d.channels[0] === "email"), {
    message: "A campaign to an email list can only be sent by email",
    path: ["channels"],
  });

export const updateNotificationCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  templateKey: z.string().trim().toLowerCase().nullable().optional(),
  inlineContent: z.object({ subject: z.string().trim().min(1).max(200), bodyMarkdown: z.string().trim().min(1).max(8000), highlightStyle: highlightStyleSchema, callout: calloutSchema, button: buttonSchema }).nullable().optional(),
  categoryKey: z.string().trim().toLowerCase().min(1).optional(),
  channels: z.array(CHANNEL).min(1).optional(),
  audience: AUDIENCE.optional(),
  segmentQuery: segmentQuerySchema.optional(),
  userIds: z.array(z.string()).optional(),
  externalListKey: EXTERNAL_LIST_KEY.nullable().optional(),
});

export const scheduleCampaignSchema = z.object({
  scheduleAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), "scheduleAt must be in the future"),
});

export const testSendCampaignSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const updateNotificationPrefSchema = z.object({
  categoryKey: z.string().trim().toLowerCase().min(1),
  channel: CHANNEL,
  enabled: z.boolean(),
});
