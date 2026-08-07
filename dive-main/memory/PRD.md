# DIVE (Diversify My Investment) — PRD

## Original Problem Statement
Mobile-first interactive investor-DEMO web app for "DIVE" — an AI investment advisor that looks THROUGH every holding (equity, MF, bonds, gold, REIT/InvIT, ETF, FD, insurance) to expose hidden concentration risk, scores portfolio health (DIVE Score 0–100), gives category-level (never stock-level) diversification suggestions, and has a "DIVE Bot" that pops into OTHER investing apps. Presented inside a realistic phone frame wrapped in a scrollytelling landing page. All deterministic MOCK data — no real broker/KYC/auth.

## User Choices (confirmed defaults)
- Mock data + deterministic verdicts (no LLM) — most reliable for a live pitch
- 2 demo profiles: aarav (hidden Reliance concentration ~76%), meera (diversified)
- Design agent chose look: light theme, premium blue #0F62FE, Cabinet Grotesk + Satoshi
- Full end-to-end build

## Architecture
- Backend: FastAPI + MongoDB. Serves mock portfolios, ideal ranges, instruments, stress tests, insights; persists preferences. All routes /api/*.
- Frontend: React + framer-motion + recharts. Client-side DIVE engine (lib/diveEngine.js) computes score, look-through exposure, suggestions. Context-driven screen router inside a phone frame; outer scrollytelling landing (App.js) syncs phone screen via IntersectionObserver.

## Personas
- Gen-Z / young millennials (22–32), first-time/early investors. Tone: witty smart-friend, plain language.

## Implemented (Dec 2025)
- Onboarding: splash (3 cards) → mock OTP signup → Account-Aggregator consent → animated fetching → animated DIVE Score reveal
- Home dashboard: animated score ring, apparent vs real diversification, insight cards, bottom nav
- X-Ray (flagship): surface donut → "Look Deeper" melt into true company exposure (~76% Reliance), drill-down with credit-rating badges
- Suggestions: quantified Current ₹/% → Ideal ₹ range, "Simulate this change" slider (live score/exposure), Stress-test sheet (3 scenarios)
- Ask DIVE: instrument search + Fundamental/Technical/Valuation/Fit tabs + disclaimer
- DIVE Bot hub: 5 skinned simulated apps with brand-blue overlay verdicts
- Preferences: profile switch, risk/return/diversification controls, preferred/excluded chips (persisted)
- Insights feed: badges + timeline
- Landing wrapper: hero, callouts, scroll-synced feature sections, closing CTA

## Status: MVP complete, tested 100% backend + frontend (iteration_1).

## Backlog / Next
- P1: Add InvIT/ULIP/ETF holdings to demo data for fuller X-Ray variety
- P1: Persist simulated allocations so score changes carry across screens
- P2: Second annotated callout set per feature section (per screen)
- P2: Gamification streak counter + share card for social proof

## Iteration 3 (Dec 2025) — Dark+Gold redesign & viral share
- Theme flipped to DARK + GOLD (Groww-"W" style): black gradient bg, gold gradient buttons & keywords (index.css vars + .gold-btn/.text-gold-gradient). Score ring/accents gold.
- Fixed reported bugs: removed the two permanently-visible floating callout cards + inline duplicate pills; phone frame now fully visible at 1280x720 & 1440x900 (h-[calc(100vh-180px)] max-h-760).
- Simulated allocations: realistic per-category look-through (SIM_TEMPLATES) + saved/loaded per profile via backend (/api/simulations).
- Shareable "My DIVE Score": backend OG endpoints — GET /api/og-image/{score} (Pillow PNG, fonts in /app/backend/assets/fonts) + GET /api/share/{score} (HTML with og:image/twitter meta). ShareCard copies the /api/share link.
- Tested: iteration_4 — backend 18/18 pytest, frontend 100% at both viewports. No open issues.

## Iteration 5 (Jul 2026) — Real product migration (mock demo → real backend)
Full rewrite of the "how" behind the same product vision: real auth, real database, real (or sandbox-real) investment ingestion, instead of two hardcoded demo profiles. See `ARCHITECTURE.md` for the full stack/module breakdown and `test_result.md` for per-task test status.

- **Stack change**: FastAPI/Python backend replaced with Node/Express/TypeScript + MongoDB (Mongoose). Old Python app preserved at `backend/legacy-python/` for reference only, no longer run. Reason: same REST API needs to be reusable by a future React Native/Expo mobile app unchanged.
- **Auth**: real signup with simulated OTP (hashed, 5min TTL, dev-mode code shown on-screen until a real SMS provider is configured), login with `USER_NOT_FOUND`/`INVALID_CREDENTIALS` branches, JWT access + httpOnly-cookie refresh tokens.
- **4 investment-ingestion methods, all real**: Manual Entry (all 11 asset classes, FD computes maturity value server-side), File Upload (CSV/XLSX/JSON parse + Tesseract.js OCR for images/text-PDFs, shared instrument categorizer, review-before-save), Bot Scanner (real `getDisplayMedia` screen capture + periodic OCR + Angel-One-shaped parser + generic fallback + review-before-save — **not yet verified against a real broker screen**, see test_result.md), Account Aggregator via Finvu sandbox (mock mode active — no real Finvu credentials yet, so it uses clearly-labeled synthetic sample data through the exact same consent/fetch pipeline a real sandbox would use).
- **Instrument Master service**: ~70-instrument seed across all 11 asset classes, daily 6am IST refresh job pulling AMFI (mutual funds) and CoinGecko (crypto) live with static fallback, search/autocomplete endpoint backing every instrument picker in the app.
- **Honest scope note**: the flagship "X-Ray look-through" (e.g. a mutual fund secretly being 42% one company) was demo-specific curated fake data. Real holdings have no fund-composition data source yet, so concentration detection only catches the *same instrument* recurring across holdings, not decomposing a fund into its underlying stocks. Documented in `diveEngine.js`'s `adaptHolding()`. Old canned per-profile stress-test numbers replaced with a real client-side "what-if" calculation off actual holdings.
- **Security**: helmet, CORS locked to frontend origin, rate limiting (auth/OTP tight, general API limiter for defense-in-depth), bcrypt passwords, hashed OTPs, multer file-type/size validation, production-startup guard against default JWT secrets / in-memory DB.
- **Docs**: `/docs/GETTING_API_KEYS.md` — plain-language guide for SMS/OTP provider, Finvu AA sandbox, cloud OCR (optional), crypto/market data (optional).
- Tested: 22/22 backend integration tests (jest+supertest+mongodb-memory-server) across auth, holdings, uploads, bot-scan parsers, and the AA mock flow. Full flow browser-verified: signup → manual/file-upload/AA-mock ingestion → real DIVE Score → Home/X-Ray/Profile all rendering live data.
