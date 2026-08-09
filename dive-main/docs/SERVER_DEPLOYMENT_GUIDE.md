# Server Deployment Guide — putting Divve on the internet

This guide walks you through putting your Divve app on a real server, with your own domain name, so anyone in the world can visit it — not just you, on your own computer.

**You don't need to know anything technical already.** Every step tells you exactly what to click, what to type, and why. Just follow it top to bottom, in order — don't skip ahead.

**What you'll need before starting:**
- A credit or debit card (AWS and, if you don't already have it, MongoDB both ask for one — MongoDB's free plan never actually charges it, and AWS has a free plan too, but they want a card on file).
- Access to your GoDaddy account (the one where you bought your domain).
- About 1–2 hours, done in one sitting if possible.

**The plan, in plain words:** you're going to (1) create a free online database, (2) rent one small computer from Amazon that runs day and night, (3) put your app's code on that computer, (4) tell your GoDaddy domain name to point at that computer, and (5) put a padlock (🔒 HTTPS) on your website so it's secure. That's it — five things. Each one is its own numbered Part below.

---

## Part 1 — Create your free online database (MongoDB Atlas)

Your app needs somewhere to permanently store every user's signup, holdings, and preferences. Right now, without this step, your app just uses temporary memory that forgets everything the moment it restarts. This part fixes that.

1. Open a web browser and go to **mongodb.com/cloud/atlas/register**.
2. Sign up with your email and a password (or continue with Google), then verify your email if asked.
3. Atlas will ask a few setup questions ("What is your goal today?", preferred language, etc.) — pick whatever's closest, or look for a **"Skip"** link if you don't want to answer them.
4. On the "Deploy your database" screen, make sure the **free "M0"** option is selected (it's usually already selected by default and clearly marked **"Free"**), then click **"Create"**.
5. You'll be asked to create a database user — type a username (e.g. `divveapp`) and click **"Autogenerate Secure Password"**. A password will appear.
   > 🔴 **Stop and copy this password into a text file on your computer right now.** Atlas will never show it to you again. If you lose it, you'll have to make a new one.
6. Under "Where would you like to connect from?", click **"Add a Different IP Address"**, type `0.0.0.0/0` into the box, and click **"Add Entry"**. This looks a little scary — it means "let a connection in from any address" — but it's necessary here because your server's address isn't fixed yet at this point in the guide, and MongoDB requires this network access rule to even accept a connection. (In Part 2, once your server has a fixed address, we'll come back and tighten this — noted as an optional extra-security step at the end of Part 2.)
7. Click **"Finish and Close"**. Your database takes a minute or two to finish setting up — you'll see a loading spinner.
8. Once it's ready, click the **"Connect"** button on your cluster (it's usually named "Cluster0").
9. Click **"Drivers"** (sometimes labeled "Connect your application").
10. Under "Driver", make sure **"Node.js"** is selected.
11. You'll see a line of text starting with `mongodb+srv://` — click the copy icon next to it. It looks like:
    `mongodb+srv://divveapp:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
12. Open your text file from step 5. Paste this copied line in, then find `<db_password>` inside it and replace it (including the `<` and `>` symbols) with the actual password you saved earlier. Keep this edited line — you'll need it in Part 5.

**Part 1 is done.** You now have a real, free, permanent database waiting for your app.

---

## Part 2 — Rent a computer from Amazon (AWS EC2) and lock its doors

This is the actual computer that will run your app, 24 hours a day. Amazon calls this service "EC2." We'll also set up its "doors" (called a security group) so only the right kind of traffic can reach it — this is the first big security step.

1. Go to **aws.amazon.com** and click **"Create an AWS Account"** (top-right).
2. Follow the signup steps: email, password, AWS account name (can be anything, e.g. "Divve"), your card details, and phone verification. This is normal — AWS always asks for a card, even for free-tier usage.
3. Once signed in, you'll land on the **AWS Management Console**. In the search bar at the top, type **EC2** and click it when it appears.
4. Click the orange **"Launch instance"** button.
5. Under "Name", type something like `divve-server`.
6. Under "Application and OS Images", make sure **"Ubuntu"** is selected, and the version dropdown shows something like **"Ubuntu Server 24.04 LTS"** (any recent Ubuntu LTS version is fine).
7. Under "Instance type", choose **"t3.small"** (a reliable low-cost option; if you specifically want to stay inside AWS's free tier for the first year, `t2.micro` also works but may feel slow — `t3.small` is the safer pick for a real, working app and costs only a small amount per month).
8. Under "Key pair (login)", click **"Create new key pair"**. Give it a name like `Divve-key`, leave the type as **"RSA"** and format as **".pem"**, then click **"Create key pair"**. A file called `Divve-key.pem` will download to your computer automatically.
   > 🔴 **This file is like a physical key to your server's front door. Move it somewhere safe on your computer (not your Downloads folder) and never share it or upload it anywhere, including GitHub.**
9. Under "Network settings", click **"Edit"**. You'll see a list of rules — set them up exactly like this:
   - **SSH, port 22** — change the source from "Anywhere" to **"My IP"** (AWS will auto-fill your current internet address). This means only your own computer can even attempt to log in.
   - Click **"Add security group rule"**, choose type **"HTTP"** — leave its source as "Anywhere" (this lets visitors reach your website).
   - Click **"Add security group rule"** again, choose type **"HTTPS"** — leave its source as "Anywhere" too (this is for the secure padlock version of your site, set up in Part 6).
   - **Do not add any other rules.** Specifically, never open port 8000 or port 27017 to "Anywhere" — those are your app's and database's private, internal doors, not meant for the public.
10. Leave everything else as default, scroll down, and click the orange **"Launch instance"** button.
11. Wait about a minute, then click **"View all instances"**. You'll see `divve-server` with a status that turns to **"Running"**.

**Give your server a permanent address (Elastic IP):**

By default, your server's internet address can change if it ever restarts — that would break your domain name setup later. Let's fix that now.

12. In the left-hand menu, under "Network & Security", click **"Elastic IPs"**.
13. Click **"Allocate Elastic IP address"**, then click **"Allocate"**.
14. Select the new address in the list, click the **"Actions"** dropdown, then **"Associate Elastic IP address"**.
15. Under "Instance", pick your `divve-server`, then click **"Associate"**.
16. Write this IP address down in your text file — it looks like four numbers separated by dots (for this deployment, it's `16.192.0.164`). You'll need it constantly for the rest of this guide. This address is now permanently yours as long as the server exists.

**Part 2 is done.** You now own a computer on the internet, with only the right doors open, and a permanent address.

---

## Part 3 — Log into your server for the first time

1. **On Windows:** open the **Start Menu**, type **"PowerShell"**, and open it (do not use "PowerShell (Admin)" — the regular one is fine).
2. First, protect your key file so only you can read it. Type this (for this deployment, the key file lives at `D:\Dive\AWS DA\Divve-key.pem` — adjust if you ever move it):
   ```
   icacls "D:\Dive\AWS DA\Divve-key.pem" /inheritance:r
   icacls "D:\Dive\AWS DA\Divve-key.pem" /grant:r "%username%:R"
   ```
   Press Enter after each line. (This step matters — Windows will otherwise refuse to let you connect, saying the key file's permissions are "too open.")
3. Now connect to your server:
   ```
   ssh -i "D:\Dive\AWS DA\Divve-key.pem" ubuntu@16.192.0.164
   ```
4. The first time, it'll ask "Are you sure you want to continue connecting?" — type `yes` and press Enter.
5. You're now "inside" your server — the text prompt will change to something like `ubuntu@ip-172-31-...:~$`. Everything you type from here on, in every future step that says "on the server," happens inside this same window.

**Keep this PowerShell window open** for the next several Parts — you'll be typing commands into it.

---

## Part 4 — Install the tools your app needs, on the server

Copy and paste each block below into your PowerShell window (which is connected to your server), pressing Enter after each. These install the software your app runs on. This can take a few minutes — that's normal.

1. Update the server's own software list:
   ```
   sudo apt update && sudo apt upgrade -y
   ```
2. Install Node.js (the engine your app runs on):
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
3. Check it worked — type `node --version` — you should see something like `v20.x.x`.
4. Install Git (needed to bring your code onto the server):
   ```
   sudo apt install -y git
   ```
5. Install PM2 (a tool that keeps your app running forever, even restarting it automatically if it ever crashes or the server reboots):
   ```
   sudo npm install -g pm2
   ```
6. Install Nginx (this is what actually shows your website to visitors and safely forwards their requests to your app — explained more in Part 6):
   ```
   sudo apt install -y nginx
   ```

**Part 4 is done.**

---

## Part 5 — Put your app's code on GitHub, then onto the server

We'll use GitHub (a free, standard place to store your code) as the bridge between your computer and your server. This also makes future updates easy — one button to publish a change, one command on the server to pull it in.

**On your own computer:**

1. Go to **github.com** and click **"Sign up"** if you don't have an account yet.
2. Go to **desktop.github.com** and download **GitHub Desktop**, then install it and sign in with your new GitHub account.
3. In GitHub Desktop, click **"File" → "Add local repository"**, and browse to your project folder (`dive-main`).
4. If it says the folder isn't a Git repository yet, click the blue **"create a repository"** link it offers.
5. Click **"Publish repository"** (top of the window). You can leave it as **Public** — this is safe, because your real secrets (passwords, API keys) live only in a `.env` file that's deliberately excluded and will never be uploaded (already set up for you in this project). Click **"Publish repository"** to confirm.
6. On GitHub.com, open your new repository in a browser and click the green **"Code"** button, then copy the URL shown (it looks like `https://github.com/yourname/dive-main.git`).

**Back in your PowerShell window (connected to the server):**

7. Type this, replacing the URL with the one you just copied:
   ```
   mkdir -p ~/divve
   cd ~/divve
   git clone https://github.com/yourname/dive-main.git
   ```
   Your code is now on the server, at `~/divve/dive-main` (git names the folder after the repository itself — `dive-main` — so it lands one level deeper than the `divve` folder you just made; every path in the rest of this guide accounts for that).

**Part 5 is done.**

---

## Part 6 — Fill in your app's real settings (secrets)

Your app needs a file with real passwords and settings to run properly and safely. We'll create it now, directly on the server.

1. On the server, type:
   ```
   cd ~/divve/dive-main/backend
   cp .env.example .env
   nano .env
   ```
   This opens a simple text editor called `nano` right inside your terminal.

2. You'll see a list of lines like `SETTING_NAME=`. Using your keyboard's arrow keys to move around, edit the following lines (leave any line not mentioned here exactly as it already is):

   - `NODE_ENV=development` → change to `NODE_ENV=production`
     > 🔴 This one line matters a lot. It turns on the app's built-in safety checks — for example, it will now refuse to start if you forget to set a real secret below, instead of quietly running unsafely.

   - `MONGO_URL=` → paste the full connection string you saved in Part 1, right after the `=` sign, with no spaces.

   - `JWT_ACCESS_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET` and `JWT_REFRESH_SECRET=REPLACE_WITH_A_DIFFERENT_LONG_RANDOM_SECRET` — these need two DIFFERENT long, random passwords that only your server knows (they're what makes a user's login "keys" impossible to fake). Don't type these yourself — instead, open a **second** PowerShell window, connect to your server again the same way as Part 3 step 3, and run this command **twice** (it prints a different random value each time):
     ```
     openssl rand -base64 48
     ```
     Copy the first result into `JWT_ACCESS_SECRET=`, and the second result into `JWT_REFRESH_SECRET=`, back in your `nano` window.

   - `CORS_ORIGINS=http://localhost:3000` → change to your real domain, for example `CORS_ORIGINS=https://yourdomain.com` (use the exact domain you bought — we'll connect it in Part 7. If you don't know it yet, come back and fix this line after Part 7).

   - `PUBLIC_BASE_URL=http://localhost:8000` → change to `PUBLIC_BASE_URL=https://yourdomain.com/api` (same domain as above).

   - `EMAIL_API_KEY=`, `ANTHROPIC_API_KEY=`, `CRYPTO_PRICE_API_KEY=`, and the `FINVU_*` lines are all optional extras (real sign-up codes by email, Bot Scan, live crypto prices, real account-linking) — see `docs/GETTING_API_KEYS.md` for how to get each one, whenever you're ready. You can leave them as placeholders for now and the app will still run, just in a limited "demo" way for those specific features.
     > 🔴 **One important warning if you leave `EMAIL_API_KEY` unset**: with `NODE_ENV=production` set (as you just did above), your app will honestly tell users their sign-up code couldn't be sent, rather than ever showing it on screen — unlike SMS in India, email OTP has no separate approval wait; getting `EMAIL_API_KEY` from Resend (`docs/GETTING_API_KEYS.md` §1) takes a couple of minutes and works immediately. Set it up before inviting the public to sign up on your site.

   - `ADMIN_EMAILS=` → add the email address you'll sign up with on your own site (comma-separated if more than one), e.g. `ADMIN_EMAILS=you@example.com`. This is what's allowed to manually trigger an instrument-list refresh (`POST /api/admin/instruments/refresh`, used elsewhere in this guide's maintenance steps) — leaving it empty means *no one* can call that, including you.

3. Once you've edited everything, save and exit `nano`: press **Ctrl+O**, then **Enter** (this saves), then **Ctrl+X** (this exits).

4. Lock this file down so only you can read it:
   ```
   chmod 600 .env
   ```

**Part 6 is done.**

---

## Part 7 — Build and start your backend (the app's brain)

1. Still inside `~/divve/dive-main/backend` on the server, install everything the app needs:
   ```
   npm install
   ```
2. Turn your code into its final, fast, ready-to-run form:
   ```
   npm run build
   ```
3. Start it, using PM2 so it keeps running forever:
   ```
   pm2 start dist/index.js --name divve-backend
   ```
4. Tell PM2 to automatically restart your app if the whole server ever reboots:
   ```
   pm2 startup
   ```
   This will print one long command starting with `sudo env PATH=...` — copy that exact line it gives you and run it too.
5. Save PM2's current setup:
   ```
   pm2 save
   ```
6. Check it's alive:
   ```
   pm2 status
   ```
   You should see `divve-backend` with a green **"online"** status.

**Part 7 is done — your app's brain is now running.**

---

## Part 8 — Build your frontend (the part people see)

Your website's visual side needs to be told, once, exactly where its "brain" (the backend) lives — this gets permanently baked in when you build it, so do this step carefully with your real domain name.

1. On the server, type:
   ```
   cd ~/divve/dive-main/frontend
   cp .env.example .env.production
   nano .env.production
   ```
   > 🔵 The filename matters here: `.env.production` (not plain `.env`) is specifically what the build tool uses for a real production build — using that exact name is what lets it catch a mistake here itself (see the warning below) instead of silently shipping a broken site.
2. Delete whatever is there and type this one line instead (using your real domain):
   ```
   REACT_APP_BACKEND_URL=https://yourdomain.com
   ```
3. Save and exit: **Ctrl+O**, **Enter**, **Ctrl+X**.
4. Install and build:
   ```
   npm install
   npm run build
   ```
   This creates a new folder called `build` full of your finished, ready-to-show website files.
   > 🔴 If this step fails with an error mentioning `REACT_APP_BACKEND_URL`, it means step 1-3 above didn't get saved correctly — go back and check `.env.production` actually has your real domain in it, then run `npm run build` again. This check exists specifically so a mistake here can't silently ship a broken site — every screen would otherwise look fine but nothing would ever load, with no obvious error message anywhere.

**Part 8 is done.**

---

## Part 9 — Connect everything with Nginx

Nginx is the "front desk" of your server — it's the thing that actually greets visitors, hands them your website's files, and quietly forwards anything meant for the app's brain to it, without ever exposing the brain directly to the internet.

1. On the server, create a new configuration file:
   ```
   sudo nano /etc/nginx/sites-available/divve
   ```
2. This file will be empty — type (or paste) exactly this, replacing `yourdomain.com` with your real domain in both places it appears:
   ```
   server {
       listen 80;
       server_name yourdomain.com www.yourdomain.com;

       # Nginx's own default request-size limit is only 1MB — too small for
       # Bot Scan, which can send up to 30 screen-capture images in a single
       # request. This raises it to match what the app itself is already
       # willing to accept (see backend/src/routes/botscan.routes.ts), so
       # Nginx never rejects something the app would have handled fine.
       client_max_body_size 150m;

       location /api/ {
           proxy_pass http://localhost:8000/api/;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           # Nginx's own default is 60s — too short for Bot Scan/document
           # upload, which can legitimately take a while analyzing several
           # images at once. Set comfortably longer than the app's own
           # internal AI-call timeout (backend/src/services/aiExtractionService.ts)
           # so the app's own clear "took too long" error has a chance to
           # reach the visitor, instead of Nginx cutting the connection first
           # with a generic one.
           proxy_read_timeout 140s;
       }

       location / {
           root /home/ubuntu/divve/dive-main/frontend/build;
           try_files $uri /index.html;
       }
   }
   ```
3. Save and exit: **Ctrl+O**, **Enter**, **Ctrl+X**.
4. **Let Nginx actually reach your files.** Your home folder (`/home/ubuntu`) is private by default on Ubuntu — nothing else on the server, including Nginx, can look inside it otherwise. Without this step, every visitor gets a blank page or an endless redirect loop, since Nginx can't read `index.html` at all:
   ```
   chmod o+x /home/ubuntu
   sudo chmod -R o+rX /home/ubuntu/divve/dive-main/frontend/build
   ```
   The first line lets Nginx walk *through* your home folder (without being able to list what's in it) — the second makes the actual website files inside `build` readable.
5. Turn this configuration on:
   ```
   sudo ln -s /etc/nginx/sites-available/divve /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   ```
6. Check for typos:
   ```
   sudo nginx -t
   ```
   It should say `syntax is ok` and `test is successful`.
7. Restart Nginx to apply everything:
   ```
   sudo systemctl restart nginx
   ```

**Part 9 is done.** If you visit `http://` followed by your server's IP address (from Part 2) in a browser right now, you should already see your website — just not yet at your real domain name, and not yet with the padlock. That's the next two parts.

---

## Part 10 — Point your GoDaddy domain at your server

1. Go to **godaddy.com** and log in.
2. Click your account icon (top-right) → **"My Products"**.
3. Find your domain and click **"DNS"** next to it (sometimes labeled **"Manage DNS"**).
4. You'll see a list of "records." Look for one with Type **"A"** and Name **"@"**.
   - If it exists, click the pencil/edit icon next to it, and change its **"Value"** to your Elastic IP address from Part 2 (for this deployment, `16.192.0.164`). Save.
   - If it doesn't exist, click **"Add"**, choose Type **"A"**, Name **"@"**, and Value = your Elastic IP. Save.
5. Do the same again for Name **"www"**: either edit its existing "A" record's Value to the same Elastic IP, or add a new one the same way.
6. That's it on GoDaddy's side. Changes like this can take anywhere from a few minutes to a few hours to fully spread across the internet (this is called "DNS propagation" — completely normal, just be patient).
7. To check if it's ready: open a new browser tab and go to `http://yourdomain.com`. Once it shows your website (instead of an error or GoDaddy's placeholder page), you're ready for the final part.

**Part 10 is done.**

---

## Part 11 — Add the padlock (free HTTPS)

Right now your site works, but browsers will warn visitors it's "not secure." This part fixes that permanently, for free, using a service called Let's Encrypt.

1. Back in your PowerShell window connected to the server, install Certbot (the tool that sets this up automatically):
   ```
   sudo apt install -y certbot python3-certbot-nginx
   ```
2. Run it, replacing `yourdomain.com` with your real one:
   ```
   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```
3. It will ask for your email (for renewal reminders — real expiry is handled automatically, this is just a backup notice) and ask you to agree to the terms — type `y` and press Enter where asked.
4. When it asks about redirecting HTTP traffic to HTTPS, choose the **redirect** option (usually option `2`) — this makes sure everyone automatically gets the secure, padlocked version.
5. Certbot will finish and confirm your certificate is installed. It also quietly sets itself up to auto-renew every 90 days — you don't need to do anything more, ever.

**Visit `https://yourdomain.com` now** — you should see a padlock icon next to the address in your browser.

---

## Part 12 — One last security step: close every other door

1. On the server, turn on its own firewall:
   ```
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'
   sudo ufw enable
   ```
   Type `y` when it asks to confirm. This blocks every single connection attempt to your server except SSH (your own login) and web traffic (ports 80/443) — nothing else, including your app's internal port 8000 or your database, is reachable from outside anymore.

2. **Optional but recommended — tighten your database's front door too:** go back to MongoDB Atlas (Part 1), find **"Network Access"** in the left-hand menu, delete the `0.0.0.0/0` entry you added earlier, and add a new one containing only your server's Elastic IP address instead. This means only your server (not "anywhere on the internet") can ever reach your database.

**Part 12 is done. Your whole setup is now locked down.**

---

## Part 13 — Final check

Visit `https://yourdomain.com`, and actually try the app:
- Sign up for a new account.
- Add a holding.
- Check your DIVVE Score appears.

If something doesn't work, the most useful next step is checking your backend's own logs — on the server, type:
```
pm2 logs divve-backend
```
This shows you exactly what your app is doing (and any errors) in real time. Press **Ctrl+C** to stop watching.

---

## Keeping it running (for later, whenever you make changes)

**To publish a code change you made on your own computer:**
1. In GitHub Desktop, review your changes, write a short summary, and click **"Commit"**, then **"Push origin"**.
2. On the server: `cd ~/divve/dive-main`, then `git pull`.
3. If you changed backend code: `cd backend && npm run build && pm2 restart divve-backend`.
4. If you changed frontend code: `cd frontend && npm run build` (Nginx will pick up the new files automatically — no restart needed).

**Two things `git pull` never touches, because they don't live in the code at all:**
- **Your Nginx configuration** (`/etc/nginx/sites-available/divve`) — it's a file that lives only on the server, created by hand in Part 9. If a future update's instructions say to add or change a line in it, you have to edit that file yourself (`sudo nano /etc/nginx/sites-available/divve`), then `sudo nginx -t` and `sudo systemctl restart nginx` — a code update alone will never change it for you.
- **Data that only gets loaded once.** The instrument list (stocks, funds, etc. your app can search) only re-seeds itself automatically once a day (6am IST) or when the database is completely empty on first startup. If an update adds new entries to that bundled list, a restart alone won't pull them in sooner — see the refresh command further below.

**If your live site predates a specific fix, the fix's own writeup (in `docs/PRODUCTION_READINESS_AUDIT.md`) will say so and describe exactly what it changed — check there if you're ever unsure whether something needs an extra step beyond the usual pull-and-rebuild.**

> 🔵 **As of 2026-08-08, if your live site was deployed before this date:** it's running from before several fixes made since — including the Bot Scan/document upload "stuck scanning" timeout fix and a real permission check on the instrument-refresh endpoint. A plain `git pull` + rebuild + restart picks up all the code changes, but a few extra one-time steps are needed for everything to actually take effect:
> 1. **Add the Nginx timeout line.** Open `sudo nano /etc/nginx/sites-available/divve` and check the `location /api/` block already has `proxy_read_timeout 140s;` (copy it from the block shown in Part 9 above if it's missing — this is what lets Bot Scan's own clear "took too long" message reach you instead of Nginx cutting the connection first with a generic error). Then `sudo nginx -t` and `sudo systemctl restart nginx`.
> 2. **Add `ADMIN_EMAILS` to `backend/.env`** if it isn't there yet (`cd ~/divve/dive-main/backend && nano .env`) — set it to your own sign-up email, e.g. `ADMIN_EMAILS=you@example.com` (this update added a real check for who's allowed to trigger the refresh below; without this line, *no one* can, including you). Save, then `pm2 restart divve-backend` so the new value actually takes effect — env var changes aren't picked up by a running process on their own.
> 3. **Refresh the instrument list** (do steps 1-2 above first, so the request has both the longer timeout and permission to work): log in and trigger it manually instead of waiting for the 6am cron —
>    ```
>    TOKEN=$(curl -s -X POST https://yourdomain.com/api/auth/login \
>      -H "Content-Type: application/json" \
>      -d '{"identifier":"your-email@example.com","password":"your-password"}' \
>      | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
>    curl -s -X POST https://yourdomain.com/api/admin/instruments/refresh -H "Authorization: Bearer $TOKEN"
>    ```
>    This can take a few minutes (AMFI's mutual-fund data source is unreliable from cloud servers — see `docs/PROTOTYPE_LIMITATIONS.md` §3) — that's expected, not a sign anything is wrong.
>
> Two more things worth knowing about this update, that need no action from you: everyone currently logged in will be quietly signed out the next time their session tries to refresh (a one-time, harmless side effect of a security fix — see PRODUCTION_READINESS_AUDIT.md #10); and the stronger JWT-secret check added in the same update (#4) should be a complete no-op, since Part 6 already had you generate strong secrets with `openssl rand -base64 48` — worth double-checking `backend/.env` still has real values there and not a placeholder, since the app will now refuse to start otherwise instead of quietly running unsafely.

**To check your app is healthy at any time:** `pm2 status` (should show "online") and `pm2 logs divve-backend` (to see what it's doing).

**To restart your app:** `pm2 restart divve-backend`.

**Keep these things private, forever, and never put them in GitHub:**
- Your `Divve-key.pem` file (already protected by `.gitignore`, but never share it manually either).
- Your `backend/.env` file and everything inside it (also already protected by `.gitignore`).
- Your MongoDB database password.
