import { z } from "zod";

// Shared by every admin-editable notification body that supports
// `==highlighted==` spans (renewal-reminder messages in validators/
// subscription.ts, and NotificationTemplate/campaign inline content in
// validators/notification.ts) — see models/NotificationCategory.ts::
// IHighlightStyle for the shape these values eventually feed into.
//
// These values land inside a generated inline `style="..."` HTML attribute
// (services/notificationEmailService.ts::renderMarkdownToHtml), so this
// regex is defense-in-depth against an admin/staff value breaking out of
// that attribute or injecting a second declaration — it blocks quotes,
// angle brackets, semicolons, and braces while still allowing every
// legitimate CSS color/size value (hex, rgb(), named colors, em/px/%).
const CSS_VALUE_REGEX = /^[a-zA-Z0-9#(),.%\-\s]*$/;
const cssValue = (max: number) => z.string().trim().max(max).regex(CSS_VALUE_REGEX, "Only letters, digits, and #()%,.- are allowed").optional();

export const highlightStyleSchema = z
  .object({
    color: cssValue(40),
    gradientFrom: cssValue(40),
    gradientTo: cssValue(40),
    fontWeight: z.enum(["normal", "bold"]).optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    fontSize: cssValue(20),
  })
  .optional();

// A separate, optional headline block (image and/or a short line of
// always-highlighted text) rendered above the main body — see
// models/NotificationCategory.ts::INotificationCallout and
// services/notificationEmailService.ts::renderCalloutHtml. Both `text` and
// `imageUrl` are optional and independent; an admin can set either, both,
// or neither (an empty callout just renders nothing). `imageUrl` is
// required to look like a real http(s) URL — same reasoning as
// notificationEmailService.ts::sanitizeImageUrl, just rejected earlier with
// a clearer validation message instead of silently dropping the image.
// A redirect link — an absolute http(s) URL, or an app-relative path like
// `/?go=login`. Same rule as notificationEmailService.ts::sanitizeLinkUrl
// (which is the real enforcement at render time), rejected here first with a
// clear message instead of silently rendering nothing. Whitespace and
// quote/angle-bracket characters are refused outright since the URL lands
// inside a generated `href="..."` attribute.
export const linkUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !/["'<>\s]/.test(v), "A link can't contain spaces or quote/angle-bracket characters")
  .refine((v) => /^https?:\/\//i.test(v) || /^\/(?!\/)/.test(v), "Must start with http://, https://, or a single / (an app page like /?go=login)");

// An optional call-to-action button: both parts are required together.
export const buttonSchema = z
  .object({
    label: z.string().trim().min(1, "Button text is required").max(40),
    url: linkUrlSchema,
  })
  .optional();

export const calloutSchema = z
  .object({
    text: z.string().trim().max(200).optional(),
    imageUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .refine((v) => !v || /^https?:\/\//i.test(v), "Must be a valid image URL starting with http:// or https://"),
    linkUrl: linkUrlSchema.optional(),
    highlightStyle: highlightStyleSchema,
  })
  .optional();

export const announcementSchema = z.object({
  text: z.string().trim().max(280),
  level: z.enum(["info", "warning", "critical"]),
  enabled: z.boolean(),
  dismissible: z.boolean(),
});

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(280),
});

export const dataRequestRejectSchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

export const dataRequestLogSchema = z.object({
  email: z.string().trim().email(),
  type: z.enum(["export", "delete"]),
});
