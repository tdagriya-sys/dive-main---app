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

  // Returns whether any BRAND-NEW input got bound this call — a signal that
  // the order ticket's structure just changed (new instrument opened),
  // worth evaluating even if this particular mutation batch didn't touch an
  // already-tracked field.
  function attachInputListeners() {
    const targets = adapter.watchTargets();
    let foundNew = false;
    targets.forEach((el) => {
      if (el.dataset.diveBotBound) return;
      el.dataset.diveBotBound = "1";
      el.addEventListener("input", scheduleEvaluate);
      el.addEventListener("change", scheduleEvaluate);
      foundNew = true;
    });
    return { targets, foundNew };
  }

  // Angel One's order ticket is a React SPA panel that can mount/unmount
  // (opening a new instrument's order window swaps the whole subtree) rather
  // than just having its input values change in place — a MutationObserver
  // on the body catches that case and re-attaches listeners to whatever
  // quantity/amount/price inputs exist now.
  // Angel One's real-time price ticks cause frequent, unrelated DOM
  // mutations — throttling the observer callback keeps the input re-scan
  // from running on every single tick. Deliberately setTimeout, NOT
  // requestAnimationFrame: rAF callbacks are fully SUSPENDED (not just
  // slowed down) while the tab isn't visible/focused, which meant a ticket
  // that finished rendering slightly after the content script's first scan
  // could leave its inputs with no listeners attached until the tab was
  // switched away and back — confirmed by real testing, not theoretical.
  // setTimeout still fires reliably in a background tab.
  //
  // Only calling scheduleEvaluate() when this batch actually touched a
  // tracked field (or revealed a brand-new one) — not on every mutation
  // batch unconditionally — matters a lot in practice: a live-trading page
  // mutates constantly (price ticks, watchlist rows, P&L figures) anywhere
  // on the page, and scheduleEvaluate() resets the 700ms debounce timer
  // every time it's called. Unconditionally calling it here meant the timer
  // could keep getting reset by completely unrelated page activity and
  // never actually fire until the page went quiet for a full 700ms
  // stretch — on a busy page that quiet gap can take several seconds to
  // arrive, which is what made the card feel slow to show up. Confirmed by
  // real testing, not theoretical.
  let mutationScheduled = false;
  let pendingRecords = [];
  observer = new MutationObserver((records) => {
    pendingRecords.push(...records);
    if (mutationScheduled) return;
    mutationScheduled = true;
    setTimeout(() => {
      mutationScheduled = false;
      const records = pendingRecords;
      pendingRecords = [];
      const { targets, foundNew } = attachInputListeners();
      const touchesTracked = targets.some((input) => records.some((r) => input.contains(r.target)));
      if (foundNew || touchesTracked) scheduleEvaluate();
    }, 150);
  });
  // characterData: true matters specifically for pages where an amount is
  // shown as plain DISPLAY TEXT rather than an <input> value (confirmed on
  // Groww's mutual-fund SIP page) — without it, a framework that updates a
  // text node's data in place (rather than replacing the node, which
  // childList would already catch) wouldn't trigger a re-scan at all.
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  attachInputListeners();
  scheduleEvaluate();
})();
