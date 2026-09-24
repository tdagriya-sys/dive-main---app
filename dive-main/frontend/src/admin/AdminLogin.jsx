import React, { useState } from "react";
import { Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { useAdminAuth } from "./AdminAuthContext";

// Same TextField/FieldError shape as screens/Onboarding.jsx's login form —
// this is deliberately a close visual sibling of it (same surface, same
// field styling), not a reinvented design, even though it lives in its own
// tree and never renders alongside the main app.
function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-[var(--red)] font-semibold mt-1 mb-2" data-testid="admin-login-error">
      {msg}
    </p>
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

function Wordmark() {
  return (
    <span className="font-heading font-black text-2xl whitespace-nowrap">
      <span className="text-gold-gradient">Divv</span>
      <span className="text-gold-gradient inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
      <span className="text-[var(--text-tertiary)] font-bold ml-2 text-base align-middle">Admin</span>
    </span>
  );
}

/**
 * Staff sign-in (Phase 0.4 of docs/ADMIN_PANEL_PLAN.md): password →
 * mandatory TOTP (first-time setup with a QR code, or a plain code entry for
 * every login after that) → for a first-time enrolment only, one screen of
 * one-time recovery codes that must be acknowledged before the session
 * actually starts (see AdminAuthContext's completeLogin — the gate that
 * makes this possible).
 */
export default function AdminLogin() {
  const { loginWithPassword, totpSetup, totpConfirm, totpVerify, completeLogin } = useAdminAuth();

  const [step, setStep] = useState("credentials"); // credentials | totp | recovery-codes
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pendingToken, setPendingToken] = useState(null);
  const [totpEnrolled, setTotpEnrolled] = useState(false);
  const [setupInfo, setSetupInfo] = useState(null); // { otpauthUrl, qrDataUrl, secret }
  const [code, setCode] = useState("");
  const [pendingSession, setPendingSession] = useState(null); // { accessToken, user } — held until recovery codes are acknowledged
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const errorMessage = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

  const submitCredentials = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await loginWithPassword(identifier, password);
      setPendingToken(result.pendingToken);
      setTotpEnrolled(result.totpEnrolled);
      setStep("totp");
      if (!result.totpEnrolled) {
        const info = await totpSetup(result.pendingToken);
        setSetupInfo(info);
      }
    } catch (err) {
      setError(errorMessage(err, "Couldn't log in. Please check your details."));
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (!totpEnrolled) {
        const data = await totpConfirm(pendingToken, code);
        setPendingSession({ accessToken: data.accessToken, user: data.user });
        setRecoveryCodes(data.recoveryCodes);
        setStep("recovery-codes");
      } else {
        const data = await totpVerify(pendingToken, code);
        completeLogin(data.accessToken, data.user);
      }
    } catch (err) {
      setError(errorMessage(err, "That code is incorrect or has expired."));
    } finally {
      setLoading(false);
    }
  };

  const finishEnrolment = () => {
    completeLogin(pendingSession.accessToken, pendingSession.user);
  };

  if (step === "recovery-codes") {
    return (
      <div className="min-h-screen dive-app-surface flex items-center justify-center px-6 py-10" data-testid="admin-recovery-codes-screen">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-6"><Wordmark /></div>
          <div className="w-12 h-12 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center mx-auto mb-5">
            <KeyRound size={22} className="text-[var(--dive-blue)]" />
          </div>
          <h1 className="font-heading font-black text-2xl text-center mb-2">Save your recovery codes</h1>
          <p className="text-sm text-[var(--text-secondary)] text-center mb-6">
            Each code works once, as a backup if you lose access to your authenticator app. They're shown only this one time — save them
            somewhere safe (a password manager) before continuing.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
            {recoveryCodes.map((rc, i) => (
              <span key={rc} className="font-mono text-sm font-bold text-center py-1" data-testid={`admin-recovery-code-${i}`}>
                {rc}
              </span>
            ))}
          </div>
          <button
            data-testid="admin-recovery-codes-continue-btn"
            onClick={finishEnrolment}
            className="w-full gold-btn rounded-full py-4 font-bold hover:bg-[var(--dive-blue-hover)] transition-colors"
          >
            I've saved these — continue
          </button>
        </div>
      </div>
    );
  }

  if (step === "totp") {
    return (
      <div className="min-h-screen dive-app-surface flex items-center justify-center px-6 py-10" data-testid="admin-totp-screen">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-6"><Wordmark /></div>
          <div className="w-12 h-12 rounded-2xl bg-[var(--dive-blue-light)] flex items-center justify-center mx-auto mb-5">
            <ShieldCheck size={22} className="text-[var(--dive-blue)]" />
          </div>
          {totpEnrolled ? (
            <>
              <h1 className="font-heading font-black text-2xl text-center mb-2">Enter your code</h1>
              <p className="text-sm text-[var(--text-secondary)] text-center mb-6">
                Open your authenticator app and enter the 6-digit code, or use one of your recovery codes.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-heading font-black text-2xl text-center mb-2">Set up two-factor authentication</h1>
              <p className="text-sm text-[var(--text-secondary)] text-center mb-6">
                Scan this with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code it shows.
              </p>
              {setupInfo && (
                <div className="flex flex-col items-center mb-6">
                  <img src={setupInfo.qrDataUrl} alt="Two-factor setup QR code" className="w-40 h-40 rounded-xl border border-[var(--border)]" data-testid="admin-totp-qr" />
                  <p className="text-xs text-[var(--text-tertiary)] mt-3 mb-1">Can't scan? Enter this code manually:</p>
                  <code className="text-xs font-mono font-bold tracking-wider" data-testid="admin-totp-secret">
                    {setupInfo.secret}
                  </code>
                </div>
              )}
            </>
          )}
          <form onSubmit={submitCode}>
            <TextField
              label="6-digit code or recovery code"
              testId="admin-totp-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoComplete="one-time-code"
              required
            />
            <FieldError msg={error} />
            <button
              data-testid="admin-totp-submit-btn"
              type="submit"
              disabled={loading || !code}
              className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />} {totpEnrolled ? "Verify & continue" : "Confirm & continue"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen dive-app-surface flex items-center justify-center px-6 py-10" data-testid="admin-login-screen">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8"><Wordmark /></div>
        <h1 className="font-heading font-black text-2xl text-center mb-2">Staff sign-in</h1>
        <p className="text-sm text-[var(--text-secondary)] text-center mb-8">Two-factor authentication is required for every staff account.</p>
        <form onSubmit={submitCredentials}>
          <TextField label="Email" testId="admin-login-identifier-input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          <TextField
            label="Password"
            testId="admin-login-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <FieldError msg={error} />
          <button
            data-testid="admin-login-submit-btn"
            type="submit"
            disabled={loading}
            className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />} Continue
          </button>
        </form>
      </div>
    </div>
  );
}
