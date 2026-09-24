import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, LifeBuoy, Send, Star, ArrowLeft, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { useDive } from "../context/DiveContext";

const SUPPORT_EMAIL = "hello@divve.in";

// Mirrors backend/src/services/ticketService.ts's DEFAULT_TICKET_CATEGORIES
// keys exactly — there's no public "list categories" endpoint (that's
// staff-only, see admin.routes.ts), so this small, static list is kept in
// sync by hand, same convention as admin/permissions.js mirroring the
// backend's permission registry.
const CATEGORIES = [
  { key: "general", label: "General" },
  { key: "technical", label: "Technical issue" },
  { key: "billing", label: "Billing & payments" },
  { key: "account", label: "Account & login" },
];

const TIME_SLOTS = ["Morning · 9 AM – 12 PM", "Afternoon · 12 PM – 3 PM", "Evening · 3 PM – 6 PM", "Anytime works"];

const STATUS_BADGE = {
  open: "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]",
  pending: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  resolved: "bg-[var(--green)]/10 text-[var(--green)]",
  closed: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};

function Field({ label, testId, ...props }) {
  return (
    <label className="block mb-4">
      <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{label}</span>
      <input
        data-testid={testId}
        className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors"
        {...props}
      />
    </label>
  );
}

function NewTicketForm({ onCreated, defaultMobile }) {
  const [subject, setSubject] = useState("");
  const [categoryKey, setCategoryKey] = useState(CATEGORIES[0].key);
  const [description, setDescription] = useState("");
  const [requestCallback, setRequestCallback] = useState(false);
  const [mobile, setMobile] = useState(defaultMobile || "");
  const [preferredWindow, setPreferredWindow] = useState(TIME_SLOTS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { data } = await api.post("/tickets", {
        subject,
        categoryKey,
        description,
        requestCallback,
        ...(requestCallback ? { mobile, preferredWindow } : {}),
      });
      onCreated(data.ticket);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't submit your ticket — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Subject" testId="support-subject-input" type="text" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
      <label className="block mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Category</span>
        <select
          data-testid="support-category-select"
          value={categoryKey}
          onChange={(e) => setCategoryKey(e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors"
        >
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="block mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Description</span>
        <textarea
          data-testid="support-description-input"
          rows={4} required value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us what's going on…"
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors resize-none"
        />
      </label>

      <label className="flex items-center gap-2 mb-4 text-sm font-semibold">
        <input type="checkbox" data-testid="support-callback-checkbox" checked={requestCallback} onChange={(e) => setRequestCallback(e.target.checked)} />
        Request a callback instead of waiting for a reply
      </label>
      {requestCallback && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Field label="Mobile number" testId="support-callback-mobile-input" type="tel" required value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91 98765 43210" />
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Best time</span>
            <select
              data-testid="support-callback-window-select"
              value={preferredWindow}
              onChange={(e) => setPreferredWindow(e.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors"
            >
              {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && <p className="text-xs text-[var(--red)] font-semibold mb-4" data-testid="support-error">{error}</p>}

      <button type="submit" data-testid="support-submit-btn" disabled={submitting}
        className="w-full gold-btn rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--dive-blue-hover)] transition-colors disabled:opacity-50">
        <Send size={16} /> {submitting ? "Submitting…" : "Submit ticket"}
      </button>
      <p className="text-xs text-[var(--text-tertiary)] text-center mt-3">
        Prefer email? Write to <span className="font-semibold text-[var(--text-primary)]">{SUPPORT_EMAIL}</span>.
      </p>
    </form>
  );
}

function TicketSuccess({ ticket, onViewMine, onClose }) {
  return (
    <div className="text-center py-6" data-testid="support-ticket-success">
      <CheckCircle2 size={40} className="text-[var(--green)] mx-auto" />
      <h3 className="font-heading font-black text-xl mt-4">{`Ticket ${ticket.refNo} created`}</h3>
      <p className="text-sm text-[var(--text-secondary)] mt-2">We'll get back to you soon — you can track it under "My tickets".</p>
      <div className="flex items-center justify-center gap-3 mt-6">
        <button type="button" data-testid="support-view-my-tickets-btn" onClick={onViewMine} className="text-sm font-bold text-[var(--dive-blue)] hover:underline">
          View my tickets
        </button>
        <button type="button" onClick={onClose} className="text-sm font-bold text-[var(--text-tertiary)] hover:underline">
          Close
        </button>
      </div>
    </div>
  );
}

function TicketDetail({ ticketId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [csatScore, setCsatScore] = useState(0);
  const [csatComment, setCsatComment] = useState("");
  const [csatSubmitted, setCsatSubmitted] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/tickets/${ticketId}`);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/tickets/${ticketId}/messages`, { body: reply });
      setReply("");
      await load();
    } finally {
      setSending(false);
    }
  }

  async function submitCsat() {
    await api.post(`/tickets/${ticketId}/csat`, { score: csatScore, comment: csatComment || undefined });
    setCsatSubmitted(true);
  }

  if (loading || !data) {
    return (
      <div className="py-10 text-center text-sm text-[var(--text-tertiary)]" data-testid="support-ticket-detail-loading">
        Loading…
      </div>
    );
  }

  const { ticket, messages } = data;
  const canRate = (ticket.status === "resolved" || ticket.status === "closed") && ticket.csatScore == null && !csatSubmitted;

  return (
    <div data-testid="support-ticket-detail">
      <button type="button" data-testid="support-ticket-detail-back-btn" onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-[var(--text-tertiary)] mb-3">
        <ArrowLeft size={14} /> Back to my tickets
      </button>
      <div className="flex items-center justify-between mb-3">
        <p className="font-heading font-black">{ticket.refNo}</p>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_BADGE[ticket.status]}`}>{ticket.status}</span>
      </div>
      <p className="text-sm font-semibold mb-4">{ticket.subject}</p>

      <div className="space-y-3 mb-4 max-h-56 overflow-y-auto no-scrollbar">
        {messages.map((m) => (
          <div key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.authorType === "staff" ? "bg-[var(--dive-blue-light)]" : "bg-[var(--surface-card-hover)]"}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">{m.authorType === "staff" ? "Divve support" : "You"}</p>
            {m.body}
          </div>
        ))}
      </div>

      <form onSubmit={sendReply} className="flex items-center gap-2 mb-4">
        <input
          data-testid="support-reply-input"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type a reply…"
          className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-2.5 text-sm outline-none focus:border-[var(--dive-blue)]"
        />
        <button type="submit" data-testid="support-reply-send-btn" disabled={sending || !reply.trim()} className="gold-btn rounded-full p-2.5 disabled:opacity-50">
          <Send size={16} />
        </button>
      </form>

      {canRate && (
        <div className="rounded-xl border border-[var(--border)] p-4" data-testid="support-csat-panel">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">How did we do?</p>
          <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" data-testid={`support-csat-star-${n}`} onClick={() => setCsatScore(n)}>
                <Star size={22} className={n <= csatScore ? "fill-[var(--gold-b)] text-[var(--gold-b)]" : "text-[var(--border)]"} />
              </button>
            ))}
          </div>
          <input
            data-testid="support-csat-comment-input"
            value={csatComment}
            onChange={(e) => setCsatComment(e.target.value)}
            placeholder="Anything else? (optional)"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-3 py-2 text-sm outline-none mb-3"
          />
          <button type="button" data-testid="support-csat-submit-btn" disabled={csatScore === 0} onClick={submitCsat} className="gold-btn rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40">
            Submit rating
          </button>
        </div>
      )}
      {(ticket.csatScore != null || csatSubmitted) && (
        <p className="text-xs text-[var(--green)] font-semibold" data-testid="support-csat-thanks">Thanks for rating this ticket!</p>
      )}
    </div>
  );
}

function MyTickets({ initialTicketId }) {
  const [tickets, setTickets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialTicketId || null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/tickets");
        setTickets(data.tickets);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (selectedId) return <TicketDetail ticketId={selectedId} onBack={() => setSelectedId(null)} />;

  if (loading) {
    return <div className="py-10 text-center text-sm text-[var(--text-tertiary)]" data-testid="support-my-tickets-loading">Loading…</div>;
  }
  if (!tickets || tickets.length === 0) {
    return <p className="py-10 text-center text-sm text-[var(--text-tertiary)]" data-testid="support-my-tickets-empty">No tickets yet — raise one from the "New ticket" tab.</p>;
  }

  return (
    <div data-testid="support-my-tickets-list">
      {tickets.map((t) => (
        <button
          key={t.id}
          type="button"
          data-testid={`support-ticket-row-${t.id}`}
          onClick={() => setSelectedId(t.id)}
          className="w-full flex items-center justify-between text-left rounded-xl px-3 py-3 mb-2 hover:bg-[var(--surface-card-hover)] transition-colors"
        >
          <div>
            <p className="text-sm font-bold">{t.subject}</p>
            <p className="text-xs text-[var(--text-tertiary)]">{t.refNo}</p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize shrink-0 ${STATUS_BADGE[t.status]}`}>{t.status}</span>
        </button>
      ))}
    </div>
  );
}

// Real in-app tickets (Phase 4 of docs/ADMIN_PANEL_PLAN.md), replacing the
// earlier mailto-only design: "Raise a ticket" now creates a real Ticket
// (backend/src/controllers/ticketsController.ts) that a staff member
// answers from the admin console, and "My tickets" lets the user follow
// and reply to the conversation, request a callback, and rate the
// resolution — all without leaving the app. Same floating centered-modal
// pattern as ExtensionDownloadCard.jsx (see that file's own comment on why
// this isn't portaled).
export default function SupportCard({ onClose }) {
  const { user } = useDive();
  const [tab, setTab] = useState("new"); // "new" | "mine"
  const [createdTicket, setCreatedTicket] = useState(null);
  const [jumpToTicketId, setJumpToTicketId] = useState(null);

  return (
    <motion.div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="support-card">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <LifeBuoy size={20} className="text-[var(--dive-blue)]" />
            </div>
            <h2 className="font-heading font-black text-xl">Need help?</h2>
          </div>
          <button data-testid="support-close-btn" onClick={onClose} className="shrink-0"><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>

        {!createdTicket && (
          <div className="flex gap-2 mb-5">
            <button
              type="button"
              data-testid="support-tab-new-btn"
              onClick={() => setTab("new")}
              className={`flex-1 rounded-full py-2 text-sm font-bold transition-colors ${tab === "new" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}
            >
              New ticket
            </button>
            <button
              type="button"
              data-testid="support-tab-mine-btn"
              onClick={() => { setTab("mine"); setJumpToTicketId(null); }}
              className={`flex-1 rounded-full py-2 text-sm font-bold transition-colors ${tab === "mine" ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "text-[var(--text-tertiary)]"}`}
            >
              My tickets
            </button>
          </div>
        )}

        {createdTicket ? (
          <TicketSuccess
            ticket={createdTicket}
            onViewMine={() => { setJumpToTicketId(createdTicket.id); setTab("mine"); setCreatedTicket(null); }}
            onClose={onClose}
          />
        ) : tab === "new" ? (
          <NewTicketForm onCreated={setCreatedTicket} defaultMobile={user?.mobile} />
        ) : (
          <MyTickets initialTicketId={jumpToTicketId} />
        )}
      </motion.div>
    </motion.div>
  );
}
