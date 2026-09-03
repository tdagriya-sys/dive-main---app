import React, { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2, Plus, Save } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import InstrumentAutocomplete from "../components/dive/InstrumentAutocomplete";
import { PF_DECLARED_RATES } from "../lib/diveEngine";

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
  { value: "FD", label: "Fixed Deposit (FD/RD)" },
  { value: "PF", label: "Provident Fund (PPF/EPF)" },
  { value: "CRYPTO", label: "Crypto" },
];

const PF_SUB_TYPES = ["PPF", "EPF", "VPF"];

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
  const { setScreen, goBack, loadHoldings, updateHolding, holdings, editingHolding, setEditingHolding } = useDive();
  const isEditing = !!editingHolding;
  const isEditingFd = isEditing && editingHolding.assetClass === "FD";
  const isEditingPf = isEditing && editingHolding.assetClass === "PF";
  const isEditingSpecial = isEditingFd || isEditingPf;

  const [assetClass, setAssetClass] = useState(editingHolding?.assetClass || "EQUITY");
  const [instrument, setInstrument] = useState(
    isEditing && !isEditingSpecial
      ? { instrumentId: editingHolding.instrumentId, name: editingHolding.name }
      : { instrumentId: undefined, name: "" }
  );
  const [investedValue, setInvestedValue] = useState(isEditing && !isEditingSpecial ? String(editingHolding.investedValue ?? "") : "");
  const [currentValue, setCurrentValue] = useState(isEditing && !isEditingSpecial ? String(editingHolding.currentValue ?? "") : "");
  const [quantity, setQuantity] = useState(isEditing && !isEditingSpecial ? String(editingHolding.quantity ?? "") : "");
  const [fd, setFd] = useState(
    isEditingFd
      ? {
          bank: editingHolding.extraFields?.bank || "",
          principal: String(editingHolding.investedValue ?? ""),
          tenureMonths: String(editingHolding.extraFields?.tenureMonths ?? ""),
          startMonth: String(editingHolding.extraFields?.startMonth ?? new Date().getMonth() + 1),
          startYear: String(editingHolding.extraFields?.startYear ?? new Date().getFullYear()),
          interestRate: String(editingHolding.extraFields?.interestRate ?? ""),
        }
      : { bank: "", principal: "", tenureMonths: "", startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), interestRate: "" }
  );
  const [pf, setPf] = useState(
    isEditingPf
      ? {
          subType: editingHolding.extraFields?.subType || "PPF",
          institution: editingHolding.extraFields?.institution || "",
          openingBalance: String(editingHolding.investedValue ?? ""),
          monthlyContribution: String(editingHolding.extraFields?.monthlyContribution ?? ""),
          startMonth: String(editingHolding.extraFields?.startMonth ?? new Date().getMonth() + 1),
          startYear: String(editingHolding.extraFields?.startYear ?? new Date().getFullYear()),
          interestRatePercent: String(editingHolding.extraFields?.interestRatePercent ?? PF_DECLARED_RATES.PPF),
        }
      : {
          subType: "PPF",
          institution: "",
          openingBalance: "",
          monthlyContribution: "",
          startMonth: String(new Date().getMonth() + 1),
          startYear: String(new Date().getFullYear()),
          interestRatePercent: String(PF_DECLARED_RATES.PPF),
        }
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const resetFields = () => {
    setInstrument({ instrumentId: undefined, name: "" });
    setInvestedValue("");
    setCurrentValue("");
    setQuantity("");
    setFd({ bank: "", principal: "", tenureMonths: "", startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), interestRate: "" });
    setPf({
      subType: "PPF",
      institution: "",
      openingBalance: "",
      monthlyContribution: "",
      startMonth: String(new Date().getMonth() + 1),
      startYear: String(new Date().getFullYear()),
      interestRatePercent: String(PF_DECLARED_RATES.PPF),
    });
  };

  const back = () => {
    setEditingHolding(null);
    goBack();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (assetClass === "FD") {
        const payload = {
          assetClass: "FD",
          bank: fd.bank,
          principal: Number(fd.principal),
          tenureMonths: Number(fd.tenureMonths),
          startMonth: Number(fd.startMonth),
          startYear: Number(fd.startYear),
          interestRate: Number(fd.interestRate),
        };
        if (isEditing) await updateHolding(editingHolding.id, payload);
        else await api.post("/holdings/manual", payload);
      } else if (assetClass === "PF") {
        const payload = {
          assetClass: "PF",
          subType: pf.subType,
          institution: pf.institution,
          openingBalance: Number(pf.openingBalance),
          monthlyContribution: pf.monthlyContribution ? Number(pf.monthlyContribution) : undefined,
          startMonth: Number(pf.startMonth),
          startYear: Number(pf.startYear),
          interestRatePercent: Number(pf.interestRatePercent),
        };
        if (isEditing) await updateHolding(editingHolding.id, payload);
        else await api.post("/holdings/manual", payload);
      } else {
        const payload = {
          assetClass,
          instrumentId: instrument.instrumentId,
          name: instrument.name,
          investedValue: Number(investedValue),
          currentValue: currentValue ? Number(currentValue) : undefined,
          quantity: quantity ? Number(quantity) : undefined,
        };
        if (isEditing) await updateHolding(editingHolding.id, payload);
        else await api.post("/holdings/manual", payload);
      }

      if (isEditing) {
        setEditingHolding(null);
        goBack();
        return;
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
        <button data-testid="manual-entry-back-btn" onClick={back}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">{isEditing ? "Edit holding" : "Add manually"}</h1>
      </div>

      <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Investment type</label>
      {isEditing ? (
        // Asset class can't change on edit — a different asset class means a
        // different field set entirely (see updateHolding on the backend),
        // closer to delete-and-recreate than an edit. Shown as a fixed label
        // instead of the picker so it's clear this isn't editable here.
        <p className="mb-5 px-3 py-2 rounded-full text-xs font-bold border border-[var(--border)] bg-[var(--surface-card)] inline-block text-[var(--text-secondary)]">
          {ASSET_CLASSES.find((c) => c.value === assetClass)?.label || assetClass}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-5">
          {ASSET_CLASSES.map((c) => (
            <button key={c.value} type="button" data-testid={`asset-class-${c.value}`} onClick={() => setAssetClass(c.value)}
              className={`px-3 py-2 rounded-full text-xs font-bold border transition-colors ${assetClass === c.value ? "gold-btn border-[var(--dive-blue)]" : "bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)]"}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}

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
        ) : assetClass === "PF" ? (
          <>
            <div className="mb-4">
              <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Type</label>
              <div className="flex gap-2">
                {PF_SUB_TYPES.map((t) => (
                  <button key={t} type="button" data-testid={`pf-subtype-${t}`}
                    onClick={() => setPf((p) => ({ ...p, subType: t, interestRatePercent: String(PF_DECLARED_RATES[t]) }))}
                    className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors ${pf.subType === t ? "gold-btn border-[var(--dive-blue)]" : "bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)]"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <TextField label={pf.subType === "PPF" ? "Bank / post office" : "EPFO / employer"} testId="pf-institution-input"
              value={pf.institution} onChange={(e) => setPf((p) => ({ ...p, institution: e.target.value }))} required />
            <TextField label="Opening balance (₹)" testId="pf-opening-balance-input" type="number" min="0" value={pf.openingBalance}
              onChange={(e) => setPf((p) => ({ ...p, openingBalance: e.target.value }))} required />
            <TextField label="Monthly contribution (₹) — optional" testId="pf-monthly-contribution-input" type="number" min="0" value={pf.monthlyContribution}
              onChange={(e) => setPf((p) => ({ ...p, monthlyContribution: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Start month</label>
                <select data-testid="pf-start-month-input" value={pf.startMonth} onChange={(e) => setPf((p) => ({ ...p, startMonth: e.target.value }))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 outline-none font-semibold text-[var(--text-primary)]">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <TextField label="Start year" testId="pf-start-year-input" type="number" value={pf.startYear} onChange={(e) => setPf((p) => ({ ...p, startYear: e.target.value }))} required />
            </div>
            <TextField label="Interest rate (% p.a.)" testId="pf-rate-input" type="number" step="0.01" min="0" value={pf.interestRatePercent}
              onChange={(e) => setPf((p) => ({ ...p, interestRatePercent: e.target.value }))} required />
            <p className="text-xs text-[var(--text-secondary)] mb-4 -mt-2">
              Pre-filled with the current government-declared rate for {pf.subType} — edit if it's changed since.
            </p>
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
          {saving ? <Loader2 size={16} className="animate-spin" /> : isEditing ? <Save size={18} /> : <Plus size={18} />}
          {isEditing ? "Save changes" : "Save this holding"}
        </button>
      </form>

      {!isEditing && savedCount > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 text-sm font-semibold text-[var(--dive-blue-dark)]" data-testid="manual-entry-saved-banner">
          {savedCount} holding{savedCount > 1 ? "s" : ""} saved.
        </motion.div>
      )}

      {!isEditing && (
        <button data-testid="manual-entry-done-btn" onClick={finish}
          className="w-full mt-4 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
          Done adding investments
        </button>
      )}
    </div>
  );
}
