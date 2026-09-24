import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Loader2, PhoneCall, Settings } from "lucide-react";
import { api } from "../../lib/api";

const STATUS_BADGE = {
  open: "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]",
  pending: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  resolved: "bg-[var(--green)]/10 text-[var(--green)]",
  closed: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};
const PRIORITY_BADGE = {
  low: "text-[var(--text-tertiary)]",
  normal: "text-[var(--text-secondary)]",
  high: "text-[var(--gold-c)]",
  urgent: "text-[var(--red)]",
};

/**
 * The staff ticket inbox (Phase 4 of docs/ADMIN_PANEL_PLAN.md §7). Mirrors
 * UsersList.jsx's list->detail routing convention — a row navigates to
 * TicketDetail.jsx (/admin/tickets/:id) for the conversation, assignment,
 * merge, and callback actions. Category/canned-response management lives
 * behind the "Settings" button (/admin/ticket-settings) rather than
 * cluttering this inbox or the main sidebar with a third nav item.
 */
export default function Tickets() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: "", priority: "", q: "" });
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const params = {};
        if (filters.status) params.status = filters.status;
        if (filters.priority) params.priority = filters.priority;
        if (filters.q) params.q = filters.q;
        const { data } = await api.get("/admin/tickets", { params });
        if (!cancelled) setTickets(data.tickets);
      } catch {
        if (!cancelled) setError("Couldn't load tickets. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters]);

  return (
    <div className="p-8" data-testid="admin-tickets-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Tickets</h1>
        <Link
          to="/admin/ticket-settings"
          data-testid="admin-tickets-settings-link"
          className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
        >
          <Settings size={14} /> Categories & canned responses
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          data-testid="admin-tickets-search-input"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Search ref, subject, requester…"
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2.5 text-sm outline-none min-w-[220px]"
        />
        <select
          data-testid="admin-tickets-status-filter"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2.5 text-sm outline-none"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          data-testid="admin-tickets-priority-filter"
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2.5 text-sm outline-none"
        >
          <option value="">All priorities</option>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-tickets-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-tickets-error">{error}</p>}

      {!loading && !error && tickets && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
          <table className="w-full text-sm" data-testid="admin-tickets-table">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">SLA</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  data-testid={`admin-tickets-row-${t.id}`}
                  onClick={() => navigate(`/admin/tickets/${t.id}`)}
                  className="border-b border-[var(--border)] last:border-0 cursor-pointer hover:bg-[var(--surface-card-hover)] transition-colors"
                >
                  <td className="px-4 py-3 font-bold">{t.refNo}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{t.subject}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{t.requesterName}</td>
                  <td className={`px-4 py-3 font-bold capitalize ${PRIORITY_BADGE[t.priority] || ""}`}>{t.priority}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${STATUS_BADGE[t.status] || ""}`}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.slaBreached && <span className="text-xs font-bold text-[var(--red)]" data-testid={`admin-tickets-sla-breach-${t.id}`}>Overdue</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.callbackRequested && !t.callbackRequested.done && (
                      <PhoneCall size={14} className="text-[var(--dive-blue)] inline" data-testid={`admin-tickets-callback-flag-${t.id}`} />
                    )}
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-tickets-empty">
                    No tickets match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
