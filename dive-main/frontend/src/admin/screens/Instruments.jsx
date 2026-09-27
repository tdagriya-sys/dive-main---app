import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Search, RefreshCw, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../lib/api";

const ASSET_CLASSES = ["EQUITY", "MUTUAL_FUND", "ETF", "BOND", "REIT", "INVIT", "GOLD", "SILVER", "ULIP_INSURANCE", "FD", "CRYPTO", "PF"];
// Row-level detail lists (skipped rows, warnings) can run long on a big file —
// shown capped, with a count of the rest, rather than dumping hundreds of lines.
const ROW_DETAIL_PREVIEW = 15;

/**
 * Upload panel for manually seeding one asset class's instrument data from a
 * CSV — the fallback for when a live source is blocked (AMFI is currently
 * unreachable from this app's cloud IP) or never existed (REIT/InvIT/BOND/
 * ULIP_INSURANCE). Full column format: docs/INSTRUMENT_UPLOAD_FORMAT.md.
 * Uploading UPSERTS: an instrument identified by the same Symbol/ISIN/Scheme
 * Code as before gets its data refreshed (that's how a price/NAV update
 * happens for a class with no live source), a new one gets added, and an
 * instrument this file simply doesn't mention is left exactly as it was —
 * never live-sourced/static-seed rows, and never another asset class
 * (backend/src/services/instrumentUploadService.ts). Removing an instrument
 * that's genuinely gone is a separate opt-in checkbox below, off by default.
 * A Mutual Fund file with an Underlying Holdings column also updates the
 * Look-Through Model's draft config (admin still reviews and publishes it).
 */
function UploadPanel({ onUploaded }) {
  const [open, setOpen] = useState(false);
  const [uploadClass, setUploadClass] = useState(ASSET_CLASSES[0]);
  const [file, setFile] = useState(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [showAllSkipped, setShowAllSkipped] = useState(false);
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const fileInputRef = useRef(null);

  function reset() {
    setFile(null);
    setConfirming(false);
    setError("");
    setSummary(null);
    setShowAllSkipped(false);
    setShowAllWarnings(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function doUpload() {
    setUploading(true);
    setError("");
    setSummary(null);
    try {
      const form = new FormData();
      form.append("assetClass", uploadClass);
      form.append("file", file);
      form.append("removeMissing", removeMissing ? "true" : "false");
      const { data } = await api.post("/admin/instruments/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      setSummary(data.summary);
      setFile(null);
      setConfirming(false);
      setRemoveMissing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onUploaded();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't upload this file. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] mb-5" data-testid="admin-instruments-upload-panel">
      <button
        type="button"
        data-testid="admin-instruments-upload-toggle-btn"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold"
      >
        <span className="flex items-center gap-2">
          <Upload size={14} /> Upload data manually
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-xs text-[var(--text-tertiary)] mb-3">
            For an asset class with no live source, or when one is unreachable (AMFI mutual-fund data is currently blocked from this server) —
            upload a CSV for ONE asset class at a time. Only the instrument <b>name</b> is required; every other column is optional, and a missing
            or bad value in one column never drops the whole row. Include a <b>Symbol/ISIN/Scheme Code</b> so a re-upload updates that SAME
            instrument's price/data instead of adding a duplicate — this is how you refresh valuations for a class with no live source. An
            instrument this file doesn't mention is left exactly as it was; live-sourced data and every other asset class are always unaffected.
            Full column guide: <code>docs/INSTRUMENT_UPLOAD_FORMAT.md</code>.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <select
              data-testid="admin-instruments-upload-class-select"
              value={uploadClass}
              onChange={(e) => {
                setUploadClass(e.target.value);
                reset();
              }}
              className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-semibold"
            >
              {ASSET_CLASSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              data-testid="admin-instruments-upload-file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setConfirming(false);
                setError("");
                setSummary(null);
              }}
              className="text-sm"
            />
          </div>

          <label className="flex items-start gap-2 mb-3 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              data-testid="admin-instruments-upload-removemissing-checkbox"
              checked={removeMissing}
              onChange={(e) => setRemoveMissing(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Also remove {uploadClass} instruments not in this file (retired if a user holds one, deleted otherwise). Leave unchecked for a normal
              price/data refresh — only check this when this file is the complete, current list and anything missing from it is genuinely gone
              (delisted, wound up).
            </span>
          </label>

          {!confirming ? (
            <button
              type="button"
              data-testid="admin-instruments-upload-btn"
              disabled={!file || uploading}
              onClick={() => setConfirming(true)}
              className="gold-btn rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40"
            >
              Upload
            </button>
          ) : (
            <div className={`rounded-xl border p-3 ${removeMissing ? "border-[var(--red)]/30 bg-[var(--red)]/5" : "border-[var(--border)] bg-[var(--surface-card-hover)]"}`} data-testid="admin-instruments-upload-confirm">
              <p className="text-xs font-bold mb-2">
                {removeMissing
                  ? `This updates/adds ${uploadClass} instruments from "${file?.name}" AND removes any previously-uploaded ${uploadClass} instrument not in this file (retiring, not deleting, any one a user holds). Live-sourced/seeded ${uploadClass} data, and every other asset class, are unaffected. Continue?`
                  : `This updates matching ${uploadClass} instruments and adds any new ones from "${file?.name}". Nothing is removed. Live-sourced/seeded ${uploadClass} data, and every other asset class, are unaffected. Continue?`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="admin-instruments-upload-confirm-btn"
                  disabled={uploading}
                  onClick={doUpload}
                  className={`rounded-full text-white px-4 py-1.5 text-xs font-bold disabled:opacity-60 ${removeMissing ? "bg-[var(--red)]" : "gold-btn"}`}
                >
                  {uploading ? "Uploading…" : "Yes, upload"}
                </button>
                <button type="button" data-testid="admin-instruments-upload-cancel-btn" disabled={uploading} onClick={() => setConfirming(false)} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-[var(--red)] text-sm mt-3" data-testid="admin-instruments-upload-error">{error}</p>}

          {summary && (
            <div className="mt-4 rounded-xl border border-[var(--border)] p-3 text-sm" data-testid="admin-instruments-upload-summary">
              <p className="font-bold mb-1">
                {summary.inserted} new {summary.assetClass} instrument{summary.inserted === 1 ? "" : "s"} added, {summary.updated} existing one
                {summary.updated === 1 ? "" : "s"} updated, from "{summary.fileName}".
              </p>
              {summary.removeMissingRequested ? (
                <p className="text-[var(--text-secondary)] mb-2">
                  {summary.deletedFromPrevious} previously-uploaded row{summary.deletedFromPrevious === 1 ? "" : "s"} not in this file removed
                  {summary.retiredInsteadOfDeleted > 0 && (
                    <>
                      {" "}
                      · {summary.retiredInsteadOfDeleted} kept (retired, not deleted) because {summary.retiredInsteadOfDeleted === 1 ? "a holding" : "holdings"} still reference{summary.retiredInsteadOfDeleted === 1 ? "s" : ""} {summary.retiredInsteadOfDeleted === 1 ? "it" : "them"}
                    </>
                  )}
                  .
                </p>
              ) : (
                <p className="text-[var(--text-secondary)] mb-2">Any previously-uploaded {summary.assetClass} instrument not in this file was left as-is.</p>
              )}
              {summary.lookthrough && (
                <p className="text-[var(--text-secondary)] mb-2" data-testid="admin-instruments-upload-lookthrough-note">
                  {summary.lookthrough.fundsUpdated} fund{summary.lookthrough.fundsUpdated === 1 ? "" : "s"} updated in the Look-Through Model's draft
                  config
                  {summary.lookthrough.fundsSkippedNoWeight > 0 && <> ({summary.lookthrough.fundsSkippedNoWeight} had no usable weight and were skipped)</>}.
                  Review and publish from Look-Through Model for this to affect live Dive Scores.
                </p>
              )}
              {summary.skipped.length > 0 && (
                <div className="mb-2" data-testid="admin-instruments-upload-skipped">
                  <p className="font-bold text-[var(--red)]">{summary.skipped.length} row{summary.skipped.length === 1 ? "" : "s"} skipped</p>
                  <ul className="text-xs text-[var(--text-tertiary)] list-disc pl-4">
                    {(showAllSkipped ? summary.skipped : summary.skipped.slice(0, ROW_DETAIL_PREVIEW)).map((s, i) => (
                      <li key={i}>{s.row > 0 ? `Row ${s.row}: ` : ""}{s.message}</li>
                    ))}
                  </ul>
                  {summary.skipped.length > ROW_DETAIL_PREVIEW && !showAllSkipped && (
                    <button type="button" data-testid="admin-instruments-upload-skipped-more-btn" onClick={() => setShowAllSkipped(true)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline mt-1">
                      Show all {summary.skipped.length}
                    </button>
                  )}
                </div>
              )}
              {summary.warnings.length > 0 && (
                <div data-testid="admin-instruments-upload-warnings">
                  <p className="font-bold text-[var(--text-secondary)]">{summary.warnings.length} field{summary.warnings.length === 1 ? "" : "s"} left blank (bad value, rest of the row kept)</p>
                  <ul className="text-xs text-[var(--text-tertiary)] list-disc pl-4">
                    {(showAllWarnings ? summary.warnings : summary.warnings.slice(0, ROW_DETAIL_PREVIEW)).map((w, i) => (
                      <li key={i}>{w.row > 0 ? `Row ${w.row}: ` : ""}{w.message}</li>
                    ))}
                  </ul>
                  {summary.warnings.length > ROW_DETAIL_PREVIEW && !showAllWarnings && (
                    <button type="button" data-testid="admin-instruments-upload-warnings-more-btn" onClick={() => setShowAllWarnings(true)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline mt-1">
                      Show all {summary.warnings.length}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Instruments() {
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/instruments", { params: { q: q || undefined, assetClass: assetClass || undefined, page } });
      setResult(data);
    } catch {
      setError("Couldn't load instruments. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [q, assetClass, page]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    setRefreshMessage("");
    try {
      const { data } = await api.post("/admin/instruments/refresh");
      setRefreshMessage(data.message || "Refresh complete.");
      load();
    } catch {
      setRefreshMessage("Refresh failed. Check the System screen for integration status.");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="p-8" data-testid="admin-instruments-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading font-black text-2xl">Instruments</h1>
        <button
          data-testid="admin-instruments-refresh-btn"
          onClick={triggerRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-card-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
      {refreshMessage && <p className="text-sm text-[var(--text-secondary)] mb-4" data-testid="admin-instruments-refresh-message">{refreshMessage}</p>}

      <UploadPanel onUploaded={load} />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2.5 max-w-sm flex-1">
          <Search size={16} className="text-[var(--text-tertiary)] mr-2 shrink-0" />
          <input
            data-testid="admin-instruments-search-input"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search name, symbol, or issuer"
            className="flex-1 outline-none bg-transparent text-sm font-semibold text-[var(--text-primary)]"
          />
        </div>
        <select
          data-testid="admin-instruments-assetclass-select"
          value={assetClass}
          onChange={(e) => {
            setPage(1);
            setAssetClass(e.target.value);
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2.5 text-sm font-semibold text-[var(--text-primary)]"
        >
          <option value="">All asset classes</option>
          {ASSET_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-instruments-loading">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-[var(--red)]" data-testid="admin-instruments-error">{error}</p>}

      {!loading && !error && result && (
        <>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden">
            <table className="w-full text-sm" data-testid="admin-instruments-table">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Class</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Refreshed</th>
                </tr>
              </thead>
              <tbody>
                {result.instruments.map((i) => (
                  <tr key={i._id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 font-bold">{i.name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{i.symbol}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{i.assetClass}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{i.source}</td>
                    <td className="px-4 py-3">{i.isActive ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{i.lastRefreshedAt ? new Date(i.lastRefreshedAt).toLocaleDateString("en-IN") : "—"}</td>
                  </tr>
                ))}
                {result.instruments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-instruments-empty">
                      No instruments match this search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm text-[var(--text-secondary)]">
            <span>{result.total} total</span>
            <div className="flex items-center gap-3">
              <button data-testid="admin-instruments-prev-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-bold disabled:opacity-30">
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button data-testid="admin-instruments-next-btn" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)} className="font-bold disabled:opacity-30">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
