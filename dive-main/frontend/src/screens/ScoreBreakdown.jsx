import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2, Info } from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import { ScoreRing } from "../components/dive/Widgets";
import { scoreColor, fmtINR, ASSET_CLASS_LABELS } from "../lib/diveEngine";
import { contextSummaryMessage } from "../lib/contextMessaging";

const SUB_SCORE_META = {
  concentration: { label: "Concentration", blurb: "How spread out your money is across distinct holdings (name-level, not fund look-through)." },
  volatility: { label: "Volatility", blurb: "How much your portfolio's daily value swings, annualized." },
  drawdown: { label: "Drawdown resilience", blurb: "The worst peak-to-trough drop this mix would have taken, and how fast it recovers." },
  var: { label: "Value at Risk", blurb: "A 1-in-20 day's worth of potential loss, in ₹." },
  liquidity: { label: "Liquidity", blurb: "How easily this mix could be converted to cash without a discount." },
  beta: { label: "Market sensitivity", blurb: "How much your portfolio tends to move with the Nifty 50 — lower means more resilient in a market-wide selloff." },
  correlation: { label: "Diversification (correlation)", blurb: "How independently your asset classes move from each other — lower average correlation is better." },
  diversificationRatio: { label: "Diversification ratio", blurb: "How much smoother your portfolio's ride is versus holding each piece alone." },
  contextFit: { label: "Fit for your situation", blurb: "How well your mix covers what actually makes sense right now, given your corpus size and life stage — not a demand to hold all 11 asset classes." },
  stockCountFit: { label: "Stock-count band", blurb: "Too few equity stocks (under ~10-12) is real concentration risk; too many (past ~30-40) brings diminishing returns and unmanageable overlap — this rewards a healthy middle band, not \"more names is always better\"." },
};

const SUB_SCORE_ORDER = ["concentration", "volatility", "drawdown", "var", "liquidity", "beta", "correlation", "diversificationRatio", "contextFit", "stockCountFit"];

function correlationColor(v) {
  if (v >= 0.6) return "#F87171";
  if (v >= 0.3) return "#FBBF24";
  if (v >= 0) return "#E3B856";
  return "#34D399";
}

export default function ScoreBreakdown() {
  const { setScreen } = useDive();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/score/breakdown");
        setData(data);
      } catch (e) {
        setError("Couldn't load your score breakdown — please try again.");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col min-h-full px-7 py-8 dive-app-surface" data-testid="score-breakdown-screen">
      <div className="flex items-center gap-3 mb-4">
        <button data-testid="score-breakdown-back-btn" onClick={() => setScreen("home")}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">Score Breakdown</h1>
      </div>

      {error && <p className="text-xs text-[var(--red)] font-semibold mb-4">{error}</p>}

      {!data && !error && (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <Loader2 size={28} className="animate-spin text-[var(--dive-blue)] mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">Computing volatility, drawdown, correlation and more…</p>
        </div>
      )}

      {data && !data.hasHoldings && (
        <p className="text-sm text-[var(--text-secondary)]">Add some investments first and DIVVE will compute your full resilience score.</p>
      )}

      {data && data.hasHoldings && (
        <>
          <p className="text-xs text-[var(--text-secondary)] mb-6 leading-relaxed">
            This is the same DIVVE Score shown on Home, with the full math behind it — concentration, volatility, historical drawdown,
            value-at-risk, liquidity, market sensitivity, and diversification benefit. Only the "simulate this change" preview on
            Suggestions uses a faster, same-methodology estimate, since it needs to react instantly while you drag a slider.
          </p>

          <div className="flex justify-center mb-4">
            <ScoreRing score={data.compositeScore} size={150} />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-2xl bg-[var(--red)]/10 border border-[var(--red)]/20 p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--red)]">Apparent div.</p>
              <p className="font-heading font-black text-2xl text-[var(--red)]">{data.apparentDiversificationPct}%</p>
            </div>
            <div className="rounded-2xl bg-[var(--green)]/10 border border-[var(--green)]/20 p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--green)]">Real div.</p>
              <p className="font-heading font-black text-2xl text-[var(--green)]">{data.realDiversificationPct}%</p>
            </div>
          </div>

          {data.context && (
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4 mb-6" data-testid="score-context-card">
              <h3 className="font-bold text-sm mb-1">Your situation</h3>
              <p className="text-xs text-[var(--text-tertiary)] mb-3">
                {data.context.corpusTier.label} portfolio &middot; {data.context.persona.label}
              </p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{contextSummaryMessage(data.context)}</p>
            </div>
          )}

          <div className="bg-[var(--surface-card)] rounded-3xl border border-[var(--border)] p-4 mb-6" data-testid="score-radar-chart">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart
                data={SUB_SCORE_ORDER.map((key) => ({ subject: SUB_SCORE_META[key].label, score: data.subScores[key].score }))}
                outerRadius="72%"
              >
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} />
                <Radar dataKey="score" stroke="var(--dive-blue)" fill="var(--dive-blue)" fillOpacity={0.35} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-3 mb-6">
            {SUB_SCORE_ORDER.map((key) => {
              const sub = data.subScores[key];
              const meta = SUB_SCORE_META[key];
              const color = scoreColor(sub.score);
              return (
                <div key={key} className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4" data-testid={`subscore-${key}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">{meta.label}</span>
                    <span className="font-heading font-black text-lg" style={{ color }}>{sub.score}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--surface-card-hover)] overflow-hidden mb-2">
                    <motion.div className="h-full rounded-full" style={{ background: color }}
                      initial={{ width: 0 }} animate={{ width: `${sub.score}%` }} transition={{ duration: 0.6 }} />
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">{meta.blurb}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4 mb-4">
            <h3 className="font-bold text-sm mb-2">Drawdown</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Worst historical drop: <b className="text-[var(--text-primary)]">{Math.abs(data.drawdownDetail.maxDrawdownPct * 100).toFixed(1)}%</b>
              {data.drawdownDetail.recovered
                ? data.drawdownDetail.recoveryDays ? ` — recovered in ~${data.drawdownDetail.recoveryDays} trading days.` : " (no drawdown observed)."
                : " — this mix hadn't recovered by the end of the observed period."}
            </p>
          </div>

          <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4 mb-6">
            <h3 className="font-bold text-sm mb-2">Value at Risk (95% confidence)</h3>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[var(--text-secondary)]">1-day</span>
              <span className="font-bold">{fmtINR(data.varDetail.oneDayINR)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-secondary)]">1-month (approx.)</span>
              <span className="font-bold">{fmtINR(data.varDetail.oneMonthINR)}</span>
            </div>
          </div>

          {data.correlationMatrix.labels.length > 1 && (
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4 mb-6 overflow-x-auto no-scrollbar" data-testid="correlation-heatmap">
              <h3 className="font-bold text-sm mb-3">Correlation across your asset classes</h3>
              <table className="border-collapse text-[10px]">
                <thead>
                  <tr>
                    <th className="p-1"></th>
                    {data.correlationMatrix.labels.map((l) => (
                      <th key={l} className="p-1 font-bold text-[var(--text-tertiary)] whitespace-nowrap">{ASSET_CLASS_LABELS[l] || l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.correlationMatrix.matrix.map((row, i) => (
                    <tr key={data.correlationMatrix.labels[i]}>
                      <td className="p-1 font-bold text-[var(--text-tertiary)] whitespace-nowrap">{ASSET_CLASS_LABELS[data.correlationMatrix.labels[i]] || data.correlationMatrix.labels[i]}</td>
                      {row.map((v, j) => (
                        <td key={j} className="p-1 text-center font-bold rounded" style={{ background: `${correlationColor(v)}33`, color: correlationColor(v) }}>
                          {v.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.connections.length > 0 && (
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4 mb-4" data-testid="score-connections">
              <h3 className="font-bold text-sm mb-1">Why real is below apparent</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                These holdings look independent on the surface, but share some exposure to the same underlying risk:
              </p>
              <div className="space-y-2">
                {data.connections.map((c, i) => (
                  <div key={i} className="text-xs bg-[var(--surface-card-hover)] rounded-xl p-3" data-testid={`connection-${i}`}>
                    <span className="font-semibold">{c.reason}.</span>{" "}
                    <span className="text-[var(--text-tertiary)]">~{Math.round(c.strength * 100)}% shared exposure.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[var(--dive-blue-light)] rounded-2xl p-4 mb-4 flex gap-2" data-testid="score-data-quality">
            <Info size={16} className="text-[var(--dive-blue-dark)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-[var(--dive-blue-dark)] mb-1">
                {data.dataQuality.realPriceCoveragePct}% of your portfolio's value is backed by real historical price data
              </p>
              <p className="text-[11px] text-[var(--dive-blue-dark)]/80 leading-relaxed">
                The rest (mutual funds, bonds, REIT/InvIT units not separately listed, ULIP, FD) uses clearly-labeled, illustrative synthetic
                return assumptions — there's no cheap public daily-price source for those in India yet.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
