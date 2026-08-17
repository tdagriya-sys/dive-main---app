// Site-specific DOM heuristics live here, isolated from the generic
// observe/orchestrate logic in content.js. Broker web UIs (Angel One, Groww,
// ...) are React/Svelte SPAs with hashed/generated CSS class names, which
// makes hardcoded selectors ("div.jss482") brittle across deploys — so
// detection is LABEL- and ROLE-based (aria-label/placeholder/name text,
// nearby heading text) rather than exact selectors, which tends to survive a
// CSS rebuild even when it can't survive a full redesign.
//
// IMPORTANT: every adapter here was built without a live, logged-in
// brokerage session (an automated agent should never authenticate into a
// real trading account). Everything was tuned iteratively against real DOM
// dumps a human collected and pasted back — not guessed blind. If detection
// doesn't fire on a real order window for a broker already listed below,
// open DevTools on the actual order ticket and adjust that broker's
// section; see extension/README.md.
//
// Below is split into: (1) generic, broker-agnostic helpers — proven across
// multiple real Angel One page layouts (inline watchlist widget, dedicated
// instrument page, mutual-fund one-time/SIP pages), so a reasonable first
// try for a brand-new broker too — followed by (2) each broker's own
// adapter object, which may layer broker-specific logic (e.g. Angel One's
// mutual-fund URL parsing) on top of the generic helpers.
//
// Loaded as a plain (non-module) content script — exposes itself via the
// shared `self.DiveBotCS` namespace so content.js and overlay.js (loaded
// after this file, same isolated world) can use it.
(function () {
  const NS = (self.DiveBotCS = self.DiveBotCS || {});

  // ======================== Generic, broker-agnostic ========================

  // Plain case-insensitive substring — NO word boundaries at all, on
  // either side. Real ids embed these words anywhere in a camelCase
  // identifier, confirmed on two different brokers now: Angel One puts them
  // at the START ("amountInput", "quantityOrderPad" — a leading \b alone
  // would've been enough), but Groww's price field is "limitPriceInput" —
  // "Price" sits in the MIDDLE, with no boundary on either side ("t" before
  // it, "I" after, both letters) — so even a leading-only \b silently
  // rejects it. "shares?" covers Groww's quantity field too, which is
  // simply id="inputShare" — different vocabulary than "qty"/"quantity"
  // entirely, not a boundary issue.
  const QTY_HINT = /qty|quantity|units?|shares?/i;
  // "rate" deliberately excluded now that there's no boundary requirement —
  // as an unbounded substring it would match common unrelated words
  // ("Corporate", "Separate", "Moderate"). "price"/"ltp" alone are
  // distinctive enough without it.
  const PRICE_HINT = /price|ltp/i;
  const AMOUNT_HINT = /amount/i;
  // "Lots" (as in "1 Lot = 1KGS") is F&O/commodity-contract terminology,
  // never used on an equity/ETF/mutual-fund order screen — a deliberate,
  // reliable signal that this is a margin-leveraged derivatives position,
  // not a plain allocation purchase. See isDerivativesOrCommodityContract().
  const LOTS_HINT = /lots?/i;
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

  // A Market order (as opposed to Limit) has no fixed price to read — the
  // price field shows non-numeric text instead ("At market" on Groww;
  // likely similar on other brokers) since it executes at whatever the
  // current price is when the order fills. Confirmed by real testing: this
  // silently broke detection entirely (quantity × price needs a real price)
  // on a Market-order screen, which is the common case for most retail
  // trades, not an edge case. Falls back to the LTP/current-price figure
  // that's always shown somewhere in the ticket header regardless of order
  // type — searches root's own text for the first ₹-prefixed number, safe
  // because root is already tightly scoped to just this order ticket (see
  // findOrderPanelRoot), so it won't accidentally pick up an unrelated
  // price elsewhere on the page.
  function findMarketPriceInRoot(root) {
    if (!root) return null;
    const match = (root.textContent || "").match(/₹\s?([\d,]+(?:\.\d+)?)/);
    return match ? match[1] : null;
  }

  // "/mutual-funds/..." turns out to be shared convention, not an Angel
  // One-specific one — Groww uses it too (groww.in/mutual-funds/parag-
  // parikh-flexi-cap-fund-regular-growth). Not guaranteed for every future
  // broker, but reasonable as a starting generic check.
  function isMutualFundPage() {
    return /\/mutual-funds\//i.test(location.pathname);
  }

  // Some brokers' amount field carries NO identifying label at all (empty
  // id/aria-label/placeholder/name) — confirmed on Groww's mutual-fund SIP
  // page. .value reads correctly there once actually typed into (verified
  // live), so the fix isn't reading display text instead (tried that first —
  // wrong, it picked up an unrelated NAV/price figure elsewhere on the page
  // rather than the actual amount) — it's finding the field a different way:
  // when a page has exactly ONE visible text/number input, it's reasonable
  // to assume that's the page's one purpose-built entry field.
  function findSoleVisibleNumericInput() {
    const candidates = Array.from(document.querySelectorAll("input")).filter((input) => {
      if (!isVisible(input)) return false;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      return ["number", "text", "tel", "search"].includes(type);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  // ============================== Angel One ==============================

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
    // Weak last resort — tab titles aren't reliably per-instrument (e.g.
    // plain "Angel One - Portfolio" on a portfolio-page order widget), so
    // background.js additionally cross-checks whatever this returns against
    // the instrument search results before trusting an asset-class match
    // derived from it. Comma added as a terminator alongside dash/pipe —
    // Groww's stock-page titles use it before any dash ("SGBDEC31 Share
    // Price, Stock, ... - Groww"), which the dash-only version missed
    // entirely. Dash deliberately NOT in the capture character class (only
    // as a terminator) — every real title seen has the instrument name
    // BEFORE the first separator, never containing one itself; keeping dash
    // in both roles let the greedy match swallow past a real separator
    // ("Fund Growth - NAV, ...") before backtracking found the wrong one.
    const titleMatch = document.title.match(/^([A-Za-z0-9&. ]{2,40})\s*[-|,]/);
    return titleMatch ? titleMatch[1].trim() : null;
  }

  // Indian-market instrument names are almost always self-describing for
  // anything that isn't a plain stock ("Angel One Nifty Total Market ETF",
  // "HDFC Balanced Advantage Fund", "Embassy Office Parks REIT", "Reliance
  // Industries Bonds"...) — checked in this order so more specific terms
  // ("ETF"/"REIT"/"InvIT"/"Bond") win over the generic "Fund", which would
  // otherwise also match "Exchange Traded FUND". Sovereign Gold Bond
  // tickers are the one exception that ISN'T self-describing this way — the
  // symbol alone ("SGBSEP27", "SGBDE31III") contains no matchable keyword —
  // but they reliably start with the "SGB" prefix on NSE/BSE, confirmed
  // across four real tickers this session (SGBSEP27, SGBDE31III,
  // SGBFEB32IV, SGBDEC31). Classified GOLD rather than BOND deliberately:
  // an SGB's value tracks the gold price directly, so GOLD reflects its
  // real economic exposure for diversification purposes — the same
  // principle the backend's own live instrument refresh already applies to
  // gold ETFs like GOLDBEES (see instrumentSources.ts's fetchNseEtfs,
  // which reclassifies those from ETF to GOLD).
  const ASSET_CLASS_KEYWORDS = [
    [/^SGB[A-Z0-9]*$/i, "GOLD"],
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
  // broker-specific product seeded, so a failed/low-confidence search match
  // there falls back to this hint instead of blindly assuming Equity (which
  // used to be the only fallback, and is wrong for e.g. ETFs the instrument
  // master doesn't recognize). Generic/broker-agnostic — a broker's own
  // wrapper (see Angel One's extractAssetClassHint below) can check for
  // unambiguous broker-specific signals (like a URL pattern) first.
  //
  // Deliberately checks ONLY the tab title and the instrument name already
  // extracted for this trade — NOT a broad ancestor-textContent walk, which
  // an earlier version of this function did. That was confirmed wrong by
  // real testing: on a watchlist page with an open search dropdown showing
  // an unrelated recent search ("BHARAT BOND ETF"), the walk swept that
  // sibling UI's text in and mislabeled a Sovereign Gold Bond ("SGBSEP27",
  // which self-identifies as nothing — correctly yields no hint here) as an
  // ETF. Checking only text actually tied to THIS instrument (its own name,
  // its own tab title) can't pick up an unrelated dropdown's contents the
  // way scanning arbitrary nearby page structure can.
  function assetClassHintFromPageText(instrumentName) {
    const fromTitle = assetClassFromText(document.title);
    if (fromTitle) return fromTitle;
    return assetClassFromText(instrumentName || "");
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

  // Angel One's own wrapper: /mutual-funds/... is unambiguous, no
  // keyword-guessing needed, so check that first before falling back to the
  // generic page-text scan.
  function extractAssetClassHint(instrumentName) {
    if (isMutualFundPage()) return "MUTUAL_FUND";
    return assetClassHintFromPageText(instrumentName);
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
      else if (quantity && !price) {
        // Price field wasn't numeric — likely a Market order (see
        // findMarketPriceInRoot) — fall back to the ticket's own displayed
        // current price.
        const marketPrice = parseNumber(findMarketPriceInRoot(root));
        if (marketPrice) amount = quantity * marketPrice;
      }

      if (!amount) return null;

      const instrumentName = extractInstrumentName(root, isMutualFundPage());
      if (!instrumentName) return null;

      return { instrumentName, amount, quantity, price, assetClassHint: extractAssetClassHint(instrumentName) };
    },

    // The set of elements whose changes should re-trigger detection —
    // content.js listens on these plus a page-wide MutationObserver fallback
    // for SPA re-renders that swap the input node out entirely.
    watchTargets() {
      return [findInputMatching(QTY_HINT), findInputMatching(AMOUNT_HINT, { excludeQty: true }), findInputMatching(PRICE_HINT, { excludeQty: true })].filter(Boolean);
    },
  };

  // ================================ Groww =================================
  //
  // Equity/ETF path was validated against a real Groww session (id="inputShare"
  // for quantity, id="limitPriceInput" for price — confirmed via live DOM
  // dumps, same iterative process Angel One went through). The mutual-fund
  // path was ALSO validated against a real Groww SIP page and turned out
  // structurally different enough to need its own handling: the amount
  // <input> there has no identifying label at all (empty id/aria-label/
  // placeholder/name) and its .value stays empty even with an amount
  // visibly entered — the "₹10,000" shown is display text, not the input's
  // real value — so findDisplayedAmountText() reads it directly instead.
  const Groww = {
    id: "groww",
    matches: () => /(^|\.)groww\.in$/i.test(location.hostname),

    readOrderState() {
      if (isDerivativesOrCommodityContract()) return null;

      if (isMutualFundPage()) {
        const soleInput = findSoleVisibleNumericInput();
        const amount = soleInput ? parseNumber(soleInput.value) : null;
        if (!amount) return null;
        const instrumentName = extractInstrumentNameFromTitle() || extractPageHeading();
        if (!instrumentName) return null;
        return { instrumentName, amount, quantity: null, price: null, assetClassHint: "MUTUAL_FUND" };
      }

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
      else if (quantity && !price) {
        // Price field wasn't numeric — likely a Market order (see
        // findMarketPriceInRoot) — fall back to the ticket's own displayed
        // current price.
        const marketPrice = parseNumber(findMarketPriceInRoot(root));
        if (marketPrice) amount = quantity * marketPrice;
      }

      if (!amount) return null;

      // extractPageHeading() searches the WHOLE document for h1/h2/heading-
      // like elements — confirmed too broad by real testing: on a Groww
      // stock page it picked up an unrelated promo banner ("Effortless tax
      // filing with Cleartax") instead of the instrument name. Angel One's
      // equity path never had this problem because it goes straight to the
      // order-ticket-scoped leaf-scan; matching that safer order here too —
      // extractPageHeading() only stays as the last-resort fallback.
      const instrumentName = extractFromLeafScan(root) || extractInstrumentNameFromTitle() || extractPageHeading();
      if (!instrumentName) return null;

      return { instrumentName, amount, quantity, price, assetClassHint: assetClassHintFromPageText(instrumentName) };
    },

    watchTargets() {
      if (isMutualFundPage()) return [findSoleVisibleNumericInput()].filter(Boolean);
      return [findInputMatching(QTY_HINT), findInputMatching(AMOUNT_HINT, { excludeQty: true }), findInputMatching(PRICE_HINT, { excludeQty: true })].filter(Boolean);
    },
  };

  NS.adapters = [AngelOne, Groww];
  NS.getActiveAdapter = () => NS.adapters.find((a) => a.matches()) || null;
})();
