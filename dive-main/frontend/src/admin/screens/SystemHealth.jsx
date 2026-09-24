import React, { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../../lib/api";

const LEVEL_OPTIONS = ["info", "warning", "critical"];

function StatusPill({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${ok ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "bg-[var(--red)]/10 text-[var(--red)]"}`}>
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {label}
    </span>
  );
}

function Card({ title, children, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">{title}</p>
      {children}
    </div>
  );
}

export default function SystemHealth() {
  const [health, setHealth] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [webhooks, setWebhooks] = useState(null);
  const [announcement, setAnnouncement] = useState(null);
  const [maintenance, setMaintenance] = useState(null);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, i, j, w, s] = await Promise.all([
          api.get("/admin/system/health"),
          api.get("/admin/system/integrations"),
          api.get("/admin/system/jobs"),
          api.get("/admin/system/webhooks", { params: { limit: 10 } }),
          api.get("/admin/system/settings"),
        ]);
        if (cancelled) return;
        setHealth(h.data);
        setIntegrations(i.data);
        setJobs(j.data);
        setWebhooks(w.data);
        setAnnouncement(s.data.announcement);
        setMaintenance(s.data.maintenance);
      } catch {
        if (!cancelled) setError("Couldn't load system status. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveAnnouncement() {
    setSavingAnnouncement(true);
    try {
      const { data } = await api.patch("/admin/system/settings/announcement", announcement);
      setAnnouncement(data.announcement);
    } catch {
      setError("Couldn't save the announcement.");
    } finally {
      setSavingAnnouncement(false);
    }
  }

  async function saveMaintenance() {
    setSavingMaintenance(true);
    try {
      const { data } = await api.patch("/admin/system/settings/maintenance", maintenance);
      setMaintenance(data.maintenance);
    } catch {
      setError("Couldn't save maintenance mode.");
    } finally {
      setSavingMaintenance(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-system-loading">
        <Loader2 size={16} className="animate-spin" /> Loading system status…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8 text-[var(--red)]" data-testid="admin-system-error">
        {error}
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="admin-system-screen">
      <h1 className="font-heading font-black text-2xl mb-6">System</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card title="Health" testId="admin-system-health-card">
          <div className="flex flex-col gap-2">
            <StatusPill ok={health.db === "connected"} label={`DB: ${health.db}`} />
            <StatusPill ok={health.redis !== "error"} label={`Redis: ${health.redis}`} />
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Up {Math.round(health.uptimeSeconds / 60)} min</p>
          </div>
        </Card>
        <Card title="Integrations" testId="admin-system-integrations-card">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(integrations)
              .filter(([, v]) => v === "mock" || v === "live")
              .map(([name, status]) => (
                <StatusPill key={name} ok={status === "live"} label={`${name}: ${status}`} />
              ))}
          </div>
        </Card>
        <Card title="Webhooks (last 10)" testId="admin-system-webhooks-card">
          {webhooks.events.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">No webhook deliveries yet.</p>
          ) : (
            <div className="space-y-1">
              {webhooks.events.map((e, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{e.eventType || e.error || "—"}</span>
                  <StatusPill ok={e.processedOk} label={e.processedOk ? "ok" : "failed"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Scheduled jobs — latest run" testId="admin-system-jobs-card">
        {jobs.latestPerJob.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">No job runs recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.latestPerJob.map((j) => (
              <div key={j.job} className="flex justify-between text-sm">
                <span className="font-bold">{j.job}</span>
                <span className="text-[var(--text-secondary)]">{new Date(j.startedAt).toLocaleString("en-IN")}</span>
                <StatusPill ok={Boolean(j.ok)} label={j.ok ? "ok" : j.error || "failed"} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <Card title="Announcement banner" testId="admin-system-announcement-card">
          <textarea
            data-testid="admin-announcement-text-input"
            value={announcement.text}
            onChange={(e) => setAnnouncement((a) => ({ ...a, text: e.target.value }))}
            placeholder="Shown to every visitor across the app"
            rows={2}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none mb-2 resize-none"
          />
          <div className="flex items-center gap-3 mb-3">
            <select
              data-testid="admin-announcement-level-select"
              value={announcement.level}
              onChange={(e) => setAnnouncement((a) => ({ ...a, level: e.target.value }))}
              className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs outline-none"
            >
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs font-bold">
              <input data-testid="admin-announcement-enabled-toggle" type="checkbox" checked={announcement.enabled} onChange={(e) => setAnnouncement((a) => ({ ...a, enabled: e.target.checked }))} />
              Enabled
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold">
              <input data-testid="admin-announcement-dismissible-toggle" type="checkbox" checked={announcement.dismissible} onChange={(e) => setAnnouncement((a) => ({ ...a, dismissible: e.target.checked }))} />
              Dismissible
            </label>
          </div>
          <button type="button" data-testid="admin-announcement-save-btn" onClick={saveAnnouncement} disabled={savingAnnouncement} className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50">
            {savingAnnouncement ? "Saving…" : "Save"}
          </button>
        </Card>

        <Card title="Maintenance mode" testId="admin-system-maintenance-card">
          <p className="text-xs text-[var(--text-tertiary)] mb-2">
            When enabled, every non-staff request gets a 503 with this message instead of using the app.
          </p>
          <textarea
            data-testid="admin-maintenance-message-input"
            value={maintenance.message}
            onChange={(e) => setMaintenance((m) => ({ ...m, message: e.target.value }))}
            placeholder="Divve is temporarily down for maintenance."
            rows={2}
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none mb-2 resize-none"
          />
          <label className="flex items-center gap-1.5 text-xs font-bold mb-3">
            <input data-testid="admin-maintenance-enabled-toggle" type="checkbox" checked={maintenance.enabled} onChange={(e) => setMaintenance((m) => ({ ...m, enabled: e.target.checked }))} />
            Maintenance mode enabled
          </label>
          <button type="button" data-testid="admin-maintenance-save-btn" onClick={saveMaintenance} disabled={savingMaintenance} className="gold-btn rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50">
            {savingMaintenance ? "Saving…" : "Save"}
          </button>
        </Card>
      </div>
    </div>
  );
}
