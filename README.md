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
`node tests/acceptance-test.js` (131 checks) and `node tests/press-test.js` (77 checks) against a running server.
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

## Sidebar order
Overview (Dashboard) → **Printing Press** → **PVC / Media** → **CTP** → Shared (Customers, Accounts/Payments/Refunds, Expenses, Reports, Press Settings, Users & Settings, App, Subscription).
The old *General* and *Internal Inventory* sections are gone: their items (lamination film, paper, solvent, wash, developer, filter paper…) now live in **Press → Store**, and ID-card / memo / binding jobs are done as **Counter Jobs** (order + challan + invoice in one step). Old General bills stay viewable read-only.

## Printing Press (from the offset press spec)
- **Orders**: many products per order, each with its own design, production steps (from templates), delivery and costs. Advance payment on the order is auto-allocated when the invoice is made.
- **Design**: start → send → approve / revision; file upload after approval. Printing/plate steps are blocked until the design is approved.
- **Production board + calendar** (day/week/month), machines, outsourcing (with payment → expense).
- **Store**: items, purchases (ream↔sheet, weighted average cost), use/wastage/adjust, material **issue** (only this reduces stock) and **return** (usable → stock, damaged → loss). Customer-supplied materials register.
- **Delivery**: partial deliveries make A5 challans; one final A4 invoice per order (discount, adjustment, close-early with reason).
- **Void register** with snapshot, optional second-person approval.
- **Job costing**: estimated vs actual (materials + outsourcing + extra costs).
- **Paper calculator**: ups (normal/rotated/mixed), make-ready, wastage, reams, weight, cost.
- **29 press reports** with CSV export; dashboard shows all divisions together.
- Roles: Marketing Officer (sees only own orders), Store Staff, Designer, Accountant, Manager.

## Refunds
Cancelling any invoice (Press, PVC, CTP, old General) that already had money paid asks whether to **refund** it now (amount + method) instead of leaving it as advance. Refunds can also be made any time from Accounts or the customer page, up to the customer's available credit. Refunds appear in the ledger and reduce net collection.

## Pen-and-paper catch-up (power / internet cuts)
Every entry form has a date (and time for payments/steps). Anyone may back-date up to **Press Settings → back-date days** (default 31); older dates need the *date.edit* permission. Future and impossible dates (e.g. 31 Feb) are rejected. Date maths now uses UTC internally, so "yesterday" is correct in Bangladesh time (UTC+6).

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
