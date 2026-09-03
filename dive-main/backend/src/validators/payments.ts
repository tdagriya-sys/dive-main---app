import { z } from "zod";

export const verifyReportPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1, "Missing order id"),
  razorpay_payment_id: z.string().min(1, "Missing payment id"),
  // Real Razorpay checkouts always send a signature; the mock-mode confirm
  // button (see useDownloadReport.js) sends the literal string "mock" here —
  // paymentService.ts only trusts that once it's independently confirmed
  // the matching Payment record was itself created in mock mode.
  razorpay_signature: z.string().min(1, "Missing signature"),
});
export type VerifyReportPaymentInput = z.infer<typeof verifyReportPaymentSchema>;
