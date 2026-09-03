import React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Mail, Clock, Lock, CheckCircle2, Loader2 } from "lucide-react";
import { BackLink, SubpageHead, CompanyFooterNote } from "./SubpageChrome";
import { api } from "../../lib/api";

const SUPPORT_EMAIL = "hello@divve.in";

const CONTACT_POINTS = [
  { Icon: Mail, text: `${SUPPORT_EMAIL} — we personally read every message` },
  { Icon: Clock, text: "Prefer a call? Pick a slot below and we'll ring you" },
  { Icon: Lock, text: "Your details stay with us — never sold, never spammed" },
];

const TIME_SLOTS = [
  "Morning · 9 AM – 12 PM",
  "Afternoon · 12 PM – 3 PM",
  "Evening · 3 PM – 6 PM",
  "Night · 6 PM – 9 PM",
  "Anytime works",
];

function Field({ label, testId, ...props }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{label}</span>
      <input
        data-testid={testId}
        className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors"
        {...props}
      />
    </label>
  );
}

// Posts to POST /api/contact (backend/src/routes/contact.routes.ts), which
// validates the payload and saves it as a ContactSubmission document — a
// real submission, not a mailto draft the visitor has to send themselves.
// The mailto link only reappears as a fallback if the request itself fails
// (network/server down), so there's still a way to reach us even then,
// rather than the message just silently going nowhere.
export default function ContactPage({ onBack }) {
  const [form, setForm] = React.useState({ name: "", email: "", mobile: "", subject: "", description: "", slot: TIME_SLOTS[0] });
  const [sent, setSent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/contact", {
        name: form.name,
        email: form.email,
        mobile: form.mobile,
        subject: form.subject,
        description: form.description,
        timeSlot: form.slot,
      });
      setSent(true);
    } catch (err) {
      const message = err?.response?.data?.message || `Couldn't reach our server — please try again, or email us directly at ${SUPPORT_EMAIL}.`;
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 md:py-20" data-testid="contact-page">
      <BackLink onClick={onBack} />

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-14 items-start">
        <div>
          <SubpageHead
            eyebrow="Contact us"
            title={<>Got a question? <span className="text-gold-gradient">Ask a real person.</span></>}
            lede="No chatbot maze, no ticket queue that goes nowhere — tell us what's on your mind and we'll actually get back to you."
            maxWidth="max-w-xl"
          />
          <div className="mt-10 space-y-4">
            {CONTACT_POINTS.map((c) => (
              <div key={c.text} className="flex items-start gap-3 text-sm text-[var(--text-secondary)] leading-relaxed">
                <c.Icon size={16} className="text-[var(--dive-blue)] shrink-0 mt-0.5" /> {c.text}
              </div>
            ))}
          </div>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[var(--border-light)] bg-[var(--surface-card)] p-7 sm:p-8"
        >
          {sent ? (
            <div className="text-center py-10" data-testid="contact-sent-state">
              <CheckCircle2 size={40} className="text-[var(--green)] mx-auto" />
              <h3 className="font-heading font-black text-xl mt-4">Got it — thank you</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">
                Your message is saved and we'll get back to you at {form.email || "the email you gave us"} soon — or by call, in your {form.slot.toLowerCase()} slot.
              </p>
              <button type="button" data-testid="contact-send-another-btn" onClick={() => { setSent(false); setForm({ name: "", email: "", mobile: "", subject: "", description: "", slot: TIME_SLOTS[0] }); }}
                className="mt-6 text-sm font-bold text-[var(--dive-blue)] hover:underline">
                Send another message
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Name" testId="contact-name-input" type="text" required value={form.name} onChange={update("name")} placeholder="Your full name" />
                <Field label="Email" testId="contact-email-input" type="email" required value={form.email} onChange={update("email")} placeholder="you@email.com" />
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <Field label="Mobile number" testId="contact-mobile-input" type="tel" required value={form.mobile} onChange={update("mobile")} placeholder="+91 98765 43210" />
                <Field label="Subject" testId="contact-subject-input" type="text" value={form.subject} onChange={update("subject")} placeholder="What's this about?" />
              </div>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Description</span>
                <textarea
                  data-testid="contact-description-input"
                  rows={5} required value={form.description} onChange={update("description")}
                  placeholder="Tell us a bit more…"
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors resize-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Best time to reach you on a call</span>
                <select
                  data-testid="contact-slot-select"
                  value={form.slot} onChange={update("slot")}
                  className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors"
                >
                  {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              <button type="submit" data-testid="contact-submit-btn" disabled={submitting}
                className="gold-btn w-full rounded-full py-4 font-bold flex items-center justify-center gap-2 transition-transform hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none">
                {submitting ? <><Loader2 size={17} className="animate-spin" /> Sending…</> : <>Send message <Mail size={17} /></>}
              </button>
              <p className="text-xs text-[var(--text-tertiary)] text-center">Saved straight to our team's inbox — nothing routes through your own email app.</p>
            </div>
          )}
        </motion.form>
      </div>
      <CompanyFooterNote />
    </div>
  );
}
