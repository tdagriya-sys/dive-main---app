# DIVE Score Model — Reference Documentation

**Status:** Living document. This must be updated in the same change as any edit to the scoring model's formulas, weights, tiers, or data sources — see [§15 Maintenance](#15-maintenance--change-log) for how.

**Last verified against source:** 2026-09-01, against the codebase in this repository (`backend/src/services/diveScoreService.ts`, `lookthroughService.ts`, `priceHistoryService.ts`, `contextEngine.ts`, `stats.ts`, `backend/src/seed/*`, `backend/src/services/instrumentSources.ts`, `frontend/src/lib/diveEngine.js`, `frontend/src/lib/contextMessaging.js`, `frontend/src/screens/XRay.jsx`, `frontend/src/screens/Suggestions.jsx`).

---

## 1. Purpose & Scope

The DIVE Score is a 0–100 composite that answers two separate questions about a user's investment portfolio:

1. **Concentration** — how spread out is this money, really? (Not just "how many holdings" but "how many *genuinely independent* things.")
2. **Resilience** — if markets move against this portfolio, how much does it lose, how fast does it recover, and how easily can it be turned into cash?

Concentration is itself split into two numbers shown to the user — **Apparent Diversification** and **Real Diversification** — because a portfolio can *look* diversified (spread across labeled categories) while *actually* carrying hidden, overlapping risk (a mutual fund that holds the same stock you already hold directly, a jewelry-retailer stock that is quietly a leveraged bet on gold prices, two different bank stocks that will fall together in a rate shock). The gap between Apparent and Real is the model's core insight, and it is backed by a look-through / connectedness engine described in [§7](#7-look-through--connectedness-model).

## 2. Where This Lives In The Product

**One calculator, not two.** The backend (`backend/src/services/diveScoreService.ts`) is the single authoritative source for any score computed against a user's *real, saved* holdings. It is exposed as:

```
GET /api/score/breakdown   (authenticated)
```
via `backend/src/controllers/scoreController.ts` → `computeDiveScoreBreakdown(userId)`.

Consumers:
- **`frontend/src/context/DiveContext.js`** — fetches this once per holdings change (`loadScoreBreakdown()`), exposes `scoreBreakdown` to the whole app.
- **`Home.jsx`** — shows `scoreBreakdown.compositeScore` / `apparentDiversificationPct` / `realDiversificationPct` whenever not mid-simulation.
- **`Insights.jsx`** — same pattern, feeds the ShareCard and leaderboard percentile.
- **`ScoreBreakdown.jsx`** — the full detail view: composite score, apparent/real stat block, radar chart of all 10 sub-scores, drawdown detail, VaR, correlation heatmap, the list of detected `connections` ("Why real is below apparent"), and data-quality disclosure (`realPriceCoveragePct`).
- **`Suggestions.jsx`** — anchors its "before" value on `scoreBreakdown.compositeScore` (the real number), but see [§11](#11-frontend-fast-path-diveenginejs) for how it estimates hypothetical deltas without a round-trip to the backend. Also reads `scoreBreakdown.context` (Layer D, [§12](#12-layer-d--context-engine)) to defer nudges that don't make sense for the user's corpus/age yet.
- **`Home.jsx`** insights and **`ScoreBreakdown.jsx`**'s "Your situation" card also read `scoreBreakdown.context` — see §12.

**The one deliberate exception:** `frontend/src/lib/diveEngine.js`'s `diveScore()` is a client-side, network-free approximation used *only* where the backend fundamentally cannot help — a hypothetical, unsaved "what if I moved ₹X into gold" state while a user drags a slider, and the pre-login Onboarding preview. It is not a second, independently-invented model — its concentration formula intentionally mirrors the backend's, see §12.

## 3. Statistical Building Blocks

`backend/src/services/stats.ts` — shared primitives used throughout:

| Function | Definition |
|---|---|
| `mean(xs)` | Arithmetic mean |
| `variance(xs)` | Sample variance, `n-1` denominator |
| `stdev(xs)` | `sqrt(variance)` |
| `covariance(xs, ys)` | Sample covariance, series truncated to shorter length |
| `correlation(xs, ys)` | `covariance / (stdev(xs) * stdev(ys))`, 0 if either side has zero variance |
| `betaAgainst(assetReturns, marketReturns)` | `Cov(asset, market) / Var(market)` — standard CAPM beta |
| `scoreFromRange(value, worstAt, bestAt)` | Linear map: `worstAt → 0`, `bestAt → 100`, clamped `[0,100]`, rounded. Works for both "higher is better" (`bestAt > worstAt`) and "lower is better" (`bestAt < worstAt`) metrics via the same function. |

Every sub-score in §8 is produced by feeding a raw metric through `scoreFromRange` with a documented `(worstAt, bestAt)` pair.

## 4. Price/Return Data Sourcing

`backend/src/services/priceHistoryService.ts` resolves one **daily-return series** per holding, used for volatility, drawdown, VaR, beta, correlation, and the diversification ratio.

### 4.1 Real data (used where a free source exists)

| Asset classes | Source | Endpoint | Cost | Notes |
|---|---|---|---|---|
| EQUITY, ETF, GOLD, SILVER (NSE-listed) | Yahoo Finance | `query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>.NS`, 1y daily | Free, keyless | Needs ≥30 return points or falls back to synthetic |
| CRYPTO | CoinGecko | `/coins/{id}/market_chart`, 365d daily, USD | Free, keyless (rate-limited) | Keyed by `coingeckoId`, not symbol |
| MUTUAL_FUND (resolvable AMFI scheme code) | MFAPI.in | `api.mfapi.in/mf/<schemeCode>`, full NAV history | Free, keyless | Real daily NAV-derived returns (newest-first response reversed to chronological); needs ≥30 return points or falls back to synthetic; forces IPv4 (`family: 4`) and retries once on connection failure — this host has shown occasional first-connection flakiness (a hang/failure that succeeds immediately on retry), independent of the IPv4 fix |
| Market factor (Nifty 50 benchmark, used for every beta calc) | Yahoo Finance | `^NSEI`, 1y daily | Free, keyless | Falls back to a deterministic synthetic index if unreachable |

Real fetches are cached in-memory for 12 hours (`CACHE_TTL_MS`) and are **skipped entirely in the test environment** (`env.nodeEnv === "test"`) so the automated test suite never depends on network access or live data drift.

### 4.2 Synthetic fallback (everything else)

No free, daily-granularity public price source exists in India for bonds, REIT/InvIT units not separately NSE-listed, ULIP/insurance, or FD. For these — and as a fallback when a real fetch fails for EQUITY/ETF/CRYPTO/MUTUAL_FUND (delisted symbol, unresolvable scheme code, API down, rate-limited) — a **deterministic seeded synthetic series** is generated:

- Seed: `mulberry32` PRNG, keyed by `${assetClass}:${instrumentId || name}` — the same holding always produces the same series across requests (reproducible, not random noise on every page load).
- Shape per day: `dailyDrift + beta * marketFactor[day] + idiosyncraticNoise(Box-Muller, dailyVol)`.
- Tied to the same shared Nifty 50 "market factor" used for real-priced holdings, so a synthetic holding's correlation/beta with the rest of the portfolio stays internally coherent rather than being an independent random walk.
- Every synthetic series is labeled (`isSynthetic: true`, `label: "Synthetic — <Class> assumption"`) and surfaced to the user via `dataQuality.holdings[].isSynthetic` and the aggregate `dataQuality.realPriceCoveragePct` — **never presented as real historical data.**

**`SYNTHETIC_PARAMS`** — illustrative annual assumptions per asset class (drift / volatility / beta vs. Nifty). Only govern the synthetic fallback path — where a real daily price series exists (EQUITY/ETF/GOLD/SILVER/CRYPTO with live data), correlation and volatility are computed empirically instead. Not fitted to any single dataset, but the **ordering and sign** of each value is grounded in widely documented, qualitative asset-allocation relationships, cited below (see the comment block above `SYNTHETIC_PARAMS` in source for the full citations):

| Asset class | Drift | Vol | Beta | Beta rationale |
|---|---|---|---|---|
| EQUITY | 12% | 20% | 1.0 | Baseline (beta is measured against Nifty itself) |
| MUTUAL_FUND | 12% | 16% | 0.75 | Diversified equity funds retain high but sub-1.0 correlation to the broad index |
| ETF | 11% | 18% | 0.9 | Index-tracking ETFs closely mirror their underlying equity index by construction |
| BOND | 7% | 4% | **−0.05** | Sovereign/high-quality debt has historically shown low-to-negative correlation with equity during equity stress ("flight-to-quality") — though this can invert during synchronized high-inflation regimes (e.g. 2022), a regime-dependent caveat, not a permanent relationship |
| REIT | 9% | 15% | 0.5 | Hybrid profile — equity-like development/occupancy risk plus bond-like yield/duration sensitivity |
| INVIT | 9% | 13% | 0.45 | Similar hybrid profile to REIT, slightly lower given typically more contracted/stable infrastructure cash flows |
| GOLD | 8% | 14% | **−0.15** | The well-documented "safe-haven" property — low-to-negative correlation with equity, most pronounced in risk-off periods (World Gold Council research, standard multi-asset allocation guides) |
| SILVER | 8% | 20% | **0.15** | Shares gold's monetary-hedge role but carries a meaningful industrial-demand component, tying it more closely to growth/equity cycles than gold |
| ULIP_INSURANCE | 8% | 9% | 0.35 | Balanced/equity-linked insurance products with embedded capital protection |
| FD | 7% (or the holding's actual entered interest rate, if provided) | 0.3% | 0 | Contractually fixed return, zero market correlation by construction |
| CRYPTO | 25% | 60% | **0.3** | Academic literature (Corbet, Meegan, Larkin, Lucey & Yarovaya 2018; Baur & Dimpfl 2021) documents LOW and UNSTABLE crypto-equity correlation in normal periods (~0.1–0.3), with occasional stress spikes — **not** the strong, stable positive correlation a higher beta would imply. Crypto still isn't a "free" diversifier despite this low correlation, because its own volatility (60%) dominates any diversification benefit on the vol axis. |
| PF (Provident Fund — PPF/EPF/VPF) | 7.5% (blended PPF 7.1%/EPF 8.25% fallback; or the holding's actual `pfInterestRatePercent`, if provided) | 1% | 0 | Beta 0, same as FD — no market co-movement visible to the account holder. Vol deliberately set ABOVE FD's 0.3%, not equal: FD's rate is locked for the deposit's whole tenure at issuance (genuinely fixed once opened); PF's government-declared rate is instead periodically revised for the WHOLE balance going forward — PPF has moved from 8.7% (FY2015-16) to a 7.1% floor unchanged since Apr–Jun 2020, EPF from 8.1%–8.65% over the last 6 years — real, if slow, rate-revision variability FD doesn't have. An illustrative judgment call (not literature-cited the way the betas above are), calibrated to that observed 0.4–1.6pt historical rate-revision range, kept well below BOND's 4% since PF is still far more stable than market-priced debt. |

`vol` values are informed by typical annualized-volatility ranges commonly cited in Indian mutual-fund fact sheets (AMFI/CRISIL risk-o-meter bands), NSE/international index and ETF volatility data, and gold/silver commodity volatility indices — not fitted to one specific live dataset. These are documented, defensible starting points for illustrative math — **not investment research** and not backtested/calibrated against realized outcomes. (Bolded betas above were corrected 2026-07-30 — see §15 changelog; crypto's beta in particular was previously 1.6, which wrongly implied a strong, stable positive equity correlation.)

## 5. Instrument Master Data & Classification Sources

`backend/src/services/instrumentSources.ts` + `instrumentService.ts::runInstrumentRefresh()` — runs on server startup (if the Instrument collection is empty), on a daily cron, and via `POST /api/admin/instruments/refresh`.

| Purpose | Source | Endpoint | Cost | Notes |
|---|---|---|---|---|
| Bundled fallback (all classes, esp. REIT/InvIT/SGB/ULIP/FD-issuers with no public master list) | Hand-maintained static list | `backend/src/seed/staticInstruments.ts` | — | Always seeded first. PF (like FD) has no `Instrument` row at all — it's a principal/rate-based holding shape, not an instrument-lookup one; see `validators/holdings.ts`'s `pfSchema`. |
| MUTUAL_FUND names/codes | AMFI | `amfiindia.com/spages/NAVAll.txt` | Free, keyless | Capped at 8,000 rows (see §5.1) |
| EQUITY names/symbols | NSE | `nsearchives.nseindia.com/content/equities/EQUITY_L.csv` | Free, keyless | Frequently blocked by NSE's bot protection; fails soft to the static list |
| ETF (+ GOLD/SILVER commodity ETF reclassification) | NSE | `.../eq_etfseclist.csv` | Free, keyless | "Underlying" column routes gold/silver ETFs into GOLD/SILVER classes |
| CRYPTO names | CoinGecko | `/coins/list` | Free, keyless (rate-limited) | Top 500 taken; stores `metadata.coingeckoId` |
| **EQUITY sector** (broad NSE Industry) | NSE | `.../ind_nifty500list.csv` (Nifty 500 constituents) | Free, keyless | Feeds `metadata.sector` — used by both the same-class tier and the broad cross-class industry-affinity tier (§7) |
| **EQUITY market-cap tier** (Large/Mid/Small) | NSE | `.../ind_nifty100list.csv`, `.../ind_niftymidcap150list.csv`, `.../ind_niftysmallcap250list.csv` | Free, keyless | Feeds `metadata.marketCapTier` — the three index constituent lists don't overlap by construction, so first match wins. Used by equity's within-class quality adjustment (§6.3) |
| **CRYPTO sector** (curated broad segment) | CoinGecko | `/coins/markets?category=<slug>` × 10 curated slugs | Free, keyless (rate-limited) | One bulk call per curated segment (not per coin) — see §7.5 |
| **MUTUAL_FUND sector** (Sectoral/Thematic funds only) | AMFI | Same `NAVAll.txt`, parsed for category headers | Free, keyless | Only funds under an "Equity Scheme - Sectoral/Thematic" header get tagged — see §7.5 |

**No AI-generated data is used anywhere in this pipeline.** Every classification above traces to a free, public, machine-readable source. Where no such source exists (mutual fund portfolio composition, precise sub-industry affinities), a small hand-curated dataset is used instead of an LLM guess — see §5.2 — because fabricated *specific numeric financial figures* are a high-hallucination-risk, low-verifiability choice for something this factual.

### 5.1 A cap that mattered

`fetchAmfiMutualFunds()` originally capped at 2,000 rows to "keep the collection reasonable." AMFI lists Debt schemes before Equity schemes in `NAVAll.txt`, so that cap was silently excluding **every equity mutual fund** — including every Sectoral/Thematic fund the sector-tagging step needs an `Instrument` record to attach to — before the parser ever reached them. Raised to 8,000 (comfortably covers Debt + Equity + ETF + Fund-of-Funds; the full file is ~14,200 rows, mostly near-duplicate growth/IDCW/direct/regular plan variants of the same underlying fund).

### 5.2 Curated (hand-written, not AI-generated) datasets

| File | Contents | Why curated instead of live/AI |
|---|---|---|
| `backend/src/seed/mutualFundTopHoldings.ts` | ~8 popular funds' approximate top-5 disclosed holdings, point-in-time | No free/official API for Indian MF *portfolio composition* exists (AMFI publishes NAV, not holdings) — funds disclose via monthly factsheet PDFs, not a structured feed. A fund not listed here simply contributes no signal (never fabricates an overlap). |
| `backend/src/seed/sectorAffinity.ts` | `KEYWORD_SECTOR_AFFINITY` (company-name keywords → small cross-class affinity) and `INDUSTRY_ASSET_CLASS_AFFINITY` (broad NSE Industry → small cross-class affinity) | Precision the broad NSE "Industry" column can't provide (e.g. jewelry retailers land under generic "Consumer Durables") |
| `backend/src/seed/sectorAffinity.ts` | `MF_SEGMENT_TO_NSE_INDUSTRY` — a sectoral mutual fund's own curated sector tag → the matching NSE Industry label(s) | AMFI scheme-naming and NSE's Industry classification are two independently-evolved taxonomies with no shared identifier — can't compare by string equality. Only mappings we're confident are a real, direct match are included (e.g. "Energy" spans NSE's separate "Oil Gas & Consumable Fuels" and "Power" industries, so both are listed); broader MF themes (Infrastructure, PSU, Manufacturing, Transportation & Logistics) span too many NSE industries to map honestly, so they're left out rather than guessed at |
| `backend/src/seed/mutualFundSegments.ts` | `MUTUAL_FUND_SEGMENT_KEYWORDS` — keyword → sector label, checked only against AMFI-classified Sectoral/Thematic fund names | Diversified fund categories (Large Cap, Flexi Cap) span too many industries to tag with one sector |

## 6. Concentration Score — Apparent vs. Real vs. Name Diversification

All Herfindahl-Hirschman Index (HHI)-based: `HHI = Σ(share_i²)` over some grouping of the portfolio's value; a diversification score is `round((1 - HHI) × 100)`, clamped `[0, 100]`.

| Metric | Grouped by | Formula |
|---|---|---|
| **Apparent Diversification %** | Asset class (EQUITY, GOLD, BOND, …) | `classHhi = Σ(classValue/totalValue)²` → `round((1-classHhi)×100)` |
| **Name Diversification score** | Individual holding name (portfolio-wide, case/whitespace-normalized) | `nameHhi = Σ(nameValue/totalValue)²` → `round((1-nameHhi)×100)` |
| **Real Diversification %** | — | `apparent × (1 − overlapShare)`, see below |

### 6.1 The core invariant: Real can never exceed Apparent

```
realDiversificationPct =
  apparentDiversificationPct <= 0
    ? 0
    : clamp( round(apparentDiversificationPct × (1 − overlapShare)), 0, apparentDiversificationPct )
```

Because `overlapShare ∈ [0, 1]`, this is true **by mathematical construction**, not by convention: real diversification can only ever *reveal* hidden concentration the apparent (class-level) view missed — it can never manufacture diversification apparent doesn't already show. And if a portfolio is 100% one asset class, apparent is already 0, so real is forced to 0 too — no amount of good stock-picking *within* that one class counts as real diversification (that's what Name Diversification is for, at a small, separate weight).

`overlapShare` is the cross-asset-class portion of the look-through model's output — see §7.

### 6.2 Same-class connections: a second, separate discount

Same-sector connections *within* one asset class (e.g. two different bank stocks) cannot move Apparent or Real — both are already floored at 0 the moment a portfolio is single-class, so there is no room left for a same-class effect to register there. Instead, `sameClassOverlapShare` (also from §7) discounts the **Name Diversification** score, since that is the only concentration lever still active for a single-class (or class-skewed) portfolio:

```
sectorAdjustedNameDiversificationScore =
  clamp( round(nameDiversificationScore × (1 − sameClassOverlapShare)), 0, 100 )
```

`sameClassOverlapShare` is capped, **per asset class**, at that class's own share of total portfolio value (see §7.4) — so a tightly-clustered sector inside a small slice of the portfolio can only ever move the score by that slice's own weight, never more than the asset class actually represents.

### 6.3 Within-class HHI — a genuinely different signal from Name Diversification

Name Diversification (§6, top) is computed **portfolio-wide**: a portfolio holding one stock + one bond + one gold unit looks reasonably name-diversified (3 distinct names, `nameHhi ≈ 0.33`) even though each class it holds is 100% concentrated *within itself*. A standard HHI concentration metric should be applied both **across** asset classes (Apparent, above) and **within** each one — so a second HHI is computed separately per class:

```
for each asset class present:
    classHhiWithin = Σ (nameValue / classTotalValue)²        // HHI over just that class's own names
    classScore     = round((1 - classHhiWithin) × 100)
withinClassConcentrationScore = round( Σ_class (classTotalValue / totalValue) × classScore )
```

Value-weighted across classes, so a concentrated *small* class (e.g. one bond unit that's 5% of the portfolio) drags the score down proportionally less than a concentrated *large* class (e.g. one stock that's 80% of the portfolio).

**Three class-specific quality adjustments** sit on top of the raw name-HHI `classScore` above — a modest step toward "don't use one generic formula for all 12 classes" (the rest of that ask is deferred; see §13.1):

- **CRYPTO — capped at 70, however well name-spread.** Most crypto assets are documented to move together, especially in stress periods — spreading across N coins doesn't reduce risk anywhere near as much as spreading across N genuinely distinct equities, so this class's within-class score can never claim full credit for "diversification" the way an equally-spread equity sleeve can.
- **FD — blended with a maturity-laddering score**, when 2+ distinct FDs exist and each has a resolvable maturity month (from `extraFields.maturityDate`, already computed at holding-creation time): `ladderScore = round(100 × distinctMaturityMonths / distinctFdCount)`, then `classScore = round((classScore + ladderScore) / 2)`. Two FDs at different banks maturing the same month is a real, different risk (reinvestment/rate risk concentrated at one point in time) from the same two FDs laddered across different months — even though issuer-name spread looks identical either way. Skipped (no adjustment) when maturity data isn't resolvable for any holding, rather than guessing.
- **EQUITY — blended with sector spread and market-cap tier blend**, each independently skipped when the underlying classification isn't available (never guessed):
  - *Sector spread*: `round(100 × min(1, distinctSectors / 5))` using the NSE broad-industry `.sector` field (§5) already fetched for the look-through model — 5+ distinct sectors among the equity names held is treated as full credit, catching the "20 stocks, all IT + Banking" case the raw name-HHI can't see.
  - *Market-cap tier blend*: value-weighted HHI over Large/Mid/Small tier (from NSE's Nifty 100 / Midcap 150 / Smallcap 250 constituent lists, §5) — `round(100 × (1 - Σ(tierValue/equityTotal)²))`. 100% concentration in any one tier (small-cap especially) scores low; a genuine blend scores high.
  - If either signal is available, `classScore = round((classScore + average(availableSignals)) / 2)`.

### 6.4 Composite Concentration Score

```
concentrationScore = round(
  apparentDiversificationPct            × 0.50 +
  realDiversificationPct                × 0.15 +
  sectorAdjustedNameDiversificationScore × 0.20 +
  withinClassConcentrationScore         × 0.15
)
```

Apparent (spread across asset classes) is still deliberately the dominant term — diversifying into **new asset classes** is what should move this score the most. Real, Name, and within-class spread are meaningful but secondary corrections — each capturing a genuinely different question ("did look-through reveal hidden overlap," "are your holdings distinct by name portfolio-wide," "is each individual sleeve internally spread out").

### 6.5 Stock-count band — bounded, not "more is always better"

A flat HHI keeps improving toward 100 as more names are added, with no ceiling — but the classic diversification literature says otherwise for individual stock-picking: Evans & Archer (1968) found portfolio risk "exhausted" by roughly 10 stocks; Statman (1987) revised the minimum for a well-diversified, randomly-selected portfolio to ~30; later studies range 20–50+ depending on market/method. Practically: too few (<10–12) is genuine concentration risk; too many (>30–40) for a retail investor brings diminishing/negative marginal benefit — unmanageable overlap, index-hugging — not further diversification.

`backend/src/services/diveScoreService.ts::scoreStockCountBand()` bands the count of **distinct EQUITY holdings** (only equity — the literature is about individual stock-picking, not e.g. how many mutual funds you hold) via piecewise-linear interpolation between illustrative anchor points:

| Stock count | 1 | 3 | 8 | 12 | 15 | 30 | 40 | 50 | 75 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|
| Score | 10 | 25 | 60 | 90 | 100 | 100 | 75 | 60 | 45 | 40 |

Ideal band: **15–30** (score 100, flat plateau). Tapers on both sides — down toward concentration risk below ~10, and down (but never to 0 — over-diversification is a milder failure mode than under-diversification) above ~40. Scored as **100 (not applicable)** when the user holds no equity at all — this dimension is specifically about equity stock-picking breadth, not a penalty for lacking equity (that's already reflected elsewhere, via Apparent Diversification and Layer D's `contextFit`).

## 7. Look-Through / Connectedness Model

`backend/src/services/lookthroughService.ts`. Product framing: *how many genuinely independent unwanted events would it take to hurt this portfolio?* Two holdings that are "different" on paper but share an underlying risk factor should count as partially — never fully, unless they really are the same issuer — connected.

Checked pairwise across every two holdings in the portfolio, **most-to-least precise, first match wins**:

### 7.1 Tier 0 — Same class, same sector *(the only same-class tier)*

Applies only when `h1.assetClass === h2.assetClass`. Requires both holdings to carry a non-empty `.sector` (see §5 for which classes currently have sector data) and the same sector value, and excludes pairs that are actually the same issuer under slightly different names (that's a data-quality duplicate, not a sector-affinity case).

**Strength: fixed `0.3`.** Two different companies in the same industry aren't the same bet, but a sector-wide shock (a rate move, a regulatory change) hits both — meaningfully more than a tangential cross-class affinity, well short of an exact issuer match.

### 7.2 Tier 1 — Exact issuer match *(cross-class only)*

`normalizeIssuer(name1) === normalizeIssuer(name2)`, both non-empty, across two **different** asset classes (e.g. "Reliance Industries" equity + a "Reliance" bond). `normalizeIssuer()` strips common corporate/instrument-type suffixes (ltd, limited, bank, corp, bond, fund, trust, reit, invit, fd, sgb, bees, …) via regex — a best-effort match, not a canonical issuer registry.

**Strength: `1.0`** — this is the same company; full overlap.

### 7.3 Tier 2 — Mutual fund look-through *(cross-class only)*

One side is `MUTUAL_FUND`, the other is `EQUITY` or `BOND`. The fund's name is normalized (`normalizeFundKey()` — strips fund/scheme/plan/direct/regular/growth/dividend/idcw noise words) and looked up in the curated `MUTUAL_FUND_TOP_HOLDINGS` (§5.2). If found and it discloses a holding matching the other side's issuer:

**Strength: the fund's curated disclosed `weightPct / 100`** (e.g. HDFC Flexi Cap Fund → HDFC Bank, ~8.9%). A fund not in the curated list contributes nothing here (never guessed).

### 7.4 Tier 3 — Curated keyword affinity *(cross-class only)*

One side is `EQUITY`, the equity holding's name matches a keyword in `KEYWORD_SECTOR_AFFINITY` (§5.2), and that keyword's affinity map has an entry for the other side's asset class.

**Strength: the curated value**, currently:
- Jewelry retailers (Titan, Kalyan Jewellers, PC Jeweller, Senco Gold, Tribhovandas, Thangamayil, Joyalukkas, Malabar Gold) → GOLD `0.25`, SILVER `0.15`
- Mining/metals (Vedanta, Hindustan Zinc, Hindalco, Nalco, National Aluminium) → SILVER `0.1`

### 7.5 Tier 4 — Broad NSE industry affinity *(cross-class only)*

One side is `EQUITY` and carries a `.sector` (NSE broad Industry classification), and that sector has an entry in `INDUSTRY_ASSET_CLASS_AFFINITY` (§5.2) for the other side's asset class.

**Strength: the curated value**, currently:
- Realty → REIT `0.3`, INVIT `0.15`
- Construction → INVIT `0.2`
- Construction Materials → INVIT `0.15`
- Metals & Mining → GOLD `0.1`, SILVER `0.1`
- Power → INVIT `0.1`

### 7.6 Tier 5 — Sectoral mutual fund ↔ matching-sector equity *(cross-class only)*

One side is `EQUITY` with a `.sector`, the other is `MUTUAL_FUND` with a `.sector` (the curated Sectoral/Thematic tag from `MUTUAL_FUND_SEGMENT_KEYWORDS`, §5). The fund's sector is translated via `MF_SEGMENT_TO_NSE_INDUSTRY` (§5.2) to the matching NSE Industry label(s); if the equity's sector is among them, the pair connects.

Deliberately **not** an extension of Tier 4's `INDUSTRY_ASSET_CLASS_AFFINITY` table: that table's `[sector][assetClass] → weight` shape assumes the target asset class is itself sector-homogeneous (true for GOLD/SILVER/REIT/INVIT — *every* REIT is real-estate-ish), which a mutual fund is not (an "Automobile" stock and an arbitrary mutual fund the same user holds could be a Banking fund, a broad index fund, anything). Reusing that table's shape for MUTUAL_FUND would have wrongly connected an equity to *any* fund the user holds, regardless of the fund's actual theme — so this tier instead compares both sides' own sector tags directly.

**Strength: fixed `0.15`** — below Tier 0's same-class `0.3` (two individual stocks in one sector), since a sectoral fund spreads its sector bet across many companies, not just the one the user also holds directly.

Currently mapped (via `MF_SEGMENT_TO_NSE_INDUSTRY`): Realty, Financial Services, Healthcare, Information Technology, Automobile, Energy (→ Oil Gas & Consumable Fuels + Power), FMCG & Consumption. Other MF segments (Infrastructure, PSU, Manufacturing, Transportation & Logistics) are deliberately left unmapped for the same "don't guess" reason as §5.2.

### 7.7 Aggregation: two separate shares, kept apart on purpose

```
for every pair (i, j) with a detected connection:
    pairValue = min(value_i, value_j) × strength     # capped at the smaller position
    if same class:  add to sameClassOverlapByClass[class]
    else:            add to crossClassOverlapValue

# same-class total is capped PER CLASS at that class's own total value —
# so it can never exceed the weight that asset class represents
sameClassOverlapValue = Σ_class min(sameClassOverlapByClass[class], classTotalValue[class])

overlapShare          = clamp(crossClassOverlapValue / totalValue, 0, 1)   # → discounts Real (§6.1)
sameClassOverlapShare = clamp(sameClassOverlapValue  / totalValue, 0, 1)   # → discounts Name  (§6.2)
```

Every detected connection (both tiers) is also returned as a human-readable `Connection { a, b, strength, reason }` — rendered on the **Score Breakdown** screen under "Why real is below apparent" so the user sees the reasoning, not just the number.

### 7.8 Cross-Asset vs. Same-Asset — Summary Table

| Consideration | Applies between | Trigger | Strength | Feeds |
|---|---|---|---|---|
| Same sector, same class | EQUITY↔EQUITY, MUTUAL_FUND↔MUTUAL_FUND (Sectoral/Thematic only), CRYPTO↔CRYPTO (curated segments only) | equal, non-empty `.sector` on both sides; not the same issuer | **0.3** (fixed) | `sameClassOverlapShare` → Name Diversification (§6.2), capped per-class at that class's portfolio weight |
| Exact issuer match | Any two *different* classes | `normalizeIssuer()` equal on both sides | **1.0** | `overlapShare` → Real Diversification (§6.1) |
| MF look-through | MUTUAL_FUND ↔ (EQUITY or BOND) | fund in curated top-holdings list, discloses the other side's issuer | curated **~3–9%** | `overlapShare` |
| Keyword affinity | EQUITY ↔ any non-equity class | equity name matches a curated keyword | curated **0.1–0.25** | `overlapShare` |
| Broad industry affinity | EQUITY ↔ any non-equity class | equity's NSE sector matches a curated industry entry | curated **0.1–0.3** | `overlapShare` |
| Sectoral MF ↔ matching-sector equity | EQUITY ↔ MUTUAL_FUND | both sides' own sector tags match, via `MF_SEGMENT_TO_NSE_INDUSTRY` | **0.15** (fixed) | `overlapShare` |

**Asset-class coverage for the same-sector tier today:** EQUITY (full NSE Nifty 500 coverage), MUTUAL_FUND (Sectoral/Thematic funds only), CRYPTO (curated 10-segment coverage only). **Not yet covered:** BOND, GOLD, SILVER, REIT, INVIT, ETF, FD, ULIP_INSURANCE — no free classification source has been found/wired for these; same-class connections silently don't fire for them (fails soft, never guesses).

### 7.9 Frontend display: X-Ray's "True exposure" view vs. this model

`XRay.jsx`'s deep/company-level donut is **not** built from this section's tiered model — it's a much simpler client-side grouping in `diveEngine.js`'s `companyExposure()`, which only sees each holding's own `lookthrough` field. For a real (non-mutual-fund) holding, `adaptHolding()` sets that to a flat `[{ company: itsOwnName, pct: 100 }]` — there is no client-side equivalent of the MF top-holdings look-through (§7.3), keyword affinity (§7.4), industry affinity (§7.5), or same-sector (§7.1/§7.6) tiers. So the donut only ever catches the exact-issuer-name-across-segments case (roughly §7.2), never the richer tiers.

Left alone, this meant X-Ray's "You're actually X% in one company" claim could silently disagree with the real, canonical `realDiversificationPct` shown on Home/Score Breakdown for the exact same portfolio — understating real concentration whenever a genuine overlap only this model's richer tiers (§7.1, §7.3–§7.6) could see.

**Fixed 2026-08-17:** rather than trying to rebuild the donut itself around this model's tiered strengths (each `strength` is a partial, weighted overlap estimate, not a hard "these are the same bucket" fact — forcing that into rigid donut slices would itself overclaim a precision that doesn't exist), X-Ray now also fetches `scoreBreakdown.connections` (the same real, per-pair `{reason, strength}` data already trusted for `realDiversificationPct` and rendered on Score Breakdown's "Why real is below apparent", §7.7) and shows it directly underneath the deep-view donut whenever the backend detected something the name-only grouping couldn't. Suppressed while a what-if simulation (`sims`) is active, since `connections` describes the real saved portfolio, not a hypothetical one. See `frontend/src/screens/XRay.jsx`'s `realOverlaps` and the `xray-real-overlaps` test id.

## 8. Resilience Sub-Scores

Computed from the portfolio's weighted daily-return series (`portfolioReturns[t] = Σ weight_h × return_h[t]`, aligned to the shortest common history across holdings, capped at 252 trading days).

| Sub-score | Metric | `scoreFromRange(value, worstAt, bestAt)` | Notes |
|---|---|---|---|
| **Volatility** | Annualized stdev of portfolio returns (`stdev × √252`) | worst @ **persona-dependent** (28%–55%), best @ 3% | Lower is better. **Persona-adjusted (Layer C+D):** risk CAPACITY (not just tolerance) scales with time horizon — the "worst" threshold is further out for personas with more time to recover. See §12.2's table for the per-persona value; "best" (3%) is unchanged across personas — low volatility is good for everyone. |
| **Drawdown** | Max peak-to-trough decline of a simulated ₹100-indexed portfolio value over the window | worst @ **persona-dependent** (−35% to −70%), best @ −2% | Same persona-adjustment as Volatility, same reasoning. If the drawdown hadn't recovered by the end of the observed window, an additional 15-point penalty is applied (floored at 0). |
| **VaR (Value at Risk)** | 5th-percentile historical daily return (historical simulation, not parametric) | worst @ −8%, best @ −0.5% | 1-month VaR is a `√21` parametric scaling of the 1-day figure, not an independent empirical simulation — a standard but approximate extension. Not yet persona-adjusted (see §13 limitations). |
| **Liquidity** | Value-weighted average of a per-asset-class liquidity tier (see table below) | — | Not a per-instrument model |
| **Beta** | Value-weighted average of each holding's beta vs. Nifty 50 (real regression `betaAgainst()` for real-priced holdings, `assumedBeta` from `SYNTHETIC_PARAMS` for synthetic ones) | worst @ 1.8, best @ 0.2 | Lower market sensitivity scores higher |
| **Correlation** | **Value-weighted** average pairwise Pearson correlation across asset-class-level (not per-holding) return series, for classes present — each pair weighted by the product of the two classes' portfolio shares, so a correlation between two classes that dominate the portfolio matters more than one between two minor slivers | worst @ 1.0, best @ −0.2 | **If only one asset class is present:** 20 (not neutral 50) if the Context Engine (§12) expects more than 1 class for this user — a real diversification gap. **50 (neutral)** if the Context Engine says 1 class is exactly what's expected right now (e.g. a Starter-corpus portfolio) — not a mistake to punish. |
| **Diversification Ratio** | `(value-weighted average of each holding's own annualized vol) / (portfolio's annualized vol)` | worst @ 1.0, best @ 2.2 | A ratio near 1 means diversification isn't smoothing anything (holdings move together); higher means the portfolio genuinely benefits from combining imperfectly-correlated pieces |

### 8.1 Persona-adjusted risk-capacity thresholds

| Persona | Volatility worst-at | Drawdown worst-at |
|---|---|---|
| Early Career | 55% | −70% |
| Building Phase | 50% | −65% |
| Peak Earning | 45% | −60% (the model's original, persona-blind default) |
| Pre-Retirement | 35% | −45% |
| Retired/Senior | 28% | −35% |

Sourced from `contextEngine.ts`'s `PersonaBracket.volatilityWorstAt`/`drawdownWorstAt` — reasoned, not empirically fitted (same caveat as every other illustrative constant in this document): the ordering (younger → higher tolerance) reflects standard life-cycle investing principle (time horizon determines recovery capacity), not a study of actual investor behavior.

**Liquidity tiers** (0 illiquid/locked-up → 100 liquid, exit anytime near fair value):

| Class | Score | Class | Score |
|---|---|---|---|
| CRYPTO | 95 | REIT | 60 |
| EQUITY | 95 | INVIT | 55 |
| ETF | 90 | BOND | 50 |
| GOLD | 75 | ULIP_INSURANCE | 20 |
| MUTUAL_FUND | 70 | FD | 15 |
| SILVER | 65 | PF | 8 |

PF sits below FD, not tied with it: FD is breakable any time (with an interest penalty) — full principal access is never in question. PF has no such unconditional exit — PPF's 15-year hard lock (partial withdrawal only from FY7, capped at 50% of the balance 4 years prior) and EPF's retirement/2-month-unemployment/purpose-specific-after-12-months gating are both strictly worse than a breakable FD. Not 0 — real, if narrow, partial-access routes exist (PPF's year 3-6 loan facility, EPF's purpose-based partial withdrawals).

## 9. Composite Score

```ts
DIVE_SCORE_V2_WEIGHTS = {
  concentration: 0.17,
  volatility: 0.12,
  drawdown: 0.12,
  var: 0.08,
  liquidity: 0.12,
  beta: 0.08,
  correlation: 0.08,
  diversificationRatio: 0.04,
  contextFit: 0.11,
  stockCountFit: 0.08,
}   // sums to 1.00
```

`contextFit` (Layer D, §12) and `stockCountFit` (§6.5) each took a proportional slice from every existing weight rather than replacing one specific dimension — both are genuinely new, orthogonal signals, not a substitute for any resilience math.

```
compositeScore = clamp( round( Σ weight_i × subScore_i.score ), 0, 100 )
```

## 10. API Response Shape

`GET /api/score/breakdown` returns (`DiveScoreBreakdown` in `diveScoreService.ts`):

- `hasHoldings`, `compositeScore`, `weights`
- `apparentDiversificationPct`, `realDiversificationPct`, `connections[]`
- `subScores` — all 10 (including `contextFit` and `stockCountFit`), each `{ score, value, label }`
- `drawdownDetail`, `varDetail`, `correlationMatrix` (`{ labels, matrix }`, one row/column per asset class present)
- `dataQuality` — `realPriceCoveragePct`, `marketFactorIsSynthetic`, per-holding `{ name, assetClass, isSynthetic, label }`
- `context` (Layer D, §12) — `{ corpusTier: {id, label, reasoning}, persona: {id, label, reasoning}, expectedAssetClasses[], missingExpectedAssetClasses[] }`

## 11. Frontend Fast-Path (`diveEngine.js`)

**Scope: hypothetical/unsaved states only** — the Suggestions screen's "simulate this change" slider and stress-test scenarios, and the pre-login Onboarding preview (`Onboarding.jsx`, before any server session exists). Never used to display a score for real, saved holdings.

`diveScore(holdings, extra)` mirrors §6's concentration formula and weights exactly:

```
apparentDiversification (segment-level HHI) × 0.65
+ realDiversification (single flat 1.0-strength issuer-match only — no MF/keyword/industry/same-sector tiers, no sector data) × 0.15
+ nameDiversification (name-level HHI) × 0.20
```

**Important limitation, by design:** this client formula has no resilience math at all — no volatility, drawdown, VaR, beta, correlation, or liquidity, because those require real historical price series only the backend can fetch/compute. It is effectively *just* the concentration piece, standing in for the full composite when instant feedback matters more than full accuracy.

`Suggestions.jsx`'s `SimulateSheet` and `AskDive.jsx`'s `FitForYouCard` both reconcile this by anchoring on the real backend number and using the client formula only to estimate the *size of a change*, scaled by concentration's own share of the real composite:

```
before        = scoreBreakdown.compositeScore                       // real, full composite
rawDelta      = diveScore(hypothetical) - diveScore(baseline)        // concentration-only estimate, on ITS OWN 100-point scale
scaledDelta   = rawDelta * scoreBreakdown.weights.concentration      // proportional to concentration's real weight (0.17)
after         = clamp(before + scaledDelta, 0, 100)
```

**Why the scaling exists (added 2026-08-04):** `rawDelta` lives on the concentration formula's own 0-100 scale, but concentration is only one of ~10 sub-scores in the real composite (`DIVE_SCORE_V2_WEIGHTS.concentration = 0.17`) — none of the others (volatility/liquidity/correlation/VaR/contextFit/...) move in this quick estimate at all. Adding `rawDelta` to `before` 1:1 (the original approach) overstated the effect badly: a single large simulated addition against a concentrated existing portfolio can swing `rawDelta` by dozens of points (the concentration HHI math produces a hump-shaped delta curve that peaks when the new addition becomes roughly comparable in size to the existing dominant holding), dragging an anchor as low as 45-60 up toward 95-100+ even though nothing about real volatility, liquidity, or correlation had changed. Scaling by `weights.concentration` keeps the estimate proportional to concentration's actual share of the real score and is self-bounding to roughly ±17 points by construction, since `rawDelta` itself is bounded to [-100,100]. `AskDive.jsx`'s slider range (`sliderMax`) was also changed from an unbounded `Math.max(100000, total, simAmount)` (which grew to match whatever value was dragged to) to `Math.max(100000, total * 2)`, as a secondary UX sanity bound. See §13.1 for why a full resilience-inclusive live simulation wasn't built instead.

So the absolute anchor is always accurate; only the magnitude of a simulated change is a concentration-only approximation, now correctly weighted down to its real share of the composite. Note this client-side delta also doesn't reflect Layer D (§12) — `contextFit` and the softened correlation floor are backend-only, so a simulated change's estimated delta doesn't move for context reasons, only for concentration ones.

**"Close the apparent-vs-real gap" card — same X-Ray-class bug (§7.9), fixed 2026-09-01:** this `WhatIfSheet` card shows Real Diversification % (`before`) and what it becomes once cross-segment overlap hits 0% (`after`) — mathematically exactly `apparentDiversificationPct`, since `realDiversificationPct = apparent × (1 − overlapShare)` and overlapShare = 0 makes real == apparent by construction (§6.1). It originally computed both from this screen's own local `apparentDiversification(h)`/`realDiversification(h)` (diveEngine.js), which only detects overlap via a crude match on each **holding's own name** (`crossSegmentOverlaps`) — not the backend's real lookthrough/connectedness engine (§7's tiered model: MF top-holdings, keyword affinity, industry affinity, same-sector). A user genuinely saw Home's canonical tiles read Apparent 70% / Real 69% while this card showed 70/70 (no gap at all) for the identical portfolio — the backend caught a real cross-class connection this screen's local heuristic couldn't see. Fixed the same way §7.9 fixed X-Ray's donut: anchor on `scoreBreakdown.apparentDiversificationPct`/`realDiversificationPct` when available (`hasHoldings: true`), falling back to the local calc only when no canonical score exists yet. See `buildRealScenarios()`'s `canonicalApp`/`canonicalReal`.

### 11.1 Market Stress Test (added 2026-09) — a second, DIFFERENT derived metric: "resilience score"

`Suggestions.jsx`'s "Run Stress Test" button (distinct from "What If," §11's `WhatIfSheet` above, which replays hypothetical portfolio FIXES, not market moves) shows how a new derived **resilience score** — NOT the main DIVVE Score — would move under three named market-shock scenarios: Geopolitical Tension, Rate Hike, Sector Crash.

**Resilience score baseline** — a weighted blend of the 5 REAL backend sub-scores that actually respond to a market-VALUE shock:
```
RESILIENCE_DIMS = [volatility, drawdown, var, beta, correlation]
dimWeightSum    = Σ scoreBreakdown.weights[dim] for dim in RESILIENCE_DIMS   // ≈0.48 of DIVE_SCORE_V2_WEIGHTS' 1.00
resilienceScore = round(Σ (weights[dim]/dimWeightSum) * subScores[dim].score)
```
Deliberately excludes: `liquidity` (exit-ability, doesn't move on a price shock), `concentration` (already the direct input to the Sector Crash scenario below — including it too would double-penalize a concentrated portfolio), `diversificationRatio` (backward-looking correlation-smoothing measure, not shock-responsive), and `contextFit`/`stockCountFit` (life-stage/breadth fit, not shock-responsive). Weights are read from `scoreBreakdown.weights` at runtime, not hardcoded, so this stays correct automatically if `DIVE_SCORE_V2_WEIGHTS` is ever rebalanced — same principle as `concentrationWeight` above.

**Per-category sensitivity** — keyed to the 10 `CORE_CATEGORIES` labels (not the 12-way backend enum), each value = fraction of that category's portfolio weight "at risk" (negative = a genuine benefit). Magnitudes anchored to the already-cited betas in `SYNTHETIC_PARAMS` (§4.2), not asserted from scratch. Merged categories (Gold/Silver, REIT/InvIT) use the plain arithmetic mean of their two constituents (a market-share-weighted blend would need an unverifiable ratio this codebase has no source for):

| Category | Geopolitical | Rate Hike |
|---|---|---|
| Equity | 0.35 | 0.25 |
| Mutual Funds | 0.26 | 0.19 |
| ETF | 0.32 | 0.22 |
| Bonds | 0.08 | **0.55** |
| Gold/Silver | **−0.09** | 0.17 |
| REIT/InvIT | 0.17 | 0.43 |
| Insurance | 0.12 | 0.20 |
| FD | 0 | 0 |
| PF | 0 | 0 |
| Crypto | 0.45 | 0.50 |

Geopolitical: Equity anchored to India's recurring oil-import-driven geopolitical corrections (1991 Gulf War, 2022 Ukraine war, 2023-24 Middle East flare-ups); Mutual Funds/ETF scaled by their own `SYNTHETIC_PARAMS` beta ratio vs. Equity; Gold/Silver negative per the World Gold Council-cited safe-haven property `SYNTHETIC_PARAMS.GOLD` already documents; Crypto highest, citing the SAME Corbet/Meegan/Larkin/Lucey/Yarovaya 2018 and Baur & Dimpfl 2021 sources `SYNTHETIC_PARAMS.CRYPTO` cites for "occasional stress spikes" (this IS that stress case, not the calm-period low correlation its beta of 0.3 describes). Rate Hike: a different channel (duration/valuation, not equity-beta) — Bonds highest via the textbook duration/price-yield relationship; REIT/InvIT next (yield-competing, financing-cost-sensitive); Gold/Silver flips positive (real-rate/opportunity-cost channel); Crypto high, citing its real 2022 hiking-cycle drawdown. **FD/PF are 0 in BOTH scenarios**, confirmed consistent with `SYNTHETIC_PARAMS.FD.beta`/`SYNTHETIC_PARAMS.PF.beta` both being `0` — neither is marked-to-market, so a shock doesn't change an already-locked holding's current value (only new deposits/contributions earn differently going forward, a forward-looking effect this isn't modeling). PF's slightly higher long-run *volatility* in `SYNTHETIC_PARAMS` reflects a separate, multi-year phenomenon (periodic government rate revisions), not an acute shock, so it doesn't conflict with 0 here.

**Sector Crash** reuses the same lookthrough data `topExposure()` already computes (§16.2/`SimulateSheet`'s "Top exposure" card) — but restricted to categories where a real single-business collapse is a coherent risk: Equity, Mutual Funds, ETF, REIT/InvIT, Crypto. Bonds/Gold-Silver/FD/PF/Insurance are excluded — their lookthrough uses generic non-company placeholders (`"Gold"`, `"Govt / Bank"`, `"EPFO / Govt"`, see `SIM_TEMPLATES`) that don't represent real business/credit risk the way an equity issuer does. A portfolio dominated by one of these excluded categories (e.g. all-gold) correctly resolves to ~0 Sector Crash sensitivity — not a fall — the financially honest answer, and *unrelated* to whatever Geopolitical Tension shows for the same portfolio (different risk vectors; a gold-heavy portfolio can show a Geopolitical *improvement* and a Sector Crash *no-change* simultaneously, which is correct, not contradictory).
```
sensitivity = (topExposure(equity/MF/ETF/REIT-InvIT/crypto-only holdings).pct / 100) * 0.6
```
Severity `0.6`: real Indian single-stock/sector collapses span roughly 50-90% peak-to-trough (Yes Bank ~−85% single-day 2020, Adani Group ~−50 to −60% over days in Jan 2023, Satyam fraud ~−78% single-day 2009, IL&FS/DHFL debt-sector collapse >90%) — `0.6` sits in the moderate-severe part of that range, below the most extreme idiosyncratic fraud/governance-collapse cases (not what a named, repeatable scenario should represent), above a routine correction.

**Delta formula** — one shared `maxSwing` across all three scenarios, not three separately-tuned constants (would mean re-deciding "how severe is this scenario" twice):
```
delta = -weightedSensitivity * 100
after = clamp(round(resilienceScore + delta), 0, 100)
```
Self-bounding by construction: every sensitivity value above is ≤0.55 in magnitude and category weights always sum to 1.0, so the realistic swing range is roughly [−12, +55] points without an extra clamp beyond the final floor/ceiling — mirrors the "self-bounding by construction" property already noted above for `rawDelta`.

Cards use conditional coloring (green if `after > before`, red/amber if `after < before`, neutral if flat) rather than hardcoded red, since a Gold/Silver-heavy portfolio can genuinely improve under Geopolitical Tension — a real outcome, not a bug.

## 12. Layer D — Context Engine

`backend/src/services/contextEngine.ts`. Prevents the score and its messaging from ever penalizing someone for something that doesn't make sense at their situation — the direct fix for "₹10,000 in 3 equity stocks is not a problem worth flagging." Two independent dimensions:

- **Corpus tier** (from `totalInvestedAmount`, reusing the same `totalValue` already computed for the rest of the score) — governs *how many* classes it's practical to expect, since many classes have real per-ticket minimums (SGB ~₹6,000+, ULIP premiums ₹12,000–24,000+/year) that make spreading a small amount thin both wasteful and sometimes infeasible.
- **Persona bracket** (from the User's `age`) — governs *which* classes make sense first (a 25-year-old and a 65-year-old with the same corpus should be nudged toward different mixes), and is only consulted for ordering — it never permanently excludes a class, since a large-enough corpus tier count eventually pulls in every class regardless of persona.

### 12.1 Corpus tiers

| Tier | Range | Expected class count | Reasoning |
|---|---|---|---|
| Starter | < ₹25,000 | 1 | Splitting into even 2 classes means one gets well under ₹12,500 — below a single SGB unit or a typical ULIP's minimum annual premium, and thin enough elsewhere that brokerage/entry costs eat a large share of the ticket. One well-chosen, liquid, low-minimum class (equity, or an MF SIP) is the complete, sensible picture — not a shortfall. |
| Growing | ₹25,000–₹2,00,000 | 3 | Comfortably supports 3 classes at ₹8,000+ each even at the low end. |
| Established | ₹2,00,000–₹10,00,000 | 5 | Meaningful (₹20,000–40,000+) ticket sizes — room for a first ULIP/insurance commitment or a REIT/InvIT slice. |
| Substantial | ₹10,00,000–₹50,00,000 | 8 | Even a 1/8th equal slice (₹1.25L–6.25L) clears every class's practical minimum. |
| Large | ₹50,00,000+ | 12 | Every class is achievable at a meaningful ticket size — skipping one is a deliberate choice, not a constraint. |

### 12.2 Persona brackets

| Persona | Age | Priority classes (in order) | Deprioritized | Reasoning |
|---|---|---|---|---|
| Early Career | 18–28 | EQUITY, MUTUAL_FUND, GOLD, CRYPTO | FD, BOND, ULIP_INSURANCE, REIT, INVIT, PF | Longest time horizon, fewest dependents — the main resource is time, which growth assets compound. PF is deprioritized alongside every other lock-in class here even though EPF is often already accruing passively via payroll at this age — that existing balance still gets entered and scored regardless; deprioritizing it just means the app doesn't actively nudge toward a NEW voluntary PPF/VPF commitment this early. |
| Building Phase | 29–40 | EQUITY, MUTUAL_FUND, GOLD, BOND, PF | ULIP_INSURANCE, REIT, INVIT | Still growth-oriented; rising responsibilities make a first slice of debt reasonable — a first deliberate PPF/VPF top-up is a reasonable, tax-advantaged debt decision alongside it by this stage. |
| Peak Earning | 41–55 | EQUITY, MUTUAL_FUND, BOND, PF, FD, GOLD, REIT, INVIT | — | Highest capacity of any stage — the broadest priority list. PF sits ahead of FD: this bracket is most likely in the highest tax slab, where PF's EEE edge over FD's fully-taxable interest matters most. |
| Pre-Retirement | 56–64 | BOND, FD, MUTUAL_FUND, PF, GOLD, ULIP_INSURANCE, EQUITY | CRYPTO | Preservation rises sharply in importance as the horizon shortens; debt/insured instruments should meaningfully lift the score now. PF is deliberately placed AFTER Mutual Funds, not before: a fresh PPF opened at 56–64 doesn't mature for 15 years — a real mismatch for this persona's shortening horizon — so it shouldn't outrank more liquid, immediately-practical preservation options. |
| Retired/Senior | 65+ | FD, BOND, ULIP_INSURANCE, GOLD, MUTUAL_FUND, EQUITY | CRYPTO | Preservation and income dominate; a smaller equity sleeve remains reasonable since retirement can span decades. PF is deliberately left off both lists (falls through to `DEFAULT_CLASS_ORDER` instead, landing as this persona's 7th expected class at the Substantial tier) — no new payroll EPF at this stage for most users, and a fresh 15-year PPF lock is a poor fit for a retirement-drawdown horizon; any existing EPF balance still gets entered and scored regardless. |

Each persona also carries `volatilityWorstAt`/`drawdownWorstAt` risk-capacity thresholds, used by the Volatility/Drawdown sub-scores — see §8.1 for the full table and reasoning.

### 12.3 Expected Asset Class Set

```
ordered = persona.priorityClasses
        + DEFAULT_CLASS_ORDER (excluding persona.deprioritizedClasses)
        + persona.deprioritizedClasses   // only reached if the corpus tier's count needs this many
expectedAssetClasses = ordered.slice(0, corpusTier.expectedClassCount)
```

A large corpus tier count (up to 12) will eventually pull in even a persona's deprioritized classes — deprioritization only affects *order*, never permanent exclusion, matching "large corpus + any age → expected set approaches all 12."

### 12.4 How it feeds the score

- **`contextFit` sub-score** (new, §9): `round(100 × min(1, expectedClassesHeld / expectedAssetClasses.length))` — 100 once every expected class is held, capped at 100 so exceeding expectations is never penalized, never negative so falling short is graded proportionally.
- **Correlation floor softened** (§8): a single-class portfolio scores 20 (genuine gap) unless the Context Engine says 1 class is exactly what's expected, in which case it scores a neutral 50.
- **Deliberately NOT touched:** `apparentDiversificationPct`/`realDiversificationPct` and the core HHI math (§6) — those stay a pure, context-free measurement of actual spread. Context only adjusts `contextFit` and the correlation floor, both new/isolated levers, so the well-tested apparent-≤-real invariant and look-through model are untouched.
- **Considered and explicitly rejected: re-scaling Apparent Diversification's own ceiling against `expectedAssetClasses.length`** (e.g. `100 × (1-classHhi) / (1 - 1/expectedCount)`, so hitting exactly your own expected set reads as 100%). Worked through with real comparative numbers across several tiers — it does what it promises (e.g. 3-of-3 expected classes, evenly split, would read 100% instead of 67%) — but rejected because **"100%" reads as an absolute claim of full diversification, and a user can't tell that apart from someone who actually holds all 12 classes evenly.** It risks overconfidence — nudging someone to stop growing their portfolio's class coverage because the number told them they're "done." `contextFit` and the correlation floor already carry the "you're doing well for your stage" signal *without* overwriting the honest, absolute "Apparent Div. %" stat shown on Home/Score Breakdown — that number stays a plain fact, not a relative grade.

### 12.5 Messaging module

`frontend/src/lib/contextMessaging.js` — reusable, not ad-hoc per-screen strings:

- `contextSummaryMessage(context)` — reassurance ("your mix is a solid, complete starting point...") when nothing expected is missing, or a scoped nudge ("...Mutual Funds would be worth adding next") when something is. Rendered on `Suggestions.jsx` (banner) and `ScoreBreakdown.jsx` ("Your situation" card).
- `isCategoryExpected(categoryLabel, context)` / `expectedCoreCategories(context)` — maps the backend's 12-way `expectedAssetClasses` down to the 10 `CORE_CATEGORIES` `Suggestions.jsx` operates on.
- `deferredIncreaseNote(...)` / `deferredReduceNote(...)` — per-category copy used in `Suggestions.jsx` to replace a generic "Add to X" or "Trim X" nudge when it doesn't make sense yet:
  - An `increase` suggestion is deferred when the category isn't in the expected set.
  - A `reduce` suggestion is deferred when the category is the user's *sole* expected class — e.g. "Trim Equity to 25–35%" is nonsensical for a Starter-tier user whose entire expected set **is** equity, since the generic ideal range assumes a multi-class split that isn't realistic yet.
- `Home.jsx`'s "missing category" insight is similarly gated — it only fires the "you haven't added any X" warning when X is actually expected; otherwise it shows the reassuring summary instead.

## 13. Known Limitations & Coverage Gaps

### 13.1 Considered for later — deferred, not forgotten

A broader audit (2026-07-30) proposed a fuller "per-class quality" model across all 11 asset classes (at the time; a 12th, PF, was added later — see §15 changelog), plus a per-class point-ceiling architecture. Some pieces were built (§6.3's CRYPTO/FD/EQUITY adjustments, §8.1's persona-adjusted risk thresholds); the rest were deliberately deferred or rejected, for the specific reasons below — not simply unstarted.

**Deferred — genuinely valuable, but blocked on data this app has no free source for yet:**

| Class | What was proposed | Why it's not built now |
|---|---|---|
| MUTUAL_FUND / ETF | Fund-count band (mirroring §6.5's equity stock-count band); category spread beyond Sectoral/Thematic (Large Cap vs. Flexi Cap vs. Debt vs. International); expense ratio as a quality signal | No structured, free source distinguishes fund category beyond what AMFI's Sectoral/Thematic header already gives (§5); expense ratios aren't published in any machine-readable free feed AMFI/fund houses expose |
| BOND | Credit-quality mix (AAA vs. junk), duration spread, government vs. corporate mix | No free, machine-readable Indian corporate bond credit-rating or duration source exists — CRISIL/ICRA/CARE ratings are published per-issue on paywalled or non-structured pages, not a bulk feed |
| REIT / INVIT | Sector within the class (commercial/industrial/road/power) | India has only a handful of listed REITs/InvITs — feasible to hand-curate (like `mutualFundTopHoldings.ts`) rather than needing a live source, but not yet built; distinct-trust-count is already partially captured by the existing within-class HHI |
| GOLD / SILVER | Form matters (SGB / digital gold / physical / ETF have different liquidity & cost profiles) | No `form` field exists on `Holding`/`Instrument` today — this needs a new user-facing input (a dropdown at holding-entry time), not just a data-sourcing problem, so it's a small UI + schema project, not a scoring-engine change |
| ULIP_INSURANCE | Distinguish pure-protection value from investment-linked value; weight investment-linked ULIPs by their underlying fund's actual diversification | Needs either a new user-entered field or a mapping from insurer product codes to protection/investment splits — no free structured source exists, and it's a smaller asset class in most portfolios, lowering priority |
| VaR (Value at Risk) | Persona-adjust the VaR threshold the same way Volatility/Drawdown were (§8.1) | Deferred only for scope in this pass, not for a data reason — the same reasoning (risk capacity scales with horizon) applies here too; a natural next small addition |
| Full resilience-inclusive live simulation | Compute the complete, real backend composite score (all sub-scores, not just concentration) for a hypothetical holding in Suggestions'/Ask DIVVE's "what-if" sliders, instead of anchoring on the real score and adding a concentration-only estimated delta (§11) | `computeDiveScoreBreakdown(userId)` isn't parameterized for a hypothetical holdings array — it queries `Holding.find({userId})` directly; a simulated instrument (especially one the user hasn't actually bought, e.g. a specific mutual fund from Ask DIVVE) would need a live price/return fetch per drag tick to compute volatility/drawdown/VaR/correlation, which is both slow and rate-limit-fragile (MFAPI/CoinGecko/Yahoo are free community sources, not SLA-backed); recomputing the full correlation matrix and drawdown series on every slider tick is expensive; and continuous-drag slider UX is fundamentally incompatible with a per-tick backend round-trip. The 2026-08-04 fix (scaling the concentration-only delta by its real composite weight) is the interim mitigation — a possible future enhancement is an on-demand "Compute exact score" button that accepts the latency of one real backend call, rather than trying to make every slider tick exact |

**Rejected — considered, not just skipped, for a specific reason:**

- **Layer A — a per-asset-class point-ceiling architecture** (e.g. "Equity capped at 30/100 points, Gold at X, summing to 100, zero credit if not held"). This solves the same problem `apparentDiversificationPct` (cross-class HHI, §6) already solves — "don't let one class's internal quality inflate the whole score" — via a fundamentally different, incompatible architecture (dimension-weighted composite vs. per-class point budget). Building it would mean maintaining two parallel, potentially-disagreeing concentration mechanisms, for a benefit the HHI approach already delivers more elegantly (no hand-picked ceiling numbers to defend; HHI naturally scales with actual concentration). Rejected as redundant, not merely deferred.
- **A separate multiplicative "Resilience Multiplier"** applied on top of concentration/correlation/volatility, instead of blending them into the same weighted sum as every other dimension. This is different packaging of the same idea already in place (weighted contributions), not new signal — and a multiplicative dampener needs its own bounding logic (staying in, say, 0.7×–1.1×) that the existing additive weighted-sum + `clamp(0,100)` already handles more simply.
- **Context-normalizing `apparentDiversificationPct`/`realDiversificationPct` against the Layer D expected-class-count** (documented in §12.4) — worked through with real comparative numbers, rejected because "100% Apparent Diversification" reads as an absolute claim a user can't distinguish from genuine full diversification, risking overconfidence.

### 13.2 Existing gaps

- **Same-sector connectedness** (§7.7) is only wired up for EQUITY, MUTUAL_FUND (Sectoral/Thematic only), and CRYPTO (curated segments only) — BOND, GOLD, SILVER, REIT, INVIT, ETF, FD, ULIP_INSURANCE have no classification source yet.
- **Curated constants are judgment calls, not calibrated outputs.** Connection strengths (0.3 same-sector, 0.25 jewelry-gold, etc.), sub-score weights, and the stock-count band's anchor points (§6.5) are reasoned but not backtested against realized portfolio outcomes or historical correlations. The synthetic `SYNTHETIC_PARAMS` betas (§4.2) are now grounded in cited, qualitative asset-allocation relationships rather than arbitrary, but they're still not fitted to a specific correlation study or dataset — treat the *sign and relative ordering* as the trustworthy part, not the exact decimal value.
- **No live/fetched correlation matrix exists.** Real-priced classes get genuine empirical correlation from actual return series; synthetic classes' correlation with each other is entirely a byproduct of each one's fixed beta against the same shared Nifty factor (§4.2) — this can't reproduce richer relationships a real multi-asset correlation matrix would show (e.g. bond-gold correlation, which this model has no direct mechanism for at all, only indirectly through their shared beta to equity).
- **Most non-equity resilience math rests on synthetic assumptions**, not real price history — honestly disclosed via `dataQuality.realPriceCoveragePct`, but for a typical mutual-fund-heavy Indian retail portfolio, a large share of the volatility/drawdown/VaR numbers are calibrated assumptions, not empirical fact.
- **Correlation/beta use a single market factor** (Nifty 50) for every synthetic asset class — a structural simplification of the whole synthetic-fallback approach (§4.2), not just a crypto-specific issue. Crypto's beta was corrected 2026-07-30 (1.6 → 0.3) to stop implying a strong, stable positive equity correlation the literature doesn't support, but the single-factor architecture itself remains a simplification for every synthetic class, not only crypto.
- **No regime-awareness** — correlations/volatilities are static point estimates from a fixed historical window (≤252 trading days), not stress-scenario aware beyond whatever drawdown that window happened to contain.
- **`normalizeIssuer()` / `normalizeFundKey()`** are best-effort regex string matching, not a canonical issuer registry — will miss real overlaps between dissimilar names and can occasionally over-match.
- **Layer D's corpus/persona bands (§12) are reasoned, not empirically calibrated** — same caveat as the connection strengths above. The ₹25k/2L/10L/50L cutoffs and per-tier expected counts are defensible illustrative reasoning about practical minimums, not a study of real investor behavior.
- **Layer D only adjusts `contextFit` and the single-class correlation floor** — it does not (yet) soften `apparentDiversificationPct`, `volatilityScore`, `drawdownScore`, or any other sub-score for a small/young portfolio. A Starter-tier user's volatility/drawdown numbers are scored exactly the same as anyone else's — only the "should you have more classes" signal is context-aware today.
- **No age-derived equity-percentage glide path** (e.g. "100 minus age") exists, and none is planned as a literal formula — standard glide-path heuristics informed the *qualitative* persona reasoning in §12.2 (which classes to prioritize, and how strongly), but were deliberately not implemented as a hard percentage-by-age rule.
- **The stock-count band (§6.5) only looks at EQUITY.** Distinct-holding-count bands for other classes (e.g. "too few mutual funds," "too many bond issuers") don't exist — the classic literature this anchors to is specifically about individual stock-picking breadth.

## 14. Testing

`backend/tests/diveScore.test.ts` — covers: the empty/single-holding baseline, the real-≤-apparent invariant under many well-spread same-class names, cross-class issuer-match detection, the full composite/correlation-matrix shape, single-class correlation penalty, determinism (seeded synthetic data doesn't leak randomness across repeated calls), the full layered look-through model (MF look-through, keyword affinity, broad industry affinity, same-sector same-class for EQUITY/MUTUAL_FUND/CRYPTO, and negative controls proving unrelated holdings and different-sector pairs produce zero connections), Layer D (the exact "₹10,000 in 3 stocks" scenario, genuine under-diversification still being flagged when the user's own expected set calls for more, expected-set expansion for a large corpus, and contextFit never penalizing exceeding expectations), and the stock-count band / within-class HHI (too-few and too-many equity counts, the 15–30 plateau, not-applicable-when-no-equity, and a same-apparent-diversification comparison isolating the within-class HHI's effect on `concentrationScore`).

`backend/tests/contextEngine.test.ts` — pure unit tests for `resolveCorpusTier`, `resolvePersona`, and `resolveContext` (tier/bracket boundaries, monotonic expected-count growth, no gaps/overlaps in age brackets, every class reachable at the "large" tier).

Run via `cd backend && npm test` (or `./node_modules/.bin/jest --runInBand` if disk space blocks `npm`/`npx`'s cache writes).

## 15. Maintenance / Change Log

**Whenever the model changes — a weight, a threshold, a new tier, a new data source — update the relevant section above in the same change**, and add a dated entry below (newest first). Keep entries short: what changed, why, which file(s).

| Date | Change | Why | File(s) |
|---|---|---|---|
| 2026-09-01 | `WhatIfSheet`'s "Close the apparent-vs-real gap" card: (1) relabeled from generic "Now"/"If fixed" (shared with the two Divve Score cards beside it) to "Real div. now"/"Real div. if fixed" with a `%` suffix, since it shows a different metric than those two; (2) anchored its numbers on canonical `scoreBreakdown.apparentDiversificationPct`/`realDiversificationPct` instead of a local recompute, falling back to the local calc only when no canonical score exists yet — same fix class as §7.9's X-Ray donut fix | User reported the card showing 70/70 (no gap) while Home's canonical tiles read Apparent 70% / Real 69% for the same portfolio — confirmed as a real bug: the local `apparentDiversification(h)`/`realDiversification(h)` only detect overlap via a crude holding-name match, missing cross-class connections the backend's real lookthrough engine (§7) catches | `Suggestions.jsx`, `Suggestions.test.jsx`, `docs/DIVE_SCORE_MODEL.md` |
| 2026-09 | Split Suggestions' single "Run Stress Test" button into two: "What If" (unchanged 3 portfolio-fix scenarios, restyled bottom-sheet→floating modal to match `SimulateSheet`) and a genuine new "Run Stress Test" showing a new derived **resilience score** under 3 real market-shock scenarios (Geopolitical Tension/Rate Hike/Sector Crash) — see new §11.1 for the full formula, sensitivity tables, and citations. Two decisions confirmed with the user before implementation: FD/PF both get 0 sensitivity in both shock scenarios (consistent with their `SYNTHETIC_PARAMS.beta: 0` in the main score); Sector Crash restricted to categories with real single-issuer collapse risk (Equity/MF/ETF/REIT-InvIT/Crypto), so a gold-heavy portfolio correctly shows no Sector Crash fall even though it improves under Geopolitical Tension (safe-haven benefit) — different risk vectors, not a contradiction | The old button misleadingly labeled 3 hypothetical-fix scenarios as a "stress test" when it wasn't testing market shocks at all; user asked for a genuine market-stress feature alongside the renamed original | `Suggestions.jsx`, `Suggestions.test.jsx`, `docs/DIVE_SCORE_MODEL.md` |
| 2026-09-01 | Added PF (Provident Fund — PPF/EPF/VPF) as a 12th asset class, wired through every layer: `LIQUIDITY_TIER.PF: 8` (below FD's 15 — no unconditional exit, unlike a breakable FD); `SYNTHETIC_PARAMS.PF` (vol 1%, above FD's 0.3% since PF's rate is periodically revised rather than locked at issuance, but far below BOND's 4%) with a real-declared-rate override mirroring FD's own pattern (new `config/pfRates.ts`); Context Engine's `CORPUS_TIERS.large` bumped 11→12 classes and each `PERSONA_BRACKETS` entry updated (PF deprioritized for Early Career despite EPF often being quasi-mandatory via payroll — see §12.2's reasoning; prioritized ahead of FD for Peak Earning given its EEE tax edge; placed after Mutual Funds, not before, for Pre-Retirement given a fresh PPF's 15-year lock); own `pfSchema`/`computePfValues()` (annual compounding, no `maturityValue`/`maturityDate` — PF's "maturity" doesn't map to a single date) mirroring FD's validator pattern; new `case "PF":` in `holdingQualityService.ts` using sovereign/EPFO-backed framing (not FD's DICGC bank-insurance framing — genuinely different risk); `frontend/src/lib/diveEngine.js`'s `IDEAL_RANGES.PF` (FD-shaped but with a lower ceiling — PPF/EPF have hard practical contribution caps FD doesn't); a `TAX_NOTES.PF` entry and inclusion in `TAX_BENEFIT_CATEGORIES` in `Suggestions.jsx` (confirmed with the user). Two decisions confirmed with the user before implementation: PF gets the green tax-benefit border, and PF is deprioritized (not prioritized) for Early Career | User asked to add PF as a new asset class, "wired to all the branches like context and others" — PPF/EPF/VPF accounts are one of the most common holdings for Indian retail investors (mandatory payroll deduction for EPF, or a deliberate tax-advantaged choice for PPF) and were entirely unrepresented before this change | `models/Instrument.ts`, `diveScoreService.ts`, `priceHistoryService.ts`, `config/pfRates.ts` (new), `contextEngine.ts`, `holdingQualityService.ts`, `validators/holdings.ts`, `controllers/holdingsController.ts`, `categorizeInstrument.ts`, `aiExtractionService.ts`, `scoreReportPdfService.ts`, `frontend/src/lib/diveEngine.js`, `frontend/src/lib/plannerEngine.js`, `frontend/src/screens/Suggestions.jsx`, `Preferences.jsx`, `ManualEntry.jsx`, `FileUpload.jsx`, `BotScan.jsx` |
| 2026-08-17 | Added §7.9 (X-Ray's donut vs. this model) and §16 (Suggestions' ideal-₹ calculation), both previously entirely undocumented; wired `scoreBreakdown.connections` into X-Ray's deep view so it surfaces real backend-detected overlap (MF look-through, sector/industry affinity) the name-only donut structurally can't see | User asked how Suggestions' ideal ₹ amounts are calculated and flagged it (and possibly other things) as missing from this doc; auditing turned up a real, previously-unnoticed discrepancy — X-Ray's "True exposure" view could disagree with the canonical `realDiversificationPct` for the same portfolio, since it only ever detected same-name overlap | `XRay.jsx`, `docs/DIVE_SCORE_MODEL.md` |
| 2026-08-04 | Scaled the frontend fast-path's simulated score delta by `weights.concentration` (0.17) instead of adding it 1:1 to the real anchor score; capped Ask DIVVE's Fit-for-you slider range to `Math.max(100000, total * 2)` instead of an unbounded, value-chasing max | User reported Ask DIVVE's Fit-for-you score reaching 99-100 when simulating a large mutual-fund addition, despite the portfolio missing FD/REIT/InvIT coverage and holding minimal ETF/Gold — confirmed as a real bug: the concentration-only delta is unbounded in magnitude and was being added to the real composite anchor as if concentration were the whole score, not 17% of it | `Suggestions.jsx` (`SimulateSheet`), `AskDive.jsx` (`FitForYouCard`) |
| 2026-08-02 | Added Tier 5 — sectoral mutual fund ↔ matching-sector equity cross-class connection (fixed strength 0.15), via a new `MF_SEGMENT_TO_NSE_INDUSTRY` curated translation table and a new "Automobile" `MUTUAL_FUND_SEGMENT_KEYWORDS` entry | User reported apparent==real diversification for an Automobile-sector equity held alongside an Automobile-themed sectoral mutual fund. No tier connected equity to mutual funds by sector at all — Tier 4's `INDUSTRY_ASSET_CLASS_AFFINITY` only ever targets GOLD/SILVER/REIT/INVIT (asset classes that are themselves sector-homogeneous); naively extending it to MUTUAL_FUND would have wrongly connected an equity to *any* fund the user holds, not just matching-sector ones — needed a genuinely different mechanism comparing both sides' own sector tags. Not yet covered by an automated test (verified via live manual testing only) | `lookthroughService.ts`, `seed/sectorAffinity.ts`, `seed/mutualFundSegments.ts` |
| 2026-08-02 | Wired real AMFI mutual fund NAV history (via MFAPI.in) into `resolveHoldingReturns()` — mutual funds with a resolvable AMFI scheme code now use a real daily-return series for volatility/drawdown/VaR/beta/correlation, the same tier as EQUITY/ETF/CRYPTO, instead of always-synthetic | Every mutual fund holding's resilience math was previously 100% synthetic regardless of data availability, silently understating `dataQuality.realPriceCoveragePct` for what's typically the largest single asset class in an Indian retail portfolio, even though a free real source exists | `priceHistoryService.ts` |
| 2026-07-30 | Added a banded, tapering `stockCountFit` sub-score for distinct EQUITY holding count (ideal 15-30, per Evans & Archer 1968 / Statman 1987); added within-class HHI as a 4th concentration term (concentration internal split rebalanced 0.65/0.15/0.20 → 0.50/0.15/0.20/0.15); fixed CRYPTO's synthetic beta (1.6 → 0.3 — was wrongly implying strong stable equity correlation) and added cited reasoning to every other `SYNTHETIC_PARAMS` beta (BOND, GOLD, SILVER adjusted; REIT/INVIT/others documented as-is); top-level weights rebalanced to make room for `stockCountFit` | User audit found 3 gaps against the diversification/correlation/volatility literature: no stock-count band (flat HHI rewards "more names" indefinitely), no within-class HHI (only cross-class existed), and uncited/inconsistent correlation assumptions (crypto's beta contradicted documented low/unstable crypto-equity correlation) | `diveScoreService.ts`, `priceHistoryService.ts`, `ScoreBreakdown.jsx` |
| 2026-07-30 | Built Layer D — Context Engine: corpus tiers + persona brackets → Expected Asset Class Set; new `contextFit` sub-score (weights rebalanced to make room); softened the single-class correlation floor (20→50) when 1 class is exactly what's expected; new reusable frontend messaging module deferring "add X"/"trim X" nudges that don't make sense yet | Prevent the score AND its messaging from penalizing a user for something that doesn't make sense at their corpus size/life stage (e.g. "₹10,000 in 3 equity stocks is not a problem") | `contextEngine.ts` (new), `diveScoreService.ts`, `frontend/src/lib/contextMessaging.js` (new), `Suggestions.jsx`, `Home.jsx`, `ScoreBreakdown.jsx` |
| 2026-07-30 | Extended same-sector connectedness (Tier 0) to MUTUAL_FUND (Sectoral/Thematic funds, via AMFI category headers) and CRYPTO (curated CoinGecko category segments) | Previously equity-only; user asked whether the model generalized to all asset classes | `instrumentSources.ts`, `instrumentService.ts`, `seed/mutualFundSegments.ts` |
| 2026-07-30 | Raised AMFI fetch cap 2,000 → 8,000 rows | The 2,000 cap was silently excluding all Equity mutual funds (Debt schemes are listed first in AMFI's file), making the new MF sector-tagging a no-op | `instrumentSources.ts` (`fetchAmfiMutualFunds`) |
| 2026-07-29 | Added Tier 0 (same-class, same-sector, strength 0.3, capped per-class at that class's portfolio weight) — discounts Name Diversification, not Real, since Real is already floored at 0 for single-class portfolios | Same-sector stocks (e.g. two banks) previously had zero effect on the score in an all-equity portfolio | `lookthroughService.ts`, `diveScoreService.ts` |
| 2026-07-29 | Built the layered look-through model (issuer match, MF top-holdings, keyword affinity, broad industry affinity) and wired `computeLookthroughOverlap` into `realDiversificationPct` | Replace a naive per-name HHI with genuine cross-asset-class connectedness detection | `lookthroughService.ts`, `seed/sectorAffinity.ts`, `seed/mutualFundTopHoldings.ts` |
| 2026-07-29 | Redefined `realDiversificationPct = apparent × (1 − overlapShare)`, guaranteeing real ≤ apparent | User-reported bug: real diversification (88%) exceeded apparent (0%), which is nonsensical | `diveScoreService.ts` |
| 2026-07-29 | Lowered single-asset-class correlation default from neutral 50 to 20; rebalanced concentration to blend apparent/real/name | An all-equity, multi-stock portfolio scored deceptively high (75+) | `diveScoreService.ts` |
| 2026-07-28 | Initial Dive Score v2 build — composite engine, 8 sub-scores, real/synthetic price sourcing | Replace the original mock-backend scoring with a real, resilience-aware model | `diveScoreService.ts`, `priceHistoryService.ts`, `stats.ts` |

## 16. Suggestions — Ideal Allocation Ranges

**Not part of the DIVE Score composite itself** — this is a fully separate, client-side-only calculation that powers `Suggestions.jsx`'s "current ₹ → ideal ₹" cards. It shares no code or formula with §6-§9's concentration/resilience math; the only thing it has in common with the score is which *categories* exist (`CORE_CATEGORIES`, the same 10-way segment label set §7's tables use).

### 16.1 The ideal-range table

`frontend/src/lib/diveEngine.js`'s `IDEAL_RANGES` — a static `[lo%, hi%]` band per category, one full table per risk profile (Conservative / Balanced / Aggressive):

```js
export const IDEAL_RANGES = {
  Conservative: { Equity: [20, 30], "Mutual Funds": [15, 25], Bonds: [20, 30], "Gold/Silver": [8, 12], "REIT/InvIT": [5, 10], FD: [10, 20], PF: [10, 18], ETF: [3, 8], Insurance: [5, 10], Crypto: [0, 2] },
  Balanced:     { Equity: [25, 35], "Mutual Funds": [20, 30], Bonds: [15, 25], "Gold/Silver": [8, 12], "REIT/InvIT": [8, 12], FD: [8, 15],  PF: [8, 14],  ETF: [5, 10], Insurance: [3, 7],  Crypto: [0, 5] },
  Aggressive:   { Equity: [35, 50], "Mutual Funds": [20, 30], Bonds: [5, 15],  "Gold/Silver": [5, 10], "REIT/InvIT": [8, 15], FD: [3, 8],   PF: [3, 6],   ETF: [5, 12], Insurance: [2, 5],  Crypto: [2, 8] },
};
```

Ported from the original prototype, hand-extended for the 3 classes it left out (ETF, Insurance, Crypto — see the comment above the table in source for the reasoning behind each), plus PF (added later — see §15 changelog). PF's band deliberately follows FD's declining-with-risk-appetite SHAPE (both are guaranteed-return, zero-volatility instruments) but with a lower ceiling at every step — PPF caps contributions at ₹1.5L/year and EPF is capped by salary/employer formula, a hard practical ceiling FD doesn't have. **Illustrative reference bands, not personalized or backtested** — same caveat as every other curated constant in this document (§13.2), but unlike §6-§9's model, these bands are keyed *only* on risk profile, not on Layer D's corpus tier or persona (see §16.4).

### 16.2 From bands to ₹ amounts — `buildSuggestions(holdings, ranges, risk)`

For each of the 9 core categories:

```
current%    = categoryValue / totalPortfolioValue × 100
[loPct, hiPct] = IDEAL_RANGES[risk][category]
loAmt, hiAmt   = loPct% × total, hiPct% × total        // scales with what's already invested, not a target future corpus
action      = current% < loPct ? "increase" : current% > hiPct ? "reduce" : "hold"
suggestedAmt = round( |midpoint(loAmt, hiAmt) − current| )   // gap to the BAND'S MIDPOINT, not its nearer edge
```

Sorted: every `increase`/`reduce` category first, `hold` last; within each, biggest ₹ gap first.

### 16.3 Personalization layer — `personalizeSuggestions(suggestions, prefs)`

Runs after §16.2, never changes the ₹ figures themselves — only which categories appear and their order:

- `prefs.excluded` categories are dropped from the list entirely (filtered out by the caller, before this function even runs).
- `prefs.preferred` categories are always sorted to the top, regardless of their own `action`/`hold` status.
- `prefs.returnExpectation` (Modest/Moderate/High) nudges growth-tier categories (`RETURN_TIER`: Equity/ETF/Crypto = high, Gold/REIT/MutualFunds = medium, FD/Bonds/Insurance = low) up or down the order via `RETURN_BIAS`.
- `prefs.diversificationPriority` (Low/Medium/High) caps how many "live" `increase` pushes are active at once (`DIVERSIFICATION_CAP`) — categories beyond the cap still show, just without an active push.

### 16.4 Interaction with Layer D (Context Engine, §12)

`contextMessaging.js`'s `deferredIncreaseNote()`/`deferredReduceNote()` sit on top of §16.2's raw `action`, softening (not hiding) a suggestion that doesn't make sense yet for the user's corpus tier/persona — e.g. an `increase` on a category outside `expectedAssetClasses` becomes a deferred note instead of a live push; a `reduce` on the user's *sole* expected class is deferred too (§12.5).

**The `[loPct, hiPct]` bands ARE now adjusted by Context, but only for the user's own *expected* categories** — `rescaleIdealRanges(ranges, risk, expectedCategories)` in `diveEngine.js`, called from `Suggestions.jsx` (and `Planner.jsx`, via `plannerEngine.js`'s own resolved active-category set) before the ₹ math runs. §16.1's bands sum to ~150% of hi% across all 9 categories, which is fine for a user expected to eventually hold most of them, but breaks down for an early-stage user Layer D restricts to a small subset — e.g. a ₹50,000 Balanced-profile portfolio limited to 3 expected categories (Equity/Mutual Funds/Gold-Silver, "Growing" corpus tier) capped out at ₹38,500 (77%) even fully invested in all three, contradicting the "these are genuinely all you need right now" message Context Engine is otherwise making.

The fix: for categories in `expectedCategories` only, scale `lo` and `hi` together by the same factor, derived from the sum of each category's own **midpoint** `(lo+hi)/2`, not its `hi` (ceiling). An earlier version of this fix scaled on the `hi` sum instead — mathematically clean (funding every category to its own ceiling reaches exactly 100%), but it meant a user fully invested across just their expected categories almost always had at least one land above its own ceiling, reading as "over-exposed" everywhere even when reasonably on track (e.g. the ₹50,000/3-category case above: Mutual Funds at ₹20,000/40% read as over a hi-sum-scaled ceiling of just ₹19,481/38.96%). Scaling on the midpoint sum instead means "fully invested, on-target" lands near each category's own middle, leaving real headroom above it before a holding genuinely reads as over-exposed — while ceilings (which sit above their own midpoint by construction) now sum to *more* than 100%, not exactly 100%, so maxing out every expected category still comfortably covers the full portfolio. Every other (deferred/not-yet-expected) category keeps its original, unscaled band untouched, since it isn't part of "the budget for right now." This mirrors §12.4's note that Layer D never touches the raw Apparent/Real Diversification numbers — same principle, but §16's bands are the one place Layer D now *does* reach into the underlying target math, not just the presentation layer, because unlike Apparent/Real (a measurement), these bands are a recommendation whose credibility depends on actually summing to the user's real total.

### 16.5 Known gap

No connection to any of §8's resilience math (volatility/drawdown/liquidity/beta) — the bands are pure allocation-mix targets, informed only by risk profile. A category that's "on track" per its ideal range could still be a low-liquidity or high-volatility drag on the composite score; Suggestions doesn't currently reconcile the two.
