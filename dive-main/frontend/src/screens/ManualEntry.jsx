import React, { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2, Plus } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import InstrumentAutocomplete from "../components/dive/InstrumentAutocomplete";

const ASSET_CLASSES = [
  { value: "EQUITY", label: "Equity" },
  { value: "MUTUAL_FUND", label: "Mutual Fund" },
  { value: "ETF", label: "ETF" },
  { value: "BOND", label: "Bond" },
  { value: "REIT", label: "REIT" },
  { value: "INVIT", label: "InvIT" },
  { value: "GOLD", label: "Gold" },
  { value: "SILVER", label: "Silver" },
  { value: "ULIP_INSURANCE", label: "ULIP / Insurance" },
  { value: "FD", label: "Fixed Deposit" },
  { value: "CRYPTO", label: "Crypto" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function TextField({ label, testId, ...props }) {
  return (
    <div className="mb-4">
      <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">{label}</label>
      <input data-testid={testId} {...props}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 outline-none font-semibold text-[var(--text-primary)]" />
    </div>
  );
}

export default function ManualEntry() {
  const { setScreen, goBack, loadHoldings, holdings } = useDive();
  const [assetClass, setAssetClass] = useState("EQUITY");
  const [instrument, setInstrument] = useState({ instrumentId: undefined, name: "" });
  const [investedValue, setInvestedValue] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [quantity, setQuantity] = useState("");
  const [fd, setFd] = useState({ bank: "", principal: "", tenureMonths: "", startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), interestRate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const resetFields = () => {
    setInstrument({ instrumentId: undefined, name: "" });
    setInvestedValue("");
    setCurrentValue("");
    setQuantity("");
    setFd({ bank: "", principal: "", tenureMonths: "", startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), interestRate: "" });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (assetClass === "FD") {
        await api.post("/holdings/manual", {
          assetClass: "FD",
          bank: fd.bank,
          principal: Number(fd.principal),
          tenureMonths: Number(fd.tenureMonths),
          startMonth: Number(fd.startMonth),
          startYear: Number(fd.startYear),
          interestRate: Number(fd.interestRate),
        });
      } else {
        await api.post("/holdings/manual", {
          assetClass,
          instrumentId: instrument.instrumentId,
          name: instrument.name,
          investedValue: Number(investedValue),
          currentValue: currentValue ? Number(currentValue) : undefined,
          quantity: quantity ? Number(quantity) : undefined,
        });
      }
      setSavedCount((c) => c + 1);
      resetFields();
      await loadHoldings();
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.message || data?.issues?.[0]?.message || "Couldn't save that holding. Please check the fields.");
    } finally {
      setSaving(false);
    }
  };

  const finish = () => setScreen(holdings.length || savedCount ? "reveal" : "chooseMethod");

  return (
    <div className="flex flex-col min-h-full px-7 py-8 dive-app-surface" data-testid="manual-entry-screen">
      <div className="flex items-center gap-3 mb-4">
        <button data-testid="manual-entry-back-btn" onClick={goBack}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">Add manually</h1>
      </div>

      <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Investment type</label>
      <div className="flex flex-wrap gap-2 mb-5">
        {ASSET_CLASSES.map((c) => (
          <button key={c.value} type="button" data-testid={`asset-class-${c.value}`} onClick={() => setAssetClass(c.value)}
            className={`px-3 py-2 rounded-full text-xs font-bold border transition-colors ${assetClass === c.value ? "gold-btn border-[var(--dive-blue)]" : "bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)]"}`}>
            {c.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        {assetClass === "FD" ? (
          <>
            <TextField label="Bank / institution" testId="fd-bank-input" value={fd.bank} onChange={(e) => setFd((f) => ({ ...f, bank: e.target.value }))} required />
            <TextField label="Invested (principal) amount" testId="fd-principal-input" type="number" min="1" value={fd.principal} onChange={(e) => setFd((f) => ({ ...f, principal: e.target.value }))} required />
            <TextField label="Tenure (months)" testId="fd-tenure-input" type="number" min="1" value={fd.tenureMonths} onChange={(e) => setFd((f) => ({ ...f, tenureMonths: e.target.value }))} required />
            <div className="grid grid-cols-2 gap-3">
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Start month</label>
                <select data-testid="fd-start-month-input" value={fd.startMonth} onChange={(e) => setFd((f) => ({ ...f, startMonth: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 outline-none font-semibold text-[var(--text-primary)]">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <TextField label="Start year" testId="fd-start-year-input" type="number" value={fd.startYear} onChange={(e) => setFd((f) => ({ ...f, startYear: e.target.value }))} required />
            </div>
            <TextField label="Interest rate (% p.a.)" testId="fd-rate-input" type="number" step="0.01" min="0" value={fd.interestRate} onChange={(e) => setFd((f) => ({ ...f, interestRate: e.target.value }))} required />
          </>
        ) : (
          <>
            <InstrumentAutocomplete assetClass={assetClass} value={instrument} onChange={setInstrument} testId="manual-instrument-input" />
            <TextField label="Invested value (₹)" testId="manual-invested-input" type="number" min="0" value={investedValue} onChange={(e) => setInvestedValue(e.target.value)} required />
            <TextField label="Current value (₹) — optional" testId="manual-current-input" type="number" min="0" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
            <TextField label="Quantity — optional" testId="manual-quantity-input" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </>
        )}

        {error && <p className="text-xs text-[var(--red)] font-semibold mb-3">{error}</p>}

        <button data-testid="manual-entry-save-btn" type="submit" disabled={saving}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />} Save this holding
        </button>
      </form>

      {savedCount > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 text-sm font-semibold text-[var(--dive-blue-dark)]" data-testid="manual-entry-saved-banner">
          {savedCount} holding{savedCount > 1 ? "s" : ""} saved.
        </motion.div>
      )}

      <button data-testid="manual-entry-done-btn" onClick={finish}
        className="w-full mt-4 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        Done adding investments
      </button>
    </div>
  );
}
