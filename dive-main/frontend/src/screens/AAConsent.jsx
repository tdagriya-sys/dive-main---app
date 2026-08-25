import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, ShieldCheck, Loader2, ChevronLeft } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";

const FI_TYPES = [
  { key: "EQUITIES", label: "Equity" },
  { key: "MUTUAL_FUNDS", label: "Mutual Funds" },
  { key: "DEPOSIT", label: "Fixed Deposits" },
  { key: "INSURANCE_POLICIES", label: "Insurance / ULIP" },
];

export default function AAConsent() {
  const { setScreen, goBack, loadHoldings } = useDive();
  const [phase, setPhase] = useState("loading"); // loading | consent | fetching | error
  const [consent, setConsent] = useState(null);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState("");
  const [fetchedCount, setFetchedCount] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post("/aa/consent/request");
        setConsent(data);
        setPhase("consent");
      } catch (err) {
        setError("Couldn't start the Account Aggregator consent flow. Please try again.");
        setPhase("error");
      }
    })();
  }, []);

  const giveConsent = async () => {
    if (!consented || !consent) return;
    setPhase("fetching");
    try {
      if (consent.isMock) {
        await api.post(`/aa/consent/${consent.consentHandle}/approve`);
      } else {
        // Real Finvu sandbox: hand off to their hosted consent UI; they redirect
        // back / call our webhook once the user approves there.
        window.location.href = consent.approvalUrl;
        return;
      }
      const { data } = await api.post(`/aa/consent/${consent.consentHandle}/fetch`);
      setFetchedCount(data.holdings.length);
      await loadHoldings();
      setTimeout(() => setScreen("reveal"), 900);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't fetch your investments. Please try again.");
      setPhase("error");
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex flex-col h-full items-center justify-center dive-app-surface relative" data-testid="aa-consent-screen">
        <button data-testid="aa-consent-loading-back-btn" onClick={goBack} className="absolute top-8 left-7"><ChevronLeft size={22} /></button>
        <Loader2 size={28} className="animate-spin text-[var(--dive-blue)]" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col h-full px-7 py-10 items-center justify-center text-center dive-app-surface" data-testid="aa-consent-screen">
        <p className="text-sm text-[var(--red)] font-semibold mb-6">{error}</p>
        <button data-testid="aa-consent-back-btn" onClick={goBack} className="w-full gold-btn rounded-full py-4 font-bold">
          Back
        </button>
      </div>
    );
  }

  if (phase === "fetching") {
    return (
      <div className="flex flex-col h-full px-7 py-10 dive-app-surface justify-center" data-testid="aa-consent-screen">
        <h1 className="font-heading font-black text-2xl mb-1">Fetching your investments…</h1>
        <p className="text-[var(--text-secondary)] mb-8 text-sm">Connecting securely via the Account Aggregator.</p>
        <div className="flex justify-center mb-6">
          <Loader2 size={28} className="animate-spin text-[var(--dive-blue)]" />
        </div>
        {fetchedCount !== null && (
          <p className="text-center text-sm font-bold text-[var(--dive-blue)]">{fetchedCount} holdings fetched</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full px-7 py-10 dive-app-surface" data-testid="aa-consent-screen">
      <h1 className="font-heading font-black text-3xl mb-2">DIVVE needs a look</h1>
      <p className="text-[var(--text-secondary)] mb-6">We'll read (never touch) these investments via a licensed Account Aggregator.</p>
      {consent?.isMock && (
        <div className="bg-[var(--amber)]/10 border border-[var(--amber)]/20 rounded-xl px-4 py-3 mb-4 text-xs font-semibold text-[var(--amber)]">
          Sandbox mode — no real Finvu credentials are configured, so this uses realistic sample data instead of your actual accounts. See /docs/GETTING_API_KEYS.md to connect a real sandbox.
        </div>
      )}
      <div className="space-y-2 mb-6">
        {FI_TYPES.map((f) => (
          <div key={f.key} className="flex items-center gap-3 bg-[var(--surface-card)] rounded-xl border border-[var(--border)] px-4 py-3">
            <Check size={16} className="text-[var(--dive-blue)]" />
            <span className="font-semibold text-sm">{f.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Account Aggregators can't fetch physical gold/silver, ETFs, REITs/InvITs, or crypto — add those via Manual Entry, File Upload, or Bot Scan.
      </p>
      <div className="flex items-center gap-2 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 mb-6">
        <ShieldCheck size={18} className="text-[var(--dive-blue-dark)]" />
        <span className="text-xs font-semibold text-[var(--dive-blue-dark)]">Secured via Account Aggregator framework · read-only</span>
      </div>
      <button data-testid="aa-consent-toggle-btn" onClick={() => setConsented(!consented)}
        className={`w-full rounded-xl py-3 mb-3 font-bold border transition-colors ${consented ? "bg-[var(--dive-blue-light)] border-[var(--dive-blue)] text-[var(--dive-blue-dark)]" : "bg-[var(--surface-card)] border-[var(--border)]"}`}>
        {consented ? "✓ Consent given" : "I consent to a read-only look"}
      </button>
      <button data-testid="aa-consent-continue-btn" disabled={!consented} onClick={giveConsent}
        className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors">
        Give Consent & Continue
      </button>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={goBack}
        className="w-full text-center mt-4 text-sm font-bold text-[var(--text-secondary)]">
        Cancel
      </motion.button>
    </div>
  );
}
