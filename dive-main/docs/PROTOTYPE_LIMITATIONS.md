# Prototype-Stage Limitations & Future Scope

## 1. Purpose & Scope

A single place to catalog things this app currently simplifies, mocks, or avoids — not because they're the right long-term design, but because they're blocked on real-time data constraints or other prototype-stage engineering tradeoffs. This is a companion to two existing documents, not a replacement for either:

- **`docs/GETTING_API_KEYS.md`** covers things that are mocked *only* because a real API key/credential hasn't been configured yet — flipping the switch is a config change, not new engineering work (OTP SMS, Finvu Account Aggregator, crypto price data).
- **`docs/DIVE_SCORE_MODEL.md` §13** covers scoring-model-specific gaps (per-asset-class data coverage, correlation/volatility assumptions, etc.) in depth — this document cross-references that section rather than duplicating it.

Everything here is either (a) a real, load-bearing constraint (a free data source that doesn't exist, a live-computation cost that doesn't fit the UX), or (b) a deliberate simplification made explicitly to keep an estimate honest rather than overconfident. None of these are silently-accepted bugs — each was identified, reasoned about, and the tradeoff was a conscious call given this app's current stage.

## 2. Simulation & scoring accuracy

**What-if score deltas (Suggestions' Simulate, Ask DIVVE's Fit-for-you) can't compute the full resilience-inclusive score for a hypothetical holding.** They anchor on the real backend composite score and add a concentration-only estimated delta, scaled by concentration's actual weight in the real composite (fixed 2026-08-04 — see `DIVE_SCORE_MODEL.md` §11 and §15's changelog for the full before/after). Why the full composite isn't computed live for a hypothetical instrument, in one place:

- `computeDiveScoreBreakdown(userId)` queries the user's *persisted* holdings directly — it isn't parameterized to accept a hypothetical holdings array.
- A simulated instrument (e.g. a specific mutual fund the user is only considering) would need a live price/return history fetch per slider tick to compute volatility/drawdown/VaR/correlation — slow, and fragile against free, non-SLA-backed sources (MFAPI.in, CoinGecko, Yahoo Finance).
- Recomputing the full correlation matrix and drawdown series on every tick is expensive relative to how often a slider fires.
- Continuous-drag slider UX is fundamentally incompatible with a per-tick backend round-trip.

Full detail, including the exact math and the deferred alternative (an on-demand "Compute exact score" button that accepts one real backend call's latency instead of trying to make every slider tick exact) is in `DIVE_SCORE_MODEL.md` §13.1.

## 3. Data freshness — nothing here is truly real-time

- **Instrument metadata (sector, market-cap tier, fund category, etc.) refreshes once a day**, via a `node-cron` job at 6am IST (`backend/src/jobs/instrumentRefresh.cron.ts` → `runInstrumentRefresh()`). A newly-listed or reclassified instrument can be up to 24h stale.
- **A holding's `currentValue` is a snapshot from whenever it was entered** (manual entry, Bot Scan, file upload, or an Account Aggregator sync), not a continuously mark-to-market figure — there's no background job that re-prices existing holdings against today's market price the way a real brokerage or portfolio tracker would. The score and Home screen reflect whatever value was last saved for each holding, not live prices.
- **Free-tier price/data sources are community services, not SLA-backed APIs.** MFAPI.in (mutual fund NAV history), CoinGecko (crypto prices/segments), and Yahoo Finance (equity/ETF/REIT/InvIT chart data) are all free and can be slow, rate-limited, or briefly unavailable — the app has retry/backoff and graceful-fallback handling for this, but it's a real operational constraint, not a solved problem. NSE's own official API is blocked by bot protection (Akamai) and isn't used directly; Yahoo/scraped/static data stand in instead.

## 4. Sandboxed / mocked integrations (until a real credential is configured)

These aren't scope gaps so much as intentional dev-mode defaults — see `docs/GETTING_API_KEYS.md` for how to make each one real:

- **OTP delivery** — sign-up shows the generated code directly on-screen ("Dev mode — use test OTP") instead of sending a real email, until an `EMAIL_API_KEY` (Resend) is configured. Delivery is by email, not SMS — SMS was dropped in favor of email specifically to avoid India's DLT template pre-approval requirement, which can take days; email requires no such approval and works the moment a real key is set.
- **Account Aggregator ("Connect via Account Aggregator")** — runs against Finvu's sandbox and fills the portfolio with realistic sample holdings, clearly labeled, until real `FINVU_CLIENT_ID`/`FINVU_CLIENT_SECRET` credentials are configured (and even then, it's a sandbox environment, not a production RBI-licensed AA integration pulling a real user's actual bank/broker accounts).
- **Bot Scan / screenshot & PDF upload** — needs `ANTHROPIC_API_KEY` to function at all; without it, these return an explicit "not configured" message rather than a guess (CSV/XLSX/JSON uploads are unaffected — they're parsed directly, no AI extraction needed). **A real key is already configured in this project's `backend/.env`, so this one is fully live, not mocked** — listed here only for completeness/onboarding-doc purposes (what happens if a fresh clone doesn't have a key yet), not because it's currently limited.

## 5. Persistence

**The dev database is in-memory by default.** Without a real `MONGO_URL` set in `backend/.env`, the backend spins up an in-memory MongoDB each time it starts (`[db] MONGO_URL not set to a real database — using an in-memory MongoDB for this session. Data will NOT persist across restarts.`) — every signup, holding, and preference is lost on the next restart. This is a deliberate zero-setup default for trying the app, not a production data-storage strategy.

## 6. Divve Planner simplifications

- **Planner inputs (mode, lumpsum amount, SIP monthly/step-up/years/expanded-view) persist only for the current session, not across login/devices.** They're lifted into `DiveContext`'s `plannerState` (2026-08-04) specifically so navigating away from and back to the Planner tab within a session no longer resets them to defaults — but there's no backend endpoint or `User` schema field for this yet (unlike `prefs`, which has `savePrefs`/`PATCH /users/me/preferences`), so a fresh login or new session still starts from the same defaults. Wiring up real persistence once Mongo-backed storage is in place is a small, contained follow-up — mirror the `prefs`/`savePrefs` pattern.
- **The SIP glide path assumes contributions only, no investment growth.** A month-by-month SIP projection sums what the user actually contributes; it does not layer in an assumed market return, to avoid presenting an illustrative growth curve as if it were a forecast (the same "don't imply more certainty than the data supports" principle behind `DIVE_SCORE_MODEL.md`'s synthetic-data disclosures). A real projected-growth mode is a plausible future addition, clearly labeled as illustrative if built.
- **`frontend/src/lib/plannerEngine.js` independently ports (mirrors, doesn't import) `backend/src/services/contextEngine.ts`'s corpus-tier/persona logic**, following the same "keep in sync" convention already used for `diveEngine.js`'s `normalizeIssuer()`. This is a deliberate choice (the Planner needs this resolved against hypothetical totals — a lumpsum slider recomputes instantly, a SIP plan calls it hundreds of times client-side — round-tripping to the backend for each would be both slow and unnecessary, since the underlying logic is pure and side-effect-free), but it carries a real maintenance risk: if `contextEngine.ts` changes without a matching update to `plannerEngine.js`, the two will silently drift out of sync. There's no automated check enforcing this today.

## 7. Maintenance

Whenever a limitation here gets fixed or a new one is deliberately introduced, update this document in the same change — add or remove the relevant entry, and note the date/reason if it's non-obvious. Keep score-model-specific gaps in `DIVE_SCORE_MODEL.md` §13 rather than duplicating them here; this document should stay the broader, cross-cutting complement to it.
