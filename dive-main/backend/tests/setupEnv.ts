// Jest `setupFiles` entry — runs BEFORE any test module is imported, and
// therefore before `src/config/env.ts` evaluates `process.env` (and before the
// `dotenv.config()` call inside it, which never overrides an already-set var).
//
// Purpose: force the payment stack into mock mode no matter what real Razorpay
// credentials happen to sit in `backend/.env` on the machine running the suite.
// See docs/PRODUCTION_READINESS_AUDIT.md #35 — this dev machine carries Live-mode
// keys, so without this `npm test` exercised the real-Razorpay branch, created
// real orders against the live account, and turned ~14 payment/report tests red.
//
// "REPLACE_ME" matches `isPlaceholder()` in env.ts, which is what flips
// paymentService.ts into its clearly-labelled mock mode.
process.env.RAZORPAY_KEY_ID = "rzp_test_REPLACE_ME";
process.env.RAZORPAY_KEY_SECRET = "REPLACE_ME";
process.env.RAZORPAY_WEBHOOK_SECRET = "";

// Keep queue/observability integrations inert in tests regardless of local .env.
process.env.REDIS_URL = "";
process.env.SENTRY_DSN = "";

// Tests own the DB connection entirely via tests/setup.ts + mongodb-memory-server
// — never a real Mongo. Clearing this so `env.useInMemoryMongo` reads true and
// nothing can accidentally dial the dev/prod database from a test run.
process.env.MONGO_URL = "";
