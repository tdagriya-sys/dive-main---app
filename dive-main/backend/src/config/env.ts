import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return /REPLACE_ME|REPLACE_WITH|YOUR_KEY|CHANGE_ME/i.test(value);
}

// A JWT signing secret needs a real strength check, not just "isn't the known
// placeholder string" — a short, guessable value (or the literal dev fallback
// below, which doesn't match isPlaceholder()'s CHANGE_ME regex since it uses a
// hyphen, "change-me", not an underscore) would pass isPlaceholder() but still
// let anyone forge valid tokens. 32 chars is a floor comfortably below what
// `openssl rand -base64 48` (the value the deploy guide has people generate)
// produces, without being strict about exact entropy.
function isWeakJwtSecret(value: string): boolean {
  return isPlaceholder(value) || value.length < 32;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "8000", 10),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000").split(","),

  mongoUrl: process.env.MONGO_URL || "",
  dbName: process.env.DB_NAME || "dive",
  useInMemoryMongo: isPlaceholder(process.env.MONGO_URL) || !process.env.MONGO_URL,

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me",
  jwtAccessSecretIsWeak: isWeakJwtSecret(process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me"),
  jwtRefreshSecretIsWeak: isWeakJwtSecret(process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || "30d",

  otpTtlMinutes: parseInt(process.env.OTP_TTL_MINUTES || "5", 10),
  minSignupAge: parseInt(process.env.MIN_SIGNUP_AGE || "18", 10),

  // Gates admin-only endpoints (e.g. POST /api/admin/instruments/refresh) —
  // there's no full role system in this app yet, so admin access is just
  // "your account's email is on this list", checked fresh on every request
  // rather than a persisted per-user flag (one env var to edit beats a DB
  // migration for something this small in scope).
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // OTP delivery via email (Resend) instead of SMS — no per-message regulatory
  // approval needed (unlike SMS in India, which requires a DLT-registered
  // template before anything can send), so this works the moment a real key
  // is set, no waiting period.
  emailApiKey: process.env.EMAIL_API_KEY,
  emailApiKeyIsPlaceholder: isPlaceholder(process.env.EMAIL_API_KEY),
  emailFrom: process.env.EMAIL_FROM || "Divve <onboarding@resend.dev>",

  // Powers AI-based holdings extraction (bot scan screenshots + uploaded
  // documents/screenshots) — see services/aiExtractionService.ts. OpenAI
  // (GPT-5.6 Terra) is the PRIMARY extraction call; the Claude key below is
  // the FALLBACK, used only if the OpenAI call fails or OPENAI_API_KEY isn't
  // set. Without a real key for either, those two ingestion paths return a
  // clear "AI extraction not configured" error instead of falling back to the
  // old regex/OCR heuristics, which is exactly what this feature was built to
  // replace.
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiApiKeyIsPlaceholder: isPlaceholder(process.env.OPENAI_API_KEY),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicApiKeyIsPlaceholder: isPlaceholder(process.env.ANTHROPIC_API_KEY),

  cryptoPriceApiKey: process.env.CRYPTO_PRICE_API_KEY,
  cryptoPriceApiKeyIsPlaceholder: isPlaceholder(process.env.CRYPTO_PRICE_API_KEY),

  finvu: {
    baseUrl: process.env.FINVU_BASE_URL || "https://finvu-sandbox.example/api",
    clientId: process.env.FINVU_CLIENT_ID,
    clientSecret: process.env.FINVU_CLIENT_SECRET,
    certPath: process.env.FINVU_CERT_PATH,
    isPlaceholder: isPlaceholder(process.env.FINVU_CLIENT_ID) || isPlaceholder(process.env.FINVU_CLIENT_SECRET),
  },

  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",

  // Razorpay — gates the paid resilience-score PDF download (see
  // paymentService.ts). Deliberately its own key pair, separate from
  // whatever Razorpay keys any other product on this account uses — see
  // docs/RAZORPAY_SETUP_GUIDE.md for how to get one. Without a real key
  // pair, order creation/verification runs in a clearly-labeled mock mode
  // (paymentService.ts) instead of calling the real Razorpay API — same
  // "placeholder means dev/mock mode" convention as every other integration
  // in this file (Finvu, email, AI extraction).
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    // Separate secret from keySecret above — Razorpay issues this only when
    // you set up a webhook endpoint (docs/RAZORPAY_SETUP_GUIDE.md §5), used
    // solely to verify that an incoming POST /api/payments/webhook call
    // genuinely came from Razorpay, not to authenticate API calls TO Razorpay.
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    isPlaceholder: isPlaceholder(process.env.RAZORPAY_KEY_ID) || isPlaceholder(process.env.RAZORPAY_KEY_SECRET),
  },
  // Price of the resilience-score PDF, in paise (Razorpay's smallest INR
  // unit — 100 paise = Rs. 1), matching the Rs. 99 the frontend's
  // DownloadReportButton already advertises. A separate env var (not just a
  // hardcoded 9900 in code) so the price can change without a redeploy of
  // frontend copy and backend charge amount drifting out of sync.
  reportPricePaise: parseInt(process.env.REPORT_PRICE_PAISE || "9900", 10),
};

export { isPlaceholder };
