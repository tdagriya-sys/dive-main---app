// Renders the "Divve Bot" verdict card inside a Shadow DOM host, so none of
// the host site's CSS can bleed in (and none of ours leaks out onto their
// page). Visual language deliberately mirrors frontend/src/screens/
// DiveBot.jsx's existing bottom-sheet verdict card (same "DIVVE Bot" name,
// tone badge copy, title/reason layout, brand colors from frontend/src/
// index.css) — this is the one place in the app that already prototypes
// exactly this concept, just as an in-app simulation rather than a real
// content-script overlay.
(function () {
  const NS = (self.DiveBotCS = self.DiveBotCS || {});

  const TONE_STYLE = {
    good: { badgeBg: "#D1FAE5", badgeText: "#047857", accent: "#34D399", label: "APPROVES" },
    warn: { badgeBg: "#FEF3C7", badgeText: "#92400E", accent: "#FBBF24", label: "HEADS UP" },
    neutral: { badgeBg: "#E4E4E7", badgeText: "#3F3F46", accent: "#A1A1AA", label: "NEUTRAL" },
    danger: { badgeBg: "#FEE2E2", badgeText: "#B91C1C", accent: "#F87171", label: "WARNING" },
  };

  let hostEl = null;
  let shadow = null;
  let dismissedSignature = null; // avoids re-popping the same verdict every keystroke once the user closes it

  function ensureHost() {
    if (hostEl && document.documentElement.contains(hostEl)) return shadow;
    hostEl = document.createElement("div");
    hostEl.id = "divve-bot-host";
    hostEl.style.all = "initial";
    hostEl.style.position = "fixed";
    hostEl.style.zIndex = "2147483647";
    hostEl.style.bottom = "20px";
    hostEl.style.right = "20px";
    hostEl.style.width = "340px";
    hostEl.style.maxWidth = "calc(100vw - 40px)";
    document.documentElement.appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .card {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        background: #141416;
        border: 1px solid #262629;
        border-radius: 20px;
        padding: 18px 20px 20px;
        color: #FAFAF7;
        box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        animation: divve-slide-up 220ms ease-out;
      }
      @keyframes divve-slide-up {
        from { transform: translateY(16px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .brand { font-weight: 900; color: #E3B856; font-size: 14px; letter-spacing: -0.01em; }
      .dot { width: 20px; height: 20px; border-radius: 8px; background: #E3B856; display: flex; align-items: center; justify-content: center; font-size: 12px; }
      .badge { margin-left: auto; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 6px; letter-spacing: 0.04em; }
      .close { margin-left: 6px; background: none; border: none; color: #A1A1AA; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
      .close:hover { color: #FAFAF7; }
      .title { font-weight: 800; font-size: 15px; margin: 0 0 6px; }
      .message { font-size: 13px; line-height: 1.5; color: #A1A1AA; margin: 0 0 12px; }
      .stats { border-top: 1px solid #262629; padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
      .stat { display: flex; justify-content: space-between; font-size: 12px; }
      .stat-label { color: #A1A1AA; }
      .stat-value { font-weight: 700; }
      .up { color: #34D399; }
      .down { color: #F87171; }
      .flat { color: #A1A1AA; }
      .footer-note { font-size: 10px; color: #71717A; margin-top: 12px; }
      .loading, .info { font-size: 12px; color: #A1A1AA; }
    `;
    shadow.appendChild(style);
    return shadow;
  }

  function deltaClass(delta) {
    if (delta > 0) return "up";
    if (delta < 0) return "down";
    return "flat";
  }

  function fmtDelta(n) {
    const r = Math.round(n);
    return r > 0 ? `+${r}` : `${r}`;
  }

  function render(innerHtml) {
    const root = ensureHost();
    // Drop any prior card content (there's only ever one) before rendering the new one.
    Array.from(root.querySelectorAll(".card")).forEach((n) => n.remove());
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = innerHtml;
    root.appendChild(card);
    return card;
  }

  NS.overlay = {
    showLoading() {
      render(`
        <div class="row"><div class="dot">✦</div><span class="brand">Divve Bot</span></div>
        <p class="loading">Checking how this fits your portfolio…</p>
      `);
    },

    showLoggedOut(expired) {
      render(`
        <div class="row"><div class="dot">✦</div><span class="brand">Divve Bot</span>
          <button class="close" data-action="close">✕</button>
        </div>
        <p class="info">${
          expired
            ? "Your Divve session expired — log in again from the extension icon to keep seeing fit-for-you checks."
            : "Log in from the Divve Bot extension icon to see how this trade fits your portfolio."
        }</p>
      `);
      shadow.querySelector('[data-action="close"]')?.addEventListener("click", () => NS.overlay.hide());
    },

    showError(message) {
      render(`
        <div class="row"><div class="dot">✦</div><span class="brand">Divve Bot</span>
          <button class="close" data-action="close">✕</button>
        </div>
        <p class="info">${message || "Couldn't check this trade right now."}</p>
      `);
      shadow.querySelector('[data-action="close"]')?.addEventListener("click", () => NS.overlay.hide());
    },

    show(verdict, signature) {
      if (dismissedSignature === signature) return;
      const t = TONE_STYLE[verdict.tone] || TONE_STYLE.neutral;
      const n = verdict.numbers;
      const card = render(`
        <div class="row">
          <div class="dot">✦</div>
          <span class="brand">Divve Bot</span>
          <span class="badge" style="background:${t.badgeBg};color:${t.badgeText}">${t.label}</span>
          <button class="close" data-action="close">✕</button>
        </div>
        <h3 class="title">${verdict.title}</h3>
        <p class="message">${verdict.message}</p>
        <div class="stats">
          <div class="stat"><span class="stat-label">Divve Score</span><span class="stat-value ${deltaClass(n.scoreDelta)}">${n.baseScore} → ${n.newScore} (${fmtDelta(n.scoreDelta)})</span></div>
          <div class="stat"><span class="stat-label">Apparent diversification</span><span class="stat-value ${deltaClass(n.appDelta)}">${Math.round(n.baseApp)}% → ${Math.round(n.newApp)}%</span></div>
          <div class="stat"><span class="stat-label">Real diversification</span><span class="stat-value ${deltaClass(n.realDelta)}">${Math.round(n.baseReal)}% → ${Math.round(n.newReal)}%</span></div>
        </div>
        <p class="footer-note">Estimate based on your Divve holdings — not financial advice.</p>
      `);
      card.querySelector('[data-action="close"]')?.addEventListener("click", () => {
        dismissedSignature = signature;
        NS.overlay.hide();
      });
    },

    hide() {
      if (hostEl) hostEl.remove();
      hostEl = null;
      shadow = null;
    },
  };
})();
