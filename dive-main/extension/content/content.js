// Orchestrator: detects the active site adapter (siteAdapters.js), watches
// the order form for quantity/amount changes, debounces, asks the background
// service worker for a fit verdict (background.js — the only piece that
// talks to the Dive API), and renders it via overlay.js. No network calls or
// chrome.storage access happen in this file.
(function () {
  const NS = self.DiveBotCS;
  if (!NS || !NS.getActiveAdapter || !NS.overlay) return;

  const adapter = NS.getActiveAdapter();
  if (!adapter) return;

  const DEBOUNCE_MS = 700;
  let debounceTimer = null;
  let lastSignature = null;
  let observer = null;

  function signatureOf(state) {
    return `${state.instrumentName}|${Math.round(state.amount)}`;
  }

  async function evaluate() {
    const state = adapter.readOrderState();
    if (!state) {
      NS.overlay.hide();
      lastSignature = null;
      return;
    }

    const signature = signatureOf(state);
    if (signature === lastSignature) return; // nothing meaningfully changed
    lastSignature = signature;

    NS.overlay.showLoading();
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "GET_FIT_VERDICT",
        instrumentName: state.instrumentName,
        amount: state.amount,
        assetClassHint: state.assetClassHint,
      });
    } catch (err) {
      // Extension context can be invalidated (e.g. reloaded) while a page is
      // still open — nothing useful to show the user in that case.
      NS.overlay.hide();
      return;
    }

    if (!response || !response.ok) {
      const reason = response?.reason;
      if (reason === "NOT_LOGGED_IN" || reason === "SESSION_EXPIRED") NS.overlay.showLoggedOut(reason === "SESSION_EXPIRED");
      else if (reason === "NO_AMOUNT") NS.overlay.hide();
      else NS.overlay.showError(response?.message);
      return;
    }

    NS.overlay.show(response.verdict, signature);
  }

  function scheduleEvaluate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(evaluate, DEBOUNCE_MS);
  }

  function attachInputListeners() {
    const targets = adapter.watchTargets();
    targets.forEach((el) => {
      if (el.dataset.diveBotBound) return;
      el.dataset.diveBotBound = "1";
      el.addEventListener("input", scheduleEvaluate);
      el.addEventListener("change", scheduleEvaluate);
    });
  }

  // Angel One's order ticket is a React SPA panel that can mount/unmount
  // (opening a new instrument's order window swaps the whole subtree) rather
  // than just having its input values change in place — a MutationObserver
  // on the body catches that case and re-attaches listeners to whatever
  // quantity/amount/price inputs exist now.
  // Angel One's real-time price ticks cause frequent, unrelated DOM
  // mutations — throttling the observer callback to once per animation
  // frame keeps the input re-scan from running on every single tick.
  let mutationScheduled = false;
  observer = new MutationObserver(() => {
    if (mutationScheduled) return;
    mutationScheduled = true;
    requestAnimationFrame(() => {
      mutationScheduled = false;
      attachInputListeners();
      scheduleEvaluate();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  attachInputListeners();
  scheduleEvaluate();
})();
