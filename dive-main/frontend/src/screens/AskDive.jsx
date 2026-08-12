import React, { useState, useEffect } from "react";
import { Search, ArrowLeft, ChevronLeft, TrendingUp, TrendingDown, AlertTriangle, Minus } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import {
  effectiveHoldings, diveScore, apparentDiversification, realDiversification,
  topExposure, totalInvested, fmtINR, ASSET_CLASS_LABELS, normalizeIssuer,
} from "../lib/diveEngine";

const FIELD_META = {
  currentPrice: { label: "Current price", fmt: "inr" },
  dayHigh: { label: "Day high", fmt: "inr" },
  dayLow: { label: "Day low", fmt: "inr" },
  fiftyTwoWeekHigh: { label: "52-week high", fmt: "inr" },
  fiftyTwoWeekLow: { label: "52-week low", fmt: "inr" },
  volume: { label: "Volume (shares)", fmt: "num" },
  longName: { label: "Full name", fmt: "text" },
  currentPriceInr: { label: "Current price", fmt: "inr" },
  marketCapInr: { label: "Market cap", fmt: "inr" },
  marketCapRank: { label: "Market cap rank", fmt: "rank" },
  totalVolume24hInr: { label: "24h volume", fmt: "inr" },
  high24hInr: { label: "24h high", fmt: "inr" },
  low24hInr: { label: "24h low", fmt: "inr" },
  change24hPct: { label: "24h change", fmt: "pct" },
  change7dPct: { label: "7d change", fmt: "pct" },
  athInr: { label: "All-time high", fmt: "inr" },
  athChangePct: { label: "From all-time high", fmt: "pct" },
  circulatingSupply: { label: "Circulating supply", fmt: "num" },
  maxSupply: { label: "Max supply", fmt: "num" },
  latestNav: { label: "Latest NAV", fmt: "inr2" },
  navDate: { label: "NAV date", fmt: "text" },
  schemeCategory: { label: "Scheme category", fmt: "text" },
  fundHouse: { label: "Fund house", fmt: "text" },
  return1yPct: { label: "1-year return", fmt: "pct" },
};

function fmtField(value, fmt) {
  if (value === null || value === undefined || value === "") return "—";
  switch (fmt) {
    case "inr": return fmtINR(value);
    case "inr2": return "₹" + Number(value).toFixed(2);
    case "pct": return `${value >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
    case "num": return Number(value).toLocaleString("en-IN");
    case "rank": return `#${value}`;
    default: return String(value);
  }
}

function LiveDataCard({ detailLoading, detail }) {
  if (detailLoading) {
    return (
      <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)]" data-testid="ask-live-data-loading">
        <p className="text-sm text-[var(--text-secondary)]">Fetching live data…</p>
      </div>
    );
  }
  if (!detail || !detail.available) {
    return (
      <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)]" data-testid="ask-live-data-unavailable">
        <p className="text-sm font-bold mb-1">Fundamental / technical data</p>
        <p className="text-sm text-[var(--text-secondary)]">{detail?.reason || "Not available for this instrument."}</p>
      </div>
    );
  }
  const entries = Object.entries(detail.fields || {}).filter(([k]) => FIELD_META[k]);
  return (
    <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)]" data-testid="ask-live-data-card">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-bold">Fundamental / technical data</p>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{detail.source}</span>
      </div>
      {entries.map(([key, value], i) => (
        <div key={key} className={`flex items-center justify-between text-sm ${i === 0 ? "mt-3 pt-3 border-t border-[var(--border-light)]" : "mt-2"}`}>
          <span className="text-[var(--text-secondary)]">{FIELD_META[key].label}</span>
          <span className="font-bold">{fmtField(value, FIELD_META[key].fmt)}</span>
        </div>
      ))}
    </div>
  );
}

function FitForYouCard({ selected, holdings, sims, simAmount, setSimAmount, scoreBreakdown }) {
  const baseHoldings = effectiveHoldings(holdings, sims);
  const total = totalInvested(baseHoldings);
  // Bounded to a sensible multiple of the existing portfolio (never chases
  // whatever value simAmount happens to be dragged to) — see docs/DIVE_SCORE_MODEL.md §13.
  const sliderMax = Math.max(100000, total * 2);

  const segment = ASSET_CLASS_LABELS[selected.assetClass] || selected.assetClass;
  const issuerName = selected.issuer || selected.name;
  const extra = { segment, amount: simAmount, name: issuerName };

  // Anchor on the ONE canonical DIVVE Score (the real, resilience-inclusive
  // composite — same number Home/Suggestions show) and apply the fast
  // concentration-only formula's ESTIMATED DELTA on top, exactly like
  // Suggestions' SimulateSheet — never show the lightweight concentration
  // formula's own absolute value as if it were a second, competing score.
  const baseScore = scoreBreakdown?.hasHoldings ? scoreBreakdown.compositeScore : diveScore(baseHoldings);
  const rawDelta = diveScore(baseHoldings, extra) - diveScore(baseHoldings);
  // rawDelta lives on the concentration-only formula's own 100-point scale;
  // concentration is only one of ~10 sub-scores in the real composite
  // (DIVE_SCORE_V2_WEIGHTS.concentration = 0.17). Scaling by that weight keeps
  // this estimate proportional to concentration's real share of the score
  // instead of overstating it 1:1 — see SimulateSheet in Suggestions.jsx and
  // docs/DIVE_SCORE_MODEL.md §13 for the full rationale.
  const concentrationWeight = scoreBreakdown?.weights?.concentration ?? 0.17;
  const scaledDelta = rawDelta * concentrationWeight;
  const newScore = Math.max(0, Math.min(100, Math.round(baseScore + scaledDelta)));
  const scoreDelta = newScore - baseScore;

  // Same anchor-on-canonical-plus-estimated-delta pattern as baseScore/newScore
  // above — the lightweight client-side apparentDiversification()/
  // realDiversification() formulas don't have the backend's full look-through
  // model (mutual fund top-holdings, curated affinities, NSE industry
  // affinity, etc.), so their ABSOLUTE values can disagree with the real
  // scoreBreakdown.realDiversificationPct shown on Home/X-Ray (e.g. showing
  // apparent and real as equal when the canonical figures aren't). Using them
  // only for the DELTA of adding this one holding, applied on top of the real
  // starting point, keeps the displayed "before" numbers consistent with the
  // rest of the app while still getting an instant, correct-directioned "after".
  const baseAppRaw = apparentDiversification(baseHoldings);
  const newAppRaw = apparentDiversification(baseHoldings, extra);
  const baseRealRaw = realDiversification(baseHoldings);
  const newRealRaw = realDiversification(baseHoldings, extra);
  const hasCanonical = !!scoreBreakdown?.hasHoldings;
  const baseApp = hasCanonical ? scoreBreakdown.apparentDiversificationPct : baseAppRaw;
  const baseReal = hasCanonical ? scoreBreakdown.realDiversificationPct : baseRealRaw;
  const newApp = Math.max(0, Math.min(100, Math.round(baseApp + (newAppRaw - baseAppRaw))));
  // Real can never exceed apparent — same invariant the backend composite
  // itself enforces (real only ever reveals MORE hidden concentration).
  const newReal = Math.min(newApp, Math.max(0, Math.min(100, Math.round(baseReal + (newRealRaw - baseRealRaw)))));

  const baseTop = topExposure(baseHoldings);
  const newTop = topExposure(baseHoldings, extra);
  const issuerLc = issuerName.toLowerCase();
  const wouldBeTopHolding = newTop.pct > 0 && newTop.name &&
    (newTop.name.toLowerCase() === issuerLc || newTop.name.toLowerCase().includes(issuerLc) || issuerLc.includes(newTop.name.toLowerCase()));

  const issuerKey = normalizeIssuer(issuerName) || issuerLc;
  const existingSameIssuer = baseHoldings.filter((h) => (normalizeIssuer(h.name) || h.name.toLowerCase()) === issuerKey);

  const deltaColor = scoreDelta > 0 ? "text-[var(--green)]" : scoreDelta < 0 ? "text-[var(--red)]" : "text-[var(--text-secondary)]";
  const DeltaIcon = scoreDelta > 0 ? TrendingUp : scoreDelta < 0 ? TrendingDown : Minus;

  return (
    <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)]" data-testid="ask-fit-for-you-card">
      <p className="text-sm font-bold mb-3">Fit for you</p>
      <p className="text-xs text-[var(--text-secondary)] mb-2">If you added this much:</p>
      <input type="range" min={1000} max={sliderMax} step={1000} value={simAmount}
        onChange={(e) => setSimAmount(Number(e.target.value))}
        className="w-full accent-[var(--dive-blue)]" data-testid="ask-fit-amount-slider" />
      <div className="flex justify-between text-xs text-[var(--text-tertiary)] mb-4">
        <span>₹1,000</span>
        <span className="font-bold text-[var(--text-primary)]">{fmtINR(simAmount)}</span>
        <span>{fmtINR(sliderMax)}</span>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[var(--border-light)]">
        <span className="text-sm text-[var(--text-secondary)]">DIVVE Score</span>
        <span className={`font-bold text-sm flex items-center gap-1 ${deltaColor}`} data-testid="ask-fit-score-delta">
          <DeltaIcon size={14} /> {baseScore} → {newScore} ({scoreDelta > 0 ? "+" : ""}{scoreDelta})
        </span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm text-[var(--text-secondary)]">Apparent diversification</span>
        <span className="font-bold text-sm">{Math.round(baseApp)}% → {Math.round(newApp)}%</span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm text-[var(--text-secondary)]">Real diversification</span>
        <span className="font-bold text-sm">{Math.round(baseReal)}% → {Math.round(newReal)}%</span>
      </div>

      {wouldBeTopHolding && (
        <div className="flex items-start gap-2 mt-4 bg-[var(--red)]/10 border border-[var(--red)]/20 rounded-xl px-4 py-3" data-testid="ask-fit-concentration-warning">
          <AlertTriangle size={16} className="text-[var(--red)] shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-[var(--red)]">
            This would become your single largest exposure at {newTop.pct.toFixed(0)}% of your portfolio{baseTop.name === newTop.name ? "" : ` (currently ${baseTop.name}, ${baseTop.pct.toFixed(0)}%)`}.
          </p>
        </div>
      )}

      {existingSameIssuer.length > 0 && (
        <div className="flex items-start gap-2 mt-3 bg-[var(--amber)]/10 border border-[var(--amber)]/20 rounded-xl px-4 py-3" data-testid="ask-fit-issuer-overlap-note">
          <AlertTriangle size={16} className="text-[var(--amber)] shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-[var(--amber)]">
            You already hold {issuerName} via {[...new Set(existingSameIssuer.map((h) => h.segment))].join(", ")} — this adds to the same issuer rather than diversifying you further.
          </p>
        </div>
      )}
    </div>
  );
}

export default function AskDive() {
  const { goBack, holdings, sims, scoreBreakdown, user } = useDive();
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [simAmount, setSimAmount] = useState(5000);

  useEffect(() => {
    if (!q || q.length < 2) { setList([]); return; }
    // /instruments/search requires auth — for a logged-out demo visitor this
    // would 401 on every keystroke and land on the generic "no instruments
    // match" message below, which reads as a real empty result rather than
    // what it actually is (search was never allowed to run at all).
    if (!user) { setList([]); return; }
    const t = setTimeout(() => {
      api.get("/instruments/search", { params: { q } }).then((r) => setList(r.data.instruments || [])).catch(() => setList([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, user]);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    setDetailLoading(true);
    api.get(`/instruments/${selected._id}/detail`)
      .then((r) => setDetail(r.data.detail))
      .catch(() => setDetail({ available: false, reason: "Couldn't load live data right now." }))
      .finally(() => setDetailLoading(false));

    const base = effectiveHoldings(holdings, sims);
    const total = totalInvested(base);
    setSimAmount(Math.max(5000, Math.round((total * 0.05) / 1000) * 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (selected) {
    return (
      <div className="min-h-full dive-app-surface pb-24" data-testid="ask-verdict-screen">
        <div className="px-6 pt-8">
          <button data-testid="ask-back-btn" onClick={() => setSelected(null)} className="flex items-center gap-1 text-[var(--text-secondary)] font-semibold text-sm mb-3">
            <ArrowLeft size={18} /> Back
          </button>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{selected.assetClass} {selected.exchange ? `· ${selected.exchange}` : ""}</p>
          <h1 className="font-heading font-black text-2xl">{selected.name}</h1>
        </div>

        <div className="px-6 mt-5 space-y-4">
          <div className="bg-[var(--surface-card)] rounded-2xl p-5 border border-[var(--border)]">
            {selected.issuer && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Issuer</span>
                <span className="font-bold">{selected.issuer}</span>
              </div>
            )}
            <div className={`flex items-center justify-between text-sm ${selected.issuer ? "mt-3 pt-3 border-t border-[var(--border-light)]" : ""}`}>
              <span className="text-[var(--text-secondary)]">Symbol</span>
              <span className="font-bold">{selected.symbol}</span>
            </div>
          </div>

          <LiveDataCard detailLoading={detailLoading} detail={detail} />

          <FitForYouCard selected={selected} holdings={holdings} sims={sims} simAmount={simAmount} setSimAmount={setSimAmount} scoreBreakdown={scoreBreakdown} />
        </div>

        <div className="px-6 mt-5">
          <div className="bg-[var(--amber)]/10 border border-[var(--amber)]/20 rounded-xl px-4 py-3 text-xs font-semibold text-[var(--amber)]">
            ⚠️ Nothing here is financial advice — always do your own research or consult an advisor.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full dive-app-surface pb-24" data-testid="ask-screen">
      <div className="px-6 pt-8">
        <div className="flex items-center gap-3 mb-1">
          <button data-testid="ask-screen-back-btn" onClick={goBack}><ChevronLeft size={22} /></button>
          <h1 className="font-heading font-black text-2xl">Ask DIVVE</h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-5">Search the instrument master for any stock, fund, or bond.</p>
        <div className="flex items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
          <Search size={18} className="text-[var(--text-tertiary)] mr-2" />
          <input data-testid="ask-search-input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search any stock, fund, or bond…" className="flex-1 outline-none font-medium text-sm bg-transparent text-[var(--text-primary)]" />
        </div>
      </div>
      <div className="px-6 mt-5">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Results</p>
        <div className="space-y-3">
          {list.map((i) => (
            <button key={i._id} data-testid={`ask-item-${i._id}`} onClick={() => setSelected(i)}
              className="w-full flex items-center justify-between text-left bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)] hover:shadow-md transition-all">
              <div>
                <p className="font-bold text-sm">{i.name}</p>
                <p className="text-xs text-[var(--text-secondary)]">{i.assetClass} · {i.symbol}</p>
              </div>
              <span className="text-[var(--dive-blue)] font-bold text-sm">Ask →</span>
            </button>
          ))}
          {q.length >= 2 && !user && (
            <p className="text-sm text-[var(--text-secondary)] text-center py-6" data-testid="ask-signup-required">
              Sign up to search real stocks, funds, and bonds — this preview can't look them up yet.
            </p>
          )}
          {q.length >= 2 && user && list.length === 0 && <p className="text-sm text-[var(--text-secondary)] text-center py-6">No instruments match "{q}".</p>}
          {q.length < 2 && <p className="text-sm text-[var(--text-secondary)] text-center py-6">Type at least 2 characters to search.</p>}
        </div>
      </div>
    </div>
  );
}
