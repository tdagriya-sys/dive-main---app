import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";

function Card({ title, children, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">{title}</p>
      {children}
    </div>
  );
}

export default function Analytics() {
  const [engagement, setEngagement] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [usage, setUsage] = useState(null);
  // Phase 7 of docs/ADMIN_PANEL_PLAN.md §11 — "CSAT/NPS dashboards". The
  // underlying report (getTicketReport) already existed since Phase 4, just
  // never surfaced anywhere in the admin UI until now. Gated by `tickets.
  // view` on the backend, separate from this screen's own `analytics.view`
  // — a staff member could have one without the other, so this fetch is
  // best-effort and simply omits the card rather than failing the whole
  // screen over it.
  const [support, setSupport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // jobs/activityRollup.cron.ts (docs/ADMIN_PANEL_PLAN.md §4.3/§12 decision
  // #10) keeps a permanent daily rollup of ActivityEvent counts, so a window
  // longer than the raw 180-day retention still returns real data instead of
  // silently truncating — 90/180/365 exercise that on the backend.
  const [usageDays, setUsageDays] = useState(30);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [e, f, u] = await Promise.all([
          api.get("/admin/analytics/engagement"),
          api.get("/admin/analytics/funnel"),
          api.get("/admin/analytics/feature-usage", { params: { days: usageDays } }),
        ]);
        if (cancelled) return;
        setEngagement(e.data);
        setFunnel(f.data);
        setUsage(u.data);
      } catch {
        if (!cancelled) setError("Couldn't load analytics. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        // ticketsController.ts's getReport nests the actual stats under a
        // `report` key (`res.json({ report })`) — this used to read `data`
        // directly, so every field here (csatAverage, totalOpen, ...) was
        // silently `undefined` in real usage. The card still rendered (data
        // itself is a truthy object), just permanently blank, which is why
        // this went unnoticed: the mismatch only shows up against the real
        // backend shape, not against a test mock that (wrongly) mirrored the
        // bug by mocking the unwrapped shape directly.
        const { data } = await api.get("/admin/tickets/report");
        if (!cancelled) setSupport(data.report);
      } catch {
        // best-effort — see the comment above
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeUsageDays(days) {
    setUsageDays(days);
    setUsageLoading(true);
    try {
      const { data } = await api.get("/admin/analytics/feature-usage", { params: { days } });
      setUsage(data);
    } catch {
      // leave the previous window's data showing rather than blanking it
    } finally {
      setUsageLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-analytics-loading">
        <Loader2 size={16} className="animate-spin" /> Loading analytics…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-analytics-error">
        {error}
      </div>
    );
  }

  const maxFunnel = Math.max(1, ...funnel.stages.map((s) => s.distinctUsers));
  const maxUsage = Math.max(1, ...usage.usage.map((u) => u.count));

  return (
    <div className="p-8" data-testid="admin-analytics-screen">
      <h1 className="font-heading font-black text-2xl mb-6">Analytics</h1>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card title="Daily active" testId="admin-analytics-dau">
          <p className="font-heading font-black text-2xl">{engagement.dau}</p>
        </Card>
        <Card title="Weekly active" testId="admin-analytics-wau">
          <p className="font-heading font-black text-2xl">{engagement.wau}</p>
        </Card>
        <Card title="Monthly active" testId="admin-analytics-mau">
          <p className="font-heading font-black text-2xl">{engagement.mau}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Conversion funnel (all-time)" testId="admin-analytics-funnel">
          <div className="space-y-3">
            {funnel.stages.map((s) => (
              <div key={s.type}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-bold">{s.type}</span>
                  <span className="text-[var(--text-secondary)]">{s.distinctUsers}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--surface-card-hover)] overflow-hidden">
                  <div className="h-full bg-[var(--dive-blue)]" style={{ width: `${(s.distinctUsers / maxFunnel) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Feature usage" testId="admin-analytics-usage">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[var(--text-tertiary)]">Last {usage.days} days{usageLoading ? " · updating…" : ""}</p>
            <select
              data-testid="admin-analytics-usage-days"
              value={usageDays}
              onChange={(e) => changeUsageDays(Number(e.target.value))}
              className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1 text-xs outline-none"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </div>
          {usage.usage.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {usage.usage.map((u) => (
                <div key={u.type}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-bold">{u.type}</span>
                    <span className="text-[var(--text-secondary)]">{u.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--surface-card-hover)] overflow-hidden">
                    <div className="h-full bg-[var(--dive-blue)]" style={{ width: `${(u.count / maxUsage) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {support && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Support</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card title="CSAT average" testId="admin-analytics-csat">
              <p className="font-heading font-black text-2xl">{support.csatAverage != null ? support.csatAverage.toFixed(1) : "—"}<span className="text-sm text-[var(--text-tertiary)]">/5</span></p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">{support.csatCount} rated</p>
            </Card>
            <Card title="Open tickets" testId="admin-analytics-open-tickets">
              <p className="font-heading font-black text-2xl">{support.totalOpen}</p>
            </Card>
            <Card title="SLA breached" testId="admin-analytics-sla-breached">
              <p className="font-heading font-black text-2xl">{support.slaBreached}</p>
            </Card>
            <Card title="Avg. first response" testId="admin-analytics-first-response">
              <p className="font-heading font-black text-2xl">{support.avgFirstResponseMinutes != null ? `${Math.round(support.avgFirstResponseMinutes)}m` : "—"}</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
