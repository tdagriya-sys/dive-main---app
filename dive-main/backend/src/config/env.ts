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
};

export { isPlaceholder };
