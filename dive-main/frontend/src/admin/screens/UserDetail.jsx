import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Loader2, Eye } from "lucide-react";
import { api } from "../../lib/api";
import { isStepUpRequiredError } from "../config/stepUp";
import StepUpModal from "../config/StepUpModal";

function fmtINR(n) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

function Card({ title, children, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">{title}</p>
      {children}
    </div>
  );
}

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stepUpRequest, setStepUpRequest] = useState(null);
  const [impersonating, setImpersonating] = useState(false);
  const [accountActionBusy, setAccountActionBusy] = useState(false);
  const [accountActionNote, setAccountActionNote] = useState("");
  const [accountActionError, setAccountActionError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/admin/users/${id}`);
      setData(data);
    } catch (err) {
      setError(err?.response?.status === 404 ? "User not found." : "Couldn't load this user. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  // Phase 7 of docs/ADMIN_PANEL_PLAN.md §5.1/§8 — hands the resulting
  // read-only token off to a NEW tab via sessionStorage (see DiveContext.js's
  // tryRestoreImpersonation) rather than this admin tab's own session, so
  // the staff member's real admin session is never disturbed.
  async function viewAsUser() {
    setError("");
    setImpersonating(true);
    try {
      const { data: resp } = await withStepUp((token) => api.post(`/admin/users/${id}/impersonate`, {}, { headers: { "x-step-up-token": token } }));
      sessionStorage.setItem("divve_impersonation", JSON.stringify(resp));
      window.open("/", "_blank");
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't start an impersonation session.");
    } finally {
      setImpersonating(false);
    }
  }

  // User suspend/reactivate/force-logout (docs/ADMIN_PANEL_PLAN.md §4.1/
  // §5.3/§6 — spec'd since Phase 0.3 but never wired up until now). All
  // three are step-up-gated, same bar as impersonate above.
  async function suspendUser() {
    setAccountActionError("");
    setAccountActionNote("");
    setAccountActionBusy(true);
    try {
      await withStepUp((token) => api.post(`/admin/users/${id}/suspend`, {}, { headers: { "x-step-up-token": token } }));
      setAccountActionNote("Account suspended. Every active session was ended.");
      await load();
    } catch (err) {
      setAccountActionError(err?.response?.data?.message || "Couldn't suspend this account.");
    } finally {
      setAccountActionBusy(false);
    }
  }

  async function reactivateUser() {
    setAccountActionError("");
    setAccountActionNote("");
    setAccountActionBusy(true);
    try {
      await withStepUp((token) => api.post(`/admin/users/${id}/reactivate`, {}, { headers: { "x-step-up-token": token } }));
      setAccountActionNote("Account reactivated.");
      await load();
    } catch (err) {
      setAccountActionError(err?.response?.data?.message || "Couldn't reactivate this account.");
    } finally {
      setAccountActionBusy(false);
    }
  }

  async function forceLogoutUser() {
    setAccountActionError("");
    setAccountActionNote("");
    setAccountActionBusy(true);
    try {
      await withStepUp((token) => api.post(`/admin/users/${id}/force-logout`, {}, { headers: { "x-step-up-token": token } }));
      setAccountActionNote("Every active session was ended.");
      await load();
    } catch (err) {
      setAccountActionError(err?.response?.data?.message || "Couldn't force-logout this account.");
    } finally {
      setAccountActionBusy(false);
    }
  }

  return (
    <div className="p-8" data-testid="admin-user-detail-screen">
      <button data-testid="admin-user-detail-back-btn" onClick={() => navigate("/admin/users")} className="flex items-center gap-1 text-sm font-bold text-[var(--text-secondary)] mb-4">
        <ChevronLeft size={16} /> Back to Users
      </button>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-user-detail-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-user-detail-error">{error}</p>}

      {!loading && !error && data && (
        <>
          <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
            <h1 className="font-heading font-black text-2xl">{data.user.name}</h1>
            <div className="flex items-center gap-2">
              {data.user.status === "active" ? (
                <button
                  type="button"
                  data-testid="admin-user-detail-suspend-btn"
                  onClick={suspendUser}
                  disabled={accountActionBusy}
                  className="rounded-full border border-[var(--red)] text-[var(--red)] px-4 py-2 text-sm font-bold hover:bg-[var(--red)]/10 transition-colors disabled:opacity-50"
                >
                  Suspend
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="admin-user-detail-reactivate-btn"
                  onClick={reactivateUser}
                  disabled={accountActionBusy}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-50"
                >
                  Reactivate
                </button>
              )}
              <button
                type="button"
                data-testid="admin-user-detail-force-logout-btn"
                onClick={forceLogoutUser}
                disabled={accountActionBusy}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-50"
              >
                Force logout
              </button>
              <button
                type="button"
                data-testid="admin-user-detail-impersonate-btn"
                onClick={viewAsUser}
                disabled={impersonating}
                className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-50"
              >
                <Eye size={14} /> {impersonating ? "Starting…" : "View as this user (read-only)"}
              </button>
            </div>
          </div>
          {accountActionNote && <p className="text-sm text-[var(--green)] mb-2" data-testid="admin-user-detail-account-note">{accountActionNote}</p>}
          {accountActionError && <p className="text-sm text-[var(--red)] mb-2" data-testid="admin-user-detail-account-error">{accountActionError}</p>}
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            {data.user.email} · {data.user.mobile} · Age {data.user.age} · <span className="font-bold">{data.user.status}</span>
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card title="Portfolio" testId="admin-user-detail-portfolio-card">
              <p className="font-heading font-black text-xl">{fmtINR(data.holdings.totalValue)}</p>
              <p className="text-sm text-[var(--text-secondary)]">{data.holdings.count} holdings</p>
            </Card>
            <Card title="Dive Score" testId="admin-user-detail-score-card">
              <p className="font-heading font-black text-xl">{data.score ? data.score.compositeScore : "—"}</p>
              <p className="text-sm text-[var(--text-secondary)]">{data.score?.hasHoldings ? "computed" : "no holdings yet"}</p>
            </Card>
            <Card title="Live sessions" testId="admin-user-detail-sessions-card">
              <p className="font-heading font-black text-xl">{data.liveSessionCount}</p>
              <p className="text-sm text-[var(--text-secondary)]">active refresh tokens</p>
            </Card>
          </div>

          <Card title="Holdings by asset class" testId="admin-user-detail-holdings-breakdown">
            {Object.keys(data.holdings.byAssetClass).length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No holdings yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(data.holdings.byAssetClass).map(([cls, v]) => (
                  <div key={cls} className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">
                      {cls} ({v.count})
                    </span>
                    <span className="font-bold">{fmtINR(v.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <Card title="Payments" testId="admin-user-detail-payments-card">
              {data.payments.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)]">No payments yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.payments.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">
                        {p.purpose} {p.isMock && "(mock)"}
                      </span>
                      <span className="font-bold">
                        {fmtINR(p.amount / 100)} · {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Recent activity" testId="admin-user-detail-activity-card">
              {data.activity.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)]">No recorded activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.activity.map((a, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{a.type}</span>
                      <span className="text-[var(--text-tertiary)]">{new Date(a.ts).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <StepUpModal
        open={Boolean(stepUpRequest)}
        onCancel={() => { stepUpRequest?.reject(new Error("Step-up cancelled")); setStepUpRequest(null); }}
        onSuccess={(token) => { stepUpRequest?.resolve(token); setStepUpRequest(null); }}
      />
    </div>
  );
}
