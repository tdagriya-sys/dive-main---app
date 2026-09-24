import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";

function fmtINR(n) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

function KpiCard({ label, value, sub, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">{label}</p>
      <p className="font-heading font-black text-2xl text-[var(--text-primary)]">{value}</p>
      {sub && <p className="text-xs text-[var(--text-secondary)] mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/admin/dashboard");
        if (!cancelled) setData(data);
      } catch {
        if (!cancelled) setError("Couldn't load the dashboard. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-dashboard-loading">
        <Loader2 size={16} className="animate-spin" /> Loading dashboard…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-dashboard-error">
        {error}
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-dashboard-screen">
      <h1 className="font-heading font-black text-2xl mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard testId="kpi-total-users" label="Total users" value={data.users.total.toLocaleString("en-IN")} />
        <KpiCard
          testId="kpi-new-signups"
          label="New signups (30d)"
          value={data.users.newSignups30d.toLocaleString("en-IN")}
          sub={`${data.users.newSignups7d} in the last 7 days`}
        />
        <KpiCard testId="kpi-active-users" label="Active (30d)" value={data.users.active30d.toLocaleString("en-IN")} sub="logged in within 30 days" />
        <KpiCard testId="kpi-staff-count" label="Staff accounts" value={data.users.staffCount.toLocaleString("en-IN")} />
        <KpiCard testId="kpi-total-holdings" label="Total holdings" value={data.portfolios.totalHoldings.toLocaleString("en-IN")} />
        <KpiCard testId="kpi-holdings-value" label="Total portfolio value" value={fmtINR(data.portfolios.totalHoldingsValue)} />
        <KpiCard testId="kpi-paid-reports" label="Reports purchased" value={data.revenue.paidReportsCount.toLocaleString("en-IN")} />
        <KpiCard testId="kpi-total-revenue" label="Total revenue" value={fmtINR(data.revenue.totalRevenuePaise / 100)} />
      </div>
    </div>
  );
}
