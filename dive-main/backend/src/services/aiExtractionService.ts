import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import { Instrument, ASSET_CLASSES, AssetClass } from "../models/Instrument";
import { CandidateHolding, missingFieldsFor } from "./fileParsers/types";

export type AiSource =
  | { kind: "image"; data: Buffer; mimeType: string }
  | { kind: "pdf"; data: Buffer };

export type AiExtractionContext = "bot_scan" | "file_upload";

export class AiExtractionNotConfiguredError extends Error {
  constructor() {
    super(
      "AI-based extraction is not configured. Set a real ANTHROPIC_API_KEY in backend/.env — see /docs/GETTING_API_KEYS.md."
    );
    this.name = "AiExtractionNotConfiguredError";
  }
}

export class AiExtractionTimeoutError extends Error {
  constructor() {
    super("The AI took too long to analyze this — try again with fewer screens/pages, or a clearer image.");
    this.name = "AiExtractionTimeoutError";
  }
}

// Always "not configured" in the test environment, even if a real key is
// present in .env for local dev — tests must never spend real API credits or
// depend on network access, same policy as priceHistoryService's real-price
// fetches (gated by env.nodeEnv !== "test").
export function isAiExtractionConfigured(): boolean {
  return env.nodeEnv !== "test" && !env.anthropicApiKeyIsPlaceholder;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Without an explicit timeout, a slow/stuck Claude response (or an under-
  // provisioned deploy — see docs/SERVER_DEPLOYMENT_GUIDE.md) can leave the
  // request hanging far longer than any UI should ever sit spinning, since
  // neither Express nor the frontend axios client set one either (see the
  // matching timeout on the frontend's api.js call, and Nginx's
  // proxy_read_timeout in the deploy guide, both set comfortably longer than
  // this so a slow-but-real response still has a chance to arrive intact).
  // maxRetries: 1 (not the SDK's default of 2) keeps the worst-case total
  // wait bounded at roughly 2x this timeout, not 3x.
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

const ASSET_CLASS_LIST = ASSET_CLASSES.join(", ");

/**
 * The extraction prompt. This is the entire safety net that replaced the old
 * regex/section-marker/noise-blacklist pipeline for images/PDFs
 * (holdingsSectionExtractor.ts, brokerParsers/angelOne.ts, genericRowParser.ts
 * — all deleted, no longer used by anything). The CSV/XLSX/JSON structured-
 * data path never used that pipeline either; it goes through
 * fileParsers/rowNormalizer.ts's broker-agnostic fuzzy column matching
 * instead, a genuinely different piece of code. Every rule below exists
 * because the old heuristic pipeline broke on it in real testing:
 * watchlist/index leakage, garbage short-token rows, and duplicate/triple-
 * counted holdings across repeated or multi-account screenshots.
 */
function buildSystemPrompt(context: AiExtractionContext): string {
  const sourceDescription =
    context === "bot_scan"
      ? "a sequence of screenshots captured by scrolling through one or more live brokerage/investment app screens during a screen-share recording"
      : "one or more uploaded screenshots or documents (which may themselves contain multiple embedded screenshots, e.g. a PDF made of several pasted images) of brokerage/investment portfolios";

  return `You are a meticulous financial data extraction analyst. You will be shown ${sourceDescription}. Your job is to find every REAL investment holding shown across all of them and turn it into a clean, deduplicated, correctly-categorized list — exactly the same three or four facts a user would type in by hand if asked "what do you hold, how much did you invest, and what is it worth now."

## What counts as a holding

A holding is one row/card/tile in a PORTFOLIO or HOLDINGS view: it names one specific instrument (a stock, fund, bond, deposit, coin, etc.) that the account actually OWNS, together with how much was invested and/or what it is worth now.

## What is NOT a holding — exclude all of this, even though it often looks similar

- Watchlist / market-watch panels (a sidebar or list of tickers being tracked, not owned)
- Index or benchmark tickers (NIFTY, SENSEX, BANKNIFTY, NIFTY 50, MIDCAP, gold/silver spot-price tickers shown only as market data, etc.)
- Summary / aggregate cards at the top or bottom of a portfolio screen: "Total Invested", "Current Value", "Overall Gain/Loss", "Day's P&L", "Total Returns", XIRR, portfolio-level percentages — these describe the WHOLE portfolio, not one instrument, and must never become a fake holding row
- Navigation bars, tab labels, menu items, app chrome, buttons ("Add", "Invest more"), search bars
- Advertisements, "recommended for you" / "you may also like" / "top picks" carousels
- Order history, transaction history, or "recent activity" entries that are not the current holdings table itself
- Login screens, account-switcher menus, notifications, disclaimers, footers, page numbers
- Anything explicitly under a "Watchlist", "Market", "Explore", "Discover", or "Indices" heading rather than a "Holdings" / "Portfolio" / "Investments" heading

If you are not looking at a row inside a holdings/portfolio table or an individual position card, do not extract it — when genuinely unsure whether something is a real holding, lower its confidence to "low" and briefly say why in reasoning, but still only include it if it plausibly IS a real position, not watchlist noise.

## Extract, per holding

- **name**: the instrument's name or ticker exactly as shown (e.g. "RELIANCE", "HDFC Flexi Cap Fund", "Embassy REIT", "SBI Fixed Deposit")
- **assetClass**: exactly one of: ${ASSET_CLASS_LIST}
- **investedValue**: the amount originally invested / cost value / purchase value / principal (a plain number, no currency symbols or commas)
- **currentValue**: the current / present / market value (a plain number). If the screen only shows one value (no separate invested vs current), use your best judgement — for most holdings screens both are shown; if genuinely only one number exists, put it in currentValue and set investedValue to null rather than guessing
- **quantity**: number of shares/units, if shown; otherwise null
- For **FD (Fixed Deposit)** specifically, also try to capture: **fdPrincipal**, **fdAnnualRatePercent** (interest rate), **fdTenureMonths**, **fdMaturityDate** (ISO date string if a date is shown, else null) — set any of these to null if not visible. Still fill investedValue with the principal and currentValue with the maturity/current value if shown.

## Asset class guidance (use these cues, not just the word "fund"/"bond" etc.)

- **EQUITY**: individual company stock/shares — plain tickers or company names (RELIANCE, TCS, INFY, HDFC Bank)
- **MUTUAL_FUND**: AMC scheme names, usually containing "Fund", an AMC name (Axis, HDFC, SBI, ICICI Prudential, Nippon, Quant, Parag Parikh, etc.), or shown with a NAV
- **ETF**: exchange-traded funds — names ending in "ETF" or "BEES" (NIFTYBEES, JUNIORBEES) — EXCEPT gold/silver ETFs, which go under GOLD/SILVER instead (see below)
- **BOND**: government or corporate bonds, debentures, G-Sec, NCDs, "Bond" in the name
- **REIT**: Real Estate Investment Trusts (Embassy REIT, Mindspace REIT, Brookfield REIT, Nexus Select Trust)
- **INVIT**: Infrastructure Investment Trusts ("InvIT" in the name, e.g. IRB InvIT, PowerGrid InvIT, India Infra Trust)
- **GOLD**: physical gold, Sovereign Gold Bonds (SGB), OR a gold-tracking ETF/fund (e.g. GOLDBEES, "Gold ETF", "Gold Fund")
- **SILVER**: physical silver, OR a silver-tracking ETF/fund (e.g. SILVERBEES, "Silver ETF")
- **ULIP_INSURANCE**: Unit Linked Insurance Plans / investment-linked life insurance ("ULIP", "life plan", "guaranteed plan")
- **FD**: Fixed Deposits / Term Deposits (bank or corporate)
- **CRYPTO**: cryptocurrencies (Bitcoin, Ethereum, USDT, and other coins/tokens)

If you cannot tell which of the 11 classes applies, make your best guess (most bare tickers on an Indian brokerage app are EQUITY) and set confidence to "low".

## Cross-image reasoning — same account vs. different account (READ CAREFULLY)

You will usually be given MULTIPLE images from the SAME scan or upload. Two situations happen constantly and you must handle both correctly:

1. **Same account, seen more than once.** A screen-share scan scrolls up and down, or a document contains near-duplicate screenshots of the SAME portfolio. The same holding can appear in several images with the exact same branding/layout/header. This is NOT multiple holdings — it is one holding seen multiple times. Merge these into ONE entry for that instrument, using the clearest/most complete reading of its values across the repeated sightings.

2. **Different accounts/brokers, holding the same instrument.** Several images may come from genuinely different brokers or accounts (different branding, colors, layout, or an explicit account name/header) — for example, one set of screenshots from Angel One and another from Zerodha. If the SAME instrument (e.g. Reliance) appears in BOTH, that is legitimately two separate holdings — one per account — because the user actually owns that instrument in two different places. Output them as two separate rows, each with its own accountLabel and its own values.

Concretely: if a Reliance holding appears in 3 screenshots total, and 2 of those screenshots are clearly the same Angel One account (matching branding/layout) while 1 is clearly a different Zerodha account, output exactly TWO Reliance holdings — one for the Angel One account (the 2 Angel One sightings merged into one reading) and one for the Zerodha account — never three, and never just one.

To support this: assign every holding an **accountLabel** — a short label identifying which broker/account/document-section it came from (use the broker's visible name/branding if shown, e.g. "Angel One", "Zerodha", "Groww"; otherwise a generic but CONSISTENT label like "Account 1" / "Account 2" for images you determine belong together). Use the exact same accountLabel string for every holding you attribute to the same account, and different accountLabel strings for holdings you determine come from different accounts. When there is only one account/source across all images, use one consistent accountLabel for everything (e.g. the broker name, or "Account 1").

Decide "same account or different account" using visual evidence: app branding/logo/color scheme, header text, layout structure, and continuity of the holdings list (e.g. alphabetically continuing from one screenshot to the next strongly suggests the same scrolled list). Do not assume every image is a different account, and do not assume every image is the same account — look at the actual visual evidence in each one.

## Accuracy rules

- Never invent a value that is not visible in the source. If a number is genuinely unreadable or absent, use null rather than guessing.
- Never fabricate a holding that isn't actually shown.
- Prefer the most complete, clearest reading when the same holding is seen more than once (see above).
- Set confidence to "high" when the row is clearly a holdings-table entry with clean numbers, "medium" when categorization or a value is a reasonable inference, "low" when you are genuinely unsure whether this is real holdings data at all.
- In the reasoning field, briefly note anything a human reviewer should double check (e.g. "value partially obscured", "ticker guessed from partial text", "assumed same account as previous image based on matching layout").

## Output

Populate the excludedNotes field with a short one- or two-sentence summary of what you filtered out and why (e.g. "Ignored a watchlist sidebar showing ELECTCAST and SHYAMMETL, and summary cards for Invested/Current/Gain totals."). Every holding you output must be a real, distinct, correctly-deduplicated position — this list is shown directly to the user for a final review before saving, so precision matters more than recall: when genuinely torn between including or excluding a row, exclude it and mention it in excludedNotes instead.`;
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    holdings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          assetClass: { type: "string", enum: [...ASSET_CLASSES] },
          investedValue: { anyOf: [{ type: "number" }, { type: "null" }] },
          currentValue: { anyOf: [{ type: "number" }, { type: "null" }] },
          quantity: { anyOf: [{ type: "number" }, { type: "null" }] },
          fdPrincipal: { anyOf: [{ type: "number" }, { type: "null" }] },
          fdAnnualRatePercent: { anyOf: [{ type: "number" }, { type: "null" }] },
          fdTenureMonths: { anyOf: [{ type: "number" }, { type: "null" }] },
          fdMaturityDate: { anyOf: [{ type: "string" }, { type: "null" }] },
          accountLabel: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reasoning: { type: "string" },
        },
        required: [
          "name",
          "assetClass",
          "investedValue",
          "currentValue",
          "quantity",
          "fdPrincipal",
          "fdAnnualRatePercent",
          "fdTenureMonths",
          "fdMaturityDate",
          "accountLabel",
          "confidence",
          "reasoning",
        ],
        additionalProperties: false,
      },
    },
    excludedNotes: { type: "string" },
  },
  required: ["holdings", "excludedNotes"],
  additionalProperties: false,
} as const;

interface AiHoldingRaw {
  name: string;
  assetClass: AssetClass;
  investedValue: number | null;
  currentValue: number | null;
  quantity: number | null;
  fdPrincipal: number | null;
  fdAnnualRatePercent: number | null;
  fdTenureMonths: number | null;
  fdMaturityDate: string | null;
  accountLabel: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface AiExtractedHolding extends CandidateHolding {
  accountLabel: string;
  reasoning: string;
  fdPrincipal: number | null;
  fdAnnualRatePercent: number | null;
  fdTenureMonths: number | null;
  fdMaturityDate: string | null;
}

export interface AiExtractionResult {
  holdings: AiExtractedHolding[];
  excludedNotes: string;
}

export async function extractHoldingsWithAI(
  sources: AiSource[],
  context: AiExtractionContext
): Promise<AiExtractionResult> {
  if (!isAiExtractionConfigured()) throw new AiExtractionNotConfiguredError();
  if (sources.length === 0) return { holdings: [], excludedNotes: "" };

  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const source of sources) {
    if (source.kind === "image") {
      content.push({
        type: "image",
        source: { type: "base64", media_type: source.mimeType as any, data: source.data.toString("base64") },
      });
    } else {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: source.data.toString("base64") },
      });
    }
  }
  content.push({
    type: "text",
    text:
      sources.length > 1
        ? `Above are ${sources.length} images/documents from the same scan or upload session. Analyze all of them together as described in your instructions and return the final, deduplicated holdings list.`
        : "Above is one image/document. Extract the holdings as described in your instructions.",
  });

  let response: Anthropic.Messages.Message;
  try {
    response = await getClient().messages.create({
      // Sonnet 5 handles this vision-extraction task well at roughly half the
      // per-token cost of Opus 5 and near-Opus quality on structured
      // extraction — a better cost/quality fit for a task run on every scan
      // and every image/PDF upload than the top-tier model.
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: buildSystemPrompt(context),
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiExtractionTimeoutError();
    throw err;
  }

  const textBlock = response.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  if (!textBlock) return { holdings: [], excludedNotes: "The AI model returned no readable output." };

  let parsed: { holdings: AiHoldingRaw[]; excludedNotes: string };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return { holdings: [], excludedNotes: "The AI model's response could not be parsed." };
  }

  const rawHoldings = parsed.holdings || [];
  const matches = await verifyAgainstInstrumentMasterBatch(rawHoldings);

  const holdings: AiExtractedHolding[] = rawHoldings.map((raw, i) => {
    const { instrumentId, verifiedInInstrumentList, matchedName } = matches[i];
    const candidate: AiExtractedHolding = {
      name: matchedName || raw.name,
      assetClass: raw.assetClass,
      instrumentId,
      investedValue: raw.investedValue,
      currentValue: raw.currentValue,
      quantity: raw.quantity,
      confidence: raw.confidence,
      verifiedInInstrumentList,
      missingFields: [],
      rawRow: { accountLabel: raw.accountLabel, reasoning: raw.reasoning },
      accountLabel: raw.accountLabel,
      reasoning: raw.reasoning,
      fdPrincipal: raw.fdPrincipal,
      fdAnnualRatePercent: raw.fdAnnualRatePercent,
      fdTenureMonths: raw.fdTenureMonths,
      fdMaturityDate: raw.fdMaturityDate,
    };
    candidate.missingFields = missingFieldsFor(candidate);
    return candidate;
  });

  return { holdings, excludedNotes: parsed.excludedNotes || "" };
}

interface InstrumentCandidate {
  _id: unknown;
  symbol?: string;
  name: string;
  assetClass: AssetClass;
}

type InstrumentMatch = { instrumentId: string | null; verifiedInInstrumentList: boolean; matchedName: string | null };

// Replaces what used to be up to 2 sequential findOne round-trips PER
// extracted holding (20-60 round-trips for a typical 20-30-item scan,
// stacked on top of the already-slow Claude call) with exactly ONE query
// for the whole batch — every instrument in the asset classes actually
// present here, matched against each raw holding in memory instead of at
// the database. Only the 3 fields the matching logic needs are pulled, so
// even a class with thousands of entries (EQUITY) is a cheap payload
// compared to the network round-trip latency this eliminates.
export async function verifyAgainstInstrumentMasterBatch(
  raws: Array<{ name: string; assetClass: AssetClass }>
): Promise<InstrumentMatch[]> {
  const uniqueClasses = Array.from(new Set(raws.map((r) => r.assetClass)));
  if (uniqueClasses.length === 0) return [];

  const candidates: InstrumentCandidate[] = await Instrument.find({ assetClass: { $in: uniqueClasses } })
    .select("symbol name assetClass")
    .lean();

  const byClass = new Map<AssetClass, InstrumentCandidate[]>();
  for (const c of candidates) {
    const list = byClass.get(c.assetClass);
    if (list) list.push(c);
    else byClass.set(c.assetClass, [c]);
  }

  return raws.map((raw): InstrumentMatch => {
    const trimmed = raw.name.trim();
    if (!trimmed) return { instrumentId: null, verifiedInInstrumentList: false, matchedName: null };
    const pool = byClass.get(raw.assetClass) || [];
    const lowerTrimmed = trimmed.toLowerCase();

    // Same two-pass semantics as the original per-item regex queries: an
    // exact (case-insensitive, full-string) symbol match first, falling
    // back to a substring (case-insensitive, anywhere) name match.
    const symbolMatch = pool.find((c) => c.symbol && c.symbol.toLowerCase() === lowerTrimmed);
    if (symbolMatch) {
      return { instrumentId: String(symbolMatch._id), verifiedInInstrumentList: true, matchedName: symbolMatch.name };
    }

    const nameMatch = pool.find((c) => c.name.toLowerCase().includes(lowerTrimmed));
    if (nameMatch) {
      return { instrumentId: String(nameMatch._id), verifiedInInstrumentList: true, matchedName: nameMatch.name };
    }

    return { instrumentId: null, verifiedInInstrumentList: false, matchedName: null };
  });
}
