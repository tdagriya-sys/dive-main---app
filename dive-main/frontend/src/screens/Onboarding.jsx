import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, Loader2, Eye, Layers, Bot, Share2, Eye as EyeIcon, EyeOff } from "lucide-react";
import { useDive } from "../context/DiveContext";
import { ScoreRing } from "../components/dive/Widgets";
import ShareCard from "../components/dive/ShareCard";
import { diveScore, topExposure, effectiveHoldings } from "../lib/diveEngine";

const SLIDES = [
  { icon: Eye, title: "See what your money is really invested in", body: "Most apps show you categories. DIVVE looks through every holding to what you actually own." },
  { icon: Layers, title: "Spot hidden concentration risk", body: "Three 'different' investments can secretly be the same company. We reveal it." },
  { icon: Bot, title: "DIVVE follows you everywhere", body: "Our bot pops up inside your other investing apps to warn or cheer you on — in real time." },
];

export default function Onboarding() {
  const { screen, setScreen, holdings } = useDive();
  if (screen === "splash") return <Splash setScreen={setScreen} />;
  if (screen === "signup") return <SignUp setScreen={setScreen} />;
  if (screen === "login") return <Login setScreen={setScreen} />;
  if (screen === "forgotPassword") return <ForgotPassword setScreen={setScreen} />;
  if (screen === "reveal") return <Reveal setScreen={setScreen} holdings={holdings} />;
  return null;
}

function Splash({ setScreen }) {
  const [i, setI] = useState(0);
  const S = SLIDES[i];
  return (
    <div className="flex flex-col h-full px-7 py-10 dive-app-surface" data-testid="splash-screen">
      <div className="flex items-center gap-2">
        <span className="font-heading font-black text-2xl text-[var(--dive-blue)] whitespace-nowrap">
          Divv
          {/* Tilted 9° like Google's own wordmark "e", matching the header logo. */}
          <span className="inline-block" style={{ transform: "rotate(-9deg)" }}>e</span>
        </span>
      </div>
      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.35 }}>
            <div className="w-20 h-20 rounded-3xl bg-[var(--dive-blue-light)] flex items-center justify-center mb-8">
              <S.icon size={38} className="text-[var(--dive-blue)]" />
            </div>
            <h1 className="font-heading font-black text-3xl leading-tight mb-4">{S.title}</h1>
            <p className="text-[var(--text-secondary)] text-base leading-relaxed">{S.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex gap-2 mb-6">
        {SLIDES.map((_, idx) => (
          <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-[var(--dive-blue)]" : "w-1.5 bg-[var(--border)]"}`} />
        ))}
      </div>
      <button data-testid="splash-next-btn"
        onClick={() => (i < SLIDES.length - 1 ? setI(i + 1) : setScreen("signup"))}
        className="w-full gold-btn rounded-full py-4 font-bold flex items-center justify-center gap-2 shadow-lg shadow-[var(--dive-blue)]/25 hover:bg-[var(--dive-blue-hover)] transition-colors">
        {i < SLIDES.length - 1 ? "Next" : "Get Started"} <ChevronRight size={18} />
      </button>
      <button data-testid="splash-login-link" onClick={() => setScreen("login")}
        className="w-full text-center mt-3 text-sm font-bold text-[var(--dive-blue)]">
        Already have an account? Log in
      </button>
    </div>
  );
}

function FieldError({ msg }) {
  if (!msg) return null;
  return <p className="text-xs text-[var(--red)] font-semibold mt-1 mb-2">{msg}</p>;
}

function TextField({ label, testId, error, ...props }) {
  return (
    <div className="mb-4">
      <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">{label}</label>
      <input data-testid={testId} {...props}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 outline-none font-semibold text-[var(--text-primary)]" />
      <FieldError msg={error} />
    </div>
  );
}

function SignUp({ setScreen }) {
  const { signupStart, signupVerify, goBack } = useDive();
  const [step, setStep] = useState("form"); // form | otp
  const [form, setForm] = useState({ name: "", mobile: "", email: "", age: "", password: "", confirmPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submitForm = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await signupStart({ ...form, mobile: form.mobile.replace(/\D/g, ""), age: Number(form.age) });
      setDevOtp(res.devOtp || null);
      setStep("otp");
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.message || (data?.issues?.[0]?.message) || "Something went wrong. Please check your details.");
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async () => {
    setError("");
    setLoading(true);
    try {
      await signupVerify(form.mobile.replace(/\D/g, ""), otp);
      // Land on Home (dashboard + a dismissible "get started" popup), not the
      // fetch-method chooser directly — see Home.jsx's GetStartedPopup.
      setScreen("home");
    } catch (err) {
      setError(err?.response?.data?.message || "That OTP didn't work.");
    } finally {
      setLoading(false);
    }
  };

  if (step === "otp") {
    return (
      <div className="flex flex-col h-full px-7 py-10 dive-app-surface" data-testid="signup-otp-screen">
        <h1 className="font-heading font-black text-3xl mb-2">Verify your email</h1>
        <p className="text-[var(--text-secondary)] mb-8">We sent a 6-digit code to {form.email}.</p>
        <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Enter 6-digit OTP</label>
        <input data-testid="otp-input" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 mb-3 outline-none tracking-[0.5em] font-bold text-center text-lg text-[var(--text-primary)]" inputMode="numeric" />
        {devOtp && (
          <button data-testid="autofill-otp-btn" onClick={() => setOtp(devOtp)} className="text-sm font-bold text-[var(--dive-blue)] mb-4 self-start">
            Dev mode — use test OTP {devOtp}
          </button>
        )}
        <FieldError msg={error} />
        <button data-testid="verify-otp-btn" disabled={otp.length < 6 || loading} onClick={submitOtp}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin" />} Verify & Continue
        </button>
        <button data-testid="back-to-form-btn" onClick={() => setStep("form")} className="w-full text-center mt-3 text-sm font-bold text-[var(--text-secondary)]">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full px-7 py-10 dive-app-surface" data-testid="signup-screen">
      <button data-testid="signup-back-btn" onClick={goBack} className="mb-3 -ml-1 p-1 self-start"><ChevronLeft size={22} /></button>
      <h1 className="font-heading font-black text-3xl mb-2">Let's get you in</h1>
      <p className="text-[var(--text-secondary)] mb-6">Quick sign-up — takes a minute.</p>
      <form onSubmit={submitForm}>
        <TextField label="Full name" testId="name-input" value={form.name} onChange={set("name")} required />
        <div className="mb-4">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Mobile number</label>
          <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
            <span className="text-[var(--text-secondary)] font-semibold mr-2">+91</span>
            <input data-testid="phone-input" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
              placeholder="98765 43210" className="flex-1 outline-none font-semibold bg-transparent text-[var(--text-primary)]" inputMode="numeric" required />
          </div>
        </div>
        <TextField label="Email" testId="email-input" type="email" value={form.email} onChange={set("email")} required />
        <TextField label="Age" testId="age-input" type="number" min="18" value={form.age} onChange={set("age")} required />
        <div className="mb-4">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">Password</label>
          <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
            <input data-testid="password-input" type={showPw ? "text" : "password"} value={form.password} onChange={set("password")}
              className="flex-1 outline-none font-semibold bg-transparent text-[var(--text-primary)]" required />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="text-[var(--text-tertiary)]">
              {showPw ? <EyeOff size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
        </div>
        <TextField label="Confirm password" testId="confirm-password-input" type={showPw ? "text" : "password"} value={form.confirmPassword} onChange={set("confirmPassword")} required />
        <FieldError msg={error} />
        <button data-testid="send-otp-btn" type="submit" disabled={loading}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin" />} Send OTP
        </button>
      </form>
      <button data-testid="signup-to-login-link" onClick={() => setScreen("login")} className="w-full text-center mt-4 text-sm font-bold text-[var(--dive-blue)]">
        Already have an account? Log in
      </button>
    </div>
  );
}

function Login({ setScreen }) {
  const { login, goBack } = useDive();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setNotFound(false);
    setLoading(true);
    try {
      await login(identifier, password);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.error === "USER_NOT_FOUND") setNotFound(true);
      else setError(data?.message || "Couldn't log in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full px-7 py-10 dive-app-surface" data-testid="login-screen">
      <button data-testid="login-back-btn" onClick={goBack} className="mb-3 -ml-1 p-1 self-start"><ChevronLeft size={22} /></button>
      <h1 className="font-heading font-black text-3xl mb-2">Welcome back</h1>
      <p className="text-[var(--text-secondary)] mb-8">Log in with your email or mobile number.</p>
      <form onSubmit={submit}>
        <TextField label="Email or mobile number" testId="login-identifier-input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <TextField label="Password" testId="login-password-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="button" data-testid="forgot-password-link" onClick={() => setScreen("forgotPassword")}
          className="text-sm font-bold text-[var(--dive-blue)] mb-4 -mt-2 self-start">
          Forgot password?
        </button>
        {notFound && (
          <div className="mb-4 bg-[var(--dive-blue-light)] rounded-xl px-4 py-3" data-testid="user-not-found-banner">
            <p className="text-sm font-semibold text-[var(--dive-blue-dark)] mb-2">
              We couldn't find an account with these details — please sign up first.
            </p>
            <button type="button" data-testid="go-to-signup-btn" onClick={() => setScreen("signup")} className="text-sm font-bold text-[var(--dive-blue)] underline">
              Go to sign up
            </button>
          </div>
        )}
        <FieldError msg={error} />
        <button data-testid="login-submit-btn" type="submit" disabled={loading}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin" />} Log in
        </button>
      </form>
      <button data-testid="login-to-signup-link" onClick={() => setScreen("signup")} className="w-full text-center mt-4 text-sm font-bold text-[var(--dive-blue)]">
        New to DIVVE? Sign up
      </button>
    </div>
  );
}

function ForgotPassword({ setScreen }) {
  const { forgotPasswordStart, forgotPasswordVerify, resetPassword, goBack } = useDive();
  const [step, setStep] = useState("identifier"); // identifier | otp | newPassword | done
  const [identifier, setIdentifier] = useState("");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState(null);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submitIdentifier = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await forgotPasswordStart(identifier);
      setMobile(res.mobile);
      setDevOtp(res.devOtp || null);
      setStep("otp");
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.message || data?.issues?.[0]?.message || "Couldn't find that account.");
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const token = await forgotPasswordVerify(mobile, otp);
      setResetToken(token);
      setStep("newPassword");
    } catch (err) {
      setError(err?.response?.data?.message || "That OTP didn't work.");
    } finally {
      setLoading(false);
    }
  };

  const submitNewPassword = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await resetPassword(resetToken, newPassword, confirmNewPassword);
      setStep("done");
    } catch (err) {
      const data = err?.response?.data;
      setError(data?.message || data?.issues?.[0]?.message || "Couldn't reset your password.");
    } finally {
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <div className="flex flex-col h-full px-7 py-10 dive-app-surface items-center justify-center text-center" data-testid="forgot-password-done-screen">
        <h1 className="font-heading font-black text-2xl mb-3">Password updated</h1>
        <p className="text-[var(--text-secondary)] mb-8">You can now log in with your new password.</p>
        <button data-testid="forgot-password-done-login-btn" onClick={() => setScreen("login")}
          className="w-full gold-btn rounded-full py-4 font-bold hover:bg-[var(--dive-blue-hover)] transition-colors">
          Back to log in
        </button>
      </div>
    );
  }

  if (step === "newPassword") {
    return (
      <div className="flex flex-col h-full px-7 py-10 dive-app-surface" data-testid="forgot-password-new-screen">
        <button data-testid="forgot-password-new-back-btn" onClick={() => setStep("otp")} className="mb-3 -ml-1 p-1 self-start"><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-3xl mb-2">Set a new password</h1>
        <p className="text-[var(--text-secondary)] mb-6">Choose a new password for your account.</p>
        <form onSubmit={submitNewPassword}>
          <div className="mb-4">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2 block">New password</label>
            <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
              <input data-testid="forgot-password-new-input" type={showPw ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                className="flex-1 outline-none font-semibold bg-transparent text-[var(--text-primary)]" required />
              <button type="button" onClick={() => setShowPw((s) => !s)} className="text-[var(--text-tertiary)]">
                {showPw ? <EyeOff size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
          </div>
          <TextField label="Confirm new password" testId="forgot-password-confirm-input" type={showPw ? "text" : "password"} value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required />
          <FieldError msg={error} />
          <button data-testid="forgot-password-reset-btn" type="submit" disabled={loading}
            className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 size={16} className="animate-spin" />} Set new password
          </button>
        </form>
      </div>
    );
  }

  if (step === "otp") {
    return (
      <div className="flex flex-col h-full px-7 py-10 dive-app-surface" data-testid="forgot-password-otp-screen">
        <button data-testid="forgot-password-otp-back-btn" onClick={() => setStep("identifier")} className="mb-3 -ml-1 p-1 self-start"><ChevronLeft size={22} /></button>
        <h1 className="font-heading font-black text-3xl mb-2">Verify your email</h1>
        <p className="text-[var(--text-secondary)] mb-8">We sent a 6-digit code to the email on your account.</p>
        <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Enter 6-digit OTP</label>
        <input data-testid="forgot-password-otp-input" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 mb-3 outline-none tracking-[0.5em] font-bold text-center text-lg text-[var(--text-primary)]" inputMode="numeric" />
        {devOtp && (
          <button data-testid="forgot-password-autofill-otp-btn" onClick={() => setOtp(devOtp)} className="text-sm font-bold text-[var(--dive-blue)] mb-4 self-start">
            Dev mode — use test OTP {devOtp}
          </button>
        )}
        <FieldError msg={error} />
        <button data-testid="forgot-password-verify-otp-btn" disabled={otp.length < 6 || loading} onClick={submitOtp}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin" />} Verify & Continue
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-7 py-10 dive-app-surface" data-testid="forgot-password-screen">
      <button data-testid="forgot-password-back-btn" onClick={goBack} className="mb-3 -ml-1 p-1 self-start"><ChevronLeft size={22} /></button>
      <h1 className="font-heading font-black text-3xl mb-2">Reset your password</h1>
      <p className="text-[var(--text-secondary)] mb-6">Enter the email or mobile number on your account and we'll send a verification code.</p>
      <form onSubmit={submitIdentifier}>
        <TextField label="Email or mobile number" testId="forgot-password-identifier-input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <FieldError msg={error} />
        <button data-testid="forgot-password-send-otp-btn" type="submit" disabled={loading}
          className="w-full gold-btn rounded-full py-4 font-bold disabled:opacity-40 hover:bg-[var(--dive-blue-hover)] transition-colors flex items-center justify-center gap-2">
          {loading && <Loader2 size={16} className="animate-spin" />} Send OTP
        </button>
      </form>
    </div>
  );
}

function Reveal({ setScreen, holdings }) {
  const [show, setShow] = useState(false);
  const [share, setShare] = useState(false);
  React.useEffect(() => { const t = setTimeout(() => setShow(true), 300); return () => clearTimeout(t); }, []);
  const h = effectiveHoldings(holdings, []);
  const score = diveScore(h);
  const top = topExposure(h);
  return (
    <div className="flex flex-col h-full px-7 py-10 dive-app-surface justify-center items-center text-center relative" data-testid="reveal-screen">
      <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-6">Your DIVVE Score is ready</span>
      {show && <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
        <ScoreRing score={score} size={220} />
      </motion.div>}
      <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}
        className="mt-8 text-lg font-semibold leading-snug">
        {top.pct > 0
          ? <>Decent start — but <span className="text-[var(--red)] font-bold">{top.pct.toFixed(0)}%</span> of your money is concentrated in {top.name}.</>
          : "Add a few investments and DIVVE will start scoring your portfolio."}
      </motion.p>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
        data-testid="reveal-continue-btn" onClick={() => setScreen("home")}
        className="mt-8 w-full gold-btn rounded-full py-4 font-bold shadow-lg shadow-[var(--dive-blue)]/25 hover:bg-[var(--dive-blue-hover)] transition-colors">
        See the Full X-Ray
      </motion.button>
      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.65 }}
        data-testid="reveal-share-btn" onClick={() => setShare(true)}
        className="mt-3 w-full bg-[var(--surface-card)] border border-[var(--border)] rounded-full py-3.5 font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-card-hover)] transition-colors">
        <Share2 size={18} className="text-[var(--dive-blue)]" /> Share my score
      </motion.button>
      <AnimatePresence>
        {share && <ShareCard score={score} name="me" topPct={top.pct} onClose={() => setShare(false)} />}
      </AnimatePresence>
    </div>
  );
}
