import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, Loader2, Send, PhoneCall } from "lucide-react";
import { api } from "../../lib/api";

const STATUS_BADGE = {
  open: "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]",
  pending: "bg-[var(--gold-b)]/20 text-[var(--gold-c)]",
  resolved: "bg-[var(--green)]/10 text-[var(--green)]",
  closed: "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]",
};

function Card({ title, children, testId }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid={testId}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">{title}</p>
      {children}
    </div>
  );
}

/**
 * The staff ticket conversation (Phase 4 of docs/ADMIN_PANEL_PLAN.md §7) —
 * reply/internal notes, canned responses, assignment, priority/tags, SLA,
 * callback flag, and merge. `tickets.assign` gates the assignee field on
 * the backend (admin.routes.ts) — a 403 there surfaces inline rather than
 * hiding the control outright, since whether the current staff member has
 * that specific permission on top of `tickets.respond` isn't known here
 * without a dedicated "my permissions" endpoint.
 */
export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [cannedResponses, setCannedResponses] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [reply, setReply] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [detailRes, staffRes, cannedRes] = await Promise.all([
        api.get(`/admin/tickets/${id}`),
        api.get("/admin/tickets/staff").catch(() => ({ data: { staff: [] } })),
        api.get("/admin/canned-responses").catch(() => ({ data: { cannedResponses: [] } })),
      ]);
      setData(detailRes.data);
      setTagsInput((detailRes.data.ticket.tags || []).join(", "));
      setStaff(staffRes.data.staff);
      setCannedResponses(cannedRes.data.cannedResponses);
    } catch (err) {
      setError(err?.response?.status === 404 ? "Ticket not found." : "Couldn't load this ticket. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setActionError("");
    try {
      await api.post(`/admin/tickets/${id}/messages`, { body: reply, isInternalNote });
      setReply("");
      setIsInternalNote(false);
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't send that.");
    } finally {
      setSending(false);
    }
  }

  async function patchTicket(body) {
    setActionError("");
    try {
      await api.patch(`/admin/tickets/${id}`, body);
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "That change couldn't be saved.");
    }
  }

  async function markCallbackDone() {
    setActionError("");
    try {
      await api.post(`/admin/tickets/${id}/callback/done`, { done: true });
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't update the callback request.");
    }
  }

  async function merge() {
    if (!mergeTargetId.trim()) return;
    setActionError("");
    try {
      await api.post(`/admin/tickets/${id}/merge`, { targetTicketId: mergeTargetId.trim() });
      navigate(`/admin/tickets/${mergeTargetId.trim()}`);
    } catch (err) {
      setActionError(err?.response?.data?.message || "Couldn't merge this ticket.");
    }
  }

  return (
    <div className="p-8" data-testid="admin-ticket-detail-screen">
      <button data-testid="admin-ticket-detail-back-btn" onClick={() => navigate("/admin/tickets")} className="flex items-center gap-1 text-sm font-bold text-[var(--text-secondary)] mb-4">
        <ChevronLeft size={16} /> Back to Tickets
      </button>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-ticket-detail-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-ticket-detail-error">{error}</p>}

      {!loading && !error && data && (
        <>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-heading font-black text-2xl">{data.ticket.refNo}</h1>
            <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${STATUS_BADGE[data.ticket.status] || ""}`}>{data.ticket.status}</span>
            {data.ticket.slaDueAt && new Date(data.ticket.slaDueAt) < new Date() && !["resolved", "closed"].includes(data.ticket.status) && (
              <span className="px-2 py-1 rounded-full text-xs font-bold bg-[var(--red)]/10 text-[var(--red)]" data-testid="admin-ticket-detail-sla-breach">
                SLA overdue
              </span>
            )}
          </div>
          <p className="text-[var(--text-secondary)] mb-6">{data.ticket.subject}</p>

          {actionError && <p className="text-[var(--red)] mb-4" data-testid="admin-ticket-detail-action-error">{actionError}</p>}

          {data.ticket.callbackRequested && !data.ticket.callbackRequested.done && (
            <div className="flex items-center justify-between rounded-2xl border border-[var(--dive-blue)]/30 bg-[var(--dive-blue-light)] p-4 mb-6" data-testid="admin-ticket-detail-callback-banner">
              <div className="flex items-center gap-3">
                <PhoneCall size={18} className="text-[var(--dive-blue)]" />
                <div>
                  <p className="text-sm font-bold">Callback requested — {data.ticket.callbackRequested.mobile}</p>
                  {data.ticket.callbackRequested.preferredWindow && (
                    <p className="text-xs text-[var(--text-tertiary)]">{data.ticket.callbackRequested.preferredWindow}</p>
                  )}
                </div>
              </div>
              <button type="button" data-testid="admin-ticket-detail-callback-done-btn" onClick={markCallbackDone} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">
                Mark done
              </button>
            </div>
          )}

          <div className="grid lg:grid-cols-[1fr_320px] gap-6">
            <div>
              <Card title="Conversation" testId="admin-ticket-detail-conversation">
                <div className="space-y-3 mb-4 max-h-96 overflow-y-auto no-scrollbar">
                  {data.messages.map((m) => (
                    <div
                      key={m.id}
                      data-testid={`admin-ticket-detail-message-${m.id}`}
                      className={`rounded-xl px-3 py-2 text-sm ${
                        m.isInternalNote ? "bg-[var(--gold-b)]/10 border border-[var(--gold-b)]/30" : m.authorType === "staff" ? "bg-[var(--dive-blue-light)]" : "bg-[var(--surface-card-hover)]"
                      }`}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
                        {m.authorLabel} {m.isInternalNote && "· internal note"}
                      </p>
                      {m.body}
                    </div>
                  ))}
                </div>

                {cannedResponses.length > 0 && (
                  <select
                    data-testid="admin-ticket-detail-canned-select"
                    defaultValue=""
                    onChange={(e) => {
                      const canned = cannedResponses.find((c) => c.id === e.target.value);
                      if (canned) setReply((r) => (r ? `${r}\n${canned.body}` : canned.body));
                      e.target.value = "";
                    }}
                    className="w-full mb-3 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                  >
                    <option value="">Insert a canned response…</option>
                    {cannedResponses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                )}

                <form onSubmit={sendMessage}>
                  <textarea
                    data-testid="admin-ticket-detail-reply-input"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder="Type a reply…"
                    className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none mb-2 resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" data-testid="admin-ticket-detail-internal-checkbox" checked={isInternalNote} onChange={(e) => setIsInternalNote(e.target.checked)} />
                      Internal note (not visible to requester)
                    </label>
                    <button
                      type="submit"
                      data-testid="admin-ticket-detail-send-btn"
                      disabled={sending || !reply.trim()}
                      className="gold-btn flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold disabled:opacity-40"
                    >
                      {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                    </button>
                  </div>
                </form>
              </Card>
            </div>

            <div className="space-y-4">
              <Card title="Status" testId="admin-ticket-detail-status-card">
                <div className="flex flex-wrap gap-2">
                  {["open", "pending", "resolved", "closed"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      data-testid={`admin-ticket-detail-status-${s}-btn`}
                      onClick={() => patchTicket({ status: s })}
                      disabled={data.ticket.status === s}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize disabled:opacity-40 ${STATUS_BADGE[s]}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Card>

              <Card title="Priority" testId="admin-ticket-detail-priority-card">
                <select
                  data-testid="admin-ticket-detail-priority-select"
                  value={data.ticket.priority}
                  onChange={(e) => patchTicket({ priority: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Card>

              <Card title="Assignee" testId="admin-ticket-detail-assignee-card">
                <select
                  data-testid="admin-ticket-detail-assignee-select"
                  value={data.ticket.assigneeId || ""}
                  onChange={(e) => patchTicket({ assigneeId: e.target.value || null })}
                  className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                  ))}
                </select>
              </Card>

              <Card title="Tags" testId="admin-ticket-detail-tags-card">
                <div className="flex gap-2">
                  <input
                    data-testid="admin-ticket-detail-tags-input"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="comma, separated, tags"
                    className="flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                  />
                  <button
                    type="button"
                    data-testid="admin-ticket-detail-tags-save-btn"
                    onClick={() => patchTicket({ tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean) })}
                    className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors"
                  >
                    Save
                  </button>
                </div>
              </Card>

              <Card title="Requester" testId="admin-ticket-detail-requester-card">
                <p className="text-sm font-bold">{data.ticket.requesterName}</p>
                <p className="text-xs text-[var(--text-secondary)]">{data.ticket.requesterEmail}</p>
                {data.ticket.requesterMobile && <p className="text-xs text-[var(--text-secondary)]">{data.ticket.requesterMobile}</p>}
              </Card>

              <Card title="Merge into another ticket" testId="admin-ticket-detail-merge-card">
                <div className="flex gap-2">
                  <input
                    data-testid="admin-ticket-detail-merge-input"
                    value={mergeTargetId}
                    onChange={(e) => setMergeTargetId(e.target.value)}
                    placeholder="Target ticket ID"
                    className="flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
                  />
                  <button
                    type="button"
                    data-testid="admin-ticket-detail-merge-btn"
                    disabled={!mergeTargetId.trim()}
                    onClick={merge}
                    className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-40"
                  >
                    Merge
                  </button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
