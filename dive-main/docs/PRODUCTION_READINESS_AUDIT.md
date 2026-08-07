# Production Readiness Audit — 2026-08-05

A full sweep of the backend (Express/TS/Mongo) and frontend (React CRA) for functionality gaps, security, scalability (caching/queueing/rate-limiting/indexing), and deployment readiness. Findings are ordered P0→P3 by how much they'd actually hurt in production, not by category — a P0 blocks shipping at all; a P3 is real but can wait.

This complements two existing docs rather than duplicating them: `DIVE_SCORE_MODEL.md` §13 (deliberate scoring-model scope decisions) and `PROTOTYPE_LIMITATIONS.md` (deliberate prototype-stage simplifications). Everything below is either a genuine bug/gap, a silent failure mode, or a place code has drifted from what those docs claim — not a re-litigation of decisions already made on purpose.

---

## P0 — Blocks shipping to production at all

1. **No deploy configuration exists anywhere in the repo.** No `Dockerfile`, `docker-compose.yml`, `Procfile`, or platform config (`render.yaml`, `vercel.json`, etc.) for either frontend or backend. The only deploy-adjacent file (`.emergent/emergent.yml`) is metadata for the current prototyping platform, not a portable deploy artifact. Deploying to any real host is entirely unaddressed today. *(backend + frontend)*

2. **OTP can leak straight into the signup API response in production.** `backend/src/services/otpService.ts` + `backend/src/controllers/authController.ts` — if `EMAIL_API_KEY` (OTP delivery moved from SMS to email — see `docs/GETTING_API_KEYS.md` §1) is left as its `.env.example` placeholder, `devOtp` is returned in the JSON response, not just logged. `checkProductionSafety()` (`backend/src/index.ts:8-19`) blocks a dev JWT secret or in-memory Mongo from starting under `NODE_ENV=production`, but does **not** check `emailApiKeyIsPlaceholder` — a real deploy that forgets to set a real email key ships with a full OTP-gate bypass, silently. (Note: a *real delivery failure* with a real key configured is already handled correctly and does NOT leak — that path was fixed to hard-fail in production instead of falling back to exposing the code; this finding is specifically about the placeholder-key case, which still bypasses silently.)

3. ~~**No React error boundary anywhere in the frontend.**~~ **Fixed 2026-08-07.** `frontend/src/components/ErrorBoundary.jsx` (new) — two boundaries now mounted: an outer catch-all around the whole app (`index.js`) as a last-resort full-page fallback, and an inner one around `<DiveShell/>` inside the phone frame (`App.js`) so a bug in one screen shows a contained "this screen hit a snag, try again" state without blanking the landing page's header/marketing copy around it. Both offer a retry (re-render without reload) and the outer one also offers a full reload. Verified live by deliberately throwing in both `Onboarding` (inner) and `Landing` (outer) — each boundary caught its error correctly, logged it via `console.error`, and the outer boundary's landing-page chrome stayed intact while the inner one was broken.

4. **The production JWT-secret safety check is a weak substring match, not a real strength check.** `backend/src/index.ts:10` only checks `.includes("dev-")`. The literal `.env.example` placeholder (`JWT_ACCESS_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET`) would pass this check and boot a real server signing real user tokens with a publicly-known secret from the repo. `isPlaceholder()` (`env.ts:6-9`) covers other secrets but not the JWT ones.

5. ~~**No health/readiness endpoint, no graceful shutdown.**~~ **Fixed 2026-08-07.** Added `GET /api/health` (`backend/src/app.ts`) — checks real Mongo connectivity via `mongoose.connection.readyState`, returns 503 if disconnected rather than just confirming the process is alive. Mounted under `/api` specifically so it's reachable through the Nginx reverse-proxy in `docs/SERVER_DEPLOYMENT_GUIDE.md` (which only forwards `/api/*` to this backend). Added `SIGTERM`/`SIGINT` handlers in `backend/src/index.ts` — stop accepting new connections (`server.close()`), let in-flight ones finish, cleanly `disconnectDb()`, then exit, with a 15s force-exit safety timer in case a stuck keep-alive connection would otherwise hang the shutdown forever. Verified live: the health endpoint correctly returns `{"status":"ok","db":"connected",...}` at 200 while up. Graceful shutdown was verified by emitting `SIGINT` *in-process* (`process.emit`) rather than via a real OS signal — Windows (this dev machine) doesn't reliably deliver cross-process signals to Node the way the actual Linux/PM2 deploy target does (confirmed empirically: `process.kill(pid, "SIGINT")` from a separate process just force-terminated the target with no handler invoked, twice, consistent with Node's documented Windows signal-emulation limits), so the in-process emit is what actually exercises the registered listener's logic — it correctly logged `received SIGINT, shutting down gracefully...` → closed the server → disconnected Mongo → `shutdown complete`.

---

## P1 — Breaks the moment there's real traffic or more than one instance

6. **Rate limiting silently stops working with 2+ backend instances.** `backend/src/middleware/rateLimit.ts` and the global `/api` limiter (`app.ts:38-47`) both use `express-rate-limit`'s default in-memory store — no shared store (Redis) configured. Each process tracks its own counters, so effective limits multiply by instance count with zero error or warning.

7. **The daily instrument-refresh cron has no distributed lock.** `backend/src/jobs/instrumentRefresh.cron.ts` runs unconditionally in every process (`index.ts:37`). With 2+ instances, the 6am refresh fires N times concurrently, each hammering AMFI/NSE/CoinGecko independently — wasteful and risks tripping CoinGecko's rate limit for all instances at once.

8. **No rate limiting at all on the endpoints that cost real money per call.** `backend/src/routes/upload.routes.ts` and `botscan.routes.ts` have zero route-level limiter (only the blanket 120 req/min global limiter applies). Each call triggers one Claude vision request against up to 30 images — a real financial-abuse vector at the current ceiling.

9. **IP-based rate limiting has no `trust proxy` configuration.** No `app.set('trust proxy', ...)` anywhere. Deployed behind any real reverse proxy/load balancer/CDN, `req.ip` resolves to the proxy's address — every client's rate-limit bucket collapses into one shared bucket, undermining #6/#8's controls the moment this is actually deployed normally.

10. **Refresh tokens are never rotated and have no server-side revocation.** `backend/src/controllers/authController.ts:125-146` — `refresh()` reuses the same refresh token indefinitely; `logout()` only clears the cookie client-side. A stolen refresh token stays valid for the full 30-day TTL regardless of the real user logging out, with no way to kill it server-side short of rotating the signing secret for everyone.

11. **Bot Scan / file upload block the HTTP request on a synchronous, untimed Claude API call.** `backend/src/controllers/botScanController.ts:27`, `uploadController.ts:52-57` — no queue, no explicit timeout on the Anthropic call. A large scan holds an Express connection open for the full extraction latency; under concurrent load this ties up workers and risks load-balancer timeouts (typical 30-60s defaults) before Claude even replies.

12. **Account Aggregator "real mode" is structurally incomplete, not just gated on missing credentials.** `backend/src/controllers/aaController.ts` + `finvuService.ts` — the only path that moves a consent from `PENDING`→`ACTIVE` is `approveMockConsent`, hard-gated to `consentHandle.startsWith("mock-")`. There is **no webhook/callback route anywhere** for Finvu's real server-to-server consent-approval flow, `FINVU_CERT_PATH` is read from env but never actually used to set up mTLS, and the default `FINVU_BASE_URL` is a non-resolvable placeholder domain. Configuring real Finvu credentials today would not produce a working integration — it would hang at PENDING forever. This is a meaningfully bigger gap than `PROTOTYPE_LIMITATIONS.md` §4 currently implies ("sandbox until credentials are configured") — worth updating that doc once this is either built out or the framing is corrected.

13. **Context-level data loaders silently swallow errors and present them as empty/unchanged state.** `frontend/src/context/DiveContext.js`: `loadHoldings` (line 89) sets holdings to `[]` on any failure — indistinguishable from a genuinely empty portfolio, so a network blip or expired session makes a user's real portfolio appear to "vanish." `savePrefs` (156-159) applies preference changes optimistically and does nothing but a silent no-op comment on failure — the UI shows a save that never reached the backend. There's also no global handler that forces re-login when a refresh token ultimately fails mid-session (`lib/api.js:40-41` just rejects); only the very first page-load check redirects to onboarding.

---

## P2 — Real functional/product gaps worth fixing soon

14. **No way to edit an existing holding — only create and delete.** `backend/src/routes/holdings.routes.ts` has no `PATCH`/`PUT`; `frontend/src/screens/MyHoldings.jsx` only renders a delete button. Fixing a typo or updating a value means delete-and-recreate, which loses `purchaseDate`, `source`, and any `extraFields` (e.g. FD terms) since there's no pre-fill path either.

15. **No upper-bound sanity check on any holding value, from any entry path.** `backend/src/validators/holdings.ts:18-19` and the Mongoose schema both only enforce `min: 0`, no max. A Bot Scan misread (an extra digit) or a fat-fingered manual entry flows straight into the DIVVE Score/X-Ray/VaR math with no warning, silently producing a materially wrong score.

16. **DiveBot's demo is 100% scripted with fixed fake numbers, not connected to the viewer's real portfolio or score.** `frontend/src/screens/DiveBot.jsx:6-37` — every verdict/percentage is a hardcoded literal, independent of the logged-in user's actual holdings. The screen's own copy ("watch DIVVE Bot step in — in real time, right where you invest") reads as if it reflects real data. Not currently disclosed as staged in either limitations doc — worth an explicit "illustrative demo" label, or wiring it to real data.

17. **No documented process (or fallback) for setting the production backend URL at build time.** CRA/craco bakes `REACT_APP_BACKEND_URL` into the bundle at `build` time, not runtime. `frontend/src/lib/api.js:3` has no fallback — an unset var at build time silently produces the literal string `"undefined/api"`. No `.env.production` exists, and nothing documents this requirement for whoever runs the production build.

18. **Admin instrument-refresh endpoint has no role check and no concurrency lock.** `backend/src/controllers/instrumentsController.ts:32-38` (self-documented in-code as a known gap) — any authenticated user can trigger `runInstrumentRefresh()`, and nothing prevents two concurrent runs from both hammering AMFI/NSE/CoinGecko at once.

19. **Zero frontend test coverage**, vs. a real 8-suite backend Jest setup. No `*.test.js` files, no `setupTests.js`, `@testing-library/*` isn't even installed despite a `test` script existing. Combined with #3 (no error boundary), there's no safety net against a regression that white-screens production.

20. **Bulk-save from Bot Scan / File Upload silently swallows per-row failures.** `frontend/src/screens/BotScan.jsx:125-160`, `FileUpload.jsx:76-115` — a failed row (bad value, unresolvable instrument) is just skipped; the user sees only an aggregate "X saved" count with no indication of which row failed or why.

21. **No caching on the DIVE Score composite computation.** `backend/src/services/diveScoreService.ts` recomputes the correlation matrix, drawdown/VaR simulation, and O(n²) look-through overlap from scratch on every single `/score/breakdown` call, even though the underlying price-history fetches ARE cached. Fine under ~20-30 holdings; adds real per-request latency as portfolios and repeat-polling scale.

22. **N+1 sequential DB lookups during AI holdings extraction.** `backend/src/services/aiExtractionService.ts:247-273` — one to two un-batched, sequentially-awaited `findOne` calls per extracted holding (20-60 round-trips for a 20-30-item scan), stacked on top of the already-slow Claude call rather than parallelized or batched into one query.

---

## P3 — Worth doing, not urgent

23. **Third-party scripts unconditionally baked into every production build.** `frontend/public/index.html:27` — the `assets.emergent.sh` script tag (unlike the dev-only visual-edits plugin, which is correctly gated) ships in every build with no conditional. A PostHog snippet with a live project key is also inlined. Worth an explicit keep/remove decision before a public launch, along with the "A product of emergent.sh" meta description.

24. **No structured logging or error tracking.** Everything is `console.log`/`morgan` to stdout — no JSON logs, no request-id correlation, no Sentry/APM integration. Fine at prototype stage; makes debugging a specific failed request in production mean grepping unstructured output across however many instances are running.

25. **Dead code with a misleading comment about the file-upload architecture.** `backend/src/services/brokerParsers/angelOne.ts`, `genericRowParser.ts`, `holdingsSectionExtractor.ts` have zero callers, but a comment in `aiExtractionService.ts:38-44` claims they're still the CSV/XLSX/JSON path's helpers — they're not; that path actually goes through `fileParsers/rowNormalizer.ts`'s broker-agnostic fuzzy matching. Will mislead the next person who touches this code.

26. **Instrument search doesn't use the collection's own text index.** `backend/src/services/instrumentService.ts:206-213` does an unanchored `$regex` scan; a `name: "text"` index exists but isn't used. Fine at current collection size (~8-10k), won't scale past roughly 50-100k documents or high query volume.

27. **In-process caches (price history, instrument detail) are per-instance, not shared.** Fine below ~2-3 instances; cache hit rate degrades roughly proportional to instance count beyond that, multiplying external API call volume. Would need Redis to fix once instance count actually grows.

28. **A few bottom-nav screens render blank instead of a loading/empty message.** `Home.jsx:21`, `Suggestions.jsx:13`, `XRay.jsx:32` all `return null` rather than showing a spinner or an empty-state explainer — not a crash, but a dead-end-looking blank screen if reached before any holdings exist.

29. **Minor auth hardening gaps**: user enumeration via differing login error codes/messages (unknown identifier → 404, wrong password → 401); `User.passwordHash` has no `select: false` (every current call site is careful, but nothing stops a future accidental leak); uploaded file-type filtering trusts client-supplied MIME type (low actual risk — memory-only storage, no disk/exec path).

30. **No circuit breaker on external price APIs.** Per-call timeouts and graceful synthetic fallback already exist and work well — but per-holding fetches are awaited serially, so a fully-down external source means a multi-holding portfolio accumulates the full timeout for every affected holding in sequence (e.g. ~80s for 10 equity holdings) before falling back, rather than failing fast after the first timeout.

31. **No pagination.** `listHoldings` returns every holding unbounded (low risk — holdings are per-user and realistically small); `searchInstruments` has a limit but no offset, so results past the top 20 are unreachable.

32. **No timeout on the Claude vision-extraction call itself**, beyond the SDK's own default — a hung Claude response has no client-visible cancel/retry path.

---

## What's already solid (don't re-litigate these)

- **DB connection handling** — `MONGO_URL` branching between real/in-memory Mongo is clean and correctly parameterized (already deploy-ready).
- **Auth correctness** — `requireAuth` does real JWT signature+expiry verification; every user-data query is properly scoped by `userId` (no IDOR found anywhere).
- **Input validation** — zod is used consistently on every body/query-accepting route; no NoSQL-injection surface found.
- **CORS/Helmet/cookies** — explicit origin allowlist (not wildcard), Helmet defaults enabled, refresh cookie is httpOnly/sameSite/secure-gated correctly.
- **Error handler** — never leaks stack traces or internal paths to clients, in dev or prod.
- **External API resilience** — consistent timeouts, MFAPI retry-once, CoinGecko 429 backoff, and graceful synthetic-data fallback mean a dead external API never hangs or crashes a user's score request.
- **OTP/session state** — DB-backed (not in-process), already horizontally scalable on that front; OTP has a real 5-attempt cap.
- **Indexing** — every collection's indexes match its actual query patterns except instrument search (see #26).
- **PDF generation** — renders real, live-computed data; buffers fully in memory before sending, so no partial-file-on-error risk.
- **Account deletion** — correctly cascade-deletes Holdings and AaConsents.
- **Preferences round-trip** — every field the frontend sets has a matching schema field and persists correctly.
- **Backend build/deploy shape** — `tsc` build + `node dist/index.js` start is genuinely clean with no dev-tool dependency; just needs an actual container/platform config wrapped around it (#1).
- **Backend test coverage** — 8 real Jest suites covering scoring, auth, holdings, context engine.

---

## Maintenance

Re-run this audit (or at least re-check the P0/P1 items) before any real production deploy, and whenever a new endpoint or external integration is added. Update `PROTOTYPE_LIMITATIONS.md` §4's Account Aggregator framing to match finding #12 once that gap is either fixed or the doc is corrected to describe the real current state.
