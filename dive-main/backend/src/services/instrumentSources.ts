import axios from "axios";
import { SeedInstrument } from "../seed/staticInstruments";
import { matchMutualFundSegment } from "../seed/mutualFundSegments";

// CoinGecko's free/public API rate-limits well below what this refresh job
// needs — fetchCoinGeckoCoins (2 calls) and fetchCoinGeckoSegments (10 calls)
// fire back-to-back, and empirically the exact call budget available at any
// moment varies with how recently the API was hit (a tighter window than
// fixed inter-call spacing alone can reliably stay under, especially right
// after a burst of prior calls). So this does both: spaces every call out,
// AND retries once with a longer backoff specifically on a 429 — a category
// that gets rate-limited isn't gone for good, it just needs to wait its turn.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export const COINGECKO_CALL_SPACING_MS = 2500;
const COINGECKO_429_BACKOFF_MS = 20000;

export async function fetchCoinGeckoWithRetry<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status !== 429) throw err;
    await sleep(COINGECKO_429_BACKOFF_MS);
    return request();
  }
}

/**
 * Each fetcher hits a real public data source and normalizes its response into
 * SeedInstrument rows. Every one of them is wrapped in try/catch by the caller
 * (instrumentService) and falls back to the bundled static list on any failure
 * (network unavailable, source layout changed, rate limited, etc.) — the daily
 * refresh job must never crash the app.
 */

// AMFI publishes the full mutual fund scheme master as a public, keyless text file.
export async function fetchAmfiMutualFunds(): Promise<SeedInstrument[]> {
  const { data } = await axios.get<string>("https://www.amfiindia.com/spages/NAVAll.txt", {
    timeout: 10000,
    responseType: "text",
  });
  const lines = data.split("\n");
  const out: SeedInstrument[] = [];
  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 6) continue;
    const [schemeCode, , , schemeName] = parts;
    if (!schemeCode || !schemeName || !/^\d+$/.test(schemeCode.trim())) continue;
    out.push({
      assetClass: "MUTUAL_FUND",
      symbol: schemeCode.trim(),
      name: schemeName.trim(),
    });
    // AMFI lists Debt schemes first, Equity schemes only after — a lower cap
    // here was silently excluding every equity fund (including all
    // Sectoral/Thematic ones fetchAmfiSectoralFundSegments needs an
    // Instrument record to tag) before ever reaching them. 8000 comfortably
    // covers Debt + Equity (incl. Sectoral/Thematic) + ETF + Fund-of-Funds,
    // while still bounding collection size well short of the ~14k total rows.
    if (out.length >= 8000) break;
  }
  return out;
}

// NSE publishes the full listed-equity master as a public CSV. In practice
// NSE's servers aggressively block non-browser requests (missing session
// cookies, Akamai bot checks, etc.), so this frequently fails even with
// browser-like headers — that's expected and handled by the caller's
// try/catch + static-list fallback. When it does work, it meaningfully
// broadens equity coverage past the ~40 names in the bundled static seed.
export async function fetchNseEquities(): Promise<SeedInstrument[]> {
  const { data } = await axios.get<string>("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", {
    timeout: 10000,
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/csv,*/*",
      Referer: "https://www.nseindia.com/",
    },
  });
  const lines = data.split("\n");
  const out: SeedInstrument[] = [];
  // Header: SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,...
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const symbol = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();
    if (!symbol || !name) continue;
    out.push({ assetClass: "EQUITY", symbol, name, exchange: "NSE" });
  }
  return out;
}

// NSE publishes the full listed-ETF master as a public CSV. Its "Underlying"
// column reliably identifies gold/silver commodity ETFs — those get filed
// under the GOLD/SILVER asset classes (matching what a user means by "Gold"/
// "Silver" as an investment route) rather than generic ETF.
export async function fetchNseEtfs(): Promise<SeedInstrument[]> {
  const { data } = await axios.get<string>("https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv", {
    timeout: 10000,
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/csv,*/*",
      Referer: "https://www.nseindia.com/",
    },
  });
  const lines = data.split("\n");
  const out: SeedInstrument[] = [];
  // Header: Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const symbol = (cols[0] || "").trim();
    const underlying = (cols[1] || "").trim();
    const securityName = (cols[2] || "").replace(/"/g, "").trim();
    if (!symbol || !securityName) continue;

    let assetClass: SeedInstrument["assetClass"] = "ETF";
    if (/gold/i.test(underlying) || /gold/i.test(securityName)) assetClass = "GOLD";
    else if (/silver/i.test(underlying) || /silver/i.test(securityName)) assetClass = "SILVER";

    out.push({ assetClass, symbol, name: securityName, exchange: "NSE" });
  }
  return out;
}

// NSE publishes the Nifty 500 constituent list (public, keyless) with a broad
// "Industry" classification column (Financial Services, Realty, Metals &
// Mining, etc.) — used to detect coarse cross-asset-class overlap (e.g. a
// Realty-sector stock vs. a REIT holding). It's a macro-level bucket, not a
// precise sub-industry — e.g. jewelry retailers land under the generic
// "Consumer Durables" alongside appliance makers — so callers needing
// precision for specific cases (jewelry vs. gold) use a curated keyword list
// instead (see seed/sectorAffinity.ts) rather than this broad classification.
export interface NseIndustryRow {
  symbol: string;
  name: string;
  industry: string;
}

export async function fetchNseIndustryClassification(): Promise<NseIndustryRow[]> {
  const { data } = await axios.get<string>("https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv", {
    timeout: 10000,
    responseType: "text",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/csv,*/*",
      Referer: "https://www.nseindia.com/",
    },
  });
  const lines = data.split("\n");
  const out: NseIndustryRow[] = [];
  // Header: Company Name,Industry,Symbol,Series,ISIN Code
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const name = (cols[0] || "").trim();
    const industry = (cols[1] || "").trim();
    const symbol = (cols[2] || "").trim();
    if (!symbol || !name || !industry) continue;
    out.push({ symbol, name, industry });
  }
  return out;
}

export interface MarketCapTierRow {
  symbol: string;
  tier: "Large" | "Mid" | "Small";
}

// NSE publishes the Nifty 100 (top ~100 by market cap — large-cap proxy),
// Nifty Midcap 150, and Nifty Smallcap 250 constituent lists as free, keyless
// CSVs in the same format as the Nifty 500 list above. By construction these
// three don't overlap (each index covers a distinct market-cap band), so a
// symbol found in one is tagged with that tier and the rest are skipped. Used
// for the equity "quality mix" check — a portfolio 100% concentrated in one
// tier (small-cap especially) is a real, distinct risk from simple stock-count
// or issuer spread.
const MARKET_CAP_TIER_SOURCES: Array<{ url: string; tier: MarketCapTierRow["tier"] }> = [
  { url: "https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv", tier: "Large" },
  { url: "https://nsearchives.nseindia.com/content/indices/ind_niftymidcap150list.csv", tier: "Mid" },
  { url: "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv", tier: "Small" },
];

export async function fetchNseMarketCapTiers(): Promise<MarketCapTierRow[]> {
  const bySymbol = new Map<string, MarketCapTierRow["tier"]>();
  for (const { url, tier } of MARKET_CAP_TIER_SOURCES) {
    try {
      const { data } = await axios.get<string>(url, {
        timeout: 10000,
        responseType: "text",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/csv,*/*",
          Referer: "https://www.nseindia.com/",
        },
      });
      const lines = data.split("\n");
      // Header: Company Name,Industry,Symbol,Series,ISIN Code
      for (const line of lines.slice(1)) {
        const cols = line.split(",");
        const symbol = (cols[2] || "").trim();
        if (!symbol || bySymbol.has(symbol)) continue;
        bySymbol.set(symbol, tier);
      }
    } catch {
      continue; // one tier's source failing shouldn't block the others
    }
  }
  return Array.from(bySymbol.entries()).map(([symbol, tier]) => ({ symbol, tier }));
}

// Top ~500 coins BY MARKET CAP — deliberately not CoinGecko's /coins/list
// endpoint, which returns every coin (thousands) in an arbitrary internal
// order unrelated to relevance, so slicing the first 500 of it produced a
// near-random long-tail sample. That silently broke crypto category tagging
// downstream (fetchCoinGeckoSegments queries /coins/markets?order=
// market_cap_desc per category, i.e. genuinely popular coins) — the two
// lists barely overlapped, so real holdings like Bitcoin/Ethereum/well-known
// altcoins usually landed in this app's Instrument collection without a
// matching category record at all, and the X-Ray "quality & risk" panel fell
// back to "Uncategorized" for coins that plainly have a curated category.
export async function fetchCoinGeckoCoins(): Promise<SeedInstrument[]> {
  const out: SeedInstrument[] = [];
  for (let i = 0; i < 2; i++) {
    const page = i + 1;
    if (i > 0) await sleep(COINGECKO_CALL_SPACING_MS);
    try {
      const { data } = await fetchCoinGeckoWithRetry(() =>
        axios.get<Array<{ id: string; symbol: string; name: string }>>("https://api.coingecko.com/api/v3/coins/markets", {
          params: { vs_currency: "usd", order: "market_cap_desc", per_page: 250, page },
          timeout: 10000,
        })
      );
      for (const c of data) {
        out.push({
          assetClass: "CRYPTO",
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          // Needed to fetch real historical prices for the Dive Score v2
          // resilience math (CoinGecko's market_chart endpoint is keyed by
          // this id, not the symbol) and to match category tags above.
          metadata: { coingeckoId: c.id },
        });
      }
    } catch {
      continue; // one page failing (rate limit, transient) shouldn't block the other
    }
  }
  return out;
}

export interface CryptoSegmentRow {
  coingeckoId: string;
  segment: string;
}

// CoinGecko's per-coin `categories` field carries dozens of tags per coin —
// VC-portfolio names, per-chain ecosystem tags, index memberships — that
// aren't a meaningful "industry/segment" the way a retail investor means it,
// and fetching them would cost one API call PER coin (hundreds of calls,
// likely to hit the free tier's rate limit). Instead, this checks a small,
// curated set of genuinely broad segments (Layer 1, DeFi, Meme, Stablecoins,
// etc.) via CoinGecko's category-filtered market listing — one bulk call per
// segment, not per coin. A coin matching more than one curated segment keeps
// whichever was checked first (order below is the tie-break).
const CRYPTO_SEGMENT_CATEGORIES: Array<{ slug: string; label: string }> = [
  { slug: "layer-1", label: "Layer 1" },
  { slug: "layer-2", label: "Layer 2" },
  { slug: "decentralized-finance-defi", label: "DeFi" },
  { slug: "stablecoins", label: "Stablecoins" },
  { slug: "meme-token", label: "Meme" },
  { slug: "gaming", label: "Gaming" },
  { slug: "oracle", label: "Oracle" },
  { slug: "exchange-based-tokens", label: "Exchange Token" },
  { slug: "artificial-intelligence", label: "AI" },
  { slug: "real-world-assets-rwa", label: "Real World Assets" },
];

export async function fetchCoinGeckoSegments(): Promise<CryptoSegmentRow[]> {
  const byId = new Map<string, string>();
  // Unconditional up front — fetchCoinGeckoCoins runs immediately before this
  // in the refresh pipeline (instrumentService.ts), so this can't rely on
  // incidental delay from unrelated NSE/AMFI calls in between to stay under
  // CoinGecko's rate limit; it must hold regardless of call order.
  await sleep(COINGECKO_CALL_SPACING_MS);
  for (let i = 0; i < CRYPTO_SEGMENT_CATEGORIES.length; i++) {
    const { slug, label } = CRYPTO_SEGMENT_CATEGORIES[i];
    if (i > 0) await sleep(COINGECKO_CALL_SPACING_MS);
    try {
      const { data } = await fetchCoinGeckoWithRetry(() =>
        axios.get<Array<{ id: string }>>("https://api.coingecko.com/api/v3/coins/markets", {
          params: { vs_currency: "usd", category: slug, per_page: 250, page: 1, order: "market_cap_desc" },
          timeout: 10000,
        })
      );
      for (const coin of data) {
        if (!byId.has(coin.id)) byId.set(coin.id, label);
      }
    } catch {
      continue; // one category failing (rate limit, transient) shouldn't block the rest
    }
  }
  return Array.from(byId.entries()).map(([coingeckoId, segment]) => ({ coingeckoId, segment }));
}

export interface MutualFundSegmentRow {
  symbol: string; // AMFI scheme code
  segment: string;
}

// AMFI's scheme master groups every fund under a category header line, e.g.
// "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)". Only funds under
// a Sectoral/Thematic header are meaningfully "one industry" bets — a Large
// Cap or Flexi Cap fund spans dozens of sectors, so tagging those would be
// misleading. For funds under that header, the specific sector comes from a
// small curated keyword match against the scheme's own name (see
// seed/mutualFundSegments.ts) — schemes with no recognizable keyword (Business
// Cycle, Special Opportunities, MNC, Quant, etc.) are left untagged rather
// than guessed at.
export async function fetchAmfiSectoralFundSegments(): Promise<MutualFundSegmentRow[]> {
  const { data } = await axios.get<string>("https://www.amfiindia.com/spages/NAVAll.txt", {
    timeout: 10000,
    responseType: "text",
  });
  const lines = data.split("\n");
  const out: MutualFundSegmentRow[] = [];
  let inSectoralCategory = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(Open Ended|Close Ended|Interval Fund) Schemes\(/.test(trimmed)) {
      inSectoralCategory = /sectoral|thematic/i.test(trimmed);
      continue;
    }
    if (!inSectoralCategory) continue;
    const parts = line.split(";");
    if (parts.length < 6) continue;
    const [schemeCode, , , schemeName] = parts;
    if (!schemeCode || !schemeName || !/^\d+$/.test(schemeCode.trim())) continue;
    const segment = matchMutualFundSegment(schemeName.trim());
    if (segment) out.push({ symbol: schemeCode.trim(), segment });
  }
  return out;
}
