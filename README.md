# Baybex Printers Manager — by Baybex Digital

Multi-tenant SaaS for CTP plate + PVC / digital print businesses: stock, sales, invoices, challans, customer ledger, reports.
Node.js + PostgreSQL. No `.env`, YML or XML — all settings are in the `CONFIG` block at the top of `server.js`.

## Run
1. Node.js 18+ and PostgreSQL 13+.
2. Edit `CONFIG.db` in `server.js` (and change `CONFIG.superAdmin` password before going live).
3. `npm install` then `npm start`.

| URL | Who |
|---|---|
| `/` | Public website — features, pricing, self signup (7-day trial) |
| `/app` | Business app — staff log in with **Business ID + username + password** |
| `/super` | Baybex super admin — default `superadmin / baybex@123` (change it) |

## How multi-tenancy works
- Every business gets its **own PostgreSQL schema** (`t_1`, `t_2`, …). Data is fully isolated; all business SQL runs with `search_path` set to that schema.
- Platform tables live in `public`: `platform_tenants`, `platform_plans`, `platform_payments`, `platform_sessions`, `platform_admins`, `platform_settings`, `platform_audit`.
- On every start the app upgrades every tenant schema automatically.

## Plans, discounts & coupons (Super admin → Plans & Pricing)
- Edit everything per plan: name, months, regular price, badge, description, feature list (one per line), button text, display order, visible / hidden, highlighted.
- **Discount per plan**: none / **percentage** (e.g. 20%) / **flat** (e.g. ৳1,000), with your own label ("Eid Offer") and optional start and end dates. The price returns to normal automatically after the end date. A live preview shows exactly how the card will look.
- **Discount offer on many plans** applies one offer to several plans at once, or removes it.
- **Coupon codes**: percentage or flat, all plans or chosen plans, max uses, start and end dates, on/off. Businesses enter the code on their Subscription page. A coupon applies after the plan discount, and a use is counted when you approve the payment.
- The website, brochure, Subscription page and "Add subscription" all use the same final price. Payments record the regular price, plan discount, coupon and amount paid.

## Plans & subscription
- Default plans: Monthly ৳500 · 3 Months ৳1,500 · 6 Months ৳3,000 · 1 Year ৳6,000 — edit prices, badges, add/hide plans in **Super admin → Plans & Pricing**.
- Trial length (default 7 days), signup on/off and the bKash/Nagad receiving numbers are in **Super admin → Platform Settings**.
- When the trial or subscription ends, the business is **locked** except the Subscription page and data backup.
- The business pays by bKash/Nagad and submits the Transaction ID → it appears in **Super admin → Subscription Payments** → Approve. Days are never lost: the new period starts after the current trial/period ends.
- Super admin can also add a subscription manually (cash), give free days, suspend, edit dates/plan, reset any user's password, back up a business, delete a business, and **Open as business admin** to edit anything inside it (shown with a banner and logged).

## What each business can edit (Users & Settings / masters)
Logo & brand colour · business details · invoice/challan titles and footer notes · number sequences (continue from paper books) · plate sizes, names, sizes & rates (CTP → Plate Master) · media & roll widths (PVC → Media Master) · payment methods, expense categories, wastage reasons, ink colours · stock defaults · staff users, roles and every permission.

## Android app
- Source: `BaybexPrintersManager-Android.zip` (separate download). Build it in Android Studio; see its README.
- **Super admin → Android App**: upload each new APK with its version code/name, notes and an optional *Force update*.
  APKs are stored in PostgreSQL, so they survive redeploys.
- Businesses download it from **Android App** in their panel (button + QR code). The website also has a download section.
- Installed apps call `/api/public/app/version?current=<code>` on every launch and show an update popup when a newer version is published.

## Brochure (sales PDF)
- Built-in 8-page Bangla brochure: `public/brand/brochure.pdf`. The live, printable version is at `/brochure`; it reads current phone, email, base URL, trial days and QR codes from your settings. It shows no prices.
- Public download: `/api/public/brochure.pdf`. Buttons are on the website (hero, pricing, Android section, signup, footer) and in every business's **App & Downloads** page.
- **Super admin → Brochure**: preview it, download it, or upload a replacement PDF (stored in PostgreSQL). After changing contact details, open `/brochure` → Print → Save as PDF (A4, no margins, background graphics) → upload.
- Set **Super admin → Platform Settings → Public base URL** (e.g. `https://print.baybexai.com`) so QR codes and links point to your real domain.

## Tests
`node tests/acceptance-test.js` (server running) — 98 checks: spec v1.0–1.3 acceptance tests + SaaS isolation, trial lock, payment approval, suspension, impersonation, Android release upload/version check/forced update/download, brochure upload & download, discounts & coupons.

## Deploy (Coolify / VPS)
Plain Node app on port `CONFIG.port` with a PostgreSQL service. Point a domain (e.g. a `baybexai.com` sub-domain) at it behind HTTPS.


## Public website content (Super Admin → Website Content)

Every text on the public website (`/`) can be edited from the super admin. Nothing in the HTML needs touching.

- **Sections:** Page title & Google description, announcement bar, top menu labels, hero, features, how-it-works steps, Android app, pricing headings, FAQ, signup and footer.
- **Show/hide:** each section can be shown or hidden. Hiding a section also removes its menu link.
- **Lists:** feature cards (with icon and colour), steps and FAQ questions can be added, removed and reordered.
- **Reset:** a "Reset this section to default" button on each section.
- **Placeholders:** `{trial_days}` `{product}` `{company}` `{phone}` are filled in automatically.
- **Live preview:** the website preview updates after **Save & publish**.
- **Where prices come from:** plan cards and prices still come from **Plans & Pricing**.
- **Storage and safety:** content is stored in `platform_settings.website`. Unknown keys are dropped, and text is escaped (no HTML injection).

## General section (sidebar → General, right under Dashboard)

One menu item with tabs. It covers everything outside CTP plates and PVC media.

- **Jobs & Bills** — bills for ID cards, lamination, memo / receipt books, binding, visiting cards, posters, cutting and any job type you add.
  - **Pricing:** each job type is priced per piece, per sq inch, per sq ft, per book, per set, per 100, per 1000 or per job.
  - **Minimum quantity:** charged automatically when an order is smaller (e.g. 500 visiting cards billed as 1000).
  - **Film:** lamination lines can take film from stock. The feet used are worked out from the size and the roll width, and a job that doesn't fit the width is refused.
  - **Paper:** memo and binding lines can take paper from stock.
  - **Accounts:** bills are numbered `GEN-INV-00001` and appear in the customer balance, ledger (filter "General"), payments and allocation, and backup.
  - **Cancelling:** a cancelled bill returns its film and paper to stock.
- **Lamination Film** — film rolls by machine, finish and width (inch), tracked in feet. Entries: stock in (rolls × length), own use, wastage, adjustments.
- **Paper Stock** — paper by type (offset, duplicate, triplicate, auto carbon…), GSM, size (Demy 18, F4, 1/16…) and colour, in reams, packets or sheets. Own use leaves stock with a purpose.
- **Overview** — sales by job type, low stock, a plate calculator (colours × sides × forms) and a cutting calculator (pieces per sheet, sheets needed).
- **Job Types & Lists** — the tenant edits job types (rate, minimum, uses film/paper) and every dropdown: machines, finishes, paper types, sizes, colours, units.

## Internal Inventory (sidebar → bottom)

Things the business uses itself. It starts with PVC Solvent (Ltr), CTP Wash (Ltr), CTP Developer (Ltr) and Filter Paper (Pcs), and tenants add any item with any unit.

- **Entries:** stock in, use (purpose required), wastage, adjustments.
- **Stock rules:** stock can never go below zero, and a void creates a reversal entry.

## Other changes

- **Delete on master lists:**
  - CTP plates, PVC media, customers, film, paper and internal items.
  - An unused entry is removed completely.
  - A used entry is only hidden; its history stays and stock must be zero first.
  - Customers with invoices, payments or challans cannot be deleted; untick "Active" to hide them instead.
  - Transaction records are never deleted; they are voided or cancelled as before.
- **Challans:** "Prepared by" (defaults to the logged-in user, editable) and an optional "Nickname" are saved and printed. Users also have an optional nickname.
- **Ink stock:**
  - Entries can be stock in, use / stock out (with "used for") or a correction.
  - Litres per bottle is configurable.
  - Tenants add any colour (Light Cyan, White, Orange…) with a swatch, straight from the ink page, and empty colours can be removed.
  - Use more than the stock is blocked.
- **Print / PDF everywhere:**
  - Every print button first asks for paper size: A4, A5, A3, A6, Letter, Legal, F4/Folio, or an 80 mm / 58 mm receipt roll.
  - It also asks for portrait or landscape and the margin.
  - The page prints, or saves as a PDF, at exactly that size. Receipt rolls get a narrow layout with the page length fitted to the content.
  - The last choice is remembered.
