import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Upload, Loader2, X, Check, ShieldAlert, Trash2 } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import InstrumentAutocomplete from "../components/dive/InstrumentAutocomplete";
import ScanningLoader from "../components/dive/ScanningLoader";
import { PF_DECLARED_RATES } from "../lib/diveEngine";

const ASSET_CLASSES = [
  "EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "FD", "PF", "CRYPTO",
];

function emptyFd() {
  return { bank: "", tenureMonths: "12", startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), interestRate: "7" };
}

// c.pf* below is pre-filled from whatever the AI extraction pulled out
// (pfSubType/pfInstitution/pfMonthlyContribution/pfInterestRatePercent — see
// aiExtractionService.ts) when this candidate came from a scan/upload;
// startMonth/startYear are never AI-extracted (no clean single date is
// usually visible on a PF passbook screenshot), so they default to "now",
// same as emptyFd()'s own defaults.
function emptyPf(c) {
  return {
    subType: c?.pfSubType || "PPF",
    institution: c?.pfInstitution || "",
    monthlyContribution: c?.pfMonthlyContribution != null ? String(c.pfMonthlyContribution) : "",
    startMonth: String(new Date().getMonth() + 1),
    startYear: String(new Date().getFullYear()),
    interestRatePercent: c?.pfInterestRatePercent != null ? String(c.pfInterestRatePercent) : String(PF_DECLARED_RATES[c?.pfSubType || "PPF"]),
  };
}

export default function FileUpload() {
  const { setScreen, goBack, loadHoldings, holdings } = useDive();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [candidates, setCandidates] = useState(null); // null = not yet uploaded
  const [message, setMessage] = useState("");
  const [excludedNotes, setExcludedNotes] = useState("");
  const [error, setError] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveFailedCount, setSaveFailedCount] = useState(0);
  // A hung AI response otherwise has no escape short of waiting out the full
  // timeout chain (OpenAI/Anthropic SDK timeout x maxRetries — up to TWICE
  // that if the OpenAI primary call fails and falls back to Claude — plus
  // Nginx's proxy_read_timeout and this request's own axios timeout, see
  // aiExtractionService.ts) — this lets the user bail out immediately instead.
  const uploadAbortRef = useRef(null);

  const pickFile = () => fileInputRef.current?.click();

  const onFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    setCandidates(null);
    setExcludedNotes("");
    setSavedCount(0);
    setSaveFailedCount(0);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      const form = new FormData();
      form.append("file", file);
      // Longer than the backend's own AI-call timeout (60s x up to 2 attempts,
      // see aiExtractionService.ts) and Nginx's proxy_read_timeout (see
      // docs/SERVER_DEPLOYMENT_GUIDE.md), so a real "took too long" error from
      // the backend has a chance to arrive intact — its message is already
      // surfaced below via err.response.data.message.
      const { data } = await api.post("/uploads", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 150_000,
        signal: controller.signal,
      });
      setMessage(data.message || "");
      setExcludedNotes(data.excludedNotes || "");
      setCandidates(
        (data.candidates || []).map((c, i) => ({
          _localId: i,
          include: true,
          name: c.name,
          instrumentId: c.instrumentId || null,
          assetClass: c.assetClass || "EQUITY",
          investedValue: c.investedValue ?? "",
          currentValue: c.currentValue ?? "",
          quantity: c.quantity ?? "",
          confidence: c.confidence,
          verifiedInInstrumentList: c.verifiedInInstrumentList,
          missingFields: c.missingFields || [],
          accountLabel: c.accountLabel || "",
          fd: emptyFd(),
          pf: emptyPf(c),
          saveError: null,
        }))
      );
    } catch (err) {
      // A deliberate cancel isn't a failure — no scary error message.
      if (err.code !== "ERR_CANCELED") {
        setError(err?.response?.data?.message || "Couldn't parse that file. Please try another one, or add manually.");
      }
    } finally {
      setUploading(false);
      e.target.value = "";
      uploadAbortRef.current = null;
    }
  };

  const cancelUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const updateCandidate = (localId, patch) => {
    // Editing a row clears its saveError — the row is being fixed, so a
    // stale "couldn't save" message from before the edit would be misleading.
    setCandidates((prev) => prev.map((c) => (c._localId === localId ? { ...c, ...patch, saveError: null } : c)));
  };

  const removeCandidate = (localId) => {
    setCandidates((prev) => prev.filter((c) => c._localId !== localId));
  };

  function errorMessageOf(err, fallback) {
    const data = err?.response?.data;
    return data?.message || data?.issues?.[0]?.message || fallback;
  }

  // Each row is saved independently and its own outcome is tracked — a
  // failed row (bad value, an instrument the backend couldn't resolve) used
  // to just be silently skipped, leaving the user with only an aggregate "X
  // saved" count and no way to tell which row didn't make it or why.
  // Successful rows are removed from the list (so re-clicking "Save
  // selected" can't resubmit and duplicate them); failed rows stay, visibly
  // flagged with the real error, so they can be fixed and retried.
  const saveAll = async () => {
    setSavingAll(true);
    setError("");
    const toSave = candidates.filter((c) => c.include);
    let saved = 0;
    const errorsByLocalId = new Map();
    for (const c of toSave) {
      try {
        if (c.assetClass === "FD") {
          await api.post("/holdings/manual", {
            assetClass: "FD",
            bank: c.fd.bank || c.name,
            principal: Number(c.investedValue) || 0,
            tenureMonths: Number(c.fd.tenureMonths),
            startMonth: Number(c.fd.startMonth),
            startYear: Number(c.fd.startYear),
            interestRate: Number(c.fd.interestRate),
            source: "FILE_UPLOAD",
          });
        } else if (c.assetClass === "PF") {
          await api.post("/holdings/manual", {
            assetClass: "PF",
            subType: c.pf.subType,
            institution: c.pf.institution || c.name,
            openingBalance: Number(c.investedValue) || 0,
            monthlyContribution: c.pf.monthlyContribution ? Number(c.pf.monthlyContribution) : undefined,
            startMonth: Number(c.pf.startMonth),
            startYear: Number(c.pf.startYear),
            interestRatePercent: Number(c.pf.interestRatePercent),
            source: "FILE_UPLOAD",
          });
        } else {
          await api.post("/holdings/manual", {
            assetClass: c.assetClass,
            instrumentId: c.instrumentId || undefined,
            name: c.name,
            investedValue: Number(c.investedValue) || 0,
            currentValue: c.currentValue ? Number(c.currentValue) : undefined,
            quantity: c.quantity ? Number(c.quantity) : undefined,
            source: "FILE_UPLOAD",
          });
        }
        saved += 1;
      } catch (err) {
        errorsByLocalId.set(c._localId, errorMessageOf(err, "Couldn't save this holding — check the fields above."));
      }
    }
    setCandidates((prev) =>
      (prev || [])
        .filter((c) => !c.include || errorsByLocalId.has(c._localId))
        .map((c) => (errorsByLocalId.has(c._localId) ? { ...c, saveError: errorsByLocalId.get(c._localId) } : c))
    );
    setSavedCount(saved);
    setSaveFailedCount(errorsByLocalId.size);
    await loadHoldings();
    setSavingAll(false);
    if (errorsByLocalId.size === 0 && saved === toSave.length) {
      setCandidates(null);
    }
  };

  // "Done" must not unconditionally jump to the score-reveal screen — with
  // nothing saved (savedCount === 0) on a genuinely empty account
  // (holdings.length === 0), that screen has no score to reveal and just
  // looks like a confusing, unexplained dashboard jump. Mirrors
  // ManualEntry.jsx's finish(), which gets this right already.
  const finish = () => setScreen(holdings.length || savedCount ? "reveal" : "chooseMethod");

  return (
    <div className="flex flex-col min-h-full px-7 py-8 dive-app-surface" data-testid="file-upload-screen">
      <div className="flex items-center gap-3 mb-4">
        <button data-testid="file-upload-back-btn" onClick={goBack}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">Upload a file</h1>
      </div>
      <p className="text-[var(--text-secondary)] mb-5 text-sm">Screenshot, PDF, statement (XLSX/CSV) or a JSON export from your broker.</p>

      <div data-testid="market-data-notice" className="bg-[var(--amber)]/10 border border-[var(--amber)]/20 rounded-xl px-4 py-3 mb-5 text-xs font-semibold text-[var(--amber)]">
        We currently have limited access to market data, which may cause some instruments to not match our directory yet. We're working hard to bring in full market coverage as soon as possible, to give you the best experience.
      </div>

      <input ref={fileInputRef} type="file" data-testid="file-upload-input" className="hidden"
        accept=".csv,.xlsx,.xls,.json,.pdf,image/png,image/jpeg,image/webp" onChange={onFileSelected} />

      {uploading ? (
        <ScanningLoader
          title="Reading your file…"
          subtitle="An AI model is extracting your holdings from the document."
          messages={[
            "Scanning document…",
            "Extracting text and tables…",
            "Fetching investment details…",
            "Matching instruments to our database…",
            "Categorizing into asset classes…",
            "Almost done…",
          ]}
          onCancel={cancelUpload}
        />
      ) : (
        !candidates && (
          <button data-testid="file-upload-pick-btn" onClick={pickFile}
            className="w-full border-2 border-dashed border-[var(--border)] rounded-2xl py-10 flex flex-col items-center gap-2 text-[var(--text-secondary)] hover:border-[var(--dive-blue)] transition-colors">
            <Upload size={28} />
            <span className="font-bold text-sm">Tap to choose a file</span>
          </button>
        )
      )}

      {error && <p className="text-xs text-[var(--red)] font-semibold mt-3">{error}</p>}
      {message && !candidates?.length && <p className="text-sm text-[var(--text-secondary)] mt-4">{message}</p>}

      {candidates && candidates.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mt-4 mb-1">
            Review detected holdings ({candidates.length})
          </p>
          <p className="text-xs text-[var(--text-secondary)] mb-1">Every field below is editable, and you can remove any row entirely.</p>
          {excludedNotes && <p className="text-xs text-[var(--text-tertiary)] italic mb-3">{excludedNotes}</p>}
          <div className="space-y-3">
            {candidates.map((c) => (
              <div key={c._localId} className={`rounded-2xl border p-4 ${c.include ? "border-[var(--border)] bg-[var(--surface-card)]" : "border-[var(--border-light)] bg-[var(--surface-card)]/40 opacity-50"}`} data-testid={`upload-candidate-${c._localId}`}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <InstrumentAutocomplete
                    assetClass={c.assetClass}
                    value={{ instrumentId: c.instrumentId, name: c.name }}
                    onChange={({ instrumentId, name }) => updateCandidate(c._localId, { instrumentId, name, verifiedInInstrumentList: !!instrumentId })}
                    testId={`upload-candidate-name-${c._localId}`}
                    hideLabel
                    wrapperClassName="relative flex-1 min-w-0"
                    inputClassName="w-full font-bold text-sm bg-[var(--surface-card)] text-[var(--text-primary)] outline-none"
                  />
                  <button data-testid={`upload-candidate-toggle-${c._localId}`} onClick={() => updateCandidate(c._localId, { include: !c.include })}
                    className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${c.include ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]"}`}>
                    {c.include ? <Check size={14} /> : <X size={14} />}
                  </button>
                  <button data-testid={`upload-candidate-remove-${c._localId}`} onClick={() => removeCandidate(c._localId)}
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-[var(--surface-card-hover)] text-[var(--red)]" aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
                {c.accountLabel && (
                  <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-2">{c.accountLabel}</p>
                )}
                {c.missingFields.length > 0 && (
                  <p className="text-[10px] font-bold text-[var(--amber)] uppercase tracking-wide mb-2">Needs: {c.missingFields.join(", ")}</p>
                )}
                {!c.verifiedInInstrumentList && (
                  <div className="flex items-center gap-1 mb-2">
                    <ShieldAlert size={12} className="text-[var(--amber)]" />
                    <span className="text-[10px] font-bold text-[var(--amber)] uppercase tracking-wide">Not found in instrument list — verify name</span>
                  </div>
                )}
                {c.saveError && (
                  <p className="text-[11px] font-semibold text-[var(--red)] mb-2" data-testid={`upload-candidate-error-${c._localId}`}>
                    Couldn't save: {c.saveError}
                  </p>
                )}
                <select data-testid={`upload-candidate-class-${c._localId}`} value={c.assetClass} onChange={(e) => updateCandidate(c._localId, { assetClass: e.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs font-semibold mb-2">
                  {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {c.assetClass === "FD" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input data-testid={`upload-fd-bank-${c._localId}`} placeholder="Bank" value={c.fd.bank} onChange={(e) => updateCandidate(c._localId, { fd: { ...c.fd, bank: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs col-span-2" />
                    <input data-testid={`upload-fd-tenure-${c._localId}`} placeholder="Tenure (months)" value={c.fd.tenureMonths} onChange={(e) => updateCandidate(c._localId, { fd: { ...c.fd, tenureMonths: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                    <input data-testid={`upload-fd-rate-${c._localId}`} placeholder="Interest rate %" value={c.fd.interestRate} onChange={(e) => updateCandidate(c._localId, { fd: { ...c.fd, interestRate: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                  </div>
                ) : c.assetClass === "PF" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <select data-testid={`upload-pf-subtype-${c._localId}`} value={c.pf.subType}
                      onChange={(e) => updateCandidate(c._localId, { pf: { ...c.pf, subType: e.target.value, interestRatePercent: String(PF_DECLARED_RATES[e.target.value]) } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs col-span-2">
                      <option value="PPF">PPF</option>
                      <option value="EPF">EPF</option>
                      <option value="VPF">VPF</option>
                    </select>
                    <input data-testid={`upload-pf-institution-${c._localId}`} placeholder="Bank / EPFO" value={c.pf.institution} onChange={(e) => updateCandidate(c._localId, { pf: { ...c.pf, institution: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs col-span-2" />
                    <input data-testid={`upload-candidate-invested-${c._localId}`} placeholder="Opening balance ₹" value={c.investedValue} onChange={(e) => updateCandidate(c._localId, { investedValue: e.target.value })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                    <input data-testid={`upload-pf-rate-${c._localId}`} placeholder="Interest rate %" value={c.pf.interestRatePercent} onChange={(e) => updateCandidate(c._localId, { pf: { ...c.pf, interestRatePercent: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input data-testid={`upload-candidate-invested-${c._localId}`} placeholder="Invested ₹" value={c.investedValue} onChange={(e) => updateCandidate(c._localId, { investedValue: e.target.value })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                    <input data-testid={`upload-candidate-current-${c._localId}`} placeholder="Current ₹" value={c.currentValue} onChange={(e) => updateCandidate(c._localId, { currentValue: e.target.value })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button data-testid="file-upload-save-all-btn" onClick={saveAll} disabled={savingAll}
            className="w-full mt-5 gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
            {savingAll ? <Loader2 size={16} className="animate-spin" /> : null} {saveFailedCount > 0 ? "Retry failed holdings" : "Save selected holdings"}
          </button>
        </>
      )}

      {saveFailedCount > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--red)]/10 border border-[var(--red)]/20 rounded-xl px-4 py-3 text-sm font-semibold text-[var(--red)]" data-testid="file-upload-failed-banner">
          {saveFailedCount} holding{saveFailedCount > 1 ? "s" : ""} couldn't be saved — see the reason on each row above, fix it, and tap {saveFailedCount > 1 ? '"Retry failed holdings"' : '"Retry"'} again.
        </motion.div>
      )}

      {savedCount > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 text-sm font-semibold text-[var(--dive-blue-dark)]" data-testid="file-upload-saved-banner">
          {savedCount} holding{savedCount > 1 ? "s" : ""} saved.
        </motion.div>
      )}

      <button data-testid="file-upload-done-btn" onClick={finish}
        className="w-full mt-4 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
        Done
      </button>
    </div>
  );
}
