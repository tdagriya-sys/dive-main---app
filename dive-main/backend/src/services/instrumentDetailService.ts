import axios from "axios";
import { env } from "../config/env";
import { AssetClass } from "../models/Instrument";
import { fetchCoinGeckoWithRetry } from "./instrumentSources";

// Only the fields fetchInstrumentDetail actually reads — accepts both a
// hydrated Mongoose document and a plain `.lean()` object.
export interface InstrumentLike {
  assetClass: AssetClass;
  symbol: string;
  exchange?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

/**
 * On-demand fundamental/technical snapshot for ONE instrument, used by Ask
 * DIVE's detail screen. Deliberately separate from priceHistoryService.ts:
 * that module fetches a full daily-return HISTORY for holdings the user
 * already owns (needed for every score computation, so it's cached
 * aggressively); this fetches a CURRENT snapshot (price, 52-week range,
 * market cap, NAV, etc.) for an instrument the user is merely looking up,
 * on demand, one at a time. Real data where a free public source exists;
 * an honest "not available" everywhere else — never a fabricated number.
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // snapshot data — shorter-lived than the 12h return-history cache
interface CacheEntry {
  detail: InstrumentDetail;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export interface InstrumentDetail {
  available: boolean;
  source?: string;
  // "live" for a real fetched quote/NAV; "admin" for the fallback below —
  // callers that need to tell the two apart (e.g. to avoid treating an
  // admin-typed value as if it were a live AMFI category) can check this
  // instead of parsing `source`'s human-readable text.
  sourceKind?: "live" | "admin";
  asOf?: string;
  reason?: string;
  fields?: Record<string, number | string | null>;
  // Only set for a MUTUAL_FUND's admin-provided Underlying Holdings — the
  // live paths never populate this (no live source here returns holdings).
  holdings?: Array<{ name: string; weightPct?: number | null }>;
}

const NOT_AVAILABLE_REASONS: Record<string, string> = {
  BOND: "There's no free, reliable public API for individual Indian bond/NCD pricing.",
  ULIP_INSURANCE: "ULIP/insurance plans aren't publicly quoted instruments — pricing is policy-specific.",
  FD: "Fixed deposits/recurring deposits aren't publicly quoted instruments — the rate is fixed at booking.",
  GOLD: "This isn't exchange-listed (SGB/digital/physical gold don't have a live public quote here).",
  SILVER: "This isn't exchange-listed (digital/physical silver doesn't have a live public quote here).",
};

async function fetchYahooQuoteMeta(symbol: string): Promise<InstrumentDetail | null> {
  try {
    const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      params: { range: "5d", interval: "1d" },
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;
    return {
      available: true,
      source: `Yahoo Finance (${meta.fullExchangeName || "NSE"})`,
      asOf: new Date().toISOString(),
      fields: {
        currentPrice: meta.regularMarketPrice ?? null,
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
        volume: meta.regularMarketVolume ?? null,
        longName: meta.longName ?? null,
      },
    };
  } catch {
    return null;
  }
}

async function fetchCoinGeckoDetail(coingeckoId: string): Promise<InstrumentDetail | null> {
  try {
    const { data } = await fetchCoinGeckoWithRetry(() =>
      axios.get("https://api.coingecko.com/api/v3/coins/markets", {
        params: { vs_currency: "inr", ids: coingeckoId, price_change_percentage: "24h,7d" },
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dive-app" },
      })
    );
    const row = data?.[0];
    if (!row) return null;
    return {
      available: true,
      source: "CoinGecko",
      asOf: row.last_updated || new Date().toISOString(),
      fields: {
        currentPriceInr: row.current_price ?? null,
        marketCapInr: row.market_cap ?? null,
        marketCapRank: row.market_cap_rank ?? null,
        totalVolume24hInr: row.total_volume ?? null,
        high24hInr: row.high_24h ?? null,
        low24hInr: row.low_24h ?? null,
        change24hPct: row.price_change_percentage_24h_in_currency ?? row.price_change_percentage_24h ?? null,
        change7dPct: row.price_change_percentage_7d_in_currency ?? null,
        athInr: row.ath ?? null,
        athChangePct: row.ath_change_percentage ?? null,
        circulatingSupply: row.circulating_supply ?? null,
        maxSupply: row.max_supply ?? null,
      },
    };
  } catch {
    return null;
  }
}

function parseMfDate(d: string): number {
  // MFAPI dates are "DD-MM-YYYY"
  const [dd, mm, yyyy] = d.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd).getTime();
}

interface MfApiResponse {
  data?: Array<{ date: string; nav: string }>;
  meta?: { scheme_category?: string; fund_house?: string };
}

async function fetchMfApiRaw(schemeCode: string) {
  return axios.get<MfApiResponse>(`https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`, {
    timeout: 8000,
    // This host resolves an IPv6 (NAT64-synthesized) address alongside its
    // real IPv4 one — on networks where that IPv6 path is a black hole
    // rather than a clean refusal, Node's default dual-stack lookup can
    // hang for the full timeout before trying IPv4. Forcing IPv4 avoids
    // that class of failure outright.
    family: 4,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dive-app" },
  });
}

async function fetchMfApiDetail(schemeCode: string): Promise<InstrumentDetail | null> {
  let data: MfApiResponse | undefined;
  try {
    ({ data } = await fetchMfApiRaw(schemeCode));
  } catch {
    // This host has shown occasional first-connection flakiness in testing
    // (a slow/failed initial TCP connect that succeeds immediately on retry,
    // even with family:4 forced) — one immediate retry before giving up.
    try {
      ({ data } = await fetchMfApiRaw(schemeCode));
    } catch {
      return null;
    }
  }
  try {
    const rows: Array<{ date: string; nav: string }> = data?.data || [];
    if (!rows.length) return null;
    const latest = rows[0];
    const latestNav = parseFloat(latest.nav);
    const latestTime = parseMfDate(latest.date);
    let return1yPct: number | null = null;
    const yearAgoTarget = latestTime - 365 * 24 * 60 * 60 * 1000;
    const yearAgoRow = rows.find((r) => parseMfDate(r.date) <= yearAgoTarget) || rows[rows.length - 1];
    if (yearAgoRow) {
      const yearAgoNav = parseFloat(yearAgoRow.nav);
      if (yearAgoNav > 0) return1yPct = ((latestNav - yearAgoNav) / yearAgoNav) * 100;
    }
    return {
      available: true,
      source: "AMFI (via MFAPI.in)",
      asOf: latest.date,
      fields: {
        latestNav,
        navDate: latest.date,
        schemeCategory: data?.meta?.scheme_category ?? null,
        fundHouse: data?.meta?.fund_house ?? null,
        return1yPct,
      },
    };
  } catch {
    return null;
  }
}

// Live-priceable via Yahoo's `<SYMBOL>.NS` endpoint (NSE-listed) — mirrors
// priceHistoryService's NSE_PRICEABLE_CLASSES, extended with REIT/InvIT
// since every REIT/InvIT in the seed data carries a real NSE symbol.
const NSE_DETAIL_CLASSES = new Set(["EQUITY", "ETF", "REIT", "INVIT", "GOLD", "SILVER"]);

function asDateString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  if (v instanceof Date) return v.toISOString();
  return undefined;
}

// Same as asDateString, but truncated to just the calendar date — used only
// for the top-level "as of" fallback (the upload TIMESTAMP, not a field value
// an admin actually typed), where a user-facing "as of 2026-09-27T21:57:03.573Z"
// reads as a bug, not a date.
function asDateOnlyString(v: unknown): string | undefined {
  const s = asDateString(v);
  return s ? s.slice(0, 10) : undefined;
}

interface UnderlyingHoldingLike {
  name?: unknown;
  weightPct?: unknown;
}

/**
 * Fallback for an `ADMIN_UPLOAD`-sourced instrument when no live source
 * resolves it — which, structurally, is EVERY manually-uploaded instrument
 * today: its symbol is always namespaced (`UPLOAD_...`, see
 * instrumentUploadService.ts's own top comment) specifically so a live
 * refresh can never collide with it, but that same namespacing means Yahoo/
 * MFAPI/CoinGecko can never resolve it either. Without this, an admin who
 * carefully typed in a bond's credit rating and maturity date would see
 * nothing but "not available" on Ask DIVE — the upload would be visible
 * nowhere a user actually looks up an instrument. Shows exactly what was
 * uploaded, clearly labeled as admin-provided rather than live (never
 * fabricates a number the admin didn't actually enter).
 */
function buildAdminProvidedDetail(instrument: InstrumentLike): InstrumentDetail | null {
  if (instrument.source !== "ADMIN_UPLOAD") return null;
  const m = instrument.metadata || {};

  const fields: Record<string, number | string | null> = {};
  if (typeof m.price === "number") fields.uploadedPrice = m.price;
  const priceAsOf = asDateString(m.priceAsOf);
  if (priceAsOf) fields.uploadedPriceAsOf = priceAsOf;
  if (typeof m.annualReturnPct === "number") fields.uploadedAnnualReturnPct = m.annualReturnPct;
  if (typeof m.creditRating === "string" && m.creditRating.trim()) fields.uploadedCreditRating = m.creditRating;
  const maturityDate = asDateString(m.maturityDate);
  if (maturityDate) fields.uploadedMaturityDate = maturityDate;
  if (typeof m.expenseRatioPct === "number") fields.uploadedExpenseRatioPct = m.expenseRatioPct;
  if (typeof m.sector === "string" && m.sector.trim()) fields.uploadedSector = m.sector;
  if (typeof m.category === "string" && m.category.trim()) fields.uploadedCategory = m.category;

  const rawHoldings = Array.isArray(m.underlyingHoldings) ? (m.underlyingHoldings as UnderlyingHoldingLike[]) : [];
  const holdings = rawHoldings
    .filter((h) => typeof h?.name === "string" && (h.name as string).trim())
    .map((h) => ({ name: h.name as string, weightPct: typeof h.weightPct === "number" ? (h.weightPct as number) : null }));

  if (Object.keys(fields).length === 0 && holdings.length === 0) return null;

  return {
    available: true,
    source: "Provided by admin (manually uploaded, not live-priced)",
    sourceKind: "admin",
    asOf: priceAsOf || asDateOnlyString(m.uploadedAt),
    fields,
    ...(holdings.length ? { holdings } : {}),
  };
}

export async function fetchInstrumentDetail(instrument: InstrumentLike): Promise<InstrumentDetail> {
  const cacheKey = `${instrument.assetClass}:${instrument.symbol}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.detail;

  let detail: InstrumentDetail | null = null;

  // Real-price network calls are skipped in the test environment (same
  // policy as priceHistoryService.ts) so the test suite stays hermetic. The
  // admin-provided fallback below never touches the network, so it still
  // runs in tests — it's the only way this whole fallback path gets covered.
  if (env.nodeEnv !== "test") {
    if (NSE_DETAIL_CLASSES.has(instrument.assetClass) && instrument.exchange === "NSE" && instrument.symbol) {
      detail = await fetchYahooQuoteMeta(`${instrument.symbol}.NS`);
    } else if (instrument.assetClass === "CRYPTO") {
      const coingeckoId = (instrument.metadata?.coingeckoId as string | undefined) || instrument.symbol;
      if (coingeckoId) detail = await fetchCoinGeckoDetail(coingeckoId);
    } else if (instrument.assetClass === "MUTUAL_FUND" && instrument.symbol) {
      detail = await fetchMfApiDetail(instrument.symbol);
    }
    if (detail) detail.sourceKind = "live";
  }

  if (!detail) {
    detail = buildAdminProvidedDetail(instrument) || {
      available: false,
      reason:
        env.nodeEnv === "test"
          ? "Live data is disabled in the test environment."
          : NOT_AVAILABLE_REASONS[instrument.assetClass] ||
            "Live fundamental/technical data isn't available for this instrument right now.",
    };
  }

  cache.set(cacheKey, { detail, expiresAt: Date.now() + CACHE_TTL_MS });
  return detail;
}
