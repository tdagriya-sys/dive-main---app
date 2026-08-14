# Divve Bot extension

A standalone Chrome (Manifest V3) extension. It watches Angel One's web app
(`angelone.in` — any path: `/trade/portfolio/...`, `/trade/markets/...`,
wherever an order ticket can be opened) and, whenever you're filling in a
quantity or amount, pops up a "Divve Bot" card estimating whether that trade
is a good fit for your portfolio — same idea as `frontend/src/screens/
DiveBot.jsx`'s in-app demo, but as a real overlay on a real brokerage site.
Detection is DOM-based, not tied to any specific URL/page — it looks for the
order-ticket structure (quantity/price fields next to the NSE/BSE exchange
selector) wherever it shows up on the site, including inline order widgets
opened from a portfolio or watchlist page rather than a dedicated order page.

**This folder is fully standalone.** Nothing in `frontend/` or `backend/`
imports from it, and nothing here modifies an existing file — it only reads
from the existing REST API (`/auth/login`, `/auth/me`, `/holdings`,
`/score/breakdown`, `/instruments/search`), all unchanged. See "Design notes"
below for why no backend changes were needed.

## Install (unpacked, for development)

1. Make sure the Dive backend is running (`backend/`, default `http://localhost:8000`).
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. **Load unpacked** → select this `extension/` folder.
4. Click the Divve Bot icon in the toolbar and log in with your Dive account
   (email/mobile + password — the same credentials as the web app).
5. Open an order/buy widget anywhere on `angelone.in`, start typing a
   quantity or amount. The card appears bottom-right within ~1 second of you
   pausing.

If your backend isn't on `localhost:8000`, open the extension popup →
**Advanced: API server** and enter the full base URL (e.g.
`https://api.yourdomain.com/api`). You'll get a one-time Chrome permission
prompt for that host — that's expected, it's how a Manifest V3 extension is
allowed to talk to a server not already listed in `manifest.json`.

## How it decides what message to show

`shared/fitMessage.js` is the decision matrix, checked in this order:

0. **F&O / commodity futures contracts (a "Lots" field, margin requirements,
   expiry dates) → intentionally no card at all.** Divve's Score model is
   built around buy-and-hold allocation, not leveraged derivatives — a lot's
   notional value bears little relation to the capital actually committed
   (margin), so a diversification-fit message here would be a real framing
   mismatch, not just an imprecise one. See `isDerivativesOrCommodityContract`
   in `content/siteAdapters.js`.
1. **Already heavily concentrated in this exact instrument** → warning.
2. **Would push this exact instrument's exposure too high** → warning.
3. **Asset class already above your ideal range** (per your risk profile,
   same bands as `frontend/src/lib/diveEngine.js`'s `IDEAL_RANGES`) →
   warning.
4. **Brand-new asset class you don't hold at all yet** → appreciation.
5. Otherwise, the general case, from the projected before/after Divve Score
   and apparent/real diversification:
   - Apparent diversification rises but real doesn't → "looks diversified,
     isn't really" caution (likely hidden issuer overlap).
   - Score and both diversification measures rise → strongest appreciation.
   - Only score rises, or only diversification rises (score flat) → mild
     positive.
   - Everything flat → neutral.
   - Anything falling → discouraged.

The before/after numbers themselves are computed the same way
`frontend/src/screens/AskDive.jsx`'s existing `FitForYouCard` already does
for its "Fit for you" slider: anchor on your real, canonical Divve Score
(`GET /api/score/breakdown`) and apply the fast client-side concentration
formula's *estimated delta* on top — never a second, disagreeing absolute
score. `shared/diveEngine.js` is a ported copy of the relevant pure functions
from `frontend/src/lib/diveEngine.js` (not an import — this is a separate
build target). If those formulas ever change in the frontend, mirror the
change here too.

## Design notes / why no backend or frontend changes were needed

- **Auth**: `POST /api/auth/login` already returns the access token in the
  JSON response body (not just a cookie), so the extension's popup can log
  in independently and store the token in `chrome.storage.local`.
- **CORS**: all Dive API calls happen from the background service worker
  (`background/background.js`), never from the content script. An MV3
  service worker's fetches are governed by the extension's declared
  `host_permissions`, not the target server's CORS policy — so no CORS
  config change on the backend was required.
- **Scoring math**: rather than duplicating `backend/src/services/
  diveScoreService.ts`'s full resilience model (volatility/drawdown/VaR/
  correlation — ~10 sub-scores, not designed to run over a hypothetical,
  unsaved holding), this extension uses the same lightweight
  "hypothetical-delta" pattern already built for exactly this purpose in
  `AskDive.jsx`'s `FitForYouCard`.

## Known limitations / things to verify against a real Angel One session

I built the Angel One DOM detection (`content/siteAdapters.js`) using
label/role-based heuristics rather than hardcoded CSS selectors, because
Angel One's web app generates hashed class names on every build — and its
`/mutual-funds/` section turned out to be a genuinely different frontend
build (Svelte-hashed classes) from the `/trade/` terminal (Tailwind-style
utility classes), so the two get somewhat different handling in places.
**I did not log into a real Angel One account to inspect the live order
form** — that would mean entering trading credentials on your behalf, which
this assistant won't do. Everything here was tuned iteratively against real
DOM dumps the user collected and pasted back, not guessed blind. So:

- Root-scoping (`findOrderPanelRoot`) doesn't anchor on specific wording —
  it walks up from the quantity/amount input and stops right before the
  surrounding text size jumps from "one widget" to "whole page" (confirmed
  more reliable than a keyword anchor: "NSE" turned out not to be real text
  anywhere on the page at all, just an icon).
- Field detection (`QTY_HINT`/`PRICE_HINT`/`AMOUNT_HINT`/`LOTS_HINT`) matches
  camelCase ids like `amountInput` (leading word-boundary only, no trailing
  one — a trailing boundary would reject "amount" inside "amountInput"
  entirely, which was a real bug caught mid-session).
- Instrument-name extraction tries several sources depending on page type
  (mutual-fund page heading, mutual-fund URL slug, in-widget leaf-text scan,
  browser tab title, in that order) — if it's picking up the wrong text on a
  page type not covered yet, open DevTools on the real element and adjust
  `extractInstrumentName()`/`extractPageHeading()`.
- If the card never appears at all on some order screen, first check
  whether it's simply out of scope (F&O/commodity, see above); if not, the
  most likely culprit is `findInputMatching` not recognizing that page's
  field labels — inspect the actual input's `id`/`aria-label`/`placeholder`
  and extend the relevant `*_HINT` regex.
- Only Angel One is wired up. Adding another broker is a matter of adding
  another adapter object to `content/siteAdapters.js`'s `adapters` array and
  its origin to `manifest.json`'s `matches`/`host_permissions`.

## Privacy

- Your Dive access token is stored only in this extension's isolated
  `chrome.storage.local` — never in the page, never visible to
  Angel One or any other site.
- The only data sent to the Dive backend is the instrument name/amount you
  typed (to look up the instrument and compute the fit verdict) plus your
  existing auth token. Nothing is sent to Angel One or any third party.
