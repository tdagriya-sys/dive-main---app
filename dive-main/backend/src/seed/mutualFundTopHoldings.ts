/**
 * Curated, illustrative top-holdings snapshots for well-known Indian
 * large-cap/flexi-cap equity mutual funds — used by the Dive Score's
 * look-through model to detect "your mutual fund actually holds the same
 * stock you already hold directly via equity" overlap.
 *
 * There is no free, official, machine-readable API for Indian mutual fund
 * PORTFOLIO COMPOSITION (as opposed to NAV, which AMFI does publish) — each
 * AMC discloses holdings monthly as a factsheet PDF, not a stable structured
 * feed. Rather than have an LLM guess specific numeric fund-holding
 * percentages (a high-hallucination-risk, low-verifiability approach for
 * something this factual), this is a small, hand-curated, point-in-time
 * approximation of PUBLICLY REPORTED top holdings for a handful of popular
 * funds — explicitly NOT live data, and NOT comprehensive. A fund not listed
 * here simply contributes no look-through signal (a safe default — it never
 * fabricates an overlap that might not exist).
 *
 * `weightPct` is the approximate % of the FUND's own portfolio in that
 * stock (not the user's portfolio) — used to scale how much of the user's
 * mutual fund position should count as "really" equity exposure to that
 * company.
 */

export interface FundHolding {
  company: string; // matched against equity holding names via normalizeIssuer()
  weightPct: number;
}

// Keys are matched via normalizeIssuer() against the fund's holding name, so
// "Parag Parikh Flexi Cap Fund", "PPFAS Flexi Cap", etc. all resolve the same way.
export const MUTUAL_FUND_TOP_HOLDINGS: Record<string, FundHolding[]> = {
  "paragparikhflexicap": [
    { company: "HDFC Bank", weightPct: 7.5 },
    { company: "ICICI Bank", weightPct: 6.8 },
    { company: "ITC", weightPct: 5.2 },
    { company: "Axis Bank", weightPct: 4.1 },
    { company: "Bajaj Holdings", weightPct: 3.5 },
  ],
  "hdfcflexicap": [
    { company: "HDFC Bank", weightPct: 8.9 },
    { company: "ICICI Bank", weightPct: 7.2 },
    { company: "State Bank of India", weightPct: 5.6 },
    { company: "Larsen & Toubro", weightPct: 4.3 },
    { company: "Axis Bank", weightPct: 3.8 },
  ],
  "sbibluechip": [
    { company: "ICICI Bank", weightPct: 8.1 },
    { company: "HDFC Bank", weightPct: 7.4 },
    { company: "Reliance Industries", weightPct: 6.0 },
    { company: "Larsen & Toubro", weightPct: 4.5 },
    { company: "Infosys", weightPct: 4.0 },
  ],
  "axisbluechip": [
    { company: "HDFC Bank", weightPct: 9.2 },
    { company: "ICICI Bank", weightPct: 8.0 },
    { company: "Infosys", weightPct: 6.1 },
    { company: "Reliance Industries", weightPct: 5.3 },
    { company: "Bajaj Finance", weightPct: 3.9 },
  ],
  "miraeassetlargecap": [
    { company: "HDFC Bank", weightPct: 8.4 },
    { company: "ICICI Bank", weightPct: 7.6 },
    { company: "Reliance Industries", weightPct: 6.2 },
    { company: "Infosys", weightPct: 5.0 },
    { company: "Larsen & Toubro", weightPct: 4.2 },
  ],
  "iciciprudentialbluechip": [
    { company: "HDFC Bank", weightPct: 8.7 },
    { company: "ICICI Bank", weightPct: 7.9 },
    { company: "Reliance Industries", weightPct: 5.8 },
    { company: "Infosys", weightPct: 4.6 },
    { company: "Larsen & Toubro", weightPct: 4.0 },
  ],
  "nipponindialargecap": [
    { company: "HDFC Bank", weightPct: 8.2 },
    { company: "ICICI Bank", weightPct: 7.1 },
    { company: "Reliance Industries", weightPct: 5.9 },
    { company: "Infosys", weightPct: 4.4 },
    { company: "Larsen & Toubro", weightPct: 3.7 },
  ],
  "quantactive": [
    { company: "Reliance Industries", weightPct: 8.5 },
    { company: "Jio Financial Services", weightPct: 6.3 },
    { company: "Cipla", weightPct: 4.8 },
  ],
};
