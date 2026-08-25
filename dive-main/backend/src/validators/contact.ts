import { z } from "zod";

// Same Indian-mobile shape as validators/auth.ts (not exported there, so
// redefined here) — this app is India-focused end to end, and the landing
// page's contact form already only prompts for a +91-style number.
const INDIAN_MOBILE_REGEX = /^(?:\+91|0)?[6-9]\d{9}$/;

export const contactSubmissionSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  mobile: z.string().trim().regex(INDIAN_MOBILE_REGEX, "Enter a valid Indian mobile number"),
  subject: z.string().trim().max(150).optional().default(""),
  description: z.string().trim().min(5, "Tell us a bit more").max(4000),
  timeSlot: z.string().trim().min(1, "Pick a time slot").max(60),
});

export type ContactSubmissionInput = z.infer<typeof contactSubmissionSchema>;
