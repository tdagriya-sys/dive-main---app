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
  const { setScreen, goBack, loadHoldings } = useDive();
  const [phase, setPhase] = useState("idle"); // idle | sharing | analyzing | review
  const [error, setError] = useState("");
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [excludedNotes, setExcludedNotes] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const framesRef = useRef([]); // captured Blobs for this scan session, decimated to MAX_FRAMES
  const [foundList, setFoundList] = useState([]);

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
    try {
      const form = new FormData();
      frames.forEach((blob, i) => form.append("frames", blob, `frame-${i}.jpg`));
      const { data } = await api.post("/botscan/analyze", form, { headers: { "Content-Type": "multipart/form-data" } });
      const list = (data.candidates || []).map((c, idx) => ({
        ...c,
        _localId: `${c.accountLabel || "account"}::${c.name}::${idx}`,
        include: !!c.verifiedInInstrumentList,
        fd: emptyFd(),
      }));
      setFoundList(list);
      setExcludedNotes(data.excludedNotes || "");
      setPhase("review");
    } catch (e) {
      if (e?.response?.status === 503) {
        setError(e.response.data?.message || "AI-based scan analysis isn't configured on this server yet.");
      } else {
        setError("Couldn't analyze the scan — please try again.");
      }
      setPhase("idle");
    }
  };

  const updateCandidate = (localId, patch) => {
    setFoundList((prev) => prev.map((c) => (c._localId === localId ? { ...c, ...patch } : c)));
  };

  const removeCandidate = (localId) => {
    setFoundList((prev) => prev.filter((c) => c._localId !== localId));
  };

  const saveAll = async () => {
    setSavingAll(true);
    let saved = 0;
    for (const c of foundList.filter((x) => x.include)) {
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
        // leave unsaved rows in place — user can retry
      }
    }
    setSavedCount(saved);
    await loadHoldings();
    setSavingAll(false);
  };

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
        />
      )}

      {phase === "review" && (
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
              {savingAll ? <Loader2 size={16} className="animate-spin" /> : null} Save selected holdings
            </button>
          )}

          {savedCount > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3 text-sm font-semibold text-[var(--dive-blue-dark)]" data-testid="bot-scan-saved-banner">
              {savedCount} holding{savedCount > 1 ? "s" : ""} saved.
            </motion.div>
          )}

          <button data-testid="bot-scan-done-btn" onClick={() => setScreen("reveal")}
            className="w-full mt-4 bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold hover:bg-[var(--surface-card-hover)] transition-colors">
            Done
          </button>
        </>
      )}
    </div>
  );
}
