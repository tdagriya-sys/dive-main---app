import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";

function fmtINR(paise) {
  return "₹" + Math.round((paise || 0) / 100).toLocaleString("en-IN");
}

function KpiCard({ label, value, sub, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">{label}</p>
      <p className="font-heading font-black text-2xl">{value}</p>
      {sub && <p className="text-xs text-[var(--text-secondary)] mt-1">{sub}</p>}
    </div>
  );
}

// The resilience-report PDF's price — previously hardcoded on the download
// button (Rs.299 struck through, Rs.99 real), now admin-editable (see
// backend/src/services/adminSettingService.ts::getReportPricing). Kept on
// this screen rather than the Plans tab since it's a one-off payment (Payment
// purpose SCORE_REPORT_PDF), not a subscription plan.
function ReportPricingCard({ pricing, onSave, saving, saved }) {
  const [pricePaise, setPricePaise] = useState(pricing.pricePaise);
  const [originalPricePaise, setOriginalPricePaise] = useState(pricing.originalPricePaise ?? "");

  const dirty = Number(pricePaise) !== pricing.pricePaise || (originalPricePaise === "" ? null : Number(originalPricePaise)) !== pricing.originalPricePaise;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-8" data-testid="admin-revenue-report-pricing-card">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Resilience report pricing</p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Price (₹)
          <input
            type="number"
            min={0}
            data-testid="admin-report-pricing-price-input"
            value={pricePaise / 100}
            onChange={(e) => setPricePaise(Math.round(Number(e.target.value) * 100))}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Strikethrough "was" price (₹, optional)
          <input
            type="number"
            min={0}
            data-testid="admin-report-pricing-original-input"
            value={originalPricePaise === "" ? "" : originalPricePaise / 100}
            placeholder="none"
            onChange={(e) => setOriginalPricePaise(e.target.value === "" ? "" : Math.round(Number(e.target.value) * 100))}
            className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm outline-none"
          />
        </label>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          data-testid="admin-report-pricing-save-btn"
          disabled={saving || !dirty}
          onClick={() => onSave({ pricePaise: Number(pricePaise), originalPricePaise: originalPricePaise === "" ? null : Number(originalPricePaise) })}
          className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {!dirty && saved && <span className="text-xs text-[var(--green)] font-bold">Saved</span>}
      </div>
    </div>
  );
}

export default function Revenue() {
  const [summary, setSummary] = useState(null);
  const [payments, setPayments] = useState(null);
  const [page, setPage] = useState(1);
  const [mrrSummary, setMrrSummary] = useState(null);
  const [planPerformance, setPlanPerformance] = useState(null);
  const [mrrMovement, setMrrMovement] = useState(null);
  const [failedPayments, setFailedPayments] = useState(null);
  const [reportPricing, setReportPricing] = useState(null);
  const [savingReportPricing, setSavingReportPricing] = useState(false);
  const [reportPricingSaved, setReportPricingSaved] = useState(false);
  // Two distinct error states, deliberately not shared: `loadError` gates
  // the full-page early-return below (the initial data fetch genuinely
  // failed, nothing on this screen is usable), while `error` is a mutation
  // -only inline banner (refund, report-pricing save) — reusing one state
  // for both used to mean any mutation failure blew away the entire loaded
  // screen instead of showing a small inline message, since the early
  // -return check doesn't care when or why the state became truthy.
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stepUpRequest, setStepUpRequest] = useState(null);
  const [refunding, setRefunding] = useState(null);

  async function loadBillingPolish() {
    const [mrr, plans, movement, failed] = await Promise.all([
      api.get("/admin/revenue/mrr-summary"),
      api.get("/admin/revenue/plan-performance"),
      api.get("/admin/revenue/mrr-movement", { params: { months: 6 } }),
      api.get("/admin/revenue/failed-payments"),
    ]);
    setMrrSummary(mrr.data);
    setPlanPerformance(plans.data.plans);
    setMrrMovement(movement.data.movement);
    setFailedPayments(failed.data.payments);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [s, p, rp] = await Promise.all([
          api.get("/admin/revenue/summary"),
          api.get("/admin/revenue/payments", { params: { page } }),
          api.get("/admin/revenue/report-pricing"),
        ]);
        if (cancelled) return;
        setSummary(s.data);
        setPayments(p.data);
        setReportPricing(rp.data);
        await loadBillingPolish();
      } catch {
        if (!cancelled) setLoadError("Couldn't load revenue data. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function requestStepUpToken() {
    return new Promise((resolve, reject) => setStepUpRequest({ resolve, reject }));
  }
  async function withStepUp(call) {
    try {
      return await call();
    } catch (err) {
      if (!isStepUpRequiredError(err)) throw err;
      const token = await requestStepUpToken();
      return call(token);
    }
  }

  async function refundPayment(paymentId) {
    setError("");
    setRefunding(paymentId);
    try {
      await withStepUp((token) => api.post(`/admin/payments/${paymentId}/refund`, {}, { headers: { "x-step-up-token": token } }));
      const p = await api.get("/admin/revenue/payments", { params: { page } });
      setPayments(p.data);
      await loadBillingPolish();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't refund this payment.");
    } finally {
      setRefunding(null);
    }
  }

  // No step-up — same "instantly reversible by editing it again" bar as the
  // announcement/maintenance settings (systemController.ts) and plan-price
  // edits (plansController.ts), not a discrete money-moving action like
  // refund/cancel/grant.
  async function saveReportPricing(next) {
    setError("");
    setSavingReportPricing(true);
    setReportPricingSaved(false);
    try {
      const res = await api.patch("/admin/revenue/report-pricing", next);
      setReportPricing(res.data);
      setReportPricingSaved(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't update the report price.");
    } finally {
      setSavingReportPricing(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-revenue-loading">
        <Loader2 size={16} className="animate-spin" /> Loading revenue…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-revenue-error">
        {loadError}
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-revenue-screen">
      <h1 className="font-heading font-black text-2xl mb-6">Revenue</h1>

      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-revenue-mutation-error">{error}</p>}

      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Subscriptions</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard testId="admin-revenue-mrr" label="MRR" value={fmtINR(mrrSummary.mrrPaise)} sub={`${mrrSummary.activePayingCount} paying`} />
        <KpiCard testId="admin-revenue-arr" label="ARR" value={fmtINR(mrrSummary.arrPaise)} />
        <KpiCard testId="admin-revenue-arpu" label="ARPU" value={fmtINR(mrrSummary.arpuPaise)} />
        <KpiCard testId="admin-revenue-churn" label="Churn (30d)" value={mrrSummary.churnRatePct != null ? `${mrrSummary.churnRatePct.toFixed(1)}%` : "—"} sub={mrrSummary.estimatedLtvPaise != null ? `Est. LTV ${fmtINR(mrrSummary.estimatedLtvPaise)}` : undefined} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard testId="admin-revenue-total" label="Total revenue" value={fmtINR(summary.totalAmountPaise)} sub={`${summary.totalCount} payments`} />
        <KpiCard testId="admin-revenue-real" label="Real payments" value={fmtINR(summary.real.amountPaise)} sub={`${summary.real.count} orders`} />
        <KpiCard testId="admin-revenue-mock" label="Mock payments" value={fmtINR(summary.mock.amountPaise)} sub={`${summary.mock.count} orders`} />
        <KpiCard testId="admin-revenue-trialing" label="Trialing / past due" value={`${mrrSummary.trialingCount} / ${mrrSummary.pastDueCount}`} />
      </div>

      <ReportPricingCard pricing={reportPricing} onSave={saveReportPricing} saving={savingReportPricing} saved={reportPricingSaved} />

      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Plan performance</p>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden mb-8">
        <table className="w-full text-sm" data-testid="admin-revenue-plan-performance-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Paying</th>
              <th className="px-4 py-3">Trialing</th>
              <th className="px-4 py-3">MRR</th>
            </tr>
          </thead>
          <tbody>
            {planPerformance.map((p) => (
              <tr key={p.planKey} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3 font-bold">{p.planName}</td>
                <td className="px-4 py-3">{p.payingCount}</td>
                <td className="px-4 py-3">{p.trialingCount}</td>
                <td className="px-4 py-3 font-bold">{fmtINR(p.mrrPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">MRR movement (last 6 months)</p>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden mb-8 overflow-x-auto">
        <table className="w-full text-sm" data-testid="admin-revenue-mrr-movement-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3">New</th>
              <th className="px-4 py-3">Expansion</th>
              <th className="px-4 py-3">Contraction</th>
              <th className="px-4 py-3">Churned</th>
              <th className="px-4 py-3">Net</th>
            </tr>
          </thead>
          <tbody>
            {mrrMovement.map((m) => (
              <tr key={m.month} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3 font-bold">{m.month}</td>
                <td className="px-4 py-3 text-[var(--green)]">{m.newPaise > 0 ? `+${fmtINR(m.newPaise)}` : "—"}</td>
                <td className="px-4 py-3 text-[var(--green)]">{m.expansionPaise > 0 ? `+${fmtINR(m.expansionPaise)}` : "—"}</td>
                <td className="px-4 py-3 text-[var(--red)]">{m.contractionPaise > 0 ? `−${fmtINR(m.contractionPaise)}` : "—"}</td>
                <td className="px-4 py-3 text-[var(--red)]">{m.churnedPaise > 0 ? `−${fmtINR(m.churnedPaise)}` : "—"}</td>
                <td className={`px-4 py-3 font-bold ${m.netPaise >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{m.netPaise >= 0 ? "+" : "−"}{fmtINR(Math.abs(m.netPaise))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failedPayments.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Failed payments</p>
          <div className="rounded-2xl border border-[var(--red)]/30 bg-[var(--surface-card)] overflow-hidden mb-8">
            <table className="w-full text-sm" data-testid="admin-revenue-failed-payments-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {failedPayments.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0" data-testid={`admin-revenue-failed-payment-${p.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-bold">{p.userName || "—"}</span>
                      <br />
                      <span className="text-xs text-[var(--text-tertiary)]">{p.userEmail}</span>
                    </td>
                    <td className="px-4 py-3 font-bold">{fmtINR(p.amountPaise)}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{p.failureReason || "—"}</td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{p.subscriptionStatus || "—"}</td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">All payments</p>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
        <table className="w-full text-sm" data-testid="admin-revenue-payments-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Purpose</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {payments.payments.map((p) => (
              <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3">
                  <span className="font-bold">{p.userName || "—"}</span>
                  <br />
                  <span className="text-xs text-[var(--text-tertiary)]">{p.userEmail}</span>
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {p.purpose} {p.isMock && "(mock)"}
                </td>
                <td className="px-4 py-3 font-bold">{fmtINR(p.amount)}</td>
                <td className="px-4 py-3">{p.status}{p.refundedAmountPaise > 0 && ` (refunded ${fmtINR(p.refundedAmountPaise)})`}</td>
                <td className="px-4 py-3 text-[var(--text-tertiary)]">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="px-4 py-3 text-right">
                  {p.status === "paid" && !(p.refundedAmountPaise >= p.amount) && (
                    <button
                      type="button"
                      data-testid={`admin-revenue-refund-btn-${p.id}`}
                      disabled={refunding === p.id}
                      onClick={() => refundPayment(p.id)}
                      className="text-xs font-bold text-[var(--red)] hover:underline disabled:opacity-40"
                    >
                      {refunding === p.id ? "Refunding…" : "Refund"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {payments.payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-revenue-empty">
                  No payments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-secondary)]">
        <span>{payments.total} total</span>
        <div className="flex items-center gap-3">
          <button data-testid="admin-revenue-prev-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-bold disabled:opacity-30">
            Previous
          </button>
          <span>
            Page {payments.page} of {payments.totalPages}
          </span>
          <button data-testid="admin-revenue-next-btn" disabled={page >= payments.totalPages} onClick={() => setPage((p) => p + 1)} className="font-bold disabled:opacity-30">
            Next
          </button>
        </div>
      </div>

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => { stepUpRequest?.reject(new Error("Step-up cancelled")); setStepUpRequest(null); }}
        onSuccess={(token) => { stepUpRequest?.resolve(token); setStepUpRequest(null); }}
      />
    </div>
  );
}
