import React, { useState } from "react";
import { motion } from "framer-motion";
import { X, LifeBuoy, Mail } from "lucide-react";
import { useDive } from "../context/DiveContext";

const SUPPORT_EMAIL = "hello@divve.in";

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

// Same floating centered-modal pattern already established by
// ExtensionDownloadCard.jsx — triggered from both AppHeader.jsx (header
// button) and DiveShell.jsx (sidebar button), so its open/close state lives
// in DiveShell, their shared parent. Not portaled, unlike Suggestions.jsx's
// WhatIfSheet/etc. — same reasoning as ExtensionDownloadCard: this is
// rendered at DiveShell's own top level, outside the sidebar/content split,
// which never scrolls, so plain `fixed` positioning is already correct here
// without needing document.body.
//
// Deliberately NOT a backend submission like ContactPage.jsx's own support
// form (POST /api/contact, saved for the team to read later) — this one
// hands off to the user's own configured mail app via a plain `mailto:`
// link instead, prefilled and ready to review before it actually sends,
// reachable from inside the app itself (Contact Us only exists on the
// logged-out marketing site) with zero backend involvement.
export default function SupportCard({ onClose }) {
  const { user } = useDive();
  const [email, setEmail] = useState(user?.email || "");
  const [mobile, setMobile] = useState(user?.mobile || "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const submit = (e) => {
    e.preventDefault();
    // The email actually SENDS from whatever address the user's mail app is
    // configured with, which may not match what they typed above — restating
    // both fields in the body itself is what makes the given email/mobile
    // reach us at all, not just whatever the mail client's own "From" says.
    const body = `From: ${email}\nMobile: ${mobile}\n\n${description}`;
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject || "Support request")}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
    onClose();
  };

  return (
    <motion.div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--surface-card)] rounded-3xl p-6 max-h-[85vh] overflow-y-auto no-scrollbar"
        initial={{ opacity: 0, scale: 0.94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }} data-testid="support-card">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <LifeBuoy size={20} className="text-[var(--dive-blue)]" />
            </div>
            <h2 className="font-heading font-black text-xl">Need help?</h2>
          </div>
          <button data-testid="support-close-btn" onClick={onClose} className="shrink-0"><X size={22} className="text-[var(--text-secondary)]" /></button>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-5">
          Fill this in and we'll open your mail app with everything ready to send to <span className="font-semibold text-[var(--text-primary)]">{SUPPORT_EMAIL}</span>.
        </p>

        <form onSubmit={submit}>
          <Field label="Email" testId="support-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
          <Field label="Mobile number" testId="support-mobile-input" type="tel" required value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91 98765 43210" />
          <Field label="Subject" testId="support-subject-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What's this about?" />
          <label className="block mb-5">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Description</span>
            <textarea
              data-testid="support-description-input"
              rows={4} required value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what's going on…"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--dive-blue)] transition-colors resize-none"
            />
          </label>
          <button type="submit" data-testid="support-submit-btn"
            className="w-full gold-btn rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--dive-blue-hover)] transition-colors">
            <Mail size={17} /> Open mail app
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}
