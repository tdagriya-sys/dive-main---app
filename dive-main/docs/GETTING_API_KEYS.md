# Getting your API keys

This app works right out of the box with **fake/sample data** for a few things, so you can try everything without signing up for anything. This guide is for when you're ready to make those things real. Each section below is completely separate — you can do them in any order, or skip the ones you don't need yet.

Every key goes into one file: `backend/.env`. If that file doesn't exist yet, make a copy of `backend/.env.example` and rename the copy to `.env`.

**Looking for MongoDB setup?** That's covered step-by-step in `docs/SERVER_DEPLOYMENT_GUIDE.md` instead, as part of the full deploy walkthrough — not here.

---

## 1. Email OTP — for real sign-up codes

**What this does today without a key:** when someone signs up, the app makes up a 6-digit code and just shows it to you on the screen (look for "Dev mode — use test OTP"). Nobody actually receives an email yet.

**How to make it send a real email**, using a free service called Resend. Unlike SMS (which needs a government-approved template before anything can send — a multi-day wait), this works the moment you paste in a key — no waiting, no approval:

1. Open a web browser and go to **resend.com**.
2. Look for a button that says **"Sign Up"** or **"Get Started"**, usually top-right. Click it.
3. Sign up with your email and a password (or continue with Google/GitHub), then verify your email if asked.
4. Once you're logged in, look on the left side of the screen for **"API Keys"**. Click it.
5. Click the button that says **"Create API Key"**. Give it any name (e.g. "divve"), leave the permission as the default, and click **"Add"**.
6. Copy the key that appears — it starts with `re_`. You won't be able to see it again after leaving this page.
7. Open the file `backend/.env` on your computer.
8. Find the line `EMAIL_API_KEY=REPLACE_WITH_YOUR_KEY`, delete `REPLACE_WITH_YOUR_KEY`, and paste your key in its place.
9. Save the file and restart the backend server.

You can leave `EMAIL_FROM=` blank for now — it defaults to Resend's own shared address (`onboarding@resend.dev`). **But there's an important catch**: until you verify your own domain (next section), Resend only allows this shared address to deliver to **the one email address you signed up to Resend with** — sending to anyone else fails with an error like *"Please use our testing email address instead of domains like example.com."* This isn't a mistake in your setup, it's a deliberate Resend anti-spam rule for unverified senders. So right now, real OTP emails only work if you sign up in the app using your own Resend account's email — every other signup will safely fall back to the on-screen code (never silently fail).

### Finding GoDaddy's DNS page

Both sections below need you to add DNS records in GoDaddy — here's how to get there, since it isn't always the first thing GoDaddy shows you:

1. Go to **godaddy.com** and log in.
2. Click your account icon (top-right) → **"My Products"**.
3. Find your domain in the list. Look for a **"DNS"** button/link right next to it, or click the **"..."** (three-dot) menu next to the domain and choose **"Manage DNS"**.
4. If GoDaddy instead shows you a setup wizard (offering a website builder, email, etc.) before you can reach this, look for a small **"Skip"** or **"X"** to dismiss it and get to the real dashboard.
5. If your domain was bought in just the last few minutes, GoDaddy can briefly show it as "still setting up" before DNS management becomes available — if so, just wait a few minutes and refresh the page. This is unrelated to whether you have an email set up on the domain; DNS management doesn't require that.

Once you're on the DNS page for your domain, you'll see a list of "records" with an **"Add"** or **"Add New Record"** button — that's where both sections below add their records.

### Optional: get a free professional mailbox on your domain too (Zoho Mail)

This gives you a real inbox like `you@yourdomain.com` instead of a generic Gmail address — Zoho's free plan supports this for up to 5 people. Do this **before** the Resend domain-verification section below, since both touch the same kind of DNS record and doing Zoho first avoids a mix-up (explained at the end).

1. Open a web browser and go to **zoho.com/mail**.
2. Look for a plan called **"Forever Free"** (sometimes shown under "Plans" or "Pricing") and click **"Sign Up Now"** under it.
3. When asked, choose **"Add an existing domain I've already purchased"** and type your domain.
4. Create your Zoho account (email + password, or use an existing Google account).
5. Zoho will first ask you to **prove you own the domain** — it'll show you either a **TXT record** or a **CNAME record** to add. Keep this Zoho page open in one tab.
6. In another tab, open GoDaddy's DNS page (see above), click **"Add"**, choose the matching **Type**, and copy-paste the exact **Name/Host** and **Value** Zoho showed you. Save it.
7. Back in Zoho, click **"Verify"** (this can take a few minutes to work after saving the DNS record).
8. Once verified, Zoho will show you a set of **MX records** (these tell the internet "deliver mail for this domain to Zoho") and usually an **SPF TXT record** too (starts with `v=spf1`). Add each one in GoDaddy the same copy-paste way as step 6.
   > 🔴 **Important:** an SPF record (the one starting `v=spf1`) can only exist ONCE per domain. If you later add Resend's domain verification (next section) and it also gives you an SPF record, do NOT add a second `v=spf1` record — instead EDIT this one so it lists both, e.g. `v=spf1 include:zoho.com include:_spf.resend.com ~all` (copy the exact `include:` values each service actually shows you, this is just an example of the shape).
9. Once Zoho shows everything verified (can take a few minutes to a few hours), go to Zoho's admin panel and create your first mailbox/user, e.g. `you@yourdomain.com`, with its own password.
10. You can now read that mail at **mail.zoho.com**, logging in with that mailbox's email and password.

### Verify your own domain in Resend — so OTP emails work for *any* signup email, not just your own

You already own a domain (from GoDaddy), so you can do this right now — it doesn't depend on having deployed the app yet, it's just DNS records:

1. In Resend, click **"Domains"** in the left-hand menu, then click **"Add Domain"**.
2. Type your domain (e.g. `yourdomain.com`) and click **"Add"**.
3. Resend will show you a list of DNS records to add — usually a couple of **TXT** records (for something called SPF/DKIM — these prove to email providers that you really own the domain and aren't a spammer impersonating it) and an **MX** record. Keep this Resend page open in one browser tab.
4. Open GoDaddy's DNS page (see above). For each record Resend showed you: click **"Add"**, pick the matching **Type**, and copy the **Name/Host** and **Value/Points to** fields **exactly** as Resend displayed them.
   > 🔴 **If you already set up Zoho Mail above and it already added an SPF record (`v=spf1...`)**: don't add a second one for Resend. Instead, find that existing TXT record in GoDaddy, click edit, and add Resend's `include:` value into the same line, right before the `~all` at the end — see the note in step 8 of the Zoho section above for the shape.
5. Save each record. Back in Resend, click **"Verify DNS Records"** (or just wait — Resend also checks periodically on its own). This can take anywhere from a few minutes to a few hours, since DNS changes take time to spread across the internet.
6. Once Resend shows a green **"Verified"** badge next to your domain, open `backend/.env`, set `EMAIL_FROM=Divve <noreply@yourdomain.com>` (use any name before the `@` you like — doesn't need to match a real Zoho mailbox), save, and restart the backend server.

From that point on, real OTP emails will deliver to **any** signup email address, not just your own.

---

## 2. Finvu Account Aggregator sandbox — for real "connect my accounts"

**What this does today without a key:** the "Connect via Account Aggregator" option shows a clearly-labeled "Sandbox mode" banner and fills your portfolio with realistic sample holdings instead of your real ones.

**How to get real sandbox access:**

1. Open a web browser and go to **finvu.in**.
2. Look for a link or button that says **"Contact Us"** or **"Sandbox Access"** — it's usually in the menu at the top of the page.
3. Fill in the form with your name, email, and company/project name (you can write "personal project" if this is just for testing), then click **"Submit"**.
4. Finvu's team will email you back — this can take a few days since a real person has to approve it. Reply to any emails they send asking for more details.
5. Once approved, they'll email you three things: a **Client ID**, a **Client Secret**, and sometimes a **certificate file**. Keep this email safe — don't forward it to anyone.
6. Open the file `backend/.env` on your computer.
7. Find the line `FINVU_CLIENT_ID=REPLACE_ME` and replace `REPLACE_ME` with the Client ID from the email.
8. Find the line `FINVU_CLIENT_SECRET=REPLACE_ME` and replace `REPLACE_ME` with the Client Secret from the email.
9. If they sent you a certificate file, save it somewhere on your computer and put its full file path after `FINVU_CERT_PATH=` on its own line.
10. Save the file and restart the backend server.

---

## 3. AI extraction keys — for Bot Scan and file/screenshot upload

**What this does today without either key:** Bot Scan and uploading a screenshot or PDF need at least one of these two keys to work at all — without either, both return a clear "not configured" message instead of guessing. (CSV/XLSX/JSON uploads don't need this — they're parsed directly since there's no ambiguity in structured data.) This is what actually reads your screenshots/documents: it finds every real holding, filters out watchlists/indices/summary cards, sorts each one into the right asset class, and figures out whether a repeated instrument is the same holding seen twice or a genuinely separate holding in a different account.

There are two keys because there are two providers, used in a **primary + fallback** order — you don't have to set up both, but setting up both is the most reliable option:

- **`OPENAI_API_KEY` (OpenAI, model GPT-5.6 Terra) — PRIMARY.** Every scan/upload tries this one first.
- **`ANTHROPIC_API_KEY` (Claude Sonnet 5) — FALLBACK.** If the OpenAI call fails for any reason (outage, rate limit, timeout, an unreadable response), the app automatically retries the same scan/upload with Claude instead — the user never sees the OpenAI failure, they just get a result (possibly a few seconds slower on that one retry). If `OPENAI_API_KEY` is left blank, every scan/upload goes straight to Claude instead, and it behaves as the only engine.

Set up section 3a below at minimum; add 3b too if you want the automatic fallback.

### 3a. OpenAI API key (primary)

1. Open a web browser and go to **platform.openai.com**.
2. Sign up or log in.
3. Click your account/organization name (top-right), then **"API keys"** in the menu (or go directly to **platform.openai.com/api-keys**).
4. Click the button that says **"Create new secret key"**, give it any name like "dive-dev", and click **"Create secret key"**.
5. Copy the key that appears — it starts with `sk-`. You won't be able to see it again after leaving this page.
6. Open the file `backend/.env` on your computer.
7. Find the line `OPENAI_API_KEY=REPLACE_WITH_YOUR_KEY`, delete `REPLACE_WITH_YOUR_KEY`, and paste your key in its place.
8. Save the file and restart the backend server.

You'll need a small amount of prepaid credit on the OpenAI account for this to work (a few dollars covers a lot of scans/uploads) — add it under **"Billing"** in the same platform dashboard. The app calls the `gpt-5.6-terra` model specifically; if your account doesn't yet have access to it, the OpenAI call will fail and every request will silently fall back to Claude (3b) instead — set up 3b too so this doesn't leave you stuck.

### 3b. Claude (Anthropic) API key (fallback)

1. Open a web browser and go to **console.anthropic.com**.
2. Sign up or log in.
3. On the left-hand menu, click **"API Keys"**.
4. Click the button that says **"Create Key"**, give it any name like "dive-dev", and click **"Create"**.
5. Copy the key that appears — it starts with `sk-ant-`. You won't be able to see it again after leaving this page.
6. Open the file `backend/.env` on your computer.
7. Find the line `ANTHROPIC_API_KEY=REPLACE_WITH_YOUR_KEY`, delete `REPLACE_WITH_YOUR_KEY`, and paste your key in its place.
8. Save the file and restart the backend server.

You'll need a small amount of prepaid credit on the Anthropic account for this to work (a few dollars covers a lot of scans/uploads) — add it under **"Billing"** on the same console.

---

## 4. Crypto / market price data — optional, for live prices

**What this does today without a key:** the instrument list for cryptocurrencies (Bitcoin, Ethereum, etc.) already updates every morning automatically using a free service called CoinGecko — no key needed for that. This section is only if you later want real-time price lookups elsewhere in the app.

**How to get a CoinGecko key** (for higher rate limits / real-time prices):

1. Open a web browser and go to **coingecko.com/en/api/pricing**.
2. Pick a plan — there's usually a free-forever option near the top, look for a button that says **"Get Started"** under it.
3. Create an account with your email and a password when asked.
4. After signing up, look for a menu item called **"Developer Dashboard"** (sometimes under your account picture, top-right of the page).
5. Click the button that says **"+ Add New Key"** or **"Create API Key"**.
6. Copy the key that appears on the screen.
7. Open the file `backend/.env` on your computer.
8. Find the line `CRYPTO_PRICE_API_KEY=REPLACE_WITH_YOUR_KEY`, delete `REPLACE_WITH_YOUR_KEY`, and paste your key in its place.
9. Save the file and restart the backend server.

---

## Quick reference: which line goes where

| Service | Line in `backend/.env` |
|---|---|
| Email/OTP provider | `EMAIL_API_KEY=...` (optional: `EMAIL_FROM=...`) |
| Finvu Account Aggregator | `FINVU_CLIENT_ID=...`, `FINVU_CLIENT_SECRET=...`, `FINVU_CERT_PATH=...` |
| OpenAI GPT-5.6 Terra — PRIMARY (Bot Scan + file/screenshot upload) | `OPENAI_API_KEY=...` |
| Claude Sonnet 5 — FALLBACK (Bot Scan + file/screenshot upload) | `ANTHROPIC_API_KEY=...` |
| Crypto/market data (optional) | `CRYPTO_PRICE_API_KEY=...` |

After changing anything in `backend/.env`, stop the backend server (close its terminal window or press `Ctrl+C`) and start it again so it picks up the new values.
