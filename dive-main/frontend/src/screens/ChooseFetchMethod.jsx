import React from "react";
import { motion } from "framer-motion";
import { Link2, PenLine, Bot, Upload, Compass, ChevronRight } from "lucide-react";
import { useDive } from "../context/DiveContext";

const METHODS = [
  { id: "aaConsent", icon: Link2, title: "Connect via Account Aggregator", body: "Securely pull equity, mutual funds, bonds and more from a RBI-licensed Account Aggregator (Finvu sandbox)." },
  { id: "manualEntry", icon: PenLine, title: "Add manually", body: "Quick guided forms for each investment type — takes about a minute per holding." },
  { id: "botScan", icon: Bot, title: "Bot Scan (screen share)", body: "Share your broker app's holdings page and DIVVE reads it for you." },
  { id: "fileUpload", icon: Upload, title: "Upload a file", body: "Screenshot, PDF, statement (XLSX/CSV) or a JSON export from your broker." },
  { id: "planner", icon: Compass, title: "Build your first plan with Divve", body: "New to investing? Tell us how much you have and we'll map out exactly how to split it across asset classes — no stock-picking, no guesswork, just a clear place to start." },
];

export default function ChooseFetchMethod() {
  const { setScreen, goBack, holdings } = useDive();
  return (
    <div className="flex flex-col min-h-full px-7 py-10 dive-app-surface" data-testid="choose-method-screen">
      <h1 className="font-heading font-black text-3xl mb-2">Add your investments</h1>
      <p className="text-[var(--text-secondary)] mb-6">Pick how you'd like DIVVE to see your portfolio. You can add more later.</p>
      <div className="space-y-3">
        {METHODS.map((m, i) => (
          <motion.button key={m.id} data-testid={`method-${m.id}`} onClick={() => setScreen(m.id)}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="w-full flex items-center gap-3 text-left bg-[var(--surface-card)] rounded-2xl p-4 border border-[var(--border)] hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-xl bg-[var(--dive-blue-light)] flex items-center justify-center shrink-0">
              <m.icon size={20} className="text-[var(--dive-blue)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm">{m.title}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5 break-words">{m.body}</p>
            </div>
            <ChevronRight size={18} className="text-[var(--text-tertiary)] shrink-0" />
          </motion.button>
        ))}
      </div>
      {holdings.length > 0 && (
        <button data-testid="choose-method-skip-btn" onClick={goBack}
          className="w-full text-center mt-6 text-sm font-bold text-[var(--dive-blue)]">
          Skip for now — go back
        </button>
      )}
    </div>
  );
}
