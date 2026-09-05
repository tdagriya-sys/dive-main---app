import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { fmtINR } from "../lib/diveEngine";

const SOURCE_LABELS = { AA: "Account Aggregator", MANUAL: "Manual", BOT: "Bot Scan", FILE_UPLOAD: "File Upload" };

export default function MyHoldings() {
  const { holdings, setScreen, goBack, deleteHolding, setEditingHolding } = useDive();
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const edit = (holding) => {
    setEditingHolding(holding);
    setScreen("manualEntry");
  };

  const remove = async (id) => {
    setError("");
    setDeletingId(id);
    try {
      await deleteHolding(id);
    } catch (err) {
      setError("Couldn't delete that holding. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-full dive-app-surface pb-10" data-testid="my-holdings-screen">
      <div className="px-6 pt-8 flex items-center gap-3">
        <button data-testid="my-holdings-back-btn" onClick={goBack}><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-2xl">Your Holdings</h1>
      </div>
      <p className="px-6 mt-1 text-sm text-[var(--text-secondary)]">{holdings.length} holding{holdings.length === 1 ? "" : "s"}</p>

      {error && <p className="px-6 mt-3 text-xs text-[var(--red)] font-semibold">{error}</p>}

      <div className="px-6 mt-5 space-y-3">
        <AnimatePresence>
          {holdings.map((h) => (
            <motion.div key={h.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}
              className="flex items-center justify-between bg-[var(--surface-card)] rounded-2xl border border-[var(--border)] p-4" data-testid={`holding-row-${h.id}`}>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  {h.segment} · {SOURCE_LABELS[h.source] || h.source}
                </p>
                <p className="font-bold text-sm truncate">{h.name}</p>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">{fmtINR(h.amount)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <button data-testid={`edit-holding-${h.id}`} onClick={() => edit(h)} disabled={deletingId === h.id}
                  className="w-9 h-9 rounded-xl bg-[var(--surface-card-hover)] text-[var(--text-secondary)] flex items-center justify-center disabled:opacity-40">
                  <Pencil size={16} />
                </button>
                <button data-testid={`delete-holding-${h.id}`} onClick={() => remove(h.id)} disabled={deletingId === h.id}
                  className="w-9 h-9 rounded-xl bg-[var(--red)]/10 text-[var(--red)] flex items-center justify-center disabled:opacity-40">
                  {deletingId === h.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {holdings.length === 0 && (
          <p className="text-sm text-[var(--text-secondary)] text-center py-10">No holdings yet.</p>
        )}
      </div>

      <div className="px-6 mt-6">
        <button data-testid="my-holdings-add-btn" onClick={() => setScreen("chooseMethod")}
          className="w-full md:max-w-xs md:ml-auto gold-btn rounded-full py-4 font-bold flex items-center justify-center gap-2 hover:bg-[var(--dive-blue-hover)] transition-colors">
          <Plus size={18} /> Add an investment
        </button>
      </div>
    </div>
  );
}
