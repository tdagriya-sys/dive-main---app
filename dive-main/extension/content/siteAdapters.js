// Site-specific DOM heuristics live here, isolated from the generic
// observe/orchestrate logic in content.js. Angel One's web trading UI
// (angelone.in — order widgets can appear on /trade/portfolio, /trade/
// markets, or any other path, not just a dedicated order page) is a React
// SPA with hashed/generated CSS class names, which makes hardcoded selectors
// ("div.jss482") brittle across deploys — so detection here is LABEL- and
// ROLE-based (aria-label/placeholder/name text, nearby heading text) rather
// than exact selectors or a URL check, which tends to survive a CSS rebuild
// even when it can't survive a full redesign.
//
// IMPORTANT: this was built without a live, logged-in Angel One session (an
// automated agent should never authenticate into a real brokerage account).
// If detection doesn't fire on your real order window, open DevTools on the
// actual order ticket, find the quantity input, and adjust the regexes/
// selectors below to match what you see — everything site-specific is
// isolated in this one file. See extension/README.md.
//
// Loaded as a plain (non-module) content script — exposes itself via the
// shared `self.DiveBotCS` namespace so content.js and overlay.js (loaded
// after this file, same isolated world) can use it.
(function () {
  const NS = (self.DiveBotCS = self.DiveBotCS || {});

  // Leading word-boundary only (no trailing \b) — deliberately, so these
  // still match camelCase ids like "amountInput" or "quantityOrderPad",
  // confirmed via real inspection to be how Angel One actually names these
  // fields. A trailing \b would require "amount"/"quantity" to be a whole
  // word, which silently rejects exactly the id attributes meant to
  // identify the field (id="amountInput" has no boundary between "amount"
  // and "Input" — both are letters).
  const QTY_HINT = /\b(qty|quantity|units?)/i;
  const PRICE_HINT = /\b(price|ltp|rate)/i;
  const AMOUNT_HINT = /\bamount/i;
  // "Lots" (as in "1 Lot = 1KGS") is F&O/commodity-contract terminology,
  // never used on an equity/ETF/mutual-fund order screen — a deliberate,
  // reliable signal that this is a margin-leveraged derivatives position,
  // not a plain allocation purchase. See isDerivativesOrCommodityContract().
  const LOTS_HINT = /\blots?\b/i;
  // "pay"/"invest" cover the amount-only mutual-fund flow (angelone.in/
  // mutual-funds/...), which has no Buy/Sell toggle at all — just a
  // "PAY ₹5,000" / "Invest" CTA.
  const ORDER_BUTTON_HINT = /\b(buy|sell|pay|invest|place order|review order|swipe to (buy|sell))\b/i;

  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function labelText(el) {
    const ariaLabel = el.getAttribute("aria-label") || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const name = el.getAttribute("name") || "";
    const id = el.id || "";
    // Walk up to a couple of ancestor levels to catch a sibling <label> or
    // text node that visually labels this field but isn't an ARIA attribute
    // (common in hand-rolled React forms that skip proper <label for>).
    let nearby = "";
    let node = el.closest("div,li,section");
    if (node) nearby = node.textContent?.slice(0, 80) || "";
    return [ariaLabel, placeholder, name, id, nearby].join(" ");
  }

  function findInputMatching(hintRegex, { excludeQty = false } = {}) {
    const inputs = Array.from(document.querySelectorAll("input"));
    for (const input of inputs) {
      if (!isVisible(input)) continue;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      if (!["number", "text", "tel", "search"].includes(type)) continue;
      const text = labelText(input);
      if (hintRegex.test(text) && (!excludeQty || !QTY_HINT.test(text))) return input;
    }
    return null;
  }

  // Originally anchored on "NSE"/Buy-Sell text in an ancestor's aggregated
  // textContent — confirmed by live DOM inspection (see extension/README.md's
  // "known limitations") to be simply WRONG for this site: "NSE" isn't real
  // text anywhere on the page at all (it's rendered as an icon/pseudo-
  // element next to the price), and the Buy/Sell/Pay footer sits in a
  // sibling container the quantity input's ancestor chain never reaches
  // either — so that anchor-based walk could never succeed and always fell
  // through to a near-useless one-level fallback.
  //
  // What DOES hold structurally (also confirmed by inspection): the order
  // ticket is a single, self-contained widget of roughly constant text size
  // as you walk up through it — then there's one sharp jump once you step
  // OUT of the widget into the surrounding page (holdings table, watchlist
  // sidebar, nav). Walking up and stopping right before that jump finds the
  // widget's true boundary without depending on any specific wording at all.
  function findOrderPanelRoot() {
    const qtyInput = findInputMatching(QTY_HINT);
    const primaryInput = qtyInput || findInputMatching(AMOUNT_HINT);
    if (!primaryInput) return null;

    let best = primaryInput;
    let bestLength = (primaryInput.textContent || "").length;
    let node = primaryInput;
    for (let i = 0; i < 14 && node.parentElement; i++) {
      const parent = node.parentElement;
      const parentLength = (parent.textContent || "").length;
      // A jump to >1500 chars AND >3x the widget's own size marks "we've
      // left the ticket and are now looking at a page-level container" —
      // stop at the last node before that happened.
      if (parentLength > 1500 && parentLength > bestLength * 3) return best;
      best = parent;
      bestLength = parentLength;
      node = parent;
    }
    return best;
  }

  function isMutualFundPage() {
    return /\/mutual-funds\//i.test(location.pathname);
  }

  // Angel One's mutual-fund URLs encode the fund's name directly — confirmed
  // on two different path shapes so far: the one-time-purchase page
  // (/mutual-funds/schemes/motilal-oswal-midcap-fund-isin-.../) and the SIP
  // page (/mutual-funds/investments/motilal-oswal-midcap-fund-isin-.../) —
  // so this matches any single path segment between "mutual-funds" and the
  // slug, not just "schemes" specifically. Far more reliable than scraping
  // the page for it either way, since (per real screenshots) the fund's name
  // lives in a separate card from the payment widget entirely, outside
  // whatever root findOrderPanelRoot() scopes to.
  function extractNameFromMutualFundUrl() {
    const match = location.pathname.match(/\/mutual-funds\/[a-z]+\/([a-z0-9-]+?)-isin-/i);
    if (!match) return null;
    return match[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function extractPageHeading() {
    const candidates = document.querySelectorAll(
      'h1, h2, [class*="scheme" i], [class*="fund-name" i], [class*="scrip" i], [class*="symbol" i]'
    );
    for (const el of candidates) {
      const text = el.textContent?.trim();
      if (text && text.length >= 2 && text.length <= 80 && !ORDER_BUTTON_HINT.test(text)) return text;
    }
    return null;
  }

  // Text that's clearly NOT the instrument symbol — exchange labels, order
  // tabs/actions, product-type toggles — even though some of these can share
  // a leaf element with the symbol depending on how tightly the markup nests.
  const NON_SYMBOL_TEXT = /^(nse|bse|buy|sell|regular|stop loss|gtt|sip|limit|market|day|intraday|delivery|int|del|b|s)$/i;

  function looksLikePriceOrExchangeText(text) {
    if (/^\s*(nse|bse)\b/i.test(text)) return true; // e.g. "NSE 842.10 ▼ -23.10 (-2.67%)" as one combined node
    if (/[₹%▼▲]/.test(text)) return true;
    if (!/[a-zA-Z]/.test(text)) return true; // pure numeric/punctuation, e.g. "842.10"
    return false;
  }

  function extractFromLeafScan(root) {
    if (!root) return null;
    // Walk leaf elements (no element children) in DOM order — visually, the
    // instrument symbol is reliably the first short, non-numeric,
    // non-exchange-label line at the top of the order ticket (confirmed
    // against real Angel One order-ticket screenshots: "TATATECH"/"TMPV"
    // appear as the very first such line, immediately above the
    // "NSE {price} ▼ ... / BSE {price} ▼" row).
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => (el.children.length === 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    let el;
    while ((el = walker.nextNode())) {
      const text = el.textContent?.trim();
      if (!text || text.length < 2 || text.length > 40) continue;
      if (NON_SYMBOL_TEXT.test(text)) continue;
      if (looksLikePriceOrExchangeText(text)) continue;
      return text;
    }
    return null;
  }

  function extractInstrumentName(root, isMFPage) {
    // Mutual-fund pages: prefer the page's OWN displayed heading over the
    // URL slug — confirmed by real testing that Angel One's slug generator
    // can silently DROP parts of the name (e.g. "SBI Nifty Midcap 150 Index
    // Fund" -> slug "sbi-nifty-midcap--index-fund", the "150" gone entirely,
    // visible as a double-hyphen artifact), which then fails to match
    // anything in the Dive instrument master. The displayed heading is what
    // the user actually sees, so it doesn't have that lossy-encoding
    // problem. The payment widget's own root doesn't contain the fund's
    // name at all (it's in a separate card) — that's what the leaf-scan
    // below would otherwise wrongly pick up unrelated card copy from (e.g.
    // "5.9L people have invested in this fund").
    if (isMFPage) {
      const heading = extractPageHeading();
      if (heading) return heading;
      const fromUrl = extractNameFromMutualFundUrl();
      if (fromUrl) return fromUrl;
    }
    const fromLeafScan = extractFromLeafScan(root);
    if (fromLeafScan) return fromLeafScan;
    return extractInstrumentNameFromTitle();
  }

  function extractInstrumentNameFromTitle() {
    // Weak last resort — Angel One's tab title isn't reliably per-instrument
    // (e.g. plain "Angel One - Portfolio" on a portfolio-page order widget),
    // so background.js additionally cross-checks whatever this returns
    // against the instrument search results before trusting an asset-class
    // match derived from it.
    const titleMatch = document.title.match(/^([A-Za-z0-9&.\- ]{2,40})\s*[-|]/);
    return titleMatch ? titleMatch[1].trim() : null;
  }

  // Indian-market instrument names are almost always self-describing for
  // anything that isn't a plain stock ("Angel One Nifty Total Market ETF",
  // "HDFC Balanced Advantage Fund", "Embassy Office Parks REIT", "Reliance
  // Industries Bonds"...) — checked in this order so more specific terms
  // ("ETF"/"REIT"/"InvIT"/"Bond") win over the generic "Fund", which would
  // otherwise also match "Exchange Traded FUND".
  const ASSET_CLASS_KEYWORDS = [
    [/\bETFs?\b/i, "ETF"],
    [/\bREITs?\b/i, "REIT"],
    [/\bInvITs?\b/i, "INVIT"],
    [/\bBonds?\b/i, "BOND"],
    [/\bFixed Deposits?\b/i, "FD"],
    [/\bMutual Funds?\b/i, "MUTUAL_FUND"],
  ];

  function assetClassFromText(text) {
    for (const [pattern, assetClass] of ASSET_CLASS_KEYWORDS) {
      if (pattern.test(text)) return assetClass;
    }
    return null;
  }

  // A bare ticker symbol ("AONETOTAL") doesn't self-identify its asset class
  // the way the instrument's full descriptive name does — and the Dive
  // instrument master (background.js's resolveInstrument) won't have every
  // Angel One-specific product seeded, so a failed/low-confidence search
  // match there falls back to this hint instead of blindly assuming Equity
  // (which used to be the only fallback, and is wrong for e.g. ETFs the
  // instrument master doesn't recognize).
  function extractAssetClassHint(root) {
    // /mutual-funds/... is unambiguous — no keyword-guessing needed.
    if (isMutualFundPage()) return "MUTUAL_FUND";
    // Angel One's dedicated per-instrument page (e.g. /trade/tradeone/...)
    // typically titles the tab with the full descriptive name, which
    // self-identifies non-equity classes far more reliably than the ticker
    // symbol alone.
    const fromTitle = assetClassFromText(document.title);
    if (fromTitle) return fromTitle;
    // Fall back to a bounded walk up from the order ticket — wide enough to
    // reach a page header sitting just outside the ticket modal (as on the
    // dedicated instrument page, where "AONETOTAL" and "Angel One Nifty
    // Total Market ETF" are siblings just above the order widget), narrow
    // enough to avoid the unrelated watchlist sidebar/global nav.
    let node = root;
    for (let i = 0; i < 15 && node; i++) {
      const hint = assetClassFromText(node.textContent || "");
      if (hint) return hint;
      node = node.parentElement;
    }
    return null;
  }

  function parseNumber(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/[₹,\s]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Deliberate scope decision, not a gap: Divve's Score/diversification
  // model (see backend/src/services/diveScoreService.ts) is built around
  // buy-and-hold ALLOCATION — what share of your money sits in each asset
  // class — not margin/leverage/expiry risk. A futures/commodity lot's
  // notional value bears little relation to the capital actually committed
  // (a single gold lot can be worth ~40x the margin required to hold it), so
  // a "this is already X% of your portfolio" message built on that notional
  // value would be a real, actively misleading framing mismatch — not
  // merely an imprecise one. Detected via the "Lots" field, which is F&O/
  // commodity-specific terminology never used on an equity/ETF/mutual-fund
  // order screen.
  function isDerivativesOrCommodityContract() {
    return !!findInputMatching(LOTS_HINT);
  }

  const AngelOne = {
    id: "angelone",
    matches: () => /(^|\.)angelone\.in$/i.test(location.hostname),

    // Returns { instrumentName, amount, quantity, price, assetClassHint } or
    // null if no order-entry context is currently detectable on the page —
    // including when it's an F&O/commodity contract, which is intentionally
    // out of scope (see isDerivativesOrCommodityContract).
    readOrderState() {
      if (isDerivativesOrCommodityContract()) return null;

      const root = findOrderPanelRoot();
      if (!root) return null;

      const qtyInput = findInputMatching(QTY_HINT);
      const amountInput = findInputMatching(AMOUNT_HINT, { excludeQty: true });
      const priceInput = findInputMatching(PRICE_HINT, { excludeQty: true });

      const quantity = qtyInput ? parseNumber(qtyInput.value) : null;
      const directAmount = amountInput ? parseNumber(amountInput.value) : null;
      const price = priceInput ? parseNumber(priceInput.value) : null;

      let amount = null;
      if (directAmount) amount = directAmount;
      else if (quantity && price) amount = quantity * price;

      if (!amount) return null;

      const instrumentName = extractInstrumentName(root, isMutualFundPage());
      if (!instrumentName) return null;

      return { instrumentName, amount, quantity, price, assetClassHint: extractAssetClassHint(root) };
    },

    // The set of elements whose changes should re-trigger detection —
    // content.js listens on these plus a page-wide MutationObserver fallback
    // for SPA re-renders that swap the input node out entirely.
    watchTargets() {
      return [findInputMatching(QTY_HINT), findInputMatching(AMOUNT_HINT, { excludeQty: true }), findInputMatching(PRICE_HINT, { excludeQty: true })].filter(Boolean);
    },
  };

  NS.adapters = [AngelOne];
  NS.getActiveAdapter = () => NS.adapters.find((a) => a.matches()) || null;
})();
