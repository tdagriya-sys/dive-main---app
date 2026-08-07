import React, { useState } from "react";
import { motion } from "framer-motion";
import { LogOut, ListChecks, Loader2, AlertTriangle, FileDown, Bot } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

const CATEGORIES = ["Equity", "Mutual Funds", "Bonds", "Gold/Silver", "REIT/InvIT", "ETF", "FD", "Insurance", "Crypto"];
const RISK = ["Conservative", "Balanced", "Aggressive"];
const RETURN = ["Modest", "Moderate", "High"];
const DIV = ["Low", "Medium", "High"];

export default function Preferences() {
  const { user, prefs, savePrefs, logout, setScreen, deleteAccount } = useDive();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [reportError, setReportError] = useState("");
  if (!user) return null;

  const downloadReport = async () => {
    setDownloadingReport(true);
    setReportError("");
    try {
      const res = await api.get("/score/breakdown/pdf", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "divve-resilience-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setReportError("Couldn't generate your report. Please try again.");
    } finally {
      setDownloadingReport(false);
    }
  };

  const confirmDeleteAccount = async () => {
    setDeleting(true);
    setError("");
    try {
      await deleteAccount();
    } catch (err) {
      setError("Couldn't delete your account. Please try again.");
      setDeleting(false);
    }
  };
  const toggleChip = (list, key, val) => {
    const has = list.includes(val);
    savePrefs({ ...prefs, [key]: has ? list.filter((x) => x !== val) : [...list, val] });
  };
  const customized = prefs.risk !== "Balanced" || prefs.excluded.length > 0;

  return (
    <div className="min-h-full dive-app-surface pb-24" data-testid="preferences-screen">
      <div className="px-6 pt-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading font-black text-2xl">{user.name}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{user.email}</p>
          <span className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-md ${customized ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue-dark)]" : "bg-[#D1FAE5] text-[#047857]"}`}>
            {customized ? "Customized" : "Security-first (default)"}
          </span>
        </div>
        <button data-testid="logout-btn" onClick={logout} className="w-10 h-10 rounded-xl bg-[var(--surface-card)] border border-[var(--border)] flex items-center justify-center shrink-0">
          <LogOut size={18} className="text-[var(--text-secondary)]" />
        </button>
      </div>

      <Section title="Risk appetite">
        <SegRow options={RISK} value={prefs.risk} onChange={(v) => savePrefs({ ...prefs, risk: v })} testid="risk" />
      </Section>
      <Section title="Return expectation">
        <SegRow options={RETURN} value={prefs.returnExpectation} onChange={(v) => savePrefs({ ...prefs, returnExpectation: v })} testid="return" />
      </Section>
      <Section title="Diversification priority" hint="How hard should DIVVE push you to spread out?">
        <SegRow options={DIV} value={prefs.diversificationPriority} onChange={(v) => savePrefs({ ...prefs, diversificationPriority: v })} testid="div" />
      </Section>

      <Section title="Preferred categories">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={prefs.preferred.includes(c)} onClick={() => toggleChip(prefs.preferred, "preferred", c)} testid={`pref-${c}`} />
          ))}
        </div>
      </Section>
      <Section title="Excluded categories" hint="Things you never want DIVVE to suggest.">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={prefs.excluded.includes(c)} danger onClick={() => toggleChip(prefs.excluded, "excluded", c)} testid={`excl-${c}`} />
          ))}
        </div>
      </Section>

      <div className="px-6 mt-4">
        <p className="text-xs text-[var(--text-secondary)] text-center">Change these anytime — DIVVE adapts instantly.</p>
      </div>

      <Section title="Reports" hint="Your full resilience score breakdown, as a downloadable one-pager.">
        {reportError && <p className="text-xs text-[var(--red)] font-semibold mb-3">{reportError}</p>}
        <button data-testid="prefs-download-report-btn" onClick={downloadReport} disabled={downloadingReport}
          className="w-full gold-btn rounded-full py-3.5 font-bold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
          {downloadingReport ? <Loader2 size={18} className="animate-spin" /> : <FileDown size={18} />}
          {downloadingReport ? "Preparing report…" : "Download Resilience Score Report (PDF)"}
        </button>
      </Section>

      <div className="px-6 mt-6">
        <button data-testid="prefs-manage-holdings-btn" onClick={() => setScreen("myHoldings")}
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
          <ListChecks size={18} className="text-[var(--dive-blue)]" /> Manage holdings
        </button>
      </div>

      <div className="px-6 mt-3">
        <button data-testid="prefs-simulate-popup-btn" onClick={() => setScreen("divebot")}
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
          <Bot size={18} className="text-[var(--dive-blue)]" /> Simulate app pop-up
        </button>
      </div>

      <div className="px-6 mt-8">
        <h2 className="font-heading font-bold text-lg text-[var(--red)]">Danger zone</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-3">Permanently deletes your account and every holding you've added. This can't be undone.</p>
        {error && <p className="text-xs text-[var(--red)] font-semibold mb-3">{error}</p>}
        {!confirmingDelete ? (
          <button data-testid="delete-account-btn" onClick={() => setConfirmingDelete(true)}
            className="w-full rounded-full py-3.5 font-bold border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors">
            Delete account
          </button>
        ) : (
          <div className="bg-[var(--red)]/10 border border-[var(--red)]/20 rounded-2xl p-4" data-testid="delete-account-confirm">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-[var(--red)]" />
              <span className="text-sm font-bold text-[var(--red)]">Are you sure?</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-4">All your holdings and account data will be permanently deleted.</p>
            <div className="flex gap-3">
              <button data-testid="delete-account-cancel-btn" onClick={() => setConfirmingDelete(false)} disabled={deleting}
                className="flex-1 rounded-full py-3 font-bold bg-[var(--surface-card)] border border-[var(--border)]">
                Cancel
              </button>
              <button data-testid="delete-account-confirm-btn" onClick={confirmDeleteAccount} disabled={deleting}
                className="flex-1 rounded-full py-3 font-bold bg-[var(--red)] text-white flex items-center justify-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={16} className="animate-spin" /> : null} Yes, delete everything
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <div className="px-6 mt-6">
      <h2 className="font-heading font-bold text-lg">{title}</h2>
      {hint && <p className="text-xs text-[var(--text-secondary)] mb-3">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

function SegRow({ options, value, onChange, testid }) {
  return (
    <div className="flex gap-1 bg-[var(--surface-card)] rounded-full p-1 border border-[var(--border)]">
      {options.map((o) => (
        <button key={o} data-testid={`${testid}-${o}`} onClick={() => onChange(o)}
          className={`flex-1 rounded-full py-2 text-[11px] sm:text-xs font-bold transition-colors ${value === o ? "gold-btn" : "text-[var(--text-secondary)]"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Chip({ label, active, danger, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className={`px-3 py-2 rounded-full text-sm font-semibold border transition-colors ${active
        ? danger ? "bg-[#FEE2E2] border-[var(--red)] text-[#B91C1C]" : "bg-[var(--dive-blue-light)] border-[var(--dive-blue)] text-[var(--dive-blue-dark)]"
        : "bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)]"}`}>
      {label}
    </button>
  );
}
