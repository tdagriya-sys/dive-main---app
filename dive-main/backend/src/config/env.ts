import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return /REPLACE_ME|REPLACE_WITH|YOUR_KEY|CHANGE_ME/i.test(value);
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
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || "30d",

  otpTtlMinutes: parseInt(process.env.OTP_TTL_MINUTES || "5", 10),
  minSignupAge: parseInt(process.env.MIN_SIGNUP_AGE || "18", 10),

  // OTP delivery via email (Resend) instead of SMS — no per-message regulatory
  // approval needed (unlike SMS in India, which requires a DLT-registered
  // template before anything can send), so this works the moment a real key
  // is set, no waiting period.
  emailApiKey: process.env.EMAIL_API_KEY,
  emailApiKeyIsPlaceholder: isPlaceholder(process.env.EMAIL_API_KEY),
  emailFrom: process.env.EMAIL_FROM || "Divve <onboarding@resend.dev>",

  // Powers AI-based holdings extraction (bot scan screenshots + uploaded
  // documents/screenshots) via the Claude API — see services/aiExtractionService.ts.
  // Without a real key, those two ingestion paths return a clear
  // "AI extraction not configured" error instead of falling back to the old
  // regex/OCR heuristics, which is exactly what this feature was built to replace.
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
