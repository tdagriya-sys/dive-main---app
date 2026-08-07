import { Instrument } from "../models/Instrument";
import { STATIC_INSTRUMENTS, SeedInstrument } from "../seed/staticInstruments";
import {
  fetchAmfiMutualFunds,
  fetchAmfiSectoralFundSegments,
  fetchCoinGeckoCoins,
  fetchCoinGeckoSegments,
  fetchNseEquities,
  fetchNseEtfs,
  fetchNseIndustryClassification,
  fetchNseMarketCapTiers,
} from "./instrumentSources";

export interface RefreshSummary {
  source: string;
  fetched: number;
  added: number;
  updated: number;
  failed: number;
  error?: string;
}

async function upsertBatch(rows: SeedInstrument[], source: string): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const res = await Instrument.findOneAndUpdate(
      { assetClass: row.assetClass, symbol: row.symbol },
      {
        $set: {
          name: row.name,
          issuer: row.issuer,
          exchange: row.exchange,
          isActive: true,
          source,
          metadata: row.metadata || {},
          lastRefreshedAt: new Date(),
        },
      },
      { upsert: true, new: false }
    );
    if (res) updated += 1;
    else added += 1;
  }
  return { added, updated };
}

/**
 * Refreshes the Instrument master collection across all 11 asset classes.
 * Live public sources: Equity (NSE), ETF (NSE — also reclassifies gold/silver
 * commodity ETFs into GOLD/SILVER by their listed "Underlying"), Mutual Funds
 * (AMFI), Crypto (CoinGecko). No clean public master-list source exists for
 * REIT/InvIT (India has only a small, enumerable set of each — NSE's own
 * archives don't include them), Sovereign Gold Bonds, ULIP/insurance plans
 * (proprietary insurer products), or FD-issuing banks — those stay on the
 * bundled static list, kept as accurate as we can make it by hand. Always
 * seeds/re-asserts the static list first, then layers live sources on top.
 * Any live source that fails (offline, rate-limited, layout changed) is
 * logged and skipped — it never aborts the whole run.
 */
export async function runInstrumentRefresh(): Promise<RefreshSummary[]> {
  const summaries: RefreshSummary[] = [];

  const staticRes = await upsertBatch(STATIC_INSTRUMENTS, "SEED");
  summaries.push({ source: "SEED", fetched: STATIC_INSTRUMENTS.length, ...staticRes, failed: 0 });

  for (const [name, fetcher] of Object.entries({
    AMFI: fetchAmfiMutualFunds,
    COINGECKO: fetchCoinGeckoCoins,
    NSE: fetchNseEquities,
    NSE_ETF: fetchNseEtfs,
  })) {
    try {
      const rows = await fetcher();
      const res = await upsertBatch(rows, name);
      summaries.push({ source: name, fetched: rows.length, ...res, failed: 0 });
    } catch (err) {
      summaries.push({
        source: name,
        fetched: 0,
        added: 0,
        updated: 0,
        failed: 1,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Runs AFTER the NSE equity upsert above (which resets `metadata` to `{}`
  // on every refresh) so this targeted `metadata.sector` set always lands on
  // top rather than being wiped by it. Used for the Dive Score's look-through
  // model (e.g. detecting a Realty-sector stock's overlap with a REIT holding)
  // — see services/lookthroughService.ts.
  try {
    const industryRows = await fetchNseIndustryClassification();
    let sectorUpdated = 0;
    for (const row of industryRows) {
      const res = await Instrument.updateOne(
        { assetClass: "EQUITY", symbol: row.symbol },
        { $set: { "metadata.sector": row.industry } }
      );
      if (res.matchedCount > 0) sectorUpdated += 1;
    }
    summaries.push({ source: "NSE_SECTOR", fetched: industryRows.length, added: 0, updated: sectorUpdated, failed: 0 });
  } catch (err) {
    summaries.push({
      source: "NSE_SECTOR",
      fetched: 0,
      added: 0,
      updated: 0,
      failed: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Same pattern again — Nifty 100/Midcap 150/Smallcap 250 constituent lists
  // tag each equity's market-cap tier, used for the Dive Score's equity
  // "quality mix" check (see diveScoreService.ts).
  try {
    const tierRows = await fetchNseMarketCapTiers();
    let tierUpdated = 0;
    for (const row of tierRows) {
      const res = await Instrument.updateOne(
        { assetClass: "EQUITY", symbol: row.symbol },
        { $set: { "metadata.marketCapTier": row.tier } }
      );
      if (res.matchedCount > 0) tierUpdated += 1;
    }
    summaries.push({ source: "NSE_MARKETCAP", fetched: tierRows.length, added: 0, updated: tierUpdated, failed: 0 });
  } catch (err) {
    summaries.push({
      source: "NSE_MARKETCAP",
      fetched: 0,
      added: 0,
      updated: 0,
      failed: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Same pattern as NSE_SECTOR above, runs after the COINGECKO upsert (which
  // resets metadata) so this targeted set always lands on top. Only a small
  // curated set of broad crypto segments (Layer 1, DeFi, Meme, etc.) is
  // tagged — see fetchCoinGeckoSegments for why per-coin categories aren't
  // used directly.
  try {
    const cryptoSegments = await fetchCoinGeckoSegments();
    let cryptoSegmentUpdated = 0;
    for (const row of cryptoSegments) {
      const res = await Instrument.updateOne(
        { assetClass: "CRYPTO", "metadata.coingeckoId": row.coingeckoId },
        { $set: { "metadata.sector": row.segment } }
      );
      if (res.matchedCount > 0) cryptoSegmentUpdated += 1;
    }
    summaries.push({ source: "CRYPTO_SEGMENT", fetched: cryptoSegments.length, added: 0, updated: cryptoSegmentUpdated, failed: 0 });
  } catch (err) {
    summaries.push({
      source: "CRYPTO_SEGMENT",
      fetched: 0,
      added: 0,
      updated: 0,
      failed: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Same pattern again, runs after the AMFI upsert. Only AMFI-classified
  // Sectoral/Thematic mutual funds get a sector tag — see
  // fetchAmfiSectoralFundSegments for why diversified fund categories (Large
  // Cap, Flexi Cap, etc.) are deliberately skipped.
  try {
    const mfSegments = await fetchAmfiSectoralFundSegments();
    let mfSegmentUpdated = 0;
    for (const row of mfSegments) {
      const res = await Instrument.updateOne(
        { assetClass: "MUTUAL_FUND", symbol: row.symbol },
        { $set: { "metadata.sector": row.segment } }
      );
      if (res.matchedCount > 0) mfSegmentUpdated += 1;
    }
    summaries.push({ source: "MF_SEGMENT", fetched: mfSegments.length, added: 0, updated: mfSegmentUpdated, failed: 0 });
  } catch (err) {
    summaries.push({
      source: "MF_SEGMENT",
      fetched: 0,
      added: 0,
      updated: 0,
      failed: 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    "[instrumentRefresh]",
    summaries.map((s) => `${s.source}: +${s.added} ~${s.updated} (${s.fetched} fetched${s.error ? `, error: ${s.error}` : ""})`).join(" | ")
  );

  return summaries;
}

export async function searchInstruments(assetClass: string | undefined, q: string | undefined, limit = 20) {
  const filter: Record<string, unknown> = { isActive: true };
  if (assetClass) filter.assetClass = assetClass;
  if (q && q.trim()) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = { $regex: escaped, $options: "i" };
    // Matches on company name ("Reliance") or ticker symbol ("RELIANCE") —
    // broker holdings pages show symbols, not full names.
    filter.$or = [{ name: pattern }, { symbol: pattern }];
  }
  return Instrument.find(filter).limit(limit).sort({ name: 1 }).lean();
}
