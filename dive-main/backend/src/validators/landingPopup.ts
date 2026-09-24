import { z } from "zod";
import { highlightStyleSchema, calloutSchema, buttonSchema } from "./adminSetting";

export const createLandingPopupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(4000),
  highlightStyle: highlightStyleSchema,
  callout: calloutSchema,
  button: buttonSchema,
});

// `null` explicitly clears an optional block; an omitted field means
// "leave unchanged" — same convention as updateNotificationTemplateSchema.
export const updateLandingPopupSchema = createLandingPopupSchema.partial().extend({
  highlightStyle: highlightStyleSchema.nullable(),
  callout: calloutSchema.nullable(),
  button: buttonSchema.nullable(),
});
