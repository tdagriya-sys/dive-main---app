import React, { useState, useEffect } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { api } from "../../lib/api";

// The "Email lists" tab of Admin → Notifications: people who are NOT Divve
// users yet — addresses (and optionally names) staff import to run an
// onboarding/marketing campaign to (backend models/ExternalContact.ts). A
// campaign's "Email list" audience picks one of these lists. Every email sent
// carries an unsubscribe link; anyone who unsubscribes is never emailed again,
// even if they're imported again. People who already have a Divve account are
// skipped automatically when sending.

const MAX_FILE_BYTES = 1_500_000;

function ImportResult({ result }) {
  const r = result.result;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card-hover)] p-4 mb-4 text-sm" data-testid="admin-external-lists-import-result">
      <p className="font-bold mb-2">
        Imported {r.total} address(es): {r.added} new, {r.updated} already known.
      </p>
      <ul className="list-disc pl-5 text-[var(--text-secondary)] space-y-0.5">
        {result.duplicatesInFile > 0 && <li data-testid="admin-external-lists-result-duplicates">{result.duplicatesInFile} duplicate row(s) in your file were merged.</li>}
        {r.unsubscribedKept > 0 && (
          <li data-testid="admin-external-lists-result-unsubscribed">{r.unsubscribedKept} had already unsubscribed — they stay unsubscribed and will never be emailed.</li>
        )}
        {r.alreadyRegistered > 0 && (
          <li data-testid="admin-external-lists-result-registered">{r.alreadyRegistered} already have a Divve account — kept on the list, but skipped when sending.</li>
        )}
      </ul>
      {result.invalidCount > 0 && (
        <div className="mt-3" data-testid="admin-external-lists-result-invalid">
          <p className="text-[var(--red)] font-bold">{result.invalidCount} row(s) couldn't be imported:</p>
          <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)]">
            {result.invalid.map((row) => (
              <li key={`${row.line}-${row.value}`}>Line {row.line}: “{row.value}” — {row.reason}</li>
            ))}
          </ul>
          {result.invalidCount > result.invalid.length && <p className="text-xs text-[var(--text-tertiary)] mt-1">…and {result.invalidCount - result.invalid.length} more.</p>}
        </div>
      )}
    </div>
  );
}

export default function ExternalLists() {
  const [data, setData] = useState(null); // { lists, suppressedTotal }
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [listName, setListName] = useState("");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [consent, setConsent] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const [viewing, setViewing] = useState(null); // { name, page, contacts, total, pageSize }
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  async function load() {
    try {
      const res = await api.get("/admin/external-lists");
      setData(res.data);
    } catch {
      setError("Couldn't load your email lists. Please try again.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is too large (over 1.5 MB). Split it into smaller files.");
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ""));
      setFileName(file.name);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  async function runImport() {
    setError("");
    setNotice("");
    setImportResult(null);
    setImporting(true);
    try {
      const res = await api.post("/admin/external-lists/import", { listName: listName.trim(), source: source.trim(), consentConfirmed: true, text });
      setImportResult(res.data);
      setText("");
      setFileName("");
      setConsent(false);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't import those addresses.");
    } finally {
      setImporting(false);
    }
  }

  async function viewContacts(name, page = 1) {
    setError("");
    try {
      const res = await api.get("/admin/external-lists/contacts", { params: { list: name, page } });
      setViewing({ name, ...res.data });
    } catch {
      setError("Couldn't load that list's contacts.");
    }
  }

  async function deleteList(name) {
    setError("");
    setNotice("");
    setConfirmingDelete(null);
    try {
      const res = await api.delete("/admin/external-lists", { params: { name } });
      setNotice(`Deleted the list “${name}”: ${res.data.deleted} contact(s) removed, ${res.data.detached} kept (unsubscribed, or also on another list).`);
      if (viewing?.name === name) setViewing(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't delete that list.");
    }
  }

  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-secondary)]" data-testid="admin-external-lists-loading">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  const canImport = listName.trim() && source.trim() && text.trim() && consent && !importing;
  const sender = data?.marketingSender;

  return (
    <div data-testid="admin-external-lists">
      <p className="text-xs text-[var(--text-secondary)] mb-4 max-w-2xl">
        Email people who haven't registered on Divve yet — for example an onboarding campaign. Only add people who have agreed to hear from Divve. Every email includes an unsubscribe link, and
        anyone who unsubscribes is never emailed again, even if you import them again. People who already have a Divve account are skipped automatically.
      </p>
      {sender && !sender.ready && (
        <p className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2 text-xs text-[var(--red)] mb-4 max-w-2xl" data-testid="admin-external-lists-sender-warning">
          {sender.problem}
        </p>
      )}
      {sender?.ready && (
        <p className="text-xs text-[var(--text-secondary)] mb-4" data-testid="admin-external-lists-sender">
          {sender.from ? (
            <>Sent from <b>{sender.from}</b> — a separate marketing address, so it never affects your no-reply address for sign-in codes.{sender.replyTo ? ` Replies go to ${sender.replyTo}.` : ""}</>
          ) : (
            "Development mode — no real email provider is configured, so nothing is actually sent."
          )}
        </p>
      )}
      {error && <p className="text-[var(--red)] mb-4" data-testid="admin-external-lists-error">{error}</p>}
      {notice && <p className="text-[var(--green)] mb-4" data-testid="admin-external-lists-notice">{notice}</p>}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 mb-6" data-testid="admin-external-lists-import">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-3">Import addresses</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            data-testid="admin-external-lists-import-list-input"
            aria-label="List name"
            list="admin-external-list-names"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="List name (new, or add to an existing one)"
            maxLength={80}
            className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
          />
          <datalist id="admin-external-list-names">
            {(data?.lists || []).map((l) => <option key={l.name} value={l.name} />)}
          </datalist>
          <input
            data-testid="admin-external-lists-import-source-input"
            aria-label="Where these addresses came from"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Where did these come from? e.g. Webinar signups, Aug 2026"
            maxLength={200}
            className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none"
          />
        </div>
        <textarea
          data-testid="admin-external-lists-import-text-input"
          aria-label="Addresses"
          value={text}
          onChange={(e) => { setText(e.target.value); setFileName(""); }}
          placeholder={"Paste one per line, or CSV with a header:\nemail,name\nada@example.com,Ada Lovelace\nalan@example.com,Alan Turing"}
          rows={6}
          className="w-full mb-2 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none resize-y font-mono"
        />
        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold cursor-pointer hover:bg-[var(--surface-card-hover)] transition-colors">
            <Upload size={13} /> Upload a CSV file
            <input type="file" accept=".csv,.txt,text/csv,text/plain" data-testid="admin-external-lists-import-file-input" onChange={onFileChosen} className="hidden" />
          </label>
          {fileName && <span className="text-xs text-[var(--text-secondary)]" data-testid="admin-external-lists-import-file-name">{fileName}</span>}
          <span className="text-[10px] text-[var(--text-tertiary)]">Columns: email, and optionally name (or first name + last name). Up to 10,000 rows.</span>
        </div>
        <label className="flex items-start gap-2 text-xs mb-3">
          <input type="checkbox" data-testid="admin-external-lists-import-consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          <span>I confirm these people have agreed to receive emails from Divve.</span>
        </label>
        <button
          type="button"
          data-testid="admin-external-lists-import-btn"
          disabled={!canImport}
          onClick={runImport}
          className="gold-btn rounded-full px-5 py-2 text-sm font-bold disabled:opacity-40"
        >
          {importing ? "Importing…" : "Import"}
        </button>
      </div>

      {importResult && <ImportResult result={importResult} />}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] overflow-hidden mb-4">
        <table className="w-full text-sm" data-testid="admin-external-lists-table">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <th className="px-4 py-3">List</th>
              <th className="px-4 py-3">Contacts</th>
              <th className="px-4 py-3">Subscribed</th>
              <th className="px-4 py-3">Unsubscribed</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.lists || []).map((l) => (
              <tr key={l.name} className="border-b border-[var(--border)] last:border-0" data-testid={`admin-external-list-row-${l.name}`}>
                <td className="px-4 py-3 font-bold">{l.name}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{l.total}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{l.subscribed}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{l.unsubscribed}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button type="button" data-testid={`admin-external-list-view-btn-${l.name}`} onClick={() => viewContacts(l.name)} className="text-xs font-bold text-[var(--dive-blue)] hover:underline">View</button>
                    {confirmingDelete === l.name ? (
                      <span className="flex items-center gap-2">
                        <button type="button" data-testid={`admin-external-list-delete-confirm-btn-${l.name}`} onClick={() => deleteList(l.name)} className="rounded-full bg-[var(--red)] text-white px-3 py-1 text-xs font-bold">Yes, delete</button>
                        <button type="button" onClick={() => setConfirmingDelete(null)} className="text-xs font-bold text-[var(--text-tertiary)]">Cancel</button>
                      </span>
                    ) : (
                      <button type="button" data-testid={`admin-external-list-delete-btn-${l.name}`} aria-label={`Delete ${l.name}`} onClick={() => setConfirmingDelete(l.name)} className="text-[var(--text-tertiary)] hover:text-[var(--red)]">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {data && data.lists.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-tertiary)]" data-testid="admin-external-lists-empty">No email lists yet — import your first one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.suppressedTotal > 0 && (
        <p className="text-[10px] text-[var(--text-tertiary)] mb-6" data-testid="admin-external-lists-suppressed">
          {data.suppressedTotal} address(es) have unsubscribed and will never be emailed again.
        </p>
      )}

      {viewing && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5" data-testid="admin-external-lists-contacts">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold">{viewing.name} — {viewing.total} contact(s)</p>
            <button type="button" data-testid="admin-external-lists-contacts-close-btn" onClick={() => setViewing(null)} className="text-xs font-bold text-[var(--text-tertiary)]">Close</button>
          </div>
          <table className="w-full text-sm mb-3">
            <tbody>
              {viewing.contacts.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0" data-testid={`admin-external-contact-${c.id}`}>
                  <td className="py-2 text-[var(--text-secondary)]">{c.email}</td>
                  <td className="py-2">{c.name || <span className="text-[var(--text-tertiary)]">(no name)</span>}</td>
                  <td className="py-2 text-right text-xs">{c.unsubscribed ? <span className="text-[var(--red)] font-bold">Unsubscribed</span> : <span className="text-[var(--green)]">Subscribed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between text-xs">
            <button type="button" data-testid="admin-external-lists-contacts-prev-btn" disabled={viewing.page <= 1} onClick={() => viewContacts(viewing.name, viewing.page - 1)} className="font-bold disabled:opacity-40">← Previous</button>
            <span className="text-[var(--text-tertiary)]">Page {viewing.page} of {Math.max(1, Math.ceil(viewing.total / viewing.pageSize))} · addresses are partly hidden</span>
            <button type="button" data-testid="admin-external-lists-contacts-next-btn" disabled={viewing.page * viewing.pageSize >= viewing.total} onClick={() => viewContacts(viewing.name, viewing.page + 1)} className="font-bold disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
