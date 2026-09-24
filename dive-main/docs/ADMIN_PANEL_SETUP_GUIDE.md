# Divve Admin Panel — Setup Guide (Tasks For The Account Owner)

Companion to [`ADMIN_PANEL_PLAN.md`](./ADMIN_PANEL_PLAN.md). This lists **everything that has to be done by you** (not in code) for the admin panel and subscriptions to work — infra, accounts, environment variables, Razorpay, first login, 2FA, GST. Work top-to-bottom; items are grouped by the phase that needs them.

Legend: 🔴 blocking / must do before that phase can run · 🟡 recommended · 🟢 optional.

---

## 0. Do this FIRST — protect production data

🔴 **Your dev backend currently points at the LIVE MongoDB database.**
`backend/.env` has `MONGO_URL` set to the production cluster. `backend/src/db/connect.ts`
connects straight to it, and `env.dbName` defaults to `dive`. That means running
`npm run dev` locally — and every admin feature we test live (creating roles,
publishing scoring configs, editing plans, sending notifications) — writes into
**production**.

**Update (2026-09-11):** this machine's DNS can't resolve the SRV records that a
`mongodb+srv://` Atlas URL needs (`querySrv ECONNREFUSED`), so dev connects to a
**local MongoDB in Docker** instead. Production keeps the Atlas URL + `DB_NAME=dive`.

### Run local Mongo + Redis with Docker Compose

A dev-only compose file is at the repo root: [`docker-compose.dev.yml`](../docker-compose.dev.yml)
(MongoDB 7 + Redis 7, both bound to `127.0.0.1` only, data persisted in named volumes).

```bash
# from the repo root
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps        # both should be "running"
```

`backend/.env` is already set for this:

```
MONGO_URL=mongodb://127.0.0.1:27018
DB_NAME=dive_staging
REDIS_URL=redis://127.0.0.1:6379
```

**Note:** Mongo is on host port **27018**, not the default 27017 — this machine
already runs a separate native `mongod.exe` Windows service on 27017, shared with
other projects. Never point Divve at that instance or stop that service; the
Docker container is deliberately on a different port so the two can't collide.

Then start the backend:

```bash
cd backend && npm run dev
```

Expected log line on boot:

```
[db] connected to MongoDB "dive_staging" (persistent)
```

First boot seeds the instrument master into the fresh `dive_staging` DB (~1–2 min,
hits AMFI/NSE/CoinGecko).

To stop: `docker compose -f docker-compose.dev.yml down` (keeps data) — add `-v` to wipe it.

☐ Docker running · ☐ `docker compose -f docker-compose.dev.yml up -d` · ☐ `npm run dev` shows `connected to MongoDB "dive_staging" (persistent)` · ☐ Instrument seed completed (`listening on http://localhost:8000`)

> The automated backend test suite is already safe — it spins up its own throwaway
> in-memory MongoDB (`backend/tests/setup.ts`). This warning is only about the dev server.

---

## 1. Phase 0 — Foundations

### 1.1 Redis 🔴

Needed for the job queue (notification sends, config simulations, exports) and the
shared rate-limiter store.

- **Local dev:** already covered by `docker-compose.dev.yml` (§0) — Redis comes up alongside Mongo. `backend/.env` already has `REDIS_URL=redis://127.0.0.1:6379`.
- **Production server:** `sudo apt install redis-server`, enable it, bind to `127.0.0.1` only, set a password, then in the production `.env`:

```
REDIS_URL=redis://:<password>@127.0.0.1:6379
```

☐ Local Redis up (via compose) · ☐ Redis on the production server · ☐ `REDIS_URL` set in the production `.env`

### 1.2 Error tracking (Sentry) 🟡

Two independent switches — each is fully **off** until you give it a DSN:

- **Backend** (server errors): `SENTRY_DSN`, wired in `backend/src/lib/sentry.ts`.
- **Frontend** (errors in your users' browsers): `REACT_APP_SENTRY_DSN`, wired in
  `frontend/src/lib/monitoring.js`. Until now a crash in someone's browser only showed *them*
  the "Something went wrong" screen and nobody on your side ever knew; with this on, the error
  (with the React component stack) is reported to you.

Steps:
1. In Sentry create **two projects** — one "Node" (backend), one "React" (frontend). Each gives a DSN.
2. Backend: add `SENTRY_DSN=...` to `backend/.env`, then `pm2 restart divve-backend`.
3. Frontend: add `REACT_APP_SENTRY_DSN=...` to `frontend/.env.production` and **rebuild**
   (`npm run build`) — it is baked into the build, not read at runtime, so editing the file alone
   does nothing. Optionally also `REACT_APP_RELEASE=<date or git hash>` to label which deploy an
   error came from.

What the frontend reports — and what it deliberately doesn't:
- **Reported:** the error, where in the code it happened, the React component stack, and the page
  path. It also catches errors that never reach the error screen (crashes in event handlers,
  unhandled promise rejections). Noise from browser extensions and harmless "ResizeObserver"
  warnings is ignored.
- **Never sent:** the URL's query string or #fragment (a reset-password link can carry a token
  there), cookies, request headers, the user's IP address, or any user id/email. No performance
  tracing and no session replay (a replay would record what's on screen — holdings, balances).
- A DSN is *meant* to be public (it can only send events, not read them), so it appearing in the
  built JavaScript is normal.
- Cost: Sentry loads as a separate ~119 kB (gzipped) file **after** the page has loaded, and only
  when a DSN was set at build time — with no DSN it is never requested. The main bundle grew by
  under 1 kB.

To confirm it works after deploying: open your site, then in the browser console run
`setTimeout(() => { throw new Error("sentry frontend test") })` — the error should appear in the
React project in Sentry within a minute.

☐ Two Sentry projects created · ☐ `SENTRY_DSN` set + backend restarted · ☐ `REACT_APP_SENTRY_DSN` set in `.env.production` + frontend rebuilt · ☐ Test error seen in Sentry

### 1.3 New environment variables (Phase 0) 🔴

Add to `backend/.env` and the production `.env`:

```
# --- Redis / queue ---
REDIS_URL=redis://localhost:6379

# --- Staff / admin auth ---
STAFF_ACCESS_TTL=10m                 # short-lived access token for staff sessions
TOTP_ISSUER=Divve Admin              # label shown in the authenticator app
ADMIN_IP_ALLOWLIST=                  # optional, comma-separated; empty = allow any IP

# --- Observability ---
SENTRY_DSN=

# --- Activity events ---
ACTIVITY_EVENT_RETENTION_DAYS=180

# --- Usage metering (subscriptions, used from Phase 6a; safe to set now) ---
EDIT_SESSION_WINDOW_MIN=20           # minutes; a burst of holding edits within this window = 1 metered "edit"
```

`ADMIN_EMAILS` (already present) stays — it is reused once, to bootstrap the first
superadmin, then becomes irrelevant.

☐ Variables added to `backend/.env` · ☐ Variables added to production `.env`

### 1.4 Bootstrap the first superadmin 🔴 (fully live as of Phase 0.4 — 2026-09-11)

**Status: log in at `/admin` for real.** The full flow — password → QR code → recovery
codes → dashboard placeholder — is built, tested, and verified live in a real browser.
There's no dashboard content yet beyond a placeholder (that's Phase 1+), but the sign-in
loop itself is real, not a mock.

**Start here:** sign up a normal Divve account first (in the real app, same signup flow
as any user) with
the email you want to be superadmin — e.g. `dagriyafintech@gmail.com`. Then, from the
`backend/` directory:

```bash
npm run create-superadmin -- --email you@example.com
```

This sets `staffRole=superadmin` on that account (audited). It does **not** touch
2FA — a fresh promotion always starts unenrolled, which is what forces the setup step
on the very next login.

☐ Normal account exists · ☐ Script run · ☐ Superadmin promoted (script prints confirmation)

### 1.5 Enrol 2FA (TOTP) 🔴

**Via the app** (recommended — this is the real, working flow now): go to
`http://localhost:3000/admin` (or your production domain + `/admin`), log in with your
promoted account → you'll be shown a QR code → scan it with an authenticator app
(Google Authenticator, Authy, 1Password, etc.) → enter the 6-digit code to confirm →
**save the 8 recovery codes shown once** on the next screen somewhere safe (a password
manager) — each is single-use, for when you lose your phone → click "I've saved these —
continue" to land in the admin panel.

**Via the raw API instead** (optional, e.g. for scripting/CI):
```bash
# 1. Log in — a staff account gets a pendingToken, not a real session yet
curl -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"identifier":"you@example.com","password":"yourpassword"}'

# 2. Start TOTP setup with that pendingToken — returns otpauthUrl + a scannable qrDataUrl
curl -X POST http://localhost:8000/api/auth/staff/totp/setup \
  -H "Authorization: Bearer <pendingToken>"

# 3. Scan the QR (or paste otpauthUrl's `secret=` value into your authenticator
#    app manually), then confirm with the 6-digit code it shows:
curl -X POST http://localhost:8000/api/auth/staff/totp/confirm \
  -H "Authorization: Bearer <pendingToken>" -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
# -> returns a real accessToken, your user object (staffRole now set), and 8
#    one-time recoveryCodes — save them now, they're never shown again.
```

Every staff member (superadmin, admin, employee) goes through this — it is mandatory
and cannot be skipped (enforced server-side regardless of which path you use).

☐ Authenticator installed · ☐ TOTP enrolled · ☐ Recovery codes saved

---

## 2. Phase 1 — Read-only admin

No new manual setup. Optionally (🟡) switch dev to a separate cluster with a realistic
data copy (Option B in §0) so the analytics/revenue dashboards have something to show.

---

## 3. Phase 2 — Configurable models

No new infra. One operational note:

🟡 After each **scoring/context/suggestion config publish**, the plan requires a written
"change note". Treat these like deploys — the change is live for all users immediately
(behind the same 5-minute score cache that already exists). Use the built-in **Simulate**
step every time before publishing; it shows how many users' scores move and by how much.

☐ Understood: config publishes are live changes, always Simulate first.

---

## 4. Phase 3 — Employees & roles

### 4.1 Inviting an employee

From `/admin` → Employees → Invite:
- Enter their email + pick a role (or create a custom role first under Roles).
- They receive an email (via Resend — see §7.1) with an accept link valid for a limited time.
- They set a password and enrol TOTP, then land in `/admin` with exactly their role's permissions.

☐ Roles reviewed · ☐ First employee invited and onboarded

### 4.2 Resend email domain 🔴 (shared with tickets & notifications — see §7.1)

---

## 5. Phase 4 — Support tickets

### 5.1 Resend / outbound email 🔴

Ticket replies and notification emails go out through Resend using the existing
`EMAIL_API_KEY`. For anything other than the sandbox `onboarding@resend.dev` sender you must:

- Add and **verify your sending domain** in the Resend dashboard (DNS records: SPF, DKIM, and ideally DMARC).
- Set in `backend/.env` / production `.env`:

```
EMAIL_FROM=Divve <noreply@yourdomain.com>
SUPPORT_REPLY_TO=support@yourdomain.com     # optional — see the note below
```

> `EMAIL_FROM` is your **no-reply / transactional** sender (sign-in codes, staff invites,
> tickets, billing notices). It is not used for promotional email — campaigns to people who
> aren't on Divve, and campaigns in a **marketing-sender category** (the seeded `marketing`
> category by default), use a separate `MARKETING_EMAIL_FROM` (§6.3), which does not affect it.

**`SUPPORT_REPLY_TO` — where a customer's email reply to a ticket email goes.**

- It applies to the two **ticket emails only** ("We've got your message" and "New reply on your
  ticket") as a reply-to header. Sign-in codes, staff invites, billing notices and marketing
  emails are unaffected — they still use `EMAIL_FROM` / `MARKETING_EMAIL_FROM` exactly as before.
- When it's set, the ticket-reply email also tells the customer they can reply to it and it will
  reach your support team.
- 🔴 **The mailbox must really exist.** Resend only *sends* email; it doesn't receive it. Create
  `support@yourdomain.com` as a real inbox (e.g. in Zoho Mail) or as an alias that forwards to
  one you read. If it doesn't exist, customers' replies bounce.
- **Leave it empty** and ticket emails carry no reply-to: a reply then goes to `EMAIL_FROM`'s own
  address (e.g. `noreply@yourdomain.com`), which is usually not a mailbox anyone reads.
- **Not built:** turning an emailed reply back into a message on the ticket. Replies land in the
  support inbox; staff read them there and copy anything needed into the ticket by hand (§5.2).
  Users continue a ticket properly from inside the app.
- `MARKETING_EMAIL_REPLY_TO` (§6.3) is a separate setting for marketing emails — you can point
  both at the same mailbox, but they're independent.

☐ Domain verified in Resend · ☐ `EMAIL_FROM` set · ☐ `support@` mailbox exists · ☐ `SUPPORT_REPLY_TO` set

### 5.2 Ticket settings 🟡

From `/admin` → System → Settings, or Tickets → Categories:
- Define ticket categories (Billing, Bug, Feature request, Account, Other) and their SLA hours.
- Add a few canned responses.
- Set the default assignee(s).

☐ Categories defined · ☐ SLAs set · ☐ Canned responses added

> Inbound email-to-ticket parsing is **not** in scope for now. Users raise tickets in
> the app; replies you send from `/admin` go out by email; if a user replies to that
> email it lands in your `SUPPORT_REPLY_TO` inbox (§5.1; if that isn't set, it goes to
> `EMAIL_FROM`'s own address instead), and you (for now) copy it into the ticket manually.

---

## 6. Phase 5 — Notifications

### 6.1 Notification categories & templates 🟡

From `/admin` → Notifications:
- Review the seeded categories (`account`, `score`, `subscription`, `product`, `support`, `marketing`) and decide which ones users are allowed to opt out of.
- Each category also has an **email sender**: `system` (the no-reply address) or `marketing` (the separate marketing address). Only `marketing` is set to the marketing sender out of the box; every other category sends from no-reply. See §6.3 → "Which campaigns use the marketing sender".
- Create templates for the common ones (welcome, score-moved, payment-failed, subscription-expiring, feature-announcement).

### 6.2 Email volume 🟡

Check your Resend plan's monthly send limit against your user count before running a
"send to all" campaign. Sends run inside the request (there is no background queue),
so a campaign to registered users is bounded by the audience cap, and an email-list
campaign (§6.3) goes out in batches of 100 and is capped at 2,000 deliverable
contacts per campaign. The provider's own monthly cap still applies either way.

☐ Categories reviewed · ☐ Core templates created · ☐ Resend send limit checked

### 6.3 Emailing people who aren't on Divve yet (marketing / onboarding) 🔴

Divve can email a list of people who have **not registered** — for example to invite
them to sign up. This is separate from every other email the app sends, and it goes out
from its **own marketing address**, never from your no-reply address. The same marketing
address is also used for promotional campaigns to your registered users (see "Which
campaigns use the marketing sender" below).

> **Two senders, on purpose.**
> - `EMAIL_FROM` — your existing **no-reply** address. It sends sign-in codes (OTP),
>   staff invites, support replies, billing notices, and non-promotional notifications to
>   registered users. **Nothing in this section changes it.**
> - `MARKETING_EMAIL_FROM` — the **new marketing** address, used for campaigns to an
>   imported email list **and** for campaigns in a category whose email sender is set to
>   "marketing" (the seeded `marketing` category). There is deliberately **no fallback**:
>   if it isn't set, those campaigns refuse to send (rather than quietly using the no-reply
>   address). The reason:
>   people mark marketing email as spam far more often than sign-in codes, and those
>   complaints damage the address they came from. Keeping the two apart means a bad
>   campaign can never stop sign-in codes from arriving.

#### Part A — One-time setup of the marketing sender

**Step 1 — Choose the marketing address.** Pick something different from your no-reply
address, e.g. `Divve <hello@mail.yourdomain.com>` or `Divve <offers@mail.yourdomain.com>`.
**Recommended: use a subdomain** (`mail.yourdomain.com`) rather than your main domain.
A subdomain keeps its reputation separate from your main domain, and it avoids a DNS
trap: a domain can only have **one** SPF record, and yours may already be used by Zoho
Mail and/or your no-reply setup — a subdomain has its own, so nothing existing has to be
edited. (If you use the main domain instead, follow the SPF warning in
`GETTING_API_KEYS.md` — edit the existing record, never add a second one.)

**Step 2 — Verify that domain/subdomain in Resend.**
1. Resend dashboard → **Domains** → **Add Domain** → enter `mail.yourdomain.com`.
2. Resend shows DNS records (SPF and DKIM `TXT`/`MX` records). Add each one at your DNS
   host (GoDaddy walk-through: `GETTING_API_KEYS.md` → "Verify your own domain in
   Resend"), copying the **Name** and **Value** exactly as Resend shows them.
3. Click **Verify DNS Records** and wait for the green **Verified** badge (minutes to a
   few hours).
4. Recommended: also add a **DMARC** record for the domain (Resend's docs show the exact
   value). Gmail and Yahoo now expect SPF + DKIM + DMARC from anyone sending bulk email.

**Step 3 — Set the environment variables.** In `backend/.env` (development) and the
production `.env`:

```
MARKETING_EMAIL_FROM=Divve <hello@mail.yourdomain.com>
MARKETING_EMAIL_REPLY_TO=hello@yourdomain.com     # optional — where replies go; leave empty if nobody reads replies
PUBLIC_API_URL=                                   # optional — see the note below
```

- `MARKETING_EMAIL_FROM` **must be a different address from `EMAIL_FROM`**. If they match
  (the display name and capitalisation are ignored), campaigns refuse to send.
- `MARKETING_EMAIL_REPLY_TO` must be a **real mailbox** (Resend can't receive mail). If it's
  empty, replies go to the marketing address itself (`hello@mail.yourdomain.com`), which is
  usually not a mailbox either — so set it to an inbox you read, or accept that replies bounce.
- Leave **`EMAIL_FROM` exactly as it is.**
- `PUBLIC_API_URL` is the public address of your API **including `/api`** (e.g.
  `https://yourdomain.com/api`). It's used for the unsubscribe link in every email. Leave it
  empty in production **if** your site and API share one domain through Nginx (the setup in
  `SERVER_DEPLOYMENT_GUIDE.md`) — it then defaults to `<your first CORS_ORIGINS entry>/api`.
  Set it only if your API lives on a different address.

**Step 4 — Restart the backend** (`pm2 restart` on the server, or restart `npm run dev`
locally) so it reads the new values.

**Step 5 — Check it took.** Open `/admin` → **Notifications** → **Email lists**.
- Green line — *"Sent from Divve <hello@mail.yourdomain.com> — a separate marketing
  address…"* → you're set.
- Red warning → read it: *"No marketing sender is set up"* (Step 3 missed or no restart) or
  *"same address as EMAIL_FROM"* (choose a different address).

**Step 6 — Confirm the no-reply address is untouched.** Request a sign-in code (log out and
log back in as a normal user, or use *Forgot password*). The code should arrive from your
**no-reply** address exactly as before.

**Step 7 — Send yourself a real test.** Create a tiny list containing only your own address
(Part B, steps 2–5), then use **Send test** on the campaign page. In your inbox check:
it arrived from the **marketing** address; the footer has an **Unsubscribe** link; and in
Gmail, *⋮ → Show original* lists a `List-Unsubscribe` header (that is what powers Gmail's
own "Unsubscribe" button). Note: a **test** email carries a *placeholder* unsubscribe link, so
clicking it shows a "This link isn't valid" page — that's expected. Real campaign emails
carry a working, per-person link (it opens a confirmation page with a "Yes, unsubscribe me"
button). To see the real page end to end, send a real campaign to a list that contains only
your own address, then unsubscribe yourself.

☐ Marketing (sub)domain verified in Resend · ☐ SPF + DKIM (+ DMARC) records added · ☐ `MARKETING_EMAIL_FROM` set, different from `EMAIL_FROM` · ☐ Backend restarted · ☐ Green "Sent from…" line in Email lists · ☐ Sign-in code still arrives from the no-reply address · ☐ Test email received from the marketing address

#### Which campaigns use the marketing sender

You don't pick the sender on each campaign — the campaign's **category** decides it:

| Campaign | Emails go out from |
|---|---|
| Sent to an **email list** (people who aren't on Divve) | Always the marketing address |
| To registered users, category **`marketing`** (seeded default) | The marketing address |
| To registered users, any other category (`product`, `score`, `account`, `subscription`, or one you create) | The no-reply address (`EMAIL_FROM`) — same as before |
| Sign-in codes, staff invites, ticket replies, payment-reminder emails | The no-reply address — categories never affect these |

- **See which one a campaign will use:** open the campaign → **Details** shows *"Email sent from — Marketing address (…)"* or *"— No-reply address (…)"*. If it's the marketing address and that isn't set up, a red message appears above the Send button.
- **Test emails** go out from the same address the real send will use, so **Send test** also proves the sender works.
- **A campaign with no email channel** (in-app / pop-up only) doesn't need a sender and is never blocked.
- **Changing a category's sender.** There's no screen for this yet — it's the `emailSender` field on the category (`"system"` or `"marketing"`), changed with `PATCH /api/admin/notification-categories/<category id>` and body `{"emailSender": "marketing"}` (needs the *manage templates* permission; the change is audit-logged). It's read at send time, so it applies to the next send. Use it if you create your own promotional category (e.g. `offers`) and want it sent from the marketing address too.
- **Existing databases:** when the backend starts, the `marketing` category is set to the marketing sender if it has no value yet. If you have already chosen a value for it, that choice is kept.
- **If the marketing address isn't set up,** a marketing-category campaign refuses to send (it stays a draft; nothing is emailed) rather than falling back to no-reply. Set `MARKETING_EMAIL_FROM` (Part A), or switch that category's sender to `system` if you really want it on no-reply.
- **Unsubscribing for registered users** works through their notification preferences in the app (they can switch a category off if it allows opting out) — unlike email-list emails, these emails don't carry a one-click unsubscribe link. That's fine at small volumes; if you start sending large promotional volumes to registered users, Gmail/Yahoo expect that link too, so let us know and it can be added.

#### Part B — Running a campaign to people who aren't on Divve

**Step 1 — Get a list you're allowed to email.** Only include people who have **agreed to
hear from Divve** (a signup form, a webinar registration, an event sheet where they opted
in, a waitlist). Do **not** use purchased or scraped lists — beyond the legal risk
(India's data-protection law expects consent), they get marked as spam, which damages your
sending reputation. Keep a record of where each list came from.

**Step 2 — Import it.** `/admin` → **Notifications** → **Email lists**.
1. **List name** — a new name, or an existing one to add to it (e.g. *Webinar Aug 2026*).
2. **Where did these come from?** — a short note kept with every contact as a consent trail
   (e.g. *Webinar signups, Aug 2026*).
3. Paste the addresses, **or** click **Upload a CSV file**. Accepted layouts: one address
   per line; `email,name` (header row optional); `email,first name,last name`; even
   `Ada Lovelace <ada@example.com>` lines. Up to 10,000 rows per import.
4. Tick **"I confirm these people have agreed to receive emails from Divve."** (Import stays
   disabled until you do.)
5. Click **Import** and read the summary: how many are new, duplicates merged, addresses that
   **already have a Divve account** (kept on the list but skipped when sending), any that had
   **already unsubscribed** (they stay unsubscribed), and any invalid rows with line numbers.
   Fix and re-import invalid rows if needed — re-importing is safe.

**Step 3 — Write the campaign.** **Campaigns** → **New campaign**. Give it a name, and write
the subject and body. To personalise, use:
- `{{first_name}}` — first word of their name ("Ada"), `{{name}}` — full name,
  `{{email}}` — their address. Anyone with **no name** on file gets **"there"**, so
  *"Hi {{first_name}},"* becomes *"Hi there,"* — never *"Hi ,"*.
- A **button** and/or links so people can act, e.g. button link **App page… → Sign up**
  (this sends them to your sign-up screen). Callout/banner and images work as in any
  campaign. Personalisation works in the subject, body and callout text.

**Step 4 — Point it at the list (important — do this before anything else).** New
campaigns start with the audience set to **"All users"**. On the campaign page →
**Audience** → choose **"Email list (not on Divve yet)"** → pick your list → **Save
audience**. This automatically makes the campaign **email-only**.

**Step 5 — Preview who will get it.** Click **Preview audience**. Check the number and the
line *"skipped: N already on Divve, M unsubscribed."* If the count is not what you expect,
stop and investigate before sending.

**Step 6 — Test it.** Enter your own address under **Test send** and click **Send test**.
Check the wording, the button/links, and the unsubscribe footer. You can still change
everything: **Edit content** on the campaign page (drafts only).

**Step 7 — Send.** **Send now** → confirm → enter your password again (step-up). Or **Schedule**
it for later. Very large audiences: a campaign is capped at **2,000** deliverable contacts —
split bigger lists into several lists/campaigns.
- **First time, or a brand-new sending domain:** start small (50–100 people) and watch
  the results before a big send — new domains have no reputation yet, and sending a big
  blast cold is the fastest way to land in spam.

**Step 8 — Read the results.** The sent campaign page shows *Targeted / Sent / Delivered /
Failed*, who was left out and why, and the list's current subscribed/unsubscribed counts.
"Opened" is not shown: the app deliberately has no tracking pixel, so opens can't be known.
Anything under **Failed** was rejected by the email provider — see the table below.

☐ List has consent · ☐ Import summary read · ☐ Audience set to the Email list (not "All users") · ☐ Preview count checked · ☐ Test email checked · ☐ First send kept small

#### How unsubscribing works (nothing for you to do)

- Every email has an **Unsubscribe** link in the footer and the headers that make Gmail /
  Outlook / Yahoo show their own one-click "Unsubscribe" button.
- Opening the link shows a confirmation page; clicking **"Yes, unsubscribe me"** removes them.
  (Opening alone does nothing — email security scanners open every link, and would otherwise
  unsubscribe everybody.)
- An unsubscribed address is **never emailed again, even if you import it again**. It is kept
  (not deleted) precisely so it can't be mailed by accident later — even if you delete the
  list it was on.
- People who **register on Divve** later are automatically skipped by list campaigns — they're
  reached through the app instead, so nobody gets the same message twice.

#### Troubleshooting

| What you see | Meaning / fix |
|---|---|
| Red warning *"No marketing sender is set up"*, or sending says the same | `MARKETING_EMAIL_FROM` is empty, or the backend wasn't restarted after setting it (Part A steps 3–4). |
| A campaign to **registered users** says *"No marketing sender is set up"* | Its category (e.g. `marketing`) is set to the marketing sender, and the address isn't configured. Set `MARKETING_EMAIL_FROM` (Part A), or change the category's `emailSender` to `system`. |
| A promotional campaign to registered users went out from the **no-reply** address | Its category's sender is `system`. Use the `marketing` category, or set that category's `emailSender` to `marketing` (see "Which campaigns use the marketing sender"). |
| *"MARKETING_EMAIL_FROM is the same address as EMAIL_FROM"* | Pick a different marketing address (Part A step 1). |
| Every email under **Failed** (Resend error 403/422 in the backend log) | The sending domain isn't verified yet, or `MARKETING_EMAIL_FROM` isn't on a verified domain, or you're still on the sandbox `onboarding@resend.dev` (which can only email your own Resend login). Fix Part A step 2. |
| Only a few under **Failed** | Usually invalid or bounced addresses. They're recorded as failed; the rest were sent. |
| *"…more than 2,000 deliverable contacts — split it"* | Split the list (e.g. import the halves under two list names) and run two campaigns. |
| Send said "1 campaign(s) that haven't been sent yet still use this list" when deleting a list | Delete or send that draft/scheduled campaign first. |
| Preview count is lower than the list size | Expected: people who already have a Divve account and people who unsubscribed are skipped — the preview line says how many of each. |
| A person says they never got it | Check their spam folder; check **Email lists → View** for their status (they may have unsubscribed); an address that "already has a Divve account" is skipped by design. |

> **Not covered by the app:** bounce and spam-complaint handling from the provider (Resend
> shows these on its dashboard — check them after each send, and remove people who repeatedly
> bounce), and a postal address in the footer (some countries' marketing-email rules, e.g.
> the US CAN-SPAM Act, require one — tell us if you need it added).

---

## 7. Phase 6a — Subscriptions core

### 7.1 Razorpay account 🔴

You already have Razorpay keys configured (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET` in `backend/.env`). During Phase 6a's own live verification
this dev `.env` was found holding **live-mode** keys, which meant the first plan-publish
and subscribe checks briefly created two real (harmless, never-authorized) objects on the
live Razorpay account before anyone noticed — see `ADMIN_PANEL_PLAN.md` §13f's opening
note. It was switched to **test-mode** keys (`rzp_test_...`) for local dev as a result;
switch back to real live-mode keys only in the actual production `.env`, never in a local
or shared dev environment.

Do this in the Razorpay Dashboard:

1. **Enable the Subscriptions product** (Dashboard → Subscriptions). It may need a quick activation/KYC confirmation for your account.
2. **Do NOT hand-create the plans.** We create them from `/admin` → Plans → "Publish to Razorpay", which calls the Razorpay Plans API with the exact amounts:
   - `premium_monthly` — ₹119/month → `period: monthly`, `interval: 1`, `amount: 11900`
   - `premium_annual` — ₹1099/year → `period: yearly`, `interval: 1`, `amount: 109900`
3. **Add subscription events to your existing webhook.** Dashboard → Settings → Webhooks → your existing `/api/payments/webhook` endpoint → add:
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.completed`
   - `subscription.cancelled`
   - `subscription.halted`
   - `subscription.pending`
   - `payment.failed`
   (Keep the existing `payment.captured` / order events.)
4. Confirm the webhook secret in `backend/.env` matches the one shown in the dashboard.

☐ Subscriptions product enabled · ☐ Webhook events added · ☐ Webhook secret confirmed

### 7.2 New environment variables (Phase 6a)

None needed beyond the Razorpay keys in §7.1 above. As actually implemented, the
`PLAN_LIMIT_REACHED` error is a plain in-app JSON response handled entirely client-side
(the shared `PlanLimitModal` navigates to the in-app Subscription screen — no email, no
external link, so no public base-URL setting was needed), and each plan's Razorpay
`total_count` (billing cycles before auto-complete, ~10 years either way) is a fixed
value in `subscriptionService.ts` keyed off the plan's own `interval`, not an env var.

☐ Nothing to add here — confirmed against the actual code

### 7.3 Plan go-live checklist 🔴

From `/admin` → Plans:
- Review the seeded `freemium`, `premium_monthly`, `premium_annual` entitlements against
  [`ADMIN_PANEL_PLAN.md` §3](./ADMIN_PANEL_PLAN.md#3-subscription-product-spec-locked).
- "Publish to Razorpay" for the two premium plans → confirm `razorpayPlanId` is stored.
- Do one **real ₹1 test** (temporarily set the monthly plan to ₹1, subscribe with your
  own account, confirm the webhook flips the subscription to `active`, then set it back
  to ₹119 and archive the test subscription).

☐ Entitlements reviewed · ☐ Plans published to Razorpay · ☐ End-to-end test subscription verified

### 7.4 Existing-user migration

No migration script exists, and none is needed. As actually implemented, **Freemium is
defined as the absence of a `Subscription` document** — `entitlementService.ts` falls
back to the seeded Freemium plan for any user with no `trialing`/`active`/`past_due` row,
which every pre-existing account already satisfies with zero data changes.
- Nothing breaks — Freemium keeps full read access; only the new weekly/monthly limits
  and the "no daily revaluation" rule start applying.
- Post an in-app announcement (Notifications → campaign, or the announcement banner)
  explaining the two plans a few days before you publish the Premium plans to Razorpay.

☐ Announcement scheduled

---

## 8. Phase 6b — Billing polish (GST invoices, refunds, coupons, dunning)

### 8.1 GST details for invoices 🔴 (get these from your CA/accountant)

As actually implemented, GST invoicing needs exactly three env vars — prices are already
GST-inclusive (§3), so the invoice backs the 18% out of the amount actually charged
rather than adding it on top, and the invoice number (`DIV-INV-000001`, sequential) and
SAC code (`998439`, hardcoded per charge type in `invoiceService.ts` — **confirm the
exact SAC classification with your CA**, this is an accounting decision the code can't
verify) aren't separately configurable:

```
GST_SELLER_GSTIN=...
GST_SELLER_NAME=...            # defaults to "Divve" if left blank
GST_SELLER_STATE=...           # place of supply — see the note below
```

Leaving `GST_SELLER_GSTIN` blank is fine for dev/testing: invoices still generate, just
visibly marked "PROVISIONAL — seller GSTIN not yet configured" on the PDF. Set a real
value before accepting real payments in production.

**Place of supply**: this app collects no buyer billing address, so `GST_SELLER_STATE`
(your own registered state) is used as a simplification for every invoice, rather than a
per-buyer address-based calculation. Confirm with your CA that this is acceptable for a
digital/OIDAR service before relying on it for real filings.

☐ CA consulted · ☐ `GST_SELLER_GSTIN`/`GST_SELLER_NAME`/`GST_SELLER_STATE` set in
production `.env` · ☐ SAC code (`998439`) confirmed with CA · ☐ Place-of-supply
simplification confirmed acceptable

### 8.2 Refunds 🟡

Refunds are issued from `/admin` → Revenue → the payments table's per-row **Refund**
button (full or partial — the amount defaults to whatever remains unrefunded). This calls
the real Razorpay refund API for a real payment and is **irreversible** — it requires a
permission (`subscriptions.refund`), a step-up auth prompt, and is fully audited. Decide
who on staff gets that permission.

☐ Refund permission assigned deliberately

### 8.3 Coupons 🟢 (optional)

Coupons are managed from `/admin` → Subscriptions → the **Coupons** tab (gated by the
existing `plans.manage` permission — no separate permission or env var needed). A real
discount is applied by creating a genuinely-discounted, one-off Razorpay Plan for that
specific redemption at subscribe time — the customer is actually billed the discounted
amount every cycle for as long as that subscription lives, not just the first charge.
Nothing to configure before use; create your first coupon directly in the admin UI.

**"First charge only" vs "every renewal".** Each coupon has a *duration*: `recurring` (the discount applies to every renewal, for the life of the subscription) or `once` (only the first charge is discounted, then it returns to the normal price). How `once` works: checkout uses a special discounted Razorpay plan, so **Razorpay's checkout / your UPI or card autopay screen will show the discounted amount (e.g. ₹1.19) — that is expected**. Only *after the first charge succeeds* does the app ask Razorpay to switch the subscription to the normal plan from the next cycle. So the autopay showing the discounted amount right after paying is not by itself a fault; what matters is whether that switch was scheduled.

To check a real subscription (read-only — changes nothing, in the database or at Razorpay):

```
cd ~/divve/dive-main/backend && npm run inspect-subscription -- --email the-users-email@example.com
```

It prints what the app recorded, what Razorpay itself says (current plan amount, next charge date, any scheduled plan change), and a plain verdict: ✅ the switch to full price is scheduled, or ❌ Razorpay has no scheduled switch and will keep charging the discounted amount. If it's ❌, search the log for the cause: `pm2 logs divve-backend --lines 500 --nostream | grep "failed to revert one-time-coupon"`. **Always test a new coupon with a throwaway account, and cancel the test subscription afterwards** — on the live site it's a real mandate that really charges.

☐ First real coupon reviewed before sharing a code publicly (redemption cap set
appropriately — an unlimited coupon has no ceiling on total discount given away)

### 8.4 Dunning (past-due subscriptions) 🟢

```
DUNNING_GRACE_DAYS=7   # days a past_due subscription keeps Premium access before
                       # jobs/dunning.cron.ts auto-cancels it (default shown)
```

A failed renewal charge (Razorpay `subscription.halted` / `payment.failed`) sets a
subscription to `past_due` — it keeps full Premium access and gets one email + in-app
notice immediately, then a daily cron (7am IST) auto-cancels it once `DUNNING_GRACE_DAYS`
has passed with no successful retry, sending a second notice. Nothing else to configure;
adjust the grace period if 7 days doesn't match your desired dunning policy.

☐ `DUNNING_GRACE_DAYS` reviewed (or left at the 7-day default)

---

## 9. Phase 7 — Polish

🟢 As actually implemented (see `ADMIN_PANEL_PLAN.md` §13h): feature flags, the
announcement + maintenance banner, read-only impersonation, the DPDP request queue, and
a CSAT dashboard. **No new environment variables were needed for any of it** — everything
runs on infrastructure earlier phases already set up (Mongo, the existing JWT signing
secret, the existing step-up flow).

☐ Nothing to add here — confirmed against the actual code

- **Feature flags**: `/admin` → Feature Flags. Purely in-app — create a flag, toggle it,
  set a rollout percentage or restrict it to specific plan keys. Nothing to configure
  outside the admin UI.
- **Announcement / maintenance banner**: `/admin` → System. Turning on maintenance mode
  immediately 503s the entire public app (everything except `/auth`, `/admin`, `/health`,
  `/app-settings`) with a friendly fallback page — staff can always still reach `/admin`
  to turn it back off. Worth deciding ahead of time who on your team is authorized to
  flip this (it's gated by `system.manage`, no step-up, since it's instantly reversible).
- **Read-only impersonation**: `/admin` → Users → a user's detail page → "View as this
  user (read-only)". Step-up-gated and time-boxed to 30 minutes; every write is blocked
  centrally, not per-screen. No configuration needed, but worth deciding who on your team
  gets the `users.impersonate` permission, since it's a real (if read-only) window into a
  customer's account.
- **DPDP request queue**: `/admin` → Data Requests. This ships the *tooling* — a queue,
  an on-demand export-bundle generator, and delete-request logging. **You still need to
  define your own data-retention and response-time policy** (e.g., how many days you
  commit to fulfilling an export request) — that's a business decision, not something the
  code enforces.
- **CSAT dashboard**: `/admin` → Analytics → the new Support section. This surfaces data
  that Phase 4's ticket system was already computing — nothing new to configure.
- **Deferred, not shipped this phase** (see `ADMIN_PANEL_PLAN.md` §13h for the reasoning):
  content/CMS editing, A/B config experiments, an abuse/rate-limit console, scheduled
  reports & CSV exports, and NPS collection. None of these need anything from you yet.

---

## 10. Production deployment additions (when each phase ships)

Your deploy is Nginx (serves the SPA, proxies `/api/*` to `localhost:8000`) + PM2 for the
backend (see `SERVER_DEPLOYMENT_GUIDE.md`). Additions for this work:

| When | Task |
|---|---|
| Phase 0 | Install & start Redis on the server (localhost-bound, password-set). Add all Phase 0 env vars to the production `.env`. Add a PM2 process (or systemd unit) for the **BullMQ worker** if we run it as a separate process — TBD, may run in-process initially. |
| Phase 0 | Run `createSuperadmin.ts` on the server (or locally against the production DB, carefully). |
| Phase 2 | First deploy after config refactor: no behaviour change (defaults = current values). Verify `GET /api/score/config` responds and the frontend still scores identically. |
| Phase 4/5 | Verify Resend domain + `EMAIL_FROM` on the server. |
| Email lists (non-user campaigns) and the marketing sender | Verify the marketing (sub)domain in Resend, add `MARKETING_EMAIL_FROM` (must differ from `EMAIL_FROM`) to the production `.env`, and restart PM2 — full steps in §6.3. Check `PUBLIC_API_URL` only if the API isn't on the same domain as the site. The email-list feature adds **new Mongo collections** (`externalcontacts`, `externaldeliveries`, created automatically). The category sender adds an `emailSender` field on notification categories; on first start the existing `marketing` category is backfilled to the marketing sender automatically — no manual migration. **Until `MARKETING_EMAIL_FROM` is set, campaigns in the `marketing` category refuse to send** (other categories are unaffected). Confirm a sign-in code still arrives from the no-reply address afterwards. |
| Phase 6a | Add subscription webhook events in Razorpay (production). No extra env vars needed (§7.2) and no migration to run — Freemium is automatic. Watch `WebhookEvent` + `SystemJobRun` logs in `/admin` → System for the first day. |
| Phase 6a | Confirm the daily valuation cron (`valuationRefresh.cron.ts`, 6:30am IST) now only reprices Premium users — check `SystemJobRun` stats. |
| Phase 6b | Set `GST_SELLER_GSTIN`/`GST_SELLER_NAME`/`GST_SELLER_STATE` in the production `.env` before accepting real payments (§8.1) — invoices generate as "provisional" without a real GSTIN. Review `DUNNING_GRACE_DAYS` if 7 days doesn't match your policy. Watch the new `dunning` cron (7am IST) in `/admin` → System for the first week. |
| Phase 7 | No new env vars or infra. Decide who gets the `feature_flags.manage`, `system.manage`, and `users.impersonate` permissions before granting roles — maintenance mode and impersonation are both real, if reversible, levers. Write down your DPDP export/delete response-time policy (§9) — the queue is ready, the policy is yours to set. |
| Post-Phase-7 gap sweep | **Run `npm run backfill-activity-first-touch` once, as soon as possible after this deploy.** `ActivityFirstTouch` (the permanent per-user first-touch marker the admin Analytics funnel now reads instead of raw `ActivityEvent`) is a brand-new collection — without this backfill, the funnel will read near-zero right after deploy until fresh activity slowly repopulates it on its own. The backfill is a best-effort snapshot of whatever raw `ActivityEvent` history is still within its 180-day TTL at the moment it runs, so the sooner it runs after deploy, the less real history has already aged out. Safe to re-run (idempotent). Also confirm the new `activityRollup` cron (7:30am IST) appears in `/admin` → System after its first run. |
| Daily valuation job | A malformed FD/PF holding (e.g. an FD with no start month) is skipped and logged (`skipped a holding whose recomputed value…`) instead of stopping everyone's repricing. To list them: `cd backend && npm run audit-fd-pf-holdings` (read-only; add `-- --json` for JSON). It names the user, the holding, and the missing field. Fix = the user re-saves the holding in their own Holdings screen, or delete it if junk. Worth running once after go-live, then whenever the System page's valuation job stats show `invalidSkipped` above 0. |
| Every phase | `npm run build` (frontend + backend), restart PM2, smoke-test `/admin` login + TOTP, check Sentry for new errors. |

---

## 11. Quick reference — all new env vars

```
# Phase 0
REDIS_URL=redis://localhost:6379
STAFF_ACCESS_TTL=10m
TOTP_ISSUER=Divve Admin
ADMIN_IP_ALLOWLIST=
SENTRY_DSN=                          # backend errors
# (frontend, in frontend/.env.production — baked in at build time)
# REACT_APP_SENTRY_DSN=                # browser errors; optional REACT_APP_RELEASE=<label>
ACTIVITY_EVENT_RETENTION_DAYS=180
EDIT_SESSION_WINDOW_MIN=20

# Phase 4/5
EMAIL_FROM=Divve <noreply@yourdomain.com>
SUPPORT_REPLY_TO=support@yourdomain.com   # optional; a REAL mailbox that customers' replies to ticket emails reach (§5.1)

# Email lists (campaigns to people who aren't on Divve yet) — see §6.3
MARKETING_EMAIL_FROM=Divve <hello@mail.yourdomain.com>   # required for email-list campaigns and marketing-category campaigns; MUST differ from EMAIL_FROM
MARKETING_EMAIL_REPLY_TO=                                # optional
PUBLIC_API_URL=                                          # optional; API base incl. /api, for the unsubscribe link

# Phase 6a
# (none — Razorpay keys from §7.1 above are all it needs; see §7.2)

# Phase 6b
GST_SELLER_GSTIN=
GST_SELLER_NAME=Divve
GST_SELLER_STATE=
DUNNING_GRACE_DAYS=7
CANCEL_NOTICE_BUFFER_HOURS=48        # hours before renewal that a cancelled-but-still-active
                                      # subscription actually tells Razorpay to stop auto-renewing
RENEWAL_REMINDER_DAYS_BEFORE=7,3,0   # comma-separated days-before-renewal reminder thresholds

# Phase 7
# (none — feature flags, the announcement/maintenance banner, impersonation, and the
# DPDP queue all run on infrastructure earlier phases already set up)
```

---

## 12. Master checklist

- [ ] §0 — Dev DB isolated from production `dive`
- [ ] §1.1 — Redis (dev + prod)
- [ ] §1.2 — Sentry (backend `SENTRY_DSN` and frontend `REACT_APP_SENTRY_DSN`, frontend rebuilt)
- [ ] §1.3 — Phase 0 env vars
- [ ] §1.4 — First superadmin bootstrapped
- [ ] §1.5 — TOTP enrolled + recovery codes saved
- [ ] §5.1 — Resend sending domain verified
- [ ] §5.1 — A real `support@` mailbox exists and `SUPPORT_REPLY_TO` points at it (Resend can't receive mail — a made-up address just bounces replies); same check for `MARKETING_EMAIL_REPLY_TO` (§6.3)
- [ ] §6.3 — Marketing (sub)domain verified in Resend + `MARKETING_EMAIL_FROM` set (different from `EMAIL_FROM`) — needed before emailing people who aren't on Divve
- [ ] §6.3 — Sign-in code still arrives from the no-reply address; marketing test email received with a working unsubscribe footer
- [ ] §7.1 — Razorpay Subscriptions enabled + webhook events added
- [ ] §7.2 — confirmed no extra env vars needed
- [ ] §7.3 — Plans published to Razorpay + test subscription verified
- [ ] §7.4 — user announcement (no migration needed — Freemium is automatic)
- [ ] §8.1 — GST details from CA (`GST_SELLER_GSTIN`/`NAME`/`STATE`)
- [ ] §8.2 — Refund permission assigned deliberately
- [ ] §8.3 — first coupon's redemption cap reviewed (optional feature)
- [ ] §8.4 — `DUNNING_GRACE_DAYS` reviewed
- [ ] §9 — DPDP export/delete response-time policy written down
- [ ] §9 — `feature_flags.manage`/`system.manage`/`users.impersonate` assigned deliberately
- [ ] §10 — `npm run backfill-activity-first-touch` run once, promptly after deploy
- [ ] §10 — Production Redis + per-phase deploy steps
