# Laundry Service — In-house Hotel/Hostel Laundry System

A self-hosted laundry management app (CleanCloud-style) for a single property.
Guests scan a QR code to place orders; reception accepts, prices, and moves orders
through the cycle; guests get email updates at each stage and can message reception;
admins get revenue reporting and full access control.

Runs entirely on **GitHub + Netlify**. No separate database server:

- **Code** → GitHub
- **Hosting + serverless API** → Netlify Functions
- **Data** → Netlify Blobs (built into Netlify — nothing to set up)
- **Email** → Resend (free tier)

---

## Features

**Guest (via QR code)**
- Place an order: name, email, number of items
- Live order-tracking page with a status bar and estimated price
- Two-way messaging inbox with reception
- Automatic emails at every stage

**Reception / Admin**
- PIN-based cashier switching — one locked terminal, each staff member has a personal PIN (no full login)
- Accept orders: set room, pickup date & time, price, and payment (paid → cash/card, or pay at pickup)
- Order cycle: **New → Accepted → Cleaning → Ready → Completed** (guest emailed at accepted/cleaning/ready/completed)
- Pickup defaults to **6:00 PM the next day**; reception can pick any date & time
- Changing an order's **price requires a reason** — at accept time *or* when editing later (recorded in the order's audit log)
- Admin can **reset/change the order-number sequence** (Settings → Order numbering)
- Revenue reporting for any date range: revenue, collected vs outstanding, cash/card split, loads, items, average order value, daily breakdown — **export to CSV or PDF**
- Full audit log on every order (who did what, when — including emails sent)
- Guest message inbox with unread badges
- **Roles**: Admin, Cashier (reception), and **Laundry person** — laundry staff only move orders cleaning → ready (they can't accept, take payment, or mark picked up). They get the accepted-order and pre-pickup reminders so they know what to wash and when to check the lines.
- **Access levels**: admin chooses exactly what each cashier can do
- **Branded staff invitations**: email a new admin/cashier a welcome message with the app link, their role, and their PIN (Cashiers → Invite; the PIN is verified before it's included)
- **Only admins can modify an already-accepted order** (enforced server-side)
- **Follow-up reminders** for laundry that sits at "Accepted" too long *or* is **approaching** its pickup time (an admin-set number of hours before pickup — no sound is played *after* pickup time). In-app chime (every 30 min) + red flag, plus **push and email** to any number of recipients. Reminders **pause during admin-set quiet hours** (default 6 PM–7 AM) and resume afterwards. A receptionist can **report a delay** on an accepted/cleaning order, which mutes the reminder for 30 minutes, then it resumes until the order moves or another reason is given.
- Settings: pick currency, upload logo, set property name, price per load, and max pieces per load

**Pricing model:** flat price **per load**. Loads = ⌈items ÷ max-pieces-per-load⌉ (default max 25/load, admin-configurable). Reception can override the price on any order.

**Also included**
- Clean neutral theme; accent colour, **hover-highlight colour** (default `#FFF8ED`), logo and name are all set in Settings.
- Guest chooses payment at order time: **Pay now** (cash or card) or **Pay at pickup** (the default). Name, item count and payment choice are always required.
- **Admin-controlled required fields** (Settings → Required fields): make guest email required or optional, and require a room to be selected when accepting.
- An order **cannot be marked picked up until payment is collected** (fully).
- **Ready-too-long email**: if an order stays "ready for pickup" beyond a set time (default 12h), the admin — plus any staff the admin ticks in Settings → Ready-for-pickup alert — get an email to chase the guest.
- **Partial payments** — admin and users granted the *partialPayment* permission can record part of the amount; the order shows *partial (paid/total)*, tracks every payment in a ledger, and still can't be picked up until fully paid. Users without the permission can only take the full amount.
- **Reverse** an order a stage (e.g. ready → cleaning) — admins and any cashier granted the *reverseStatus* permission.
- Reports show **who** accepted / cleaned / marked ready / took payment, plus breakdowns **by shift** (AM 06–14, PM 14–22, Night 22–06) and **by staff**. **Collected, cash and card are measured by when the payment was taken and who took it** — so a payment Jessica records at 09:55 counts for her and for that shift, even if the order was accepted on an earlier day (payments made before the ledger existed are included too). Revenue and loads still count orders by their acceptance shift. The report opens on **today** with quick presets (Today, Last 7 / 15 / 30 days, This month) and can be **filtered and exported (CSV/PDF) to a single shift** within any date range.
- The **laundry** role no longer sees the "Ready for pickup" column — their board ends at *Mark ready*.
- Admin can **correct the recorded payment date** on any paid order from the Edit dialog.
- **Shift handovers:** opening *and* closing a shift lists the laundry currently in progress (with **unpaid items flagged**) and requires the receptionist to tick the items and acknowledge they've physically checked the laundry area. Closing also shows a **summary of the shift's activity** (laundry received, payments taken with cash/card split, and picked up). No cash counting. The shift (AM/PM/Night) is **auto-selected for the current time** and can't be set to a different one.
- **Repeating reception chimes**, each until resolved: a new-order ping (until every order is accepted), the same urgent ping for orders **stuck past the threshold** (default 4h), a new-message ping (until reception reads it), and a calmer start-a-shift chime (until a shift is open). **Only an admin can mute** the sound.
- **Auto-lock** after 5 minutes of inactivity.
- **Shift-boundary lock:** when the clock crosses into a new shift period, the terminal locks and asks whether to start a new shift or continue the current one — continuing requires the PIN of the cashier who started that shift. If they continue, the same prompt reappears on **every** subsequent auto-lock until a new shift is finally started.
- Orders are tagged by **room name** (e.g. *Duafe*) — chosen from an **admin-defined dropdown** (Settings → Rooms), or free text if no rooms are set.
- **One-click backup & restore** (admin Settings): download a full JSON snapshot of all data, and restore it later.
- Generic app icon (favicon), and staff can type their PIN on a physical keyboard (PC) as well as the on-screen pad.
- **Installable app (PWA)** with **push notifications** — new orders, messages and follow-ups reach every device that enabled alerts **even when the app is fully closed**. The one exception is the **"start a shift"** reminder: in Settings → Notification devices, an admin ticks exactly which device(s) should receive that one when closed (everyone still hears it in-app).
- **Admin can bulk-delete orders** created within a chosen date range (Settings → Delete orders).

**Bed linen & towels (Linen tab)**
- **Every piece is tracked by its own code** (L00001 …) on a printed QR label. Staff scan with the phone camera, a handheld USB/Bluetooth scanner (it types the code and presses Enter), or type the code.
- Each piece is always in one state: **clean** (storeroom or a room's cupboard), **in use** (on a bed, or a room's towels), **soiled**, **in the wash**, **missing**, or **out of stock** (damaged, worn out, lost, charged to a guest). Every move records who did it and when, and each piece keeps its own history.
- **Rooms** (Setup): each room's beds and sizes (Single/Double/Queen/King), its towels, and whether it has its own **linen cupboard**. What each bed size takes is set once; defaults follow the handbook (double sheet + cover sheet; queen/king: big sheet + 2 double sheets).
- **Change a bed or towels**: tap it, everything on it comes off into the soiled bin (or is marked missing / stays), scan what goes on, or press *Pick for me* (room's cupboard first, then the storeroom, least-washed first).
- **Reception marks rooms checked out**; their beds and towels show as due until changed. Beds are also due after a set number of days (default 3), towels after 1.
- **Wash batches**: send the soiled bin, then scan each piece back as *back clean*, *re-wash* or *damaged*. Anything not scanned is marked missing against that batch. Batches still out after 24 h are flagged.
- **Counts**: scan everything clean in the storeroom or a cupboard; unscanned pieces become missing (with a note), scanned pieces are recorded there.
- **Losses & reorder** (admins): missing now, lost/charged and damaged/worn by period and their cost, where losses happen, a priced **reorder list** that brings every item back to **3 sets per bed and bathroom** (admin-set) and replaces pieces near the end of their wash life. CSV export of every piece.
- **Labels**: Setup → *Add new linen* creates the pieces and offers **Print labels** (QR + code + item), or print labels for any filtered list under *Pieces*. Use wash-proof labels.
- **Roles & permissions**: new **Housekeeping** role (Linen and Guide only — no orders, chimes or shift prompts). New permissions *linenUse*, *linenWash* (laundry by default), *linenCheckout* (cashiers by default) and *linenManage* (admins).
- Linen is included in **backup & restore**.

---

## Deploy in ~10 minutes

### 1. Put the code on GitHub
```bash
cd hostel-laundry
git init
git add .
git commit -m "Laundry system"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

### 2. Connect to Netlify
1. Sign in at [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
2. Pick your GitHub repo. Netlify auto-detects settings from `netlify.toml` (publish `public`, functions `netlify/functions`). Click **Deploy**.
3. Netlify Blobs and the scheduled "stuck order" function are enabled automatically — no extra steps.

### 3. Set environment variables
In Netlify: **Site configuration → Environment variables → Add**. Set `SESSION_SECRET` plus **one** email backend:

| Key | Value |
|-----|-------|
| `SESSION_SECRET` | A long random string. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GMAIL_USER` | Your Gmail address (Gmail backend) |
| `GMAIL_APP_PASSWORD` | A Gmail App Password — see "Sending with Gmail" below |
| `EMAIL_FROM` | e.g. `somewhere nice <youraddress@gmail.com>` |

(Prefer Resend instead? Set `RESEND_API_KEY` and leave the `GMAIL_*` vars blank.)

Two more, only if this site is joined to the group hub — see
**Signing in from the group hub** below:

| Key | Value |
|-----|-------|
| `INSIGHT_SSO_URL` | `https://insight.niceoperation.com/api/sso/redeem` |
| `INSIGHT_SSO_SECRET` | The same value Insight holds as `SSO_SECRET_LAUNDRY` |

Then **Deploys → Trigger deploy → Deploy site** so the variables take effect.

### 4. First-run setup
Open `https://<your-site>.netlify.app/app`. On first visit you'll create the **admin account** (property name + admin PIN). After that, the terminal locks and everyone signs in with their PIN.

### 5. Finish configuration (Settings tab, admin only)
- Choose **currency**, upload your **logo**, set **price per load** and **max pieces per load**.
- Set **Base URL** to your Netlify address (used in guest emails + QR). Leaving it blank auto-uses the current address.
- Set **admin & reception alert emails** and the **stuck-order threshold**.
- Print the **guest order QR code** shown at the bottom and place it at reception.

Done. Guests scan the QR (or visit `/order`); staff work from `/app`.

---

## Signing in from the group hub

If the group runs **Insight** — the reporting site that reads this laundry
alongside attendance, breakfast and the restaurant — somebody who has signed in
there can click **Laundry** and arrive at `/app` already signed in, without
punching a PIN.

To switch it on:

1. Generate a shared secret:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. In Netlify → **Site configuration → Environment variables**, set
   `INSIGHT_SSO_URL` to `https://insight.niceoperation.com/api/sso/redeem` and
   `INSIGHT_SSO_SECRET` to that value. Redeploy so they take effect.
3. In the attendance repository (which holds Insight), add the *same* value as
   the repository secret `INSIGHT_SSO_SECRET_LAUNDRY`, then run
   **Actions → Set Insight's secrets**.
4. In Insight under **Accounts → Where each system lives**, set this site's
   sign-in address to `https://<your-site>/sso` and tick the hand-off.

### What actually happens

What arrives at `/sso` is an opaque code, never an identity — thirty-two random
bytes Insight will exchange, once, within ninety seconds. This site calls
Insight back, server to server, with its own secret, and asks who the code was
for. A URL ends up in a browser history, a proxy log and a `Referer` header, and
none of those should ever have held somebody's address.

Three rules it follows, and they are the whole reason the arrangement is safe:

- **It never trusts the address bar.** A forged `/sso?code=…` is worthless.
- **It never creates a cashier.** If Insight names somebody who has no cashier
  record here, they are refused and told so by name. Otherwise whoever controls
  the hub could mint themselves a till account.
- **It never widens anybody.** The role Insight sends is ignored. What somebody
  may do here is the role and permissions on their own cashier record, exactly
  as when they type their PIN.

Only cashiers with an **email address** on their record can be handed over — the
address is the only identifier the two systems share. Set one under **Cashiers**
for anybody who should be able to come through.

Each system on the hub holds its own secret, so a compromised laundry cannot
mint sessions on the restaurant or anywhere else.

## Letting Insight read the revenue report

Insight reads this laundry's revenue report every night, and on **Check laundry
now**, to set it beside the front desk's shifts. A PIN session lasts 12 hours,
so Insight uses a fixed **reports key** instead. The key opens `GET /api/report`
and nothing else: not orders, payments, cashiers, settings or the CSV export.
With no key set, nothing is opened by one.

1. Generate a key:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   (or any long password from a password manager).
2. In Netlify → **Site configuration → Environment variables**, add
   `REPORTS_API_KEY` with that value. Redeploy so it takes effect.
3. In the attendance repository (which holds Insight), add the *same* value as
   the repository secret `INSIGHT_LAUNDRY_TOKEN`, then run
   **Actions → Set Insight's secrets**.
4. In Insight under **Setup → The four systems**, check this site's address is
   filled in for the laundry.

To change the key, repeat steps 1 to 3 with a new value; the old one stops
working as soon as Netlify redeploys.

---

## Email

The app auto-selects a backend: **Gmail SMTP** if `GMAIL_USER` + `GMAIL_APP_PASSWORD` are set, otherwise **Resend** if `RESEND_API_KEY` is set, otherwise **dry-run** (logged only — handy for local testing).

### Sending with Gmail (App Password)

Gmail won't accept your normal password from an app, so you create a one-off **App Password**:

1. Turn on **2-Step Verification**: [myaccount.google.com/security](https://myaccount.google.com/security). (App Passwords only appear once 2-Step is on.)
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), name it e.g. "Laundry", and click **Create**.
3. Google shows a **16-character password** (four blocks of four). Copy it.
4. In Netlify → **Environment variables**, set:
   - `GMAIL_USER` = your Gmail address
   - `GMAIL_APP_PASSWORD` = that 16-character password (spaces are fine)
   - `EMAIL_FROM` = `somewhere nice <youraddress@gmail.com>`
5. **Deploys → Trigger deploy → Deploy site.**

Notes: Gmail sends from your real address (no domain setup needed) but caps at roughly **500 emails/day**, which is plenty for a hostel. If Google ever rotates/revokes the App Password, just create a new one and update `GMAIL_APP_PASSWORD`.

### Prefer Resend instead?

Set `RESEND_API_KEY` (and leave the `GMAIL_*` vars blank). Resend needs a **verified domain** to send from your own address — e.g. verify `hostelaccra.com` in Resend → Domains, then set `EMAIL_FROM="somewhere nice <info@hostelaccra.com>"`. Its sandbox sender `onboarding@resend.dev` only delivers to your own Resend signup email.

---

## Install the app + push notifications

The reception app is a **PWA**: open `https://<your-site>.netlify.app/app` in Chrome/Edge/Safari and choose **Install app** (desktop) or **Add to Home Screen** (mobile).

For notifications that arrive even when the app is closed, set up **Web Push** once:

1. Generate a key pair: `npm install` then `npm run gen-vapid`. It prints three values.
2. In Netlify → **Environment variables**, add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (e.g. `mailto:you@hostelaccra.com`).
3. Redeploy. In the app, each staff member taps **🔔 Enable alerts** once and allows notifications.

If you skip this, the app still works and still shows notifications while the tab is open in the background — you just won't get pushes when it's fully closed.

## Run locally (optional)

No Netlify CLI needed — a small dev server is included:

```bash
npm install
node scripts/dev-server.mjs      # → http://localhost:8888
```
Locally, data is stored as JSON files under `.data/` (git-ignored). On Netlify it uses Blobs automatically.

To also test emails locally, prefix with your key:
```bash
RESEND_API_KEY=re_xxx EMAIL_FROM="Laundry <onboarding@resend.dev>" node scripts/dev-server.mjs
```

---

## Tests

```bash
npm test                 # backend/logic tests (order lifecycle, pricing, auth,
                         # permissions, reporting, messaging, stuck-order alerts,
                         # and the group-hub sign-in hand-off)
node test/sso.mjs        # just the hand-off
node test/linen.mjs      # bed linen & towels
node test/dom-smoke.mjs  # browser smoke test (needs: npm i jsdom) — boots the real
                         # HTML/JS and drives the UI
```

---

## How the pieces map to your requirements

| Requirement | Where |
|---|---|
| QR order (name, email, items) | `/order` page → `POST /api/orders` |
| Reception accept (room, pickup, paid/pay-at-pickup, cash/card) | Accept modal → `POST /api/orders/:id/accept` |
| Email on accept + each stage | `netlify/functions/lib/email.js`, sent from `logic.js` |
| Cycle accepted→cleaning→ready + notify | `POST /api/orders/:id/advance` |
| 24h turnaround, custom pickup date/time | Settings `turnaroundHours` + accept modal picker |
| Revenue reporting + CSV/PDF export | Reports tab → `GET /api/report`, `/api/report/csv`, in-app PDF |
| Central lock-in + PIN cashier switching | Lock screen + `POST /api/auth/pin` |
| Audit log per order | `order.logs[]`, shown in order detail |
| Alert if "Accepted" > N hours (admin-set) | `stuck-check.js` (scheduled every 15 min) + Settings threshold |
| Guest messaging inbox | Track page + Messages tab |
| Only admin edits accepted orders; per-cashier access levels | `api.js` permission checks + Cashiers tab |
| Choose currency, upload logo & name | Settings tab |

---

## Security notes

- PINs are stored salted + hashed (SHA-256), never in plain text.
- Staff sessions are short-lived HMAC-signed tokens (12h) signed with `SESSION_SECRET`.
- Guest tracking links use an unguessable random ID and expose only guest-safe fields (no internal logs, no other orders).
- All staff/admin API routes require a valid session; sensitive actions require the specific permission. The one exception is the revenue report, which the `REPORTS_API_KEY` (if set) also opens, read-only.
- Always set a strong `SESSION_SECRET` in production.

## License
MIT
