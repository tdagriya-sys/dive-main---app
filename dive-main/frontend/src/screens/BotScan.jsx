import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ScanLine, Loader2, Check, X, MonitorPlay, ShieldAlert, Trash2 } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { api } from "../lib/api";
import InstrumentAutocomplete from "../components/dive/InstrumentAutocomplete";
import ScanningLoader from "../components/dive/ScanningLoader";

const FRAME_INTERVAL_MS = 1800;
const MAX_FRAMES = 20;

function emptyFd() {
  return { bank: "", tenureMonths: "12", startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), interestRate: "7" };
}

const ASSET_CLASSES = ["EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "FD", "CRYPTO"];

export default function BotScan() {
  const { setScreen, goBack, loadHoldings, holdings } = useDive();
  const [phase, setPhase] = useState("idle"); // idle | sharing | analyzing | review
  const [error, setError] = useState("");
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [excludedNotes, setExcludedNotes] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveFailedCount, setSaveFailedCount] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const framesRef = useRef([]); // captured Blobs for this scan session, decimated to MAX_FRAMES
  const [foundList, setFoundList] = useState([]);
  // A hung Claude response otherwise has no escape short of waiting out the
  // full ~60-150s timeout chain (Anthropic SDK timeout x maxRetries, Nginx's
  // proxy_read_timeout, this request's own axios timeout — see
  // aiExtractionService.ts) — this lets the user bail out immediately instead.
  const analyzeAbortRef = useRef(null);

  const stopStream = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => () => stopStream(), []);

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const frames = framesRef.current;
      frames.push(blob);
      // Keep a spread of frames across the whole scan instead of only the
      // first N — when over the cap, drop one from the middle so both early
      // and late scroll positions stay represented.
      if (frames.length > MAX_FRAMES) frames.splice(Math.floor(frames.length / 2), 1);
      setFramesCaptured(frames.length);
    }, "image/jpeg", 0.85);
  };

  const startScan = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopScan();
      });
      framesRef.current = [];
      setFramesCaptured(0);
      setSavedCount(0);
      setSaveFailedCount(0);
      setPhase("sharing");
      intervalRef.current = setInterval(captureFrame, FRAME_INTERVAL_MS);
    } catch (err) {
      setError("Screen share permission was denied or cancelled. You can try again, or add investments another way.");
    }
  };

  const stopScan = async () => {
    stopStream();
    const frames = framesRef.current;
    if (frames.length === 0) {
      setError("No frames were captured — try sharing the tab again with the holdings page visible.");
      setPhase("idle");
      return;
    }
    setPhase("analyzing");
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    try {
      const form = new FormData();
      frames.forEach((blob, i) => form.append("frames", blob, `frame-${i}.jpg`));
      // Longer than the backend's own AI-call timeout (60s x up to 2 attempts,
      // see aiExtractionService.ts) and Nginx's proxy_read_timeout (see
      // docs/SERVER_DEPLOYMENT_GUIDE.md), so the backend's own specific
      // "took too long" error has a chance to arrive intact instead of this
      // request giving up first with a generic one.
      const { data } = await api.post("/botscan/analyze", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 150_000,
        signal: controller.signal,
      });
      const list = (data.candidates || []).map((c, idx) => ({
        ...c,
        _localId: `${c.accountLabel || "account"}::${c.name}::${idx}`,
        include: !!c.verifiedInInstrumentList,
        fd: emptyFd(),
        saveError: null,
      }));
      setFoundList(list);
      setExcludedNotes(data.excludedNotes || "");
      setPhase("review");
    } catch (e) {
      // A deliberate cancel isn't a failure — no scary error, just quietly
      // back to the start so the user can try again right away.
      if (e.code === "ERR_CANCELED") {
        setPhase("idle");
        return;
      }
      if (e?.response?.status === 503) {
        setError(e.response.data?.message || "AI-based scan analysis isn't configured on this server yet.");
      } else if (e?.response?.status === 504 || e?.code === "ECONNABORTED") {
        setError(e.response?.data?.message || "This took too long to analyze — try again with fewer captured screens.");
      } else {
        setError("Couldn't analyze the scan — please try again.");
      }
      setPhase("idle");
    } finally {
      analyzeAbortRef.current = null;
    }
  };

  const cancelAnalysis = () => {
    analyzeAbortRef.current?.abort();
  };

  const updateCandidate = (localId, patch) => {
    // Editing a row clears its saveError — the row is being fixed, so a
    // stale "couldn't save" message from before the edit would be misleading.
    setFoundList((prev) => prev.map((c) => (c._localId === localId ? { ...c, ...patch, saveError: null } : c)));
  };

  const removeCandidate = (localId) => {
    setFoundList((prev) => prev.filter((c) => c._localId !== localId));
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
    const toSave = foundList.filter((x) => x.include);
    let saved = 0;
    const errorsByLocalId = new Map();
    for (const c of toSave) {
      try {
        if (c.assetClass === "FD") {
          await api.post("/holdings/manual", {
            assetClass: "FD",
            bank: c.fd.bank || c.name,
            principal: Number(c.investedValue ?? c.fdPrincipal) || 0,
            tenureMonths: Number(c.fd.tenureMonths ?? c.fdTenureMonths ?? 12),
            startMonth: Number(c.fd.startMonth),
            startYear: Number(c.fd.startYear),
            interestRate: Number(c.fd.interestRate ?? c.fdAnnualRatePercent ?? 7),
            source: "BOT",
          });
        } else {
          await api.post("/holdings/manual", {
            assetClass: c.assetClass,
            instrumentId: c.instrumentId || undefined,
            name: c.name,
            investedValue: Number(c.investedValue) || 0,
            currentValue: c.currentValue ? Number(c.currentValue) : undefined,
            quantity: c.quantity ? Number(c.quantity) : undefined,
            source: "BOT",
          });
        }
        saved += 1;
      } catch (e) {
        errorsByLocalId.set(c._localId, errorMessageOf(e, "Couldn't save this holding — check the fields above."));
      }
    }
    setFoundList((prev) =>
      prev
        .filter((c) => !c.include || errorsByLocalId.has(c._localId))
        .map((c) => (errorsByLocalId.has(c._localId) ? { ...c, saveError: errorsByLocalId.get(c._localId) } : c))
    );
    setSavedCount(saved);
    setSaveFailedCount(errorsByLocalId.size);
    await loadHoldings();
    setSavingAll(false);
  };

  // "Done" must not unconditionally jump to the score-reveal screen — with
  // nothing detected and nothing saved (savedCount === 0) on a genuinely
  // empty account (holdings.length === 0), that screen has no score to
  // reveal and just looks like a confusing, unexplained dashboard jump.
  // Mirrors ManualEntry.jsx's finish(), which gets this right already.
  const finish = () => setScreen(holdings.length || savedCount ? "reveal" : "chooseMethod");

  return (
    <div className="flex flex-col min-h-full px-7 py-8 dive-app-surface" data-testid="bot-scan-screen">
      <div className="flex items-center gap-3 mb-4">
        <button data-testid="bot-scan-back-btn" onClick={() => { stopStream(); goBack(); }}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">Bot Scan</h1>
      </div>

      {/* Hidden capture surface — never shown to the user, just used to grab frames from the shared stream */}
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {phase === "idle" && (
        <>
          <div className="bg-[var(--dive-blue-light)] rounded-2xl p-5 mb-5">
            <p className="text-sm font-semibold text-[var(--dive-blue-dark)] leading-relaxed">
              1. Open your investing app or broker website in another tab.<br />
              2. Go to your portfolio / holdings page.<br />
              3. Come back here and tap <b>Start Scan</b> — your browser will ask you to pick which tab or window to share.
            </p>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mb-5 leading-relaxed">
            This only works for the tab/window you choose to share — it's a real, user-initiated screen share (your browser's own permission
            dialog enforces that), never a hidden or automatic capture. This also only works from a website in your browser, not from inside a
            native mobile app. An AI model reviews the captured screens to find your real holdings and filter out watchlists, indices, and
            summary cards.
          </p>
          {error && <p className="text-xs text-[var(--red)] font-semibold mb-4">{error}</p>}
          <button data-testid="bot-scan-start-btn" onClick={startScan}
            className="w-full gold-btn rounded-full py-4 font-bold flex items-center justify-center gap-2 hover:bg-[var(--dive-blue-hover)] transition-colors">
            <MonitorPlay size={18} /> Start Scan
          </button>
        </>
      )}

      {phase === "sharing" && (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}
            className="w-20 h-20 rounded-full bg-[var(--dive-blue-light)] flex items-center justify-center mb-6">
            <ScanLine size={32} className="text-[var(--dive-blue)]" />
          </motion.div>
          <h2 className="font-heading font-black text-xl mb-2">Scanning your shared screen…</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-1">{framesCaptured} screen{framesCaptured === 1 ? "" : "s"} captured</p>
          <p className="text-xs text-[var(--text-tertiary)] mb-6 max-w-xs">
            Scroll slowly through your full holdings list, then tap Stop Scan — an AI model will analyze everything captured in one pass.
          </p>
          <button data-testid="bot-scan-stop-btn" onClick={stopScan}
            className="w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
            Stop Scan
          </button>
        </div>
      )}

      {phase === "analyzing" && (
        <ScanningLoader
          title="Analyzing your screens…"
          subtitle={`An AI model is reading ${framesCaptured} captured screen${framesCaptured === 1 ? "" : "s"} and identifying your real holdings.`}
          messages={[
            "Scanning captured screens…",
            "Reading holdings and values…",
            "Matching instruments to our database…",
            "Filtering out watchlists & indices…",
            "Categorizing into asset classes…",
            "Almost done…",
          ]}
          onCancel={cancelAnalysis}
        />
      )}

      {phase === "review" && (
        <>
          {/* foundList.length === 0 means two very different things: the AI
              genuinely found nothing (savedCount still 0), or every detected
              row was just successfully saved and correctly removed from the
              list (see saveAll — savedCount > 0 in that case). Only the first
              is actually "nothing was detected"; the saved-banner below
              already covers the second, so this block must not show for it. */}
          {(foundList.length > 0 || savedCount === 0) && (
            <>
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">
                Review detected holdings ({foundList.length})
              </p>
              <p className="text-xs text-[var(--text-secondary)] mb-1">
                Rows we couldn't verify against our instrument list start unchecked — double-check the name before including them. Every field
                below is editable, and you can remove any row entirely.
              </p>
              {excludedNotes && <p className="text-xs text-[var(--text-tertiary)] italic mb-3">{excludedNotes}</p>}
              {foundList.length === 0 && (
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Nothing was detected — DIVVE couldn't read that screen clearly. Try again with the holdings page more fully visible, or add manually.
                </p>
              )}
            </>
          )}
          <div className="space-y-3">
            {foundList.map((c) => (
              <div key={c._localId} className={`rounded-2xl border p-4 ${c.include ? "border-[var(--border)] bg-[var(--surface-card)]" : "border-[var(--border-light)] bg-[var(--surface-card)]/40 opacity-50"}`} data-testid={`botscan-candidate-${c._localId}`}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <InstrumentAutocomplete
                    assetClass={c.assetClass}
                    value={{ instrumentId: c.instrumentId, name: c.name }}
                    onChange={({ instrumentId, name }) => updateCandidate(c._localId, { instrumentId, name, verifiedInInstrumentList: !!instrumentId })}
                    testId={`botscan-name-${c._localId}`}
                    hideLabel
                    wrapperClassName="relative flex-1 min-w-0"
                    inputClassName="w-full font-bold text-sm bg-[var(--surface-card)] text-[var(--text-primary)] outline-none"
                  />
                  <button data-testid={`botscan-toggle-${c._localId}`} onClick={() => updateCandidate(c._localId, { include: !c.include })}
                    className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${c.include ? "bg-[var(--dive-blue-light)] text-[var(--dive-blue)]" : "bg-[var(--surface-card-hover)] text-[var(--text-tertiary)]"}`}>
                    {c.include ? <Check size={14} /> : <X size={14} />}
                  </button>
                  <button data-testid={`botscan-remove-${c._localId}`} onClick={() => removeCandidate(c._localId)}
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center bg-[var(--surface-card-hover)] text-[var(--red)]" aria-label="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
                {c.accountLabel && (
                  <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-2">{c.accountLabel}</p>
                )}
                {!c.verifiedInInstrumentList && (
                  <div className="flex items-center gap-1 mb-2" data-testid={`botscan-unverified-${c._localId}`}>
                    <ShieldAlert size={12} className="text-[var(--amber)]" />
                    <span className="text-[10px] font-bold text-[var(--amber)] uppercase tracking-wide">Not found in instrument list — verify name</span>
                  </div>
                )}
                {c.saveError && (
                  <p className="text-[11px] font-semibold text-[var(--red)] mb-2" data-testid={`botscan-error-${c._localId}`}>
                    Couldn't save: {c.saveError}
                  </p>
                )}
                <select value={c.assetClass || "EQUITY"} onChange={(e) => updateCandidate(c._localId, { assetClass: e.target.value })}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs font-semibold mb-2">
                  {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {c.assetClass === "FD" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Bank" value={c.fd.bank} onChange={(e) => updateCandidate(c._localId, { fd: { ...c.fd, bank: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs col-span-2" />
                    <input placeholder="Tenure (months)" value={c.fd.tenureMonths} onChange={(e) => updateCandidate(c._localId, { fd: { ...c.fd, tenureMonths: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                    <input placeholder="Interest rate %" value={c.fd.interestRate} onChange={(e) => updateCandidate(c._localId, { fd: { ...c.fd, interestRate: e.target.value } })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Invested ₹" value={c.investedValue ?? ""} onChange={(e) => updateCandidate(c._localId, { investedValue: e.target.value })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                    <input placeholder="Current ₹" value={c.currentValue ?? ""} onChange={(e) => updateCandidate(c._localId, { currentValue: e.target.value })}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] px-3 py-2 text-xs" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {foundList.length > 0 && (
            <button data-testid="bot-scan-save-all-btn" onClick={saveAll} disabled={savingAll}
              className="w-full mt-5 gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
              {savingAll ? <Loader2 size={16} className="animate-spin" /> : null} {saveFailedCount > 0 ? "Retry failed holdings" : "Save selected holdings"}
            </button>
          )}

          {saveFailedCount > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--red)]/10 border border-[var(--red)]/20 rounded-xl px-4 py-3 text-sm font-semibold text-[var(--red)]" data-testid="bot-scan-failed-banner">
              {saveFailedCount} holding{saveFailedCount > 1 ? "s" : ""} couldn't be saved — see the reason on each row above, fix it, and tap {saveFailedCount > 1 ? '"Retry failed holdings"' : '"Retry"'} again.
            </motion.div>
          )}

          {savedCount > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 text-sm font-semibold text-[var(--dive-blue-dark)]" data-testid="bot-scan-saved-banner">
              {savedCount} holding{savedCount > 1 ? "s" : ""} saved.
            </motion.div>
          )}

          <button data-testid="bot-scan-done-btn" onClick={finish}
            className="w-full mt-4 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
            Done
          </button>
        </>
      )}
    </div>
  );
}
