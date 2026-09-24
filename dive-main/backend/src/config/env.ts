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

  // --- Admin panel / observability (Phase 0 of docs/ADMIN_PANEL_PLAN.md) ---
  // All optional with safe defaults so nothing here breaks an existing dev/prod
  // setup that hasn't added them yet.
  //
  // REDIS_URL powers the BullMQ job queue (notification sends, config
  // simulations, exports) and the shared rate-limit store. Empty string =
  // "not configured" — queue-backed features degrade gracefully / run inline.
  redisUrl: process.env.REDIS_URL || "",
  // Shorter access-token lifetime applied to staff sessions specifically (a
  // stolen admin token is worth far more than a normal user's).
  staffAccessTtl: process.env.STAFF_ACCESS_TTL || "10m",
  // Label shown in the authenticator app when a staff member enrols TOTP.
  totpIssuer: process.env.TOTP_ISSUER || "Divve Admin",
  // Optional comma-separated IP allowlist for /api/admin/*. Empty = any IP.
  adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Sentry DSN — empty = error tracking disabled (logger still logs).
  sentryDsn: process.env.SENTRY_DSN || "",
  // Raw ActivityEvent rows are TTL-expired after this many days (daily rollups
  // kept indefinitely). NOTE: Mongo fixes a TTL index's expiry at creation
  // time — changing this value later needs the index dropped + recreated.
  activityEventRetentionDays: parseInt(process.env.ACTIVITY_EVENT_RETENTION_DAYS || "180", 10),
  // A burst of holding edits within this many minutes counts as ONE metered
  // "edit session" for the Freemium portfolio-edit limit (see §3.4 of the plan).
  editSessionWindowMin: parseInt(process.env.EDIT_SESSION_WINDOW_MIN || "20", 10),
  // Raw UsageEvent rows are TTL-expired after this many days — comfortably
  // past the longest rolling window enforceUsage ever checks (30 days), same
  // "storage hygiene only, never affects enforcement" reasoning as
  // activityEventRetentionDays above.
  usageEventRetentionDays: parseInt(process.env.USAGE_EVENT_RETENTION_DAYS || "35", 10),
  // pino log level. Quieter default in production, verbose in dev, silent in test.
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),

  // OTP delivery via email (Resend) instead of SMS — no per-message regulatory
  // approval needed (unlike SMS in India, which requires a DLT-registered
  // template before anything can send), so this works the moment a real key
  // is set, no waiting period.
  emailApiKey: process.env.EMAIL_API_KEY,
  emailApiKeyIsPlaceholder: isPlaceholder(process.env.EMAIL_API_KEY),
  emailFrom: process.env.EMAIL_FROM || "Divve <onboarding@resend.dev>",
  // Where a customer's email reply to a SUPPORT-TICKET email goes (Resend
  // `reply_to`) — a real, monitored mailbox, e.g. support@yourdomain.com.
  // Optional: unset, ticket emails carry no reply-to and a reply goes to
  // `emailFrom`'s own address. Only ticket emails use it (see
  // ticketEmailService.ts); it never affects sign-in codes or marketing.
  supportReplyTo: (process.env.SUPPORT_REPLY_TO || "").trim(),
  // A SEPARATE sender for marketing/onboarding campaigns to people who aren't
  // Divve users (see externalContactService.ts). Deliberately has NO fallback
  // to `emailFrom`: that address sends sign-in codes, staff invites, and
  // support replies, and spam complaints about marketing mail would damage
  // its reputation and could push those messages to spam. Unset, such
  // campaigns refuse to send (except in dev mode with no real email key).
  marketingEmailFrom: (process.env.MARKETING_EMAIL_FROM || "").trim(),
  // Where replies to a marketing email go (Resend `reply_to`). Optional — a
  // marketing address that's really no-reply can leave this unset.
  marketingEmailReplyTo: (process.env.MARKETING_EMAIL_REPLY_TO || "").trim(),
  // The PUBLIC base URL of this API (no trailing slash, including the /api
  // prefix) — used to build the unsubscribe link in marketing emails to
  // imported (non-user) contacts, which has to be a link a stranger's mail
  // client can open. Unset: in production it's `<first CORS origin>/api` (the
  // Nginx setup in docs/SERVER_DEPLOYMENT_GUIDE.md serves both on one
  // domain); in development it's http://localhost:<PORT>/api.
  publicApiUrl: (process.env.PUBLIC_API_URL || "").replace(/\/+$/, ""),

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

  // GST invoicing (Phase 6b of docs/ADMIN_PANEL_PLAN.md §4.3/§7.3) — every
  // in-app price is GST-inclusive (§3 "GST? → Inclusive"), so
  // invoiceService.ts backs the 18% out of whatever was actually charged
  // rather than adding it on top. `isPlaceholder` true means no real GSTIN
  // has been entered yet — invoices still generate (so the pipeline is
  // fully testable without one), just visibly marked as provisional; see
  // invoiceService.ts's own comment on where that shows up.
  gst: {
    sellerGstin: process.env.GST_SELLER_GSTIN || "",
    sellerName: process.env.GST_SELLER_NAME || "Divve",
    // Place of supply for GST purposes — this app has no buyer billing
    // address on file, so this simplifies to the seller's own registered
    // state (a common, defensible simplification for a digital/OIDAR
    // service with no collected address; confirm with your CA before
    // relying on this for real filings).
    sellerState: process.env.GST_SELLER_STATE || "",
    isPlaceholder: isPlaceholder(process.env.GST_SELLER_GSTIN),
  },

  // Dunning grace period (Phase 6b) — how many days a `past_due` subscription
  // (a failed renewal charge — see subscriptionService.ts's webhook handler)
  // keeps its Premium access before jobs/dunning.cron.ts auto-cancels it.
  // `past_due` is deliberately still Premium-equivalent in
  // entitlementService.ts throughout this window, matching typical SaaS
  // dunning UX (a failed card isn't an instant downgrade).
  dunningGraceDays: parseInt(process.env.DUNNING_GRACE_DAYS || "7", 10),

  // How close to a cancelled-but-still-active subscription's currentPeriodEnd
  // jobs/subscriptionCancelNotice.cron.ts waits before actually telling
  // Razorpay to stop auto-renewing it (see subscriptionService.ts::
  // cancelSubscriptionDoc's own comment on why this is deferred at all).
  // 48h gives that daily cron two chances to catch it even if one run is
  // missed, comfortably ahead of Razorpay's own next auto-charge attempt.
  cancelNoticeBufferHours: parseInt(process.env.CANCEL_NOTICE_BUFFER_HOURS || "48", 10),

  // Default set of "days before currentPeriodEnd" thresholds
  // jobs/renewalReminder.cron.ts warns the user at (renewal charge coming
  // up, free trial ending, or access ending because auto-renew is off) —
  // comma-separated, e.g. "7,3,0" fires an independent reminder at each of
  // 7 days out, 3 days out, and the day it happens. Admin-editable at
  // runtime via AdminSetting key "renewalReminder" (adminSettingService.ts)
  // — this is only the fallback for a fresh, unconfigured deploy.
  renewalReminderDaysBefore: (process.env.RENEWAL_REMINDER_DAYS_BEFORE || "7,3,0")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n)),
};

export { isPlaceholder };
