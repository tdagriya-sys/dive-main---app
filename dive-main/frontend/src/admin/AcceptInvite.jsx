import React, { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Loader2, UserPlus } from "lucide-react";
import axios from "axios";
import { API_BASE } from "../lib/api";

// A plain, interceptor-free axios instance — deliberately not the shared
// `api` singleton, which auto-attaches whatever access token happens to be
// in memory. A person accepting an invite has no session at all, and never
// should while filling this form out.
const publicApi = axios.create({ baseURL: API_BASE });

function Wordmark() {
  return (
    <span className="font-heading font-black text-2xl whitespace-nowrap">
      <span className="text-gold-gradient">Divv</span>
      <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
      <span className="text-[var(--text-tertiary)] font-bold ml-2 text-base align-middle">Admin</span>
    </span>
  );
}

function TextField({ label, testId, ...props }) {
  return (
    <div className="mb-4">
      <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">{label}</label>
      <input
        data-testid={testId}
        {...props}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 outline-none font-semibold text-[var(--text-primary)]"
      />
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen dive-app-surface flex items-center justify-center px-6 py-10" data-testid="admin-accept-invite-screen">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <Wordmark />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Public — the only way (besides the one-time createSuperadmin.ts bootstrap
 * script) a new staff account gets created (Phase 3 of
 * docs/ADMIN_PANEL_PLAN.md). Reached via /admin/accept-invite?token=... — see
 * AdminApp.jsx, which renders this INSTEAD of the login/shell switch
 * regardless of auth state, since a person accepting an invite has no
 * session yet and must never be redirected into the login flow.
 */
export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [preview, setPreview] = useState(null); // { email, staffRole } | null
  const [previewLoading, setPreviewLoading] = useState(true);
  const [form, setForm] = useState({ name: "", mobile: "", age: "", password: "", confirmPassword: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await publicApi.get(`/auth/staff/invite/${token}`);
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await publicApi.post("/auth/staff/accept-invite", { token, ...form });
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't create your account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (previewLoading) {
    return (
      <Shell>
        <div className="flex justify-center" data-testid="admin-accept-invite-loading">
          <Loader2 size={20} className="animate-spin text-[var(--text-tertiary)]" />
        </div>
      </Shell>
    );
  }

  if (!preview) {
    return (
      <Shell>
        <p className="text-center text-sm text-[var(--red)]" data-testid="admin-accept-invite-invalid">
          This invite link is invalid or has expired. Ask whoever invited you to send a new one.
        </p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="w-12 h-12 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center mx-auto mb-5">
          <UserPlus size={22} className="text-[var(--dive-blue)]" />
        </div>
        <h1 className="font-heading font-black text-2xl text-center mb-2">Account created</h1>
        <p className="text-sm text-[var(--text-secondary)] text-center mb-6" data-testid="admin-accept-invite-success">
          Log in to finish setting up two-factor authentication — every staff account requires it.
        </p>
        <Link to="/admin" data-testid="admin-accept-invite-login-link" className="w-full gold-btn rounded-full py-4 font-bold text-center block hover:bg-[var(--dive-blue-hover)] transition-colors">
          Go to sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-heading font-black text-2xl text-center mb-2">{`Join Divve as ${preview.staffRole}`}</h1>
      <p className="text-sm text-[var(--text-secondary)] text-center mb-6" data-testid="admin-accept-invite-preview">
        {preview.email}
      </p>
      <form onSubmit={handleSubmit}>
        <TextField label="Name" testId="admin-accept-invite-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextField label="Mobile number" testId="admin-accept-invite-mobile-input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} required />
        <TextField label="Age" testId="admin-accept-invite-age-input" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} required />
        <TextField
          label="Password"
          testId="admin-accept-invite-password-input"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <TextField
          label="Confirm password"
          testId="admin-accept-invite-confirmpassword-input"
          type="password"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          required
        />
        {error && (
          <p className="text-xs text-[var(--red)] font-semibold mb-4" data-testid="admin-accept-invite-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="admin-accept-invite-submit-btn"
          disabled={submitting}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />} Create account
        </button>
      </form>
    </Shell>
  );
}
