# Setting up Razorpay — for the paid resilience score report

This is the "get and set up the API" walkthrough for the **Rs. 99 resilience score PDF download** — the only paid feature in the app today. It's a bigger topic than the one-key setups in `docs/GETTING_API_KEYS.md` (there's a real business/banking step involved, not just "click create key"), so it gets its own guide.

**What this does today without any setup:** clicking the download button still works exactly like a real payment would — it just runs in a clearly-labeled **"Dev Mode"** that skips Razorpay entirely and simulates a successful payment when you click a "Simulate payment" button. No real money, no real Razorpay account needed to keep developing or testing. Nothing here is required until you're ready to actually charge people.

---

## 0. Decide: reuse your existing Razorpay key, or create a separate account

You already have a Razorpay account for a different product. **Reusing that same account's API key for Divve is a completely reasonable, common choice** — the code doesn't care which key it's pointed at, and you don't need a second account just to tell the two products' payments apart later:

> 🔵 **How you'll actually separate them (not by price):** every real order Divve creates is tagged with `notes: { purpose: "SCORE_REPORT_PDF" }` (see `backend/src/services/paymentService.ts`) — a label baked into the payment itself, not something you have to infer from the amount. Razorpay's Dashboard lets you search Payments by note content, and any CSV export includes a Notes column — so filtering "just Divve's transactions" in Excel later means filtering that column for `SCORE_REPORT_PDF`, not guessing from ₹99 (which breaks the moment either product's price ever changes or overlaps). Section 2 below shows exactly where to find this in the Dashboard.

What sharing one account genuinely does — worth knowing before you commit, not reasons to avoid it, just the honest tradeoffs:

- **Money settles together.** Both products' payments land in the same bank account on the same schedule. You can still get a clean "Divve-only" figure any time via the notes filter above — it's Razorpay's own dashboard, not your bank statement, that stays combined.
- **One leaked credential affects both products.** If the Key Secret ever leaks, both are exposed, not just one — same as any shared password.
- **Webhooks are account-wide** — see §4 below for why this specifically isn't a problem for Divve's own code, and how to still keep the two products' webhook deliveries pointed at different places if you want that.
- **Harder to unwind later** if you ever want the two treated as separate legal/financial entities (different GST registration, selling one, bringing in an investor on just one). Not a concern for most personal/side-project setups.

If none of that gives you pause, skip straight to **§1**. If you'd rather have Divve fully, unambiguously separate regardless (a different login, different settlement, zero shared blast radius) — for example because you might sell or spin off one of these products later — see **Appendix A** at the end instead, then come back to §2 onward once you have that separate account's keys.

---

## 1. Get your API keys

1. Log into your (existing) Razorpay Dashboard.
2. Make sure the **Test Mode / Live Mode** toggle (top-left) is set to whichever one you want keys for — they're separate pairs. If your account is already activated and live for your other product, you likely already have a Live Mode pair; Test Mode is worth grabbing too so you can try Divve's flow without real money first (§3).
3. Go to **Settings** (usually bottom-left) → **API Keys**.
4. If you already have a key pair for your other product, you can reuse it as-is — just copy the existing **Key Id** and, if you still have it saved somewhere from when you first generated it, the **Key Secret**. If you don't have the Key Secret saved anywhere (Razorpay only ever shows it once, at creation), click **"Regenerate"** — this invalidates the old secret everywhere it's used (including your other product), so update it there too if you do this.
5. If this account has no key pair yet at all, click **"Generate Test Key"** (or **"Generate Live Key"**) instead. Razorpay shows you two values:
   - **Key Id** — starts with `rzp_test_` (Test Mode) or `rzp_live_` (Live Mode).
   - **Key Secret** — a longer random string. **Copy this now — Razorpay only shows it once.**
6. Open the file `backend/.env` on your computer.
7. Find `RAZORPAY_KEY_ID=REPLACE_WITH_YOUR_KEY` and replace `REPLACE_WITH_YOUR_KEY` with the Key Id from above.
8. Find `RAZORPAY_KEY_SECRET=REPLACE_WITH_YOUR_KEY` and replace it with the Key Secret.
9. Save the file and restart the backend server.

That's the minimum to take the download out of Dev Mode. The next sections (§3 testing, §4 webhook) are optional but worth doing before you rely on this for real money.

---

## 2. Finding Divve's payments among your other product's

Once you've taken a few real (or Test Mode) payments through Divve sharing your existing account, here's where the `purpose: "SCORE_REPORT_PDF"` tag from §0 actually shows up:

- **In the Dashboard**: go to **Payments** (or **Transactions**), and use the search box — searching `SCORE_REPORT_PDF` surfaces just Divve's orders, regardless of what either product charges. Razorpay's exact search/filter UI shifts a little between dashboard versions, so if a plain search doesn't work, look for a **"Notes"** filter option instead, or click into an individual payment — its detail view always shows the full notes object you can eyeball to confirm it's a Divve one.
- **In a CSV export**: **Payments → Export** (or **Reports** in some dashboard versions) includes every order's notes as columns. Once opened in Excel, filter/sort on that Notes (or `purpose`) column for `SCORE_REPORT_PDF` — this is the manual-Excel-separation step you were picturing, just keyed on a label instead of price, so it can never accidentally lump in an unrelated order that happens to cost the same amount.

---

## 3. Test it end-to-end (Test Mode)

With Test Mode keys set (§1, using `rzp_test_...`), click the "Download Resilience Score Report" button in the real running app. A real Razorpay Checkout popup should open (instead of the Dev Mode banner). Use one of Razorpay's official test values instead of a real card — none of these charge anything, they're specifically for this:

- **Test card**: Card number `4111 1111 1111 1111`, any future expiry date (e.g. `12/28`), any 3-digit CVV, and any name.
- **Test UPI**: use the UPI ID `success@razorpay` to simulate a successful payment, or `failure@razorpay` to simulate a declined one (useful for checking Divve's own error message shows up correctly).
- Full up-to-date list, including test numbers for netbanking/wallets: search **"Razorpay test card details"** on razorpay.com's own docs site — these values occasionally change, so that page is more reliable than a fixed number pasted into this guide.

A successful test payment should immediately download the PDF, exactly like Dev Mode did, just via a real (test-mode) Razorpay transaction you can also see logged in your Dashboard under **Payments** — with its `SCORE_REPORT_PDF` note, per §2.

---

## 4. Set up the webhook (optional, but recommended before going live)

**What this does:** the primary way Divve knows a payment succeeded is the browser telling it right after Razorpay's popup closes. That's reliable almost all the time — but if someone's payment goes through and then they close the tab / lose their connection in that exact instant before the browser can report back, Divve would never find out, even though they were charged. A webhook is Razorpay itself calling your server directly to say "this payment succeeded," as a backup that doesn't depend on the user's browser still being there.

> 🔵 **Sharing one account is fine here too.** Razorpay lets you register multiple webhook endpoints on the same account, each pointing at a different URL — so Divve can have its own webhook (below) completely independent of whatever webhook your other product already has, if any. Divve's own handler (`paymentController.ts`'s `razorpayWebhook`) also safely ignores any event that isn't one of Divve's own orders — even if you *did* accidentally point your other product's webhook traffic here too, it would just be quietly skipped, never mistaken for a real Divve payment.

1. In your Razorpay Dashboard, go to **Settings → Webhooks**.
2. Click **"Add New Webhook"**.
3. For **Webhook URL**, enter your real, deployed backend's address plus `/api/payments/webhook` — for example `https://yourdomain.com/api/payments/webhook` (this only works once your backend is actually deployed and reachable from the internet; see `docs/SERVER_DEPLOYMENT_GUIDE.md` if you haven't done that yet — a webhook pointed at `localhost` can't work, since Razorpay's servers can't reach your computer).
4. Under **Active Events**, check **`payment.captured`** (that's the only one Divve currently listens for — leave the rest unchecked).
5. Razorpay will show you a **Webhook Secret** — click **"Create Webhook"** first if it's not shown yet, then copy the secret it generates. This is a *different* value from your Key Secret in §1 — don't mix them up.
6. Open `backend/.env`, find `RAZORPAY_WEBHOOK_SECRET=`, and paste the secret after the `=`.
7. Save the file and restart the backend server.

You can set this up for Test Mode too (Razorpay's test webhooks fire for test payments) if you want to confirm it's working before going live — just make sure you're looking at the Webhooks page while the Test/Live toggle matches whichever key pair you're currently testing.

---

## 5. Going live — the actual switch

If your account is already activated for Live Mode from your other product, there's no separate approval step to redo — Razorpay activation is account-wide, not per-product. Just:

1. Make sure `backend/.env` has your **Live Mode** `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (`rzp_live_...`, not `rzp_test_...`) on your real deployed server specifically — not just your local dev machine.
2. Make one real, small test purchase yourself (your own card, the real Rs. 99) to confirm the whole flow works with real money before telling anyone else the feature is live.
3. That's it — from that point on, every "Download Resilience Score Report" click on your deployed site charges a real Rs. 99, settling to the same bank account and schedule your other product already uses (check **Settings → Settlements** in your dashboard if you're not sure what that schedule is).

If your account has never been activated for real payments before (neither product has taken real money yet), see **Appendix A**'s activation step first — it's the same one-time process regardless of how many products end up using the account afterward.

---

## Changing the price

The Rs. 99 price (and the Rs. 299 struck-through "was" price shown on the button) aren't the same thing — the button's copy is just marketing text in `frontend/src/lib/useDownloadReport.js`, edited directly in code. The actual amount charged is `REPORT_PRICE_PAISE` in `backend/.env` (in paise — 100 paise = Rs. 1, so Rs. 99 is `9900`). If you change the real price, remember to update both: the `REPORT_PRICE_PAISE` number here, and the button's own displayed text in that file, so they don't drift out of sync.

---

## Quick reference: which line goes where

| What | Line in `backend/.env` |
|---|---|
| Key Id (Test or Live, matching Key Secret below) | `RAZORPAY_KEY_ID=...` |
| Key Secret | `RAZORPAY_KEY_SECRET=...` |
| Webhook secret (optional — §4) | `RAZORPAY_WEBHOOK_SECRET=...` |
| Report price, in paise | `REPORT_PRICE_PAISE=9900` |

While `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are left as placeholders, the download runs in Dev Mode (a clearly-labeled "simulate payment" button, no real Razorpay call) — see `backend/src/services/paymentService.ts`. Every real order carries a `SCORE_REPORT_PDF` note (§0/§2) so it stays identifiable no matter which account it runs through.

After changing anything in `backend/.env`, stop the backend server (close its terminal window or press `Ctrl+C`) and start it again so it picks up the new values.

---

## Appendix A: Creating a fully separate account instead

Only needed if you decided against §0's recommendation and want Divve on its own, unambiguous Razorpay account — its own dashboard, its own login, its own settlement, zero shared blast radius with your other product.

1. Open a web browser and go to **razorpay.com**.
2. Click **"Sign Up"** (top-right).
3. Use a *different email address* than your other product's account — a free Gmail alias like `yourname+divve@gmail.com` works fine if you don't want a whole new inbox, Razorpay treats it as a distinct email. Add a password and click **"Create Account"**.
4. Check that inbox and click the verification link Razorpay sends you.
5. You'll land on a short setup questionnaire (business name, what you're building, etc.) — answer honestly; "Divve" and "SaaS/subscription" or "Digital products" is a reasonable fit. This doesn't lock you into anything and can be edited later. You're allowed to reuse the **same PAN and bank account** as your other business here if you want the money to land in the same place — Razorpay doesn't require different business documents per account, just a different login.
6. **You can stop right here and use this new account for §1 onward** — Razorpay gives every new account Test Mode access immediately, no waiting, no bank details, no KYC. Test Mode keys work identically to Live Mode from the app's point of view, just without real money.
7. When you're ready to accept real payments on this new account: log in, look for a banner/button that says **"Activate Account"** (top of the dashboard, or under **Account & Settings**), and provide your PAN, bank account (account number + IFSC), a description of what you're selling, your website URL, and one supporting document (PAN card image, GST certificate if you have one, or a cancelled cheque/bank statement). Razorpay reviews this manually — typically a few hours to 2-3 business days, by email once approved. Once approved, the Test/Live toggle lets you actually switch into Live Mode and generate Live keys.

From here, every other section of this guide (§1's "grab your key" step, §2 onward) works exactly the same against this new account — you're just looking at a different dashboard.
