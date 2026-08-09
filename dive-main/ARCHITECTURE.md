# DIVE — Architecture

## Why this stack

- **Backend: Node.js + Express + TypeScript** (replacing FastAPI/Python). The same REST API this backend exposes is meant to be reusable, unchanged, by a future React Native / Expo mobile client — that's the reason for standardizing on a JS/TS backend instead of keeping Python. The old FastAPI app is preserved for reference at `backend/legacy-python/` but is no longer run.
- **Frontend: React** (unchanged — CRA + craco, Tailwind, shadcn/radix, the phone-frame demo shell). Screens under `frontend/src/screens/` are extended, not rewritten, and keep their existing visual design and `data-testid` conventions.
- **Database: MongoDB via Mongoose.** In local dev, if `MONGO_URL` is left empty, the backend automatically starts an in-memory MongoDB (`mongodb-memory-server`) so the app runs with zero setup — data resets on restart. Point `MONGO_URL` at a real `mongod` or MongoDB Atlas cluster to persist data.
- **Auth: JWT access tokens + refresh tokens.** Access tokens are short-lived (15m) and returned in the response body (kept in memory on the client). Refresh tokens (30d) are set as an `httpOnly` cookie scoped to `/api/auth`, so they're never exposed to client-side JS. Passwords are hashed with bcrypt; OTPs are hashed the same way with a short TTL.

## Monorepo layout

```
/backend
  src/
    index.ts, app.ts, config/env.ts     — entrypoint, express app assembly, env loading
    db/connect.ts                       — mongoose connection (real or in-memory)
    models/                             — User, Otp, PendingSignup, Instrument, Holding, AaConsent
    services/                           — otpService, finvuService, botScanService, categorizeInstrument,
                                           fileParsers/*, brokerParsers/*
    controllers/, routes/, validators/  — one set per feature area (auth, holdings, instruments, uploads,
                                           botscan, aa)
    middleware/                         — auth (JWT), errorHandler, rateLimit
    jobs/instrumentRefresh.cron.ts      — daily instrument-master refresh (node-cron, 6am IST)
    seed/                               — instrument master seed data (ported from the old mock profiles
                                           where useful as reference)
  legacy-python/                        — old FastAPI app, kept as reference only, not run
  tests/                                — jest + supertest integration tests
/frontend
  src/screens/                         — existing phone-frame screens, extended with real signup/login,
                                          choose-fetch-method, manual entry, file upload, bot scanner,
                                          AA consent
  src/context/DiveContext.js           — real API-backed state (auth, holdings) replacing mock profiles
  src/lib/api.js                       — axios instance with refresh-token interceptor
  src/lib/diveEngine.js                — unchanged scoring/look-through engine, now fed real Holding data
/docs
  GETTING_API_KEYS.md                  — plain-language guide to obtaining every real API key needed
ARCHITECTURE.md                        — this file
```

## Requirement → module mapping

| Requirement | Module(s) |
|---|---|
| Sign-up + simulated OTP | `services/otpService.ts`, `models/PendingSignup.ts`, `models/Otp.ts`, `controllers/authController.ts` (`signupStart`/`signupVerify`) |
| Login incl. user-not-found | `controllers/authController.ts` (`login`) |
| JWT sessions | `utils/jwt.ts`, `middleware/auth.ts` |
| Canonical holding schema | `models/Holding.ts` |
| Account Aggregator (Finvu) | `services/finvuService.ts`, `models/AaConsent.ts`, `routes/aa.routes.ts` |
| Manual entry (11 asset classes) | `routes/holdings.routes.ts`, `validators/holdings.ts`, frontend `screens/ManualEntry.jsx` |
| Bot scanner (screen-share OCR) | frontend `components/botscan/BotScanWidget.jsx`, `services/botScanService.ts`, `services/brokerParsers/*` |
| File upload (CSV/XLSX/JSON/OCR) | `routes/upload.routes.ts`, `services/fileParsers/*`, `services/categorizeInstrument.ts` |
| Instrument master + daily refresh | `models/Instrument.ts`, `jobs/instrumentRefresh.cron.ts`, `routes/instruments.routes.ts` |
| Non-technical API key guide | `/docs/GETTING_API_KEYS.md` |

## Instrument master: what's live vs. curated, per asset class

The instrument collection is auto-seeded on first boot (whenever it's empty — always true for the default in-memory dev DB) and refreshed daily at 6am IST. Coverage per asset class:

| Asset class | Source | Notes |
|---|---|---|
| Equity | Live — NSE `EQUITY_L.csv` | ~2,300+ listed companies |
| Mutual Funds | Live — AMFI `NAVAll.txt` | ~2,000 schemes |
| ETF | Live — NSE `eq_etfseclist.csv` | Gold/Silver commodity ETFs are reclassified into those asset classes by their listed "Underlying" |
| Crypto | Live — CoinGecko `/coins/list` | Top ~500 |
| Gold / Silver | Live ETFs (above) + hand-curated non-ETF routes (SGB, digital, physical) | No public list for SGB tranches |
| REIT / InvIT | Hand-curated, but complete | India's real universe of each is small (~4 REITs, ~7 InvITs) — NSE's own archives don't list these at all, so there's nothing to fetch |
| Bonds | Hand-curated | No clean public master-list source for corporate bonds/G-Secs; issuers shown generically, not per-ISIN/maturity |
| ULIP / Insurance | Hand-curated | Proprietary insurer products, no public master list |
| FD | Hand-curated | Major PSU/private/small-finance banks — not the full ~150-bank RBI register |

Live sources are wrapped in try/catch and fall back silently to the bundled static seed on failure (offline, rate-limited, source layout changed) — see `services/instrumentSources.ts`.

## Ports & env

- Backend listens on `PORT` (default `8000`), matching the existing `frontend/.env`'s `REACT_APP_BACKEND_URL=http://localhost:8000` — no frontend env change needed.
- Frontend dev server stays on CRA's default `3000`; `CORS_ORIGINS` in `backend/.env` is locked to it.
- Every external secret (Mongo URI, JWT secrets, Finvu creds, Anthropic/email/crypto-price keys) lives in `backend/.env`, mirrored as placeholders in `backend/.env.example`. Placeholder values (`REPLACE_ME`, `REPLACE_WITH_YOUR_KEY`, empty) make the corresponding service run in a dev/mock mode automatically — nothing needs a real key to run locally.
