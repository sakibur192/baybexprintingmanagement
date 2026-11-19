/*
 * Baybex Printers Manager — by Baybex Digital
 * Multi-tenant SaaS: CTP Plate + PVC Media + Sales + Inventory + Accounts for printing businesses.
 * Every business (tenant) gets its own PostgreSQL schema "t_<id>"; platform tables live in "public".
 * Node.js + Express + PostgreSQL (raw SQL). No .env / YML / XML — edit CONFIG below.
 */
'use strict';
const express = require('express');
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const ExcelJS = require('exceljs');
const { AsyncLocalStorage } = require('async_hooks');
const QRCode = require('qrcode');

/* ============================== CONFIG ============================== */
const CONFIG = {
  port: 3000,
db: { host: '201.18.212.48', port: 5446, user: 'postgres', password: 'nH19h4MZBaicpbRDQ2vYt5LfMDNQHcfHpsEI9VMmli6Y5bZtYJSvx35mPASU6NuG', database: 'postgres', max: 20 },
  sessionDays: 7,
  timezone: 'Asia/Dhaka',
  superAdmin: { username: 'superadmin', password: 'baybex@123', full_name: 'Baybex Super Admin' },   // created on first start only
  signupLimitPerHour: 5,
};
/* ==================================================================== */

types.setTypeParser(1082, v => v);               // DATE -> 'YYYY-MM-DD'
types.setTypeParser(1700, v => parseFloat(v));   // NUMERIC -> number
types.setTypeParser(20, v => parseInt(v, 10));   // BIGINT -> number

const pool = new Pool(CONFIG.db);
/* Tenant isolation: every request runs inside als.run({schema}) and all tenant SQL executes with search_path = that schema. */
const als = new AsyncLocalStorage();
const curSchema = () => { const s = als.getStore()?.schema; if (!s) throw new Error('No tenant context'); return s; };
const setPath = (c, local) => c.query(`SET ${local ? 'LOCAL ' : ''}search_path TO "${curSchema()}"`);
async function withConn(fn) { const c = await pool.connect(); try { await setPath(c); return await fn(c); } finally { c.release(); } }
const db = { query: (sql, p) => withConn(c => c.query(sql, p)) };
const q = (sql, p) => db.query(sql, p).then(r => r.rows);
const q1 = (sql, p) => db.query(sql, p).then(r => r.rows[0]);
const inTenant = (t, fn) => als.run({ schema: t.schema_name, tenant: t }, fn);
/* platform (public schema) helpers — always fully-qualified table names */
const pq = (sql, p) => pool.query(sql, p).then(r => r.rows);
const pq1 = (sql, p) => pool.query(sql, p).then(r => r.rows[0]);
async function ptx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { c.release(); }
}
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await setPath(c, true); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { c.release(); }
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone }).format(new Date());
const r2 = n => Math.round((+n || 0) * 100) / 100;
class AppError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const bad = (m, s) => { throw new AppError(m, s); };

/* ============================ PERMISSIONS ============================ */
const PERMS = {
  'dashboard': 'View dashboard',
  'ctp.view': 'View CTP stock', 'ctp.production': 'CTP production / opening / stock in', 'ctp.ownuse': 'CTP own use entry',
  'ctp.invoice': 'CTP invoices', 'ctp.challan': 'CTP challans', 'ctp.rates': 'Change CTP rates',
  'pvc.view': 'View PVC stock', 'pvc.stockin': 'PVC opening / stock in', 'pvc.print': 'PVC print entry',
  'pvc.wastage': 'PVC wastage', 'pvc.invoice': 'PVC invoices', 'pvc.challan': 'PVC challans', 'pvc.media': 'Manage media master',
  'ink': 'Ink stock', 'customers.view': 'View customers', 'customers.edit': 'Add / edit customers',
  'payments': 'Record payments', 'expenses': 'Business expenses', 'accounts.view': 'Accounts & ledger',
  'reports': 'Reports', 'reports.employee': 'Employee-wise reports', 'invoice.cancel': 'Cancel confirmed invoices',
  'stock.adjust': 'Stock adjustments / void entries', 'challan.standalone': 'Standalone challan (no invoice)',
  'fit.override': 'Override PVC fit check', 'date.edit': 'Back-date entries',
  'users': 'Users & roles', 'settings': 'Settings', 'backup': 'Backup & restore', 'audit': 'Audit log', 'billing': 'Subscription & billing',
};
const ALL = Object.keys(PERMS);
const DEFAULT_ROLES = {
  'Admin': ALL,
  'Manager': ['dashboard', 'ctp.view', 'pvc.view', 'ink', 'customers.view', 'accounts.view', 'reports', 'reports.employee', 'audit'],
  'Accountant': ['dashboard', 'ctp.view', 'pvc.view', 'ctp.invoice', 'pvc.invoice', 'customers.view', 'customers.edit', 'payments', 'expenses', 'accounts.view', 'reports'],
  'CTP Operator': ['dashboard', 'ctp.view', 'ctp.production', 'ctp.ownuse', 'ctp.invoice', 'ctp.challan', 'customers.view', 'customers.edit'],
  'PVC Operator': ['dashboard', 'pvc.view', 'pvc.stockin', 'pvc.print', 'pvc.wastage', 'pvc.invoice', 'pvc.challan', 'ink', 'customers.view', 'customers.edit'],
  'Designer': ['dashboard', 'pvc.view', 'pvc.print', 'pvc.invoice', 'ctp.view', 'ctp.invoice', 'customers.view', 'customers.edit'],
};
/* tenant-editable dropdown lists (defaults) */
const DEFAULT_LISTS = {
  payment_methods: ['Cash', 'Bank', 'bKash', 'Nagad', 'Rocket', 'Cheque', 'Other'],
  wastage_reasons: ['Cutting', 'Printing Error', 'Machine Error', 'Design Error', 'Media Damage', 'Other'],
  expense_categories: ['Rent', 'Salary', 'Electricity', 'Transport', 'Machine Maintenance', 'Raw Material', 'Chemical', 'Entertainment', 'Office', 'Other'],
  ink_colors: ['Cyan', 'Magenta', 'Yellow', 'Black'],
};
async function lists() {
  const r = await q1(`SELECT value FROM settings WHERE key='lists'`);
  const v = { ...DEFAULT_LISTS, ...(r?.value || {}) };
  for (const k of Object.keys(DEFAULT_LISTS)) if (!Array.isArray(v[k]) || !v[k].length) v[k] = DEFAULT_LISTS[k];
  return v;
}

/* ============================== SCHEMA ============================== */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, permissions JSONB NOT NULL DEFAULT '[]', system BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, phone TEXT, password_hash TEXT NOT NULL,
  role_id INT REFERENCES roles(id), active BOOLEAN DEFAULT true, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), created_by INT, updated_at TIMESTAMPTZ, updated_by INT);
CREATE TABLE IF NOT EXISTS audit_logs(id BIGSERIAL PRIMARY KEY, user_id INT, user_name TEXT, role_name TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs(created_at);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value JSONB);
CREATE TABLE IF NOT EXISTS idem_keys(key TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS invoice_sequences(key TEXT PRIMARY KEY, prefix TEXT NOT NULL, last_no INT NOT NULL DEFAULT 0, pad INT NOT NULL DEFAULT 5);

CREATE TABLE IF NOT EXISTS customers(id SERIAL PRIMARY KEY, name TEXT NOT NULL, company TEXT, contact_person TEXT, phone TEXT, address TEXT, email TEXT,
  opening_balance NUMERIC(14,2) DEFAULT 0, remarks TEXT, active BOOLEAN DEFAULT true,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_by INT, updated_by_name TEXT, updated_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS ix_cust_name ON customers(lower(name));
CREATE INDEX IF NOT EXISTS ix_cust_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS ctp_products(id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, alias TEXT, size_mm TEXT, size_in TEXT, unit TEXT DEFAULT 'Pcs',
  current_rate NUMERIC(12,2) DEFAULT 0, low_stock INT DEFAULT 20, sort INT DEFAULT 0, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS ctp_prices(id SERIAL PRIMARY KEY, product_id INT REFERENCES ctp_products(id), rate NUMERIC(12,2) NOT NULL, old_rate NUMERIC(12,2),
  effective_from DATE NOT NULL, created_by INT, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS ctp_stock_movements(id SERIAL PRIMARY KEY, date DATE NOT NULL, product_id INT NOT NULL REFERENCES ctp_products(id),
  type TEXT NOT NULL CHECK (type IN ('opening','production','stock_in','adj_in','sale','own_use','adj_out','challan_out')),
  qty INT NOT NULL, ref_type TEXT, ref_id INT, ref_no TEXT, party TEXT, purpose TEXT, job_ref TEXT, remarks TEXT,
  is_reversal BOOLEAN DEFAULT false, reversal_of INT, voided BOOLEAN DEFAULT false, void_reason TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_by INT, updated_by_name TEXT, updated_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS ix_ctpmv ON ctp_stock_movements(product_id, date);
CREATE INDEX IF NOT EXISTS ix_ctpmv_type ON ctp_stock_movements(type, date);

CREATE TABLE IF NOT EXISTS ctp_invoices(id SERIAL PRIMARY KEY, inv_no TEXT UNIQUE, date DATE NOT NULL, customer_id INT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  subtotal NUMERIC(14,2) DEFAULT 0, discount NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0, payment_method TEXT, job_no TEXT, delivery_date DATE, remarks TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_by INT, updated_by_name TEXT, updated_at TIMESTAMPTZ,
  confirmed_by INT, confirmed_by_name TEXT, confirmed_at TIMESTAMPTZ, cancelled_by INT, cancelled_by_name TEXT, cancelled_at TIMESTAMPTZ, cancel_reason TEXT);
CREATE INDEX IF NOT EXISTS ix_ctpinv ON ctp_invoices(date, status);
CREATE TABLE IF NOT EXISTS ctp_invoice_items(id SERIAL PRIMARY KEY, invoice_id INT NOT NULL REFERENCES ctp_invoices(id) ON DELETE CASCADE, product_id INT NOT NULL REFERENCES ctp_products(id),
  qty INT NOT NULL, rate NUMERIC(12,2) NOT NULL, line_total NUMERIC(14,2) NOT NULL, description TEXT);

CREATE TABLE IF NOT EXISTS pvc_media(id SERIAL PRIMARY KEY, category TEXT NOT NULL, width_ft NUMERIC(6,2) NOT NULL, roll_length_ft NUMERIC(10,2) DEFAULT 164,
  low_stock_ft NUMERIC(10,2) DEFAULT 20, default_rate NUMERIC(12,2) DEFAULT 0, active BOOLEAN DEFAULT true, sort INT DEFAULT 0, UNIQUE(category, width_ft));
CREATE TABLE IF NOT EXISTS pvc_print_entries(id SERIAL PRIMARY KEY, date DATE NOT NULL, customer_id INT REFERENCES customers(id), job_name TEXT, media_id INT NOT NULL REFERENCES pvc_media(id),
  roll_width NUMERIC(6,2), art_w NUMERIC(10,2) NOT NULL, art_l NUMERIC(10,2) NOT NULL, qty INT NOT NULL, orientation TEXT NOT NULL, across INT DEFAULT 1,
  printed_sqft NUMERIC(12,2), used_length NUMERIC(12,2), consumed_sqft NUMERIC(12,2), wastage_length NUMERIC(12,2) DEFAULT 0, wastage_sqft NUMERIC(12,2) DEFAULT 0, wastage_reason TEXT,
  fit_status TEXT, override_reason TEXT, remarks TEXT, invoice_id INT, voided BOOLEAN DEFAULT false, void_reason TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_by INT, updated_by_name TEXT, updated_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS ix_pvcprint ON pvc_print_entries(date);
CREATE TABLE IF NOT EXISTS pvc_stock_movements(id SERIAL PRIMARY KEY, date DATE NOT NULL, media_id INT NOT NULL REFERENCES pvc_media(id),
  type TEXT NOT NULL CHECK (type IN ('opening','stock_in','adj_in','print','wastage','adj_out','challan_out')),
  length_ft NUMERIC(12,2) NOT NULL, roll_qty NUMERIC(10,2), roll_length NUMERIC(10,2), area_sqft NUMERIC(12,2), reason TEXT,
  ref_type TEXT, ref_id INT, ref_no TEXT, party TEXT, supplier TEXT, remarks TEXT,
  is_reversal BOOLEAN DEFAULT false, reversal_of INT, voided BOOLEAN DEFAULT false, void_reason TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_pvcmv ON pvc_stock_movements(media_id, date);
CREATE INDEX IF NOT EXISTS ix_pvcmv_type ON pvc_stock_movements(type, date);
CREATE TABLE IF NOT EXISTS pvc_ink_stock(id SERIAL PRIMARY KEY, date DATE NOT NULL, color TEXT NOT NULL, pcs INT NOT NULL, liters NUMERIC(10,2) NOT NULL, remarks TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE IF NOT EXISTS pvc_invoices(id SERIAL PRIMARY KEY, inv_no TEXT UNIQUE, date DATE NOT NULL, customer_id INT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  subtotal NUMERIC(14,2) DEFAULT 0, discount NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0, payment_method TEXT, job_no TEXT, delivery_date DATE, remarks TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_by INT, updated_by_name TEXT, updated_at TIMESTAMPTZ,
  confirmed_by INT, confirmed_by_name TEXT, confirmed_at TIMESTAMPTZ, cancelled_by INT, cancelled_by_name TEXT, cancelled_at TIMESTAMPTZ, cancel_reason TEXT);
CREATE INDEX IF NOT EXISTS ix_pvcinv ON pvc_invoices(date, status);
CREATE TABLE IF NOT EXISTS pvc_invoice_items(id SERIAL PRIMARY KEY, invoice_id INT NOT NULL REFERENCES pvc_invoices(id) ON DELETE CASCADE, media_id INT NOT NULL REFERENCES pvc_media(id),
  art_w NUMERIC(10,2) NOT NULL, art_l NUMERIC(10,2) NOT NULL, qty INT NOT NULL, orientation TEXT DEFAULT 'Normal', across INT DEFAULT 1,
  sqft NUMERIC(12,2) NOT NULL, rate NUMERIC(12,2) NOT NULL, line_total NUMERIC(14,2) NOT NULL,
  used_length NUMERIC(12,2) DEFAULT 0, wastage_length NUMERIC(12,2) DEFAULT 0, wastage_reason TEXT, fit_status TEXT, override_reason TEXT,
  print_entry_id INT REFERENCES pvc_print_entries(id), description TEXT);
ALTER TABLE pvc_invoice_items ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'sqft';
ALTER TABLE pvc_invoice_items ALTER COLUMN media_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS challans(id SERIAL PRIMARY KEY, division TEXT NOT NULL CHECK (division IN ('ctp','pvc')), dc_no TEXT UNIQUE NOT NULL, date DATE NOT NULL,
  invoice_id INT, customer_id INT REFERENCES customers(id), receiver TEXT, carried_by TEXT, issuing_authority TEXT, remarks TEXT, standalone BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active', created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS challan_items(id SERIAL PRIMARY KEY, challan_id INT NOT NULL REFERENCES challans(id) ON DELETE CASCADE, invoice_item_id INT,
  product_id INT, media_id INT, qty NUMERIC(12,2) NOT NULL, length_ft NUMERIC(12,2), sqft NUMERIC(12,2), description TEXT, cost NUMERIC(14,2));

CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY, receipt_no TEXT UNIQUE, date DATE NOT NULL, customer_id INT NOT NULL REFERENCES customers(id), amount NUMERIC(14,2) NOT NULL,
  method TEXT, reference TEXT, division TEXT DEFAULT 'common', remarks TEXT, voided BOOLEAN DEFAULT false, void_reason TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_pay ON payments(customer_id, date);
CREATE TABLE IF NOT EXISTS payment_allocations(id SERIAL PRIMARY KEY, payment_id INT NOT NULL REFERENCES payments(id) ON DELETE CASCADE, division TEXT NOT NULL, invoice_id INT NOT NULL,
  amount NUMERIC(14,2) NOT NULL, created_by INT, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_alloc ON payment_allocations(division, invoice_id);

CREATE TABLE IF NOT EXISTS expenses(id SERIAL PRIMARY KEY, date DATE NOT NULL, category TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL, method TEXT, description TEXT, division TEXT DEFAULT 'common',
  voided BOOLEAN DEFAULT false, created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
`;

const SEED_PRODUCTS = [
  ['Mini Plate', 'Mini', '400 x 510 mm', '14.75" x 20.07"', 260, 1],
  ['Short Demy Plate', 'Short Kord', '508 x 570 mm', '20.00" x 22.44"', 0, 2],
  ['Demy Plate', 'Full Kord', '550 x 650 mm', '21.65" x 25.59"', 0, 3],
  ['Double Demy Plate', 'Double Demy', '740 x 925 mm', '29.13" x 36.41"', 0, 4],
];
const SEED_MEDIA = [
  ['PVC Banner', [3, 4, 5, 6, 8, 10]], ['Black Back Banner', [6]], ['Pana', [3, 4]], ['Inkjet Sticker', [3, 4]],
  ['Vinyl Sticker', [3, 4, 5]], ['Reflective Sticker', [3, 4]], ['Cloth Media', [3, 4, 5]],
];
const DEFAULT_SETTINGS = {
  company: {
    name: 'My Printing Business', tagline: 'CTP Plate · PVC / Digital Print Media', address: '', challan_address: '', phone_ctp: '', phone_manager: '', email: '', email2: '',
    logo: '', color: '', ctp_invoice_title: 'BILL / ORDER SHEET', pvc_invoice_title: 'PVC / DIGITAL PRINT INVOICE', challan_title: 'DELIVERY CHALLAN',
    invoice_note: 'Our authority is not liable for any unknown illegal reproduction ordered by the customer.',
    challan_note: 'Distribution: Each Challan should be three copy, one copy issuing office, one receiving office & one for receipted copy (Return to issuing office).',
  },
  pvc: { default_roll_length: 164, default_low_stock: 20, allow_nesting: true },
  ctp: { allow_negative_stock: false },
};

const PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS public.platform_plans(id SERIAL PRIMARY KEY, name TEXT NOT NULL, months INT NOT NULL, price NUMERIC(12,2) NOT NULL, description TEXT, badge TEXT,
  sort INT DEFAULT 0, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'none';
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS discount_label TEXT;
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS discount_starts TIMESTAMPTZ;
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS discount_ends TIMESTAMPTZ;
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '[]';
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS highlight BOOLEAN DEFAULT false;
ALTER TABLE public.platform_plans ADD COLUMN IF NOT EXISTS button_text TEXT;
CREATE TABLE IF NOT EXISTS public.platform_coupons(id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT NOT NULL CHECK (type IN ('percent','flat')), value NUMERIC(12,2) NOT NULL,
  plan_ids JSONB DEFAULT '[]', max_uses INT DEFAULT 0, used INT DEFAULT 0, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, active BOOLEAN DEFAULT true, note TEXT,
  created_by TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS public.platform_tenants(id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, schema_name TEXT UNIQUE, business_name TEXT NOT NULL, owner_name TEXT, phone TEXT,
  email TEXT, address TEXT, district TEXT, status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended')), plan_id INT REFERENCES public.platform_plans(id),
  trial_ends_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, notes TEXT, source TEXT DEFAULT 'signup', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS public.platform_admins(id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  active BOOLEAN DEFAULT true, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS public.platform_sessions(token TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('tenant','super')), tenant_id INT, user_id INT NOT NULL,
  impersonated_by INT, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_psess_tenant ON public.platform_sessions(tenant_id, user_id);
CREATE TABLE IF NOT EXISTS public.platform_payments(id SERIAL PRIMARY KEY, tenant_id INT NOT NULL REFERENCES public.platform_tenants(id) ON DELETE CASCADE, plan_id INT, plan_name TEXT,
  months INT NOT NULL, amount NUMERIC(12,2) NOT NULL, method TEXT, txn_id TEXT, sender TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), submitted_by TEXT, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, reject_reason TEXT,
  period_from TIMESTAMPTZ, period_to TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE public.platform_payments ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2);
ALTER TABLE public.platform_payments ADD COLUMN IF NOT EXISTS plan_discount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.platform_payments ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE public.platform_payments ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(12,2) DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.platform_settings(key TEXT PRIMARY KEY, value JSONB);
CREATE TABLE IF NOT EXISTS public.platform_app_releases(id SERIAL PRIMARY KEY, version_code INT UNIQUE NOT NULL, version_name TEXT NOT NULL, notes TEXT,
  force_update BOOLEAN DEFAULT false, min_version_code INT DEFAULT 0, active BOOLEAN DEFAULT true, file_name TEXT, size INT, sha256 TEXT, apk BYTEA NOT NULL,
  downloads INT DEFAULT 0, uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS public.platform_files(key TEXT PRIMARY KEY, file_name TEXT, mime TEXT, size INT, data BYTEA NOT NULL, downloads INT DEFAULT 0,
  updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS public.platform_audit(id BIGSERIAL PRIMARY KEY, admin_id INT, admin_name TEXT, action TEXT NOT NULL, tenant_id INT, details JSONB, created_at TIMESTAMPTZ DEFAULT now());
`;
const DEFAULT_PLANS = [
  ['Monthly', 1, 500, 'Pay month by month', '', 1], ['3 Months', 3, 1500, 'Quarterly subscription', '', 2],
  ['6 Months', 6, 3000, 'Half-yearly subscription', 'Popular', 3], ['1 Year', 12, 6000, 'Yearly subscription', 'Best value', 4],
];
const DEFAULT_PLATFORM = {
  brand: { company: 'Baybex Digital', product: 'Baybex Printers Manager', tagline: 'CTP plate & PVC print business management software',
    phone: '01750006696', email: 'bussiness@baybexai.com', website: 'baybex.com' },
  app_url: '',   // public base URL of this server, e.g. https://print.baybexai.com — used in brochure, QR codes and shared links
  trial_days: 7, signup_open: true, announcement: '',
  payment: { instructions: 'Send the plan amount using Send Money, then submit the Transaction ID below. Your subscription is activated after verification (usually within a few hours).', numbers: [] },
};
/* ---------- pricing: plan discounts (percent / flat, optional dates) + coupon codes ---------- */
const DEFAULT_FEATURES = ['All features', 'Unlimited invoices & customers', 'Unlimited staff logins', 'Android app', 'Reports & Excel export', 'Free updates & support'];
function discountLive(p, now = Date.now()) {
  if (!p.discount_type || p.discount_type === 'none' || !(+p.discount_value > 0)) return false;
  if (p.discount_starts && new Date(p.discount_starts).getTime() > now) return false;
  if (p.discount_ends && new Date(p.discount_ends).getTime() < now) return false;
  return true;
}
/** adds original_price / discount_amount / final_price / per_month / discount_text to a plan row */
function pricePlan(p) {
  const price = +p.price, live = discountLive(p);
  let off = 0;
  if (live) off = p.discount_type === 'percent' ? r2(price * Math.min(100, +p.discount_value) / 100) : Math.min(price, r2(+p.discount_value));
  const final = r2(Math.max(0, price - off));
  return { ...p, features: Array.isArray(p.features) && p.features.length ? p.features : DEFAULT_FEATURES,
    original_price: price, discount_active: live && off > 0, discount_amount: off, final_price: final, per_month: r2(final / Math.max(1, p.months)),
    discount_text: live && off > 0 ? (p.discount_label || (p.discount_type === 'percent' ? `${+p.discount_value}% OFF` : `৳${off} OFF`)) : null,
    discount_ends: live ? p.discount_ends : null };
}
const pricedPlans = async (onlyActive = true) => (await pq(`SELECT * FROM public.platform_plans ${onlyActive ? 'WHERE active' : ''} ORDER BY sort, months`)).map(pricePlan);
async function findCoupon(code, plan, c) {
  if (!code) return null;
  const cp = (await (c || pool).query(`SELECT * FROM public.platform_coupons WHERE lower(code)=lower($1)`, [String(code).trim()])).rows[0];
  const now = Date.now();
  if (!cp || !cp.active) bad('This coupon code is not valid');
  if (cp.starts_at && new Date(cp.starts_at).getTime() > now) bad('This coupon is not active yet');
  if (cp.ends_at && new Date(cp.ends_at).getTime() < now) bad('This coupon has expired');
  if (cp.max_uses > 0 && cp.used >= cp.max_uses) bad('This coupon has been fully used');
  const ids = Array.isArray(cp.plan_ids) ? cp.plan_ids.map(Number) : [];
  if (ids.length && !ids.includes(+plan.id)) bad(`This coupon is not valid for the ${plan.name} plan`);
  return cp;
}
/** full price breakdown for a plan + optional coupon (coupon applies after the plan discount) */
async function quote(planId, code, c) {
  const row = (await (c || pool).query(`SELECT * FROM public.platform_plans WHERE id=$1 AND active`, [planId])).rows[0];
  if (!row) bad('Select a plan');
  const p = pricePlan(row), cp = await findCoupon(code, p, c);
  let coff = 0;
  if (cp) coff = cp.type === 'percent' ? r2(p.final_price * Math.min(100, +cp.value) / 100) : Math.min(p.final_price, r2(+cp.value));
  return { plan: p, coupon: cp ? { code: cp.code, type: cp.type, value: +cp.value } : null, original: p.original_price, plan_discount: p.discount_amount,
    coupon_discount: coff, total: r2(Math.max(0, p.final_price - coff)) };
}
async function platformSetting(k) { const r = await pq1(`SELECT value FROM public.platform_settings WHERE key=$1`, [k]); return r ? r.value : DEFAULT_PLATFORM[k]; }
async function platformAudit(c, admin, action, tenantId, details) {
  await (c || pool).query(`INSERT INTO public.platform_audit(admin_id, admin_name, action, tenant_id, details) VALUES($1,$2,$3,$4,$5)`,
    [admin?.id || null, admin?.full_name || 'system', action, tenantId || null, details ? JSON.stringify(details) : null]);
}
async function migratePlatform() {
  await pool.query(PLATFORM_SCHEMA);
  if (!(await pq1(`SELECT COUNT(*)::int n FROM public.platform_plans`)).n)
    for (const p of DEFAULT_PLANS) await pool.query(`INSERT INTO public.platform_plans(name,months,price,description,badge,sort) VALUES($1,$2,$3,$4,$5,$6)`, p);
  for (const [k, v] of Object.entries(DEFAULT_PLATFORM))
    await pool.query(`INSERT INTO public.platform_settings(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING`, [k, JSON.stringify(v)]);
  if (!(await pq1(`SELECT COUNT(*)::int n FROM public.platform_admins`)).n) {
    const a = CONFIG.superAdmin;
    await pool.query(`INSERT INTO public.platform_admins(username, full_name, password_hash) VALUES($1,$2,$3)`, [a.username, a.full_name, bcrypt.hashSync(a.password, 10)]);
    console.log(`  › Super admin created: ${a.username} / ${a.password}  (change it after first login)`);
  }
  await pool.query(`UPDATE public.platform_settings SET value = jsonb_set(value, '{product}', '"Baybex Printers Manager"') WHERE key='brand' AND value->>'product' IN ('Baybex Print Manager','Baybex Printing Manager')`);
  await pool.query(`DELETE FROM public.platform_sessions WHERE expires_at < now()`);
}
/** Creates/upgrades one tenant schema. `seed` is only passed when the tenant is first created. */
async function migrateTenant(t, seed) {
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${t.schema_name}"`);
    await c.query('BEGIN');
    await c.query(`SET LOCAL search_path TO "${t.schema_name}"`);
    await c.query(SCHEMA);
    for (const [name, perms] of Object.entries(DEFAULT_ROLES))
      await c.query(`INSERT INTO roles(name, permissions, system) VALUES($1,$2,true) ON CONFLICT(name) DO NOTHING`, [name, JSON.stringify(perms)]);
    await c.query(`UPDATE roles SET permissions=$1 WHERE name='Admin'`, [JSON.stringify(ALL)]);   // Admin always has every permission
    if (seed) {
      for (const p of SEED_PRODUCTS)
        await c.query(`INSERT INTO ctp_products(name, alias, size_mm, size_in, current_rate, sort) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(name) DO NOTHING`, [...p.slice(0, 4), 0, p[5]]);
      let s = 0;
      for (const [cat, widths] of SEED_MEDIA) for (const w of widths)
        await c.query(`INSERT INTO pvc_media(category, width_ft, sort) VALUES($1,$2,$3) ON CONFLICT(category, width_ft) DO NOTHING`, [cat, w, ++s]);
    }
    for (const [k, prefix] of [['ctp_inv', 'CTP-INV-'], ['pvc_inv', 'PVC-INV-'], ['ctp_dc', 'CTP-DC-'], ['pvc_dc', 'PVC-DC-'], ['receipt', 'MR-']])
      await c.query(`INSERT INTO invoice_sequences(key, prefix) VALUES($1,$2) ON CONFLICT DO NOTHING`, [k, prefix]);
    const defaults = { ...DEFAULT_SETTINGS, lists: DEFAULT_LISTS };
    if (seed) defaults.company = { ...DEFAULT_SETTINGS.company, ...seed.company };
    for (const [k, v] of Object.entries(defaults))
      await c.query(`INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT DO NOTHING`, [k, JSON.stringify(v)]);
    if (seed?.admin) {
      const role = (await c.query(`SELECT id FROM roles WHERE name='Admin'`)).rows[0];
      await c.query(`INSERT INTO users(username, full_name, phone, password_hash, role_id) VALUES($1,$2,$3,$4,$5)`,
        [seed.admin.username, seed.admin.full_name, seed.admin.phone || null, bcrypt.hashSync(seed.admin.password, 10), role.id]);
    }
    await c.query(`DELETE FROM idem_keys WHERE created_at < now() - interval '3 days'`);
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { c.release(); }
}
/** trial / active / expired / suspended — computed from dates */
function tenantState(t) {
  const now = Date.now();
  if (t.status === 'suspended') return { state: 'suspended', blocked: true, ends_at: null, days_left: 0 };
  const paid = t.expires_at ? new Date(t.expires_at).getTime() : 0, trial = t.trial_ends_at ? new Date(t.trial_ends_at).getTime() : 0;
  if (t.status === 'active' && paid > now) return { state: 'active', blocked: false, ends_at: t.expires_at, days_left: Math.ceil((paid - now) / 864e5) };
  if (t.status === 'trial' && trial > now) return { state: 'trial', blocked: false, ends_at: t.trial_ends_at, days_left: Math.ceil((trial - now) / 864e5) };
  return { state: 'expired', blocked: true, ends_at: t.status === 'trial' ? t.trial_ends_at : t.expires_at, days_left: 0 };
}

/* ============================== HELPERS ============================== */
async function nextNo(c, key) {
  const r = (await c.query(`UPDATE invoice_sequences SET last_no=last_no+1 WHERE key=$1 RETURNING prefix, last_no, pad`, [key])).rows[0];
  return r.prefix + String(r.last_no).padStart(r.pad, '0');
}
function who(u) { return { id: u.id, name: u.full_name, role: u.role_name }; }
async function audit(c, u, action, entity, entityId, details) {
  await (c || db).query(`INSERT INTO audit_logs(user_id,user_name,role_name,action,entity,entity_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [u?.id || null, u?.full_name || 'system', u?.role_name || null, action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null]);
}
async function idem(c, req) {
  const k = req.get('X-Idempotency-Key');
  if (!k) return;
  const r = await c.query(`INSERT INTO idem_keys(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key`, [k]);
  if (!r.rowCount) bad('This entry was already submitted (duplicate prevented).', 409);
}
function entryDate(req, d) {
  if (!d) return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) bad('Invalid date');
  if (d !== today() && !req.user.perms.includes('date.edit')) bad('You are not allowed to change the entry date (requires "Back-date entries" permission).', 403);
  return d;
}
const num = (v, name, { min = 0, int = false, allowZero = false } = {}) => {
  const n = Number(v);
  if (!isFinite(n)) bad(`${name} must be a number`);
  if (int && !Number.isInteger(n)) bad(`${name} must be a whole number`);
  if (allowZero ? n < min : n <= min) bad(`${name} must be greater than ${min}`);
  return n;
};
const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);

async function ctpBalance(c, productId) {
  return (await c.query(`SELECT COALESCE(SUM(qty),0)::int b FROM ctp_stock_movements WHERE product_id=$1`, [productId])).rows[0].b;
}
async function pvcBalance(c, mediaId) {
  return +(await c.query(`SELECT COALESCE(SUM(length_ft),0) b FROM pvc_stock_movements WHERE media_id=$1`, [mediaId])).rows[0].b;
}
const lockStock = (c, div, id) => c.query(`SELECT pg_advisory_xact_lock($1, $2)`, [div === 'ctp' ? 1 : 2, id]);

async function ctpMove(c, u, m) {
  const r = await c.query(`INSERT INTO ctp_stock_movements(date,product_id,type,qty,ref_type,ref_id,ref_no,party,purpose,job_ref,remarks,is_reversal,reversal_of,created_by,created_by_name,created_role)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [m.date, m.product_id, m.type, m.qty, m.ref_type || null, m.ref_id || null, m.ref_no || null, m.party || null, m.purpose || null, m.job_ref || null, m.remarks || null,
      !!m.is_reversal, m.reversal_of || null, u.id, u.full_name, u.role_name]);
  return r.rows[0];
}
async function pvcMove(c, u, m) {
  const r = await c.query(`INSERT INTO pvc_stock_movements(date,media_id,type,length_ft,roll_qty,roll_length,area_sqft,reason,ref_type,ref_id,ref_no,party,supplier,remarks,is_reversal,reversal_of,created_by,created_by_name,created_role)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [m.date, m.media_id, m.type, r2(m.length_ft), m.roll_qty || null, m.roll_length || null, m.area_sqft == null ? null : r2(m.area_sqft), m.reason || null, m.ref_type || null,
      m.ref_id || null, m.ref_no || null, m.party || null, m.supplier || null, m.remarks || null, !!m.is_reversal, m.reversal_of || null, u.id, u.full_name, u.role_name]);
  return r.rows[0];
}

/** PVC fit / dual-measurement calculation (single source of truth, also mirrored in the UI) */
function pvcCalc({ roll_width, art_w, art_l, qty, orientation, nest }) {
  const W = +roll_width, aw = +art_w, al = +art_l, n = +qty;
  const across = orientation === 'Rotate' ? al : aw;      // dimension laid across the roll width
  const along = orientation === 'Rotate' ? aw : al;       // dimension running along the roll length
  const fits = across <= W + 1e-9;
  let per = 1;
  if (fits && nest) per = Math.max(1, Math.floor((W + 1e-9) / across));
  const rows = Math.ceil(n / per);
  const used = r2(rows * along);
  return {
    fits, fit_status: fits ? 'OK' : 'DOES NOT FIT', across: per, used_length: used,
    printed_sqft: r2(aw * al * n), consumed_sqft: r2(W * used), fill_pct: used ? r2((aw * al * n) / (W * used) * 100) : 0,
    alt_orientation_fits: (orientation === 'Rotate' ? aw : al) <= W + 1e-9,
  };
}

/* ============================== APP ============================== */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '60mb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('X-Frame-Options', 'SAMEORIGIN'); next(); });
const PUB = path.join(__dirname, 'public');
app.get('/', (req, res) => res.sendFile(path.join(PUB, 'index.html')));          // marketing + signup
app.get(['/app', '/app/'], (req, res) => res.sendFile(path.join(PUB, 'app.html')));   // tenant business app
app.get(['/super', '/super/'], (req, res) => res.sendFile(path.join(PUB, 'super.html'))); // Baybex super admin
app.get(['/brochure', '/brochure/'], (req, res) => res.sendFile(path.join(PUB, 'brochure.html'))); // printable sales brochure (A4)
app.use(express.static(PUB, { index: false, maxAge: 0 }));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cookie = (req, name) => {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
};
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
async function newSession(res, { kind, tenant_id = null, user_id, impersonated_by = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO public.platform_sessions(token,kind,tenant_id,user_id,impersonated_by,expires_at) VALUES($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval)`,
    [sha(token), kind, tenant_id, user_id, impersonated_by, String(CONFIG.sessionDays)]);
  const name = kind === 'super' ? 'bbx_sa' : 'sks_sid';
  res.append('Set-Cookie', `${name}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${CONFIG.sessionDays * 86400}`);
}
const SKIP_AUTH = p => p.startsWith('/public/') || p.startsWith('/super/') || p === '/login' || p === '/logout';
/* tenant session -> tenant context -> user */
const auth = (req, res, next) => {
  if (SKIP_AUTH(req.path)) return next();
  (async () => {
    const t = cookie(req, 'sks_sid'); if (!t) return null;
    return pq1(`SELECT s.user_id, s.impersonated_by, row_to_json(tn) tenant FROM public.platform_sessions s JOIN public.platform_tenants tn ON tn.id=s.tenant_id
      WHERE s.token=$1 AND s.kind='tenant' AND s.expires_at>now()`, [sha(t)]);
  })().then(ses => {
    if (!ses) return next(new AppError('Please log in', 401));
    inTenant(ses.tenant, () => {
      q1(`SELECT u.id,u.username,u.full_name,u.phone,u.active,r.name role_name,r.permissions perms FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [ses.user_id])
        .then(u => {
          if (!u || !u.active) return next(new AppError('Please log in', 401));
          u.perms = u.perms || [];
          req.user = u; req.tenant = ses.tenant; req.impersonated = ses.impersonated_by; req.sub = tenantState(ses.tenant);
          if (ses.tenant.status === 'suspended' && !ses.impersonated_by) return next(new AppError('This business account is suspended. Please contact Baybex Digital.', 403));
          next();
        }).catch(next);
    });
  }).catch(next);
};
const can = (...p) => (req, res, next) => (p.some(x => req.user.perms.includes(x)) ? next() : next(new AppError('You do not have permission for this action', 403)));

/* ---------- tenant auth ---------- */
const loginTries = new Map();
const throttle = (key, max, windowMs) => {
  const now = Date.now(), t = (loginTries.get(key) || []).filter(x => now - x < windowMs);
  if (t.length >= max) bad('Too many attempts. Please try again later.', 429);
  return { fail: () => { t.push(now); loginTries.set(key, t); }, clear: () => loginTries.delete(key) };
};
app.post('/api/login', wrap(async (req, res) => {
  const th = throttle('login:' + req.ip, 10, 10 * 60e3);
  const { business, username, password } = req.body || {};
  const tn = await pq1(`SELECT * FROM public.platform_tenants WHERE lower(slug)=lower($1)`, [String(business || '').trim()]);
  if (!tn) { th.fail(); bad('Business ID not found. Check the ID you received when you signed up.', 401); }
  if (tn.status === 'suspended') bad('This business account is suspended. Please contact Baybex Digital.', 403);
  const u = await inTenant(tn, () => q1(`SELECT u.*, r.name role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE lower(username)=lower($1)`, [String(username || '')]));
  if (!u || !u.active || !bcrypt.compareSync(String(password || ''), u.password_hash)) { th.fail(); bad('Wrong username or password', 401); }
  th.clear();
  await newSession(res, { kind: 'tenant', tenant_id: tn.id, user_id: u.id });
  await inTenant(tn, async () => {
    await db.query(`UPDATE users SET last_login=now() WHERE id=$1`, [u.id]);
    await audit(null, { id: u.id, full_name: u.full_name, role_name: u.role_name }, 'login', 'user', u.id);
  });
  res.json({ ok: true, business: tn.slug });
}));
app.post('/api/logout', wrap(async (req, res) => {
  const t = cookie(req, 'sks_sid');
  if (t) await pool.query(`DELETE FROM public.platform_sessions WHERE token=$1`, [sha(t)]);
  res.set('Set-Cookie', 'sks_sid=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true });
}));

app.use('/api', auth);
/* subscription gate: an expired business can still log in, see billing, pay and download its data */
const OPEN_WHEN_EXPIRED = ['/me', '/meta', '/subscription', '/subscription/pay', '/backup', '/me/password', '/logout'];
app.use('/api', (req, res, next) => {
  if (SKIP_AUTH(req.path) || !req.tenant || req.impersonated) return next();
  if (req.sub.blocked && !OPEN_WHEN_EXPIRED.includes(req.path))
    return res.status(402).json({ error: req.sub.state === 'trial' ? 'Your free trial has ended.' : 'Your subscription has expired. Renew to continue.', code: 'SUBSCRIPTION_EXPIRED' });
  next();
});

app.get('/api/me', wrap(async (req, res) => {
  const t = req.tenant, plan = t.plan_id ? await pq1(`SELECT name FROM public.platform_plans WHERE id=$1`, [t.plan_id]) : null;
  const brand = await platformSetting('brand'), announcement = await platformSetting('announcement');
  res.json({ user: req.user, today: today(), impersonated: !!req.impersonated, brand, announcement,
    tenant: { id: t.id, slug: t.slug, business_name: t.business_name, status: t.status, plan: plan?.name || null, ...req.sub } });
}));

app.post('/api/me/password', wrap(async (req, res) => {
  const { current, password } = req.body;
  const u = await q1(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) bad('Current password is wrong');
  if (String(password || '').length < 6) bad('New password must be at least 6 characters');
  await db.query(`UPDATE users SET password_hash=$1, updated_at=now(), updated_by=$2 WHERE id=$2`, [bcrypt.hashSync(password, 10), req.user.id]);
  await audit(null, req.user, 'change_password', 'user', req.user.id);
  res.json({ ok: true });
}));

app.get('/api/meta', wrap(async (req, res) => {
  const [products, media, settings, roles, users] = await Promise.all([
    q(`SELECT * FROM ctp_products ORDER BY sort, id`),
    q(`SELECT * FROM pvc_media ORDER BY category, width_ft`),
    q(`SELECT key, value FROM settings`),
    q(`SELECT id, name FROM roles ORDER BY id`),
    q(`SELECT id, full_name, username FROM users ORDER BY full_name`),
  ]);
  res.json({
    products, media, roles, users, settings: Object.fromEntries(settings.map(s => [s.key, s.value])), today: today(),
    perms: PERMS, ...(await lists()),
  });
}));

/* ---------- customers ---------- */
const CUST_BAL = `
  c.opening_balance
  + COALESCE((SELECT SUM(grand_total) FROM ctp_invoices WHERE customer_id=c.id AND status='confirmed'),0)
  + COALESCE((SELECT SUM(grand_total) FROM pvc_invoices WHERE customer_id=c.id AND status='confirmed'),0)
  - COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id=c.id AND NOT voided),0)`;

app.get('/api/customers/search', can('customers.view', 'ctp.invoice', 'pvc.invoice', 'pvc.print', 'payments'), wrap(async (req, res) => {
  const s = String(req.query.q || '').trim();
  if (!s) return res.json(await q(`SELECT id,name,company,phone FROM customers WHERE active ORDER BY name LIMIT 12`));
  res.json(await q(`SELECT id,name,company,phone, (${CUST_BAL}) balance FROM customers c WHERE active AND
      (lower(name) LIKE lower($1)||'%' OR lower(name) LIKE '%'||lower($1)||'%' OR phone LIKE '%'||$1||'%' OR lower(COALESCE(company,'')) LIKE '%'||lower($1)||'%')
    ORDER BY (lower(name) LIKE lower($1)||'%') DESC, name LIMIT 12`, [s]));
}));
app.get('/api/customers', can('customers.view'), wrap(async (req, res) => {
  const s = String(req.query.q || '').trim();
  res.json(await q(`SELECT c.*, (${CUST_BAL}) balance,
      (SELECT COUNT(*) FROM ctp_invoices WHERE customer_id=c.id AND status='confirmed')::int ctp_count,
      (SELECT COUNT(*) FROM pvc_invoices WHERE customer_id=c.id AND status='confirmed')::int pvc_count
    FROM customers c WHERE ($1='' OR lower(name) LIKE '%'||lower($1)||'%' OR phone LIKE '%'||$1||'%' OR lower(COALESCE(company,'')) LIKE '%'||lower($1)||'%')
    ORDER BY name LIMIT 1000`, [s]));
}));
async function dupCheck(c, b, exceptId) {
  const r = await c.query(`SELECT id,name,phone FROM customers WHERE id<>$3 AND (regexp_replace(lower(name),'\\s+','','g')=regexp_replace(lower($1),'\\s+','','g')
     OR ($2<>'' AND regexp_replace(COALESCE(phone,''),'\\D','','g')=regexp_replace($2,'\\D','','g'))) LIMIT 1`, [b.name, b.phone || '', exceptId || 0]);
  return r.rows[0];
}
app.post('/api/customers', can('customers.edit'), wrap(async (req, res) => {
  const b = req.body; const name = str(b.name, 150);
  if (!name) bad('Customer name is required');
  const out = await tx(async c => {
    if (!b.force) { const d = await dupCheck(c, { name, phone: b.phone }); if (d) { const e = new AppError(`A similar customer already exists: ${d.name}${d.phone ? ' (' + d.phone + ')' : ''}`, 409); e.existing = d; throw e; } }
    const r = (await c.query(`INSERT INTO customers(name,company,contact_person,phone,address,email,opening_balance,remarks,created_by,created_by_name,created_role)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [name, str(b.company), str(b.contact_person), str(b.phone, 40), str(b.address), str(b.email), r2(b.opening_balance), str(b.remarks),
      req.user.id, req.user.full_name, req.user.role_name])).rows[0];
    await audit(c, req.user, 'create', 'customer', r.id, { name });
    return r;
  });
  res.json(out);
}));
app.put('/api/customers/:id', can('customers.edit'), wrap(async (req, res) => {
  const b = req.body; const name = str(b.name, 150);
  if (!name) bad('Customer name is required');
  const out = await tx(async c => {
    const old = (await c.query(`SELECT * FROM customers WHERE id=$1`, [req.params.id])).rows[0];
    if (!old) bad('Customer not found', 404);
    if (!b.force) { const d = await dupCheck(c, { name, phone: b.phone }, old.id); if (d) bad(`Another customer has the same name/phone: ${d.name}`, 409); }
    const r = (await c.query(`UPDATE customers SET name=$1,company=$2,contact_person=$3,phone=$4,address=$5,email=$6,opening_balance=$7,remarks=$8,active=$9,
      updated_by=$10,updated_by_name=$11,updated_at=now() WHERE id=$12 RETURNING *`, [name, str(b.company), str(b.contact_person), str(b.phone, 40), str(b.address), str(b.email),
      r2(b.opening_balance), str(b.remarks), b.active !== false, req.user.id, req.user.full_name, old.id])).rows[0];
    await audit(c, req.user, 'update', 'customer', old.id, { before: old, after: r });
    return r;
  });
  res.json(out);
}));
app.get('/api/customers/:id', can('customers.view'), wrap(async (req, res) => {
  const id = +req.params.id;
  const cust = await q1(`SELECT c.*, (${CUST_BAL}) balance FROM customers c WHERE id=$1`, [id]);
  if (!cust) bad('Customer not found', 404);
  const inv = div => q(`SELECT i.*, COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='${div}' AND a.invoice_id=i.id AND NOT p.voided),0) paid
      FROM ${div}_invoices i WHERE customer_id=$1 ORDER BY date DESC, id DESC LIMIT 300`, [id]);
  const [ctp, pvc, payments, ctpItems, pvcItems] = await Promise.all([
    inv('ctp'), inv('pvc'),
    q(`SELECT p.*, COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0) allocated FROM payments p WHERE customer_id=$1 ORDER BY date DESC, id DESC`, [id]),
    q(`SELECT pr.name, SUM(ii.qty)::int qty, SUM(ii.line_total) amount FROM ctp_invoice_items ii JOIN ctp_invoices i ON i.id=ii.invoice_id JOIN ctp_products pr ON pr.id=ii.product_id
       WHERE i.customer_id=$1 AND i.status='confirmed' GROUP BY pr.name, pr.sort ORDER BY pr.sort`, [id]),
    q(`SELECT COALESCE(m.category,'Piece items') category, m.width_ft, SUM(ii.sqft) sqft, SUM(ii.line_total) amount FROM pvc_invoice_items ii JOIN pvc_invoices i ON i.id=ii.invoice_id LEFT JOIN pvc_media m ON m.id=ii.media_id
       WHERE i.customer_id=$1 AND i.status='confirmed' GROUP BY 1, m.width_ft ORDER BY 1, m.width_ft`, [id]),
  ]);
  for (const l of [ctp, pvc]) for (const i of l) i.due = i.status === 'confirmed' ? r2(i.grand_total - i.paid) : 0;
  const unallocated = r2(payments.filter(p => !p.voided).reduce((s, p) => s + p.amount - p.allocated, 0));
  res.json({ customer: cust, ctp, pvc, payments, ctpItems, pvcItems, unallocated,
    ctp_due: r2(ctp.reduce((s, i) => s + i.due, 0)), pvc_due: r2(pvc.reduce((s, i) => s + i.due, 0)) });
}));
app.get('/api/customers/:id/open-invoices', can('payments', 'customers.view'), wrap(async (req, res) => {
  const rows = await q(`SELECT * FROM (
    SELECT 'ctp' division, i.id, i.inv_no, i.date, i.grand_total, i.grand_total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='ctp' AND a.invoice_id=i.id AND NOT p.voided),0) due
      FROM ctp_invoices i WHERE customer_id=$1 AND status='confirmed'
    UNION ALL
    SELECT 'pvc', i.id, i.inv_no, i.date, i.grand_total, i.grand_total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='pvc' AND a.invoice_id=i.id AND NOT p.voided),0)
      FROM pvc_invoices i WHERE customer_id=$1 AND status='confirmed') x WHERE due > 0.004 ORDER BY date, inv_no`, [req.params.id]);
  res.json(rows);
}));
app.get('/api/customers/:id/ledger', can('accounts.view', 'customers.view'), wrap(async (req, res) => {
  const id = +req.params.id, div = req.query.division || 'all';
  const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
  const cust = await q1(`SELECT * FROM customers WHERE id=$1`, [id]);
  if (!cust) bad('Customer not found', 404);
  const rows = await q(`
    SELECT date, created_at ts, 'ctp' division, 'CTP Invoice' type, inv_no ref, COALESCE(remarks,'') narration, grand_total debit, 0::numeric credit, id ref_id FROM ctp_invoices WHERE customer_id=$1 AND status IN ('confirmed','cancelled')
    UNION ALL SELECT cancelled_at::date, cancelled_at, 'ctp', 'CTP Invoice Cancelled', inv_no, COALESCE(cancel_reason,''), 0, grand_total, id FROM ctp_invoices WHERE customer_id=$1 AND status='cancelled'
    UNION ALL SELECT date, created_at, 'pvc', 'PVC Invoice', inv_no, COALESCE(remarks,''), grand_total, 0, id FROM pvc_invoices WHERE customer_id=$1 AND status IN ('confirmed','cancelled')
    UNION ALL SELECT cancelled_at::date, cancelled_at, 'pvc', 'PVC Invoice Cancelled', inv_no, COALESCE(cancel_reason,''), 0, grand_total, id FROM pvc_invoices WHERE customer_id=$1 AND status='cancelled'
    UNION ALL SELECT p.date, p.created_at, COALESCE((SELECT CASE WHEN COUNT(DISTINCT division)=1 THEN MIN(division) ELSE 'common' END FROM payment_allocations WHERE payment_id=p.id), p.division),
      'Payment', p.receipt_no, p.method || COALESCE(' · '||p.reference,'') || COALESCE(' · '||p.remarks,''), 0, p.amount, p.id FROM payments p WHERE customer_id=$1 AND NOT voided
    ORDER BY date, ts`, [id]);
  let bal = +cust.opening_balance, opening = bal;
  const out = [];
  for (const r of rows) {
    if (div !== 'all' && r.division !== div && r.division !== 'common') continue;
    bal = r2(bal + r.debit - r.credit);
    if (r.date < from) { opening = bal; continue; }
    if (r.date > to) continue;
    out.push({ ...r, balance: bal });
  }
  res.json({ customer: cust, opening, rows: out, closing: out.length ? out[out.length - 1].balance : opening });
}));

/* ============================== CTP ============================== */
app.get('/api/ctp/stock', can('ctp.view', 'ctp.invoice', 'dashboard'), wrap(async (req, res) => {
  const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
  res.json(await q(`SELECT p.*,
      COALESCE(SUM(m.qty) FILTER (WHERE m.date < $1),0)::int before,
      COALESCE(SUM(m.qty) FILTER (WHERE m.type='opening' AND m.date BETWEEN $1 AND $2),0)::int opening,
      COALESCE(SUM(m.qty) FILTER (WHERE m.type='production' AND m.date BETWEEN $1 AND $2),0)::int production,
      COALESCE(SUM(m.qty) FILTER (WHERE m.type='stock_in' AND m.date BETWEEN $1 AND $2),0)::int stock_in,
      COALESCE(SUM(m.qty) FILTER (WHERE m.type='adj_in' AND m.date BETWEEN $1 AND $2),0)::int adj_in,
      -COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('sale','challan_out') AND m.date BETWEEN $1 AND $2),0)::int sales,
      -COALESCE(SUM(m.qty) FILTER (WHERE m.type='own_use' AND m.date BETWEEN $1 AND $2),0)::int own_use,
      -COALESCE(SUM(m.qty) FILTER (WHERE m.type='adj_out' AND m.date BETWEEN $1 AND $2),0)::int adj_out,
      COALESCE(SUM(m.qty) FILTER (WHERE m.date <= $2),0)::int closing,
      COALESCE(SUM(m.qty),0)::int balance
    FROM ctp_products p LEFT JOIN ctp_stock_movements m ON m.product_id=p.id WHERE p.active GROUP BY p.id ORDER BY p.sort`, [from, to]));
}));
app.get('/api/ctp/movements', can('ctp.view'), wrap(async (req, res) => {
  const { type = '', product = '', from = '1900-01-01', to = '2999-12-31', q: s = '' } = req.query;
  res.json(await q(`SELECT m.*, p.name product FROM ctp_stock_movements m JOIN ctp_products p ON p.id=m.product_id
     WHERE ($1='' OR m.type=ANY(string_to_array($1,','))) AND ($2='' OR m.product_id=$2::int) AND m.date BETWEEN $3 AND $4
       AND ($5='' OR lower(COALESCE(m.purpose,'')||' '||COALESCE(m.remarks,'')||' '||COALESCE(m.party,'')||' '||COALESCE(m.ref_no,'')||' '||COALESCE(m.job_ref,'')) LIKE '%'||lower($5)||'%')
     ORDER BY m.date DESC, m.id DESC LIMIT 2000`, [type, String(product), from, to, s]));
}));
/* Stock register (mirrors the paper "STOCK REGISTER": Date · B.F. · Receipts · Total · Issue (party) · Qty · Balance) */
app.get('/api/ctp/register/:pid', can('ctp.view'), wrap(async (req, res) => {
  const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
  const p = await q1(`SELECT * FROM ctp_products WHERE id=$1`, [req.params.pid]);
  const bf = (await q1(`SELECT COALESCE(SUM(qty),0)::int b FROM ctp_stock_movements WHERE product_id=$1 AND date<$2`, [p.id, from])).b;
  const rows = await q(`SELECT * FROM ctp_stock_movements WHERE product_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date, id`, [p.id, from, to]);
  let bal = bf;
  const out = rows.map(m => { const b = bal; bal += m.qty; return { ...m, bf: b, receipt: m.qty > 0 ? m.qty : 0, issue: m.qty < 0 ? -m.qty : 0, balance: bal }; });
  res.json({ product: p, bf, rows: out, closing: bal });
}));
async function ctpEntry(req, type, extra = {}) {
  const b = req.body, u = req.user;
  const product_id = +b.product_id;
  const qty = num(b.qty, 'Quantity', { int: true });
  if (type === 'own_use' && !str(b.purpose)) bad('Remarks / Purpose is required for Own Use');
  if (type === 'adj_in' || type === 'adj_out') { if (!str(b.reason)) bad('Reason is required for stock adjustments'); }
  const date = entryDate(req, b.date);
  return tx(async c => {
    await idem(c, req);
    const p = (await c.query(`SELECT * FROM ctp_products WHERE id=$1`, [product_id])).rows[0];
    if (!p) bad('Select a plate size');
    await lockStock(c, 'ctp', product_id);
    const out = ['own_use', 'adj_out'].includes(type);
    if (out) {
      const bal = await ctpBalance(c, product_id);
      const s = await getSetting('ctp');
      if (bal < qty && !s.allow_negative_stock) bad(`Not enough ${p.name} in stock. Available: ${bal} pcs`);
    }
    const m = await ctpMove(c, u, {
      date, product_id, type, qty: out ? -qty : qty, purpose: type === 'own_use' ? str(b.purpose) : (str(b.reason) || null),
      job_ref: str(b.job_ref), remarks: str(b.remarks), party: type === 'own_use' ? ((await getSetting('company')).name || 'Business') + ' – Own Use' : str(b.supplier), ref_type: extra.ref_type, ref_no: str(b.ref_no),
    });
    await audit(c, u, 'create', 'ctp_' + type, m.id, { product: p.name, qty, date, purpose: m.purpose });
    return { ...m, balance: await ctpBalance(c, product_id) };
  });
}
app.post('/api/ctp/opening', can('ctp.production'), wrap(async (req, res) => res.json(await ctpEntry(req, 'opening'))));
app.post('/api/ctp/production', can('ctp.production'), wrap(async (req, res) => res.json(await ctpEntry(req, 'production'))));
app.post('/api/ctp/stockin', can('ctp.production'), wrap(async (req, res) => res.json(await ctpEntry(req, 'stock_in'))));
app.post('/api/ctp/ownuse', can('ctp.ownuse'), wrap(async (req, res) => res.json(await ctpEntry(req, 'own_use'))));
app.post('/api/ctp/adjust', can('stock.adjust'), wrap(async (req, res) => res.json(await ctpEntry(req, req.body.direction === 'out' ? 'adj_out' : 'adj_in'))));
app.post('/api/ctp/movements/:id/void', can('stock.adjust'), wrap(async (req, res) => {
  const reason = str(req.body.reason); if (!reason) bad('Reason is required');
  res.json(await tx(async c => {
    const m = (await c.query(`SELECT * FROM ctp_stock_movements WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!m) bad('Entry not found', 404);
    if (m.voided || m.is_reversal) bad('This entry is already reversed');
    if (['sale', 'challan_out'].includes(m.type)) bad('Sales are reversed by cancelling the invoice/challan');
    await lockStock(c, 'ctp', m.product_id);
    if (m.qty > 0 && (await ctpBalance(c, m.product_id)) < m.qty) bad('Cannot void: stock would go negative');
    await c.query(`UPDATE ctp_stock_movements SET voided=true, void_reason=$1, updated_by=$2, updated_by_name=$3, updated_at=now() WHERE id=$4`, [reason, req.user.id, req.user.full_name, m.id]);
    const r = await ctpMove(c, req.user, { ...m, date: today(), qty: -m.qty, is_reversal: true, reversal_of: m.id, remarks: 'VOID: ' + reason });
    await audit(c, req.user, 'void', 'ctp_' + m.type, m.id, { reason });
    return r;
  }));
}));
app.put('/api/ctp/rates', can('ctp.rates'), wrap(async (req, res) => {
  const rate = num(req.body.rate, 'Rate', { allowZero: true });
  res.json(await tx(async c => {
    const p = (await c.query(`SELECT * FROM ctp_products WHERE id=$1 FOR UPDATE`, [req.body.product_id])).rows[0];
    if (!p) bad('Product not found');
    await c.query(`UPDATE ctp_products SET current_rate=$1, low_stock=COALESCE($3, low_stock) WHERE id=$2`, [rate, p.id, req.body.low_stock == null || req.body.low_stock === '' ? null : +req.body.low_stock]);
    if (rate !== +p.current_rate)
      await c.query(`INSERT INTO ctp_prices(product_id,rate,old_rate,effective_from,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6)`, [p.id, rate, p.current_rate, today(), req.user.id, req.user.full_name]);
    await audit(c, req.user, 'rate_change', 'ctp_product', p.id, { name: p.name, old: p.current_rate, new: rate });
    return { ok: true };
  }));
}));
app.post('/api/ctp/products', can('ctp.rates'), wrap(async (req, res) => {
  const b = req.body; const name = str(b.name, 80); if (!name) bad('Plate name is required');
  res.json(await tx(async c => {
    if ((await c.query(`SELECT 1 FROM ctp_products WHERE lower(name)=lower($1)`, [name])).rowCount) bad('A plate with this name already exists');
    const r = (await c.query(`INSERT INTO ctp_products(name,alias,size_mm,size_in,unit,current_rate,low_stock,sort,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, str(b.alias), str(b.size_mm), str(b.size_in), str(b.unit) || 'Pcs', r2(b.current_rate), +b.low_stock || 20, +b.sort || 99, b.active !== false])).rows[0];
    await c.query(`INSERT INTO ctp_prices(product_id,rate,old_rate,effective_from,created_by,created_by_name) VALUES($1,$2,NULL,$3,$4,$5)`, [r.id, r.current_rate, today(), req.user.id, req.user.full_name]);
    await audit(c, req.user, 'create', 'ctp_product', r.id, r);
    return r;
  }));
}));
app.put('/api/ctp/products/:id', can('ctp.rates'), wrap(async (req, res) => {
  const b = req.body; const name = str(b.name, 80); if (!name) bad('Plate name is required');
  res.json(await tx(async c => {
    const p = (await c.query(`SELECT * FROM ctp_products WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!p) bad('Plate not found', 404);
    if ((await c.query(`SELECT 1 FROM ctp_products WHERE lower(name)=lower($1) AND id<>$2`, [name, p.id])).rowCount) bad('Another plate has this name');
    const rate = b.current_rate === undefined || b.current_rate === '' ? +p.current_rate : r2(b.current_rate);
    const r = (await c.query(`UPDATE ctp_products SET name=$1,alias=$2,size_mm=$3,size_in=$4,unit=$5,current_rate=$6,low_stock=$7,sort=$8,active=$9 WHERE id=$10 RETURNING *`,
      [name, str(b.alias), str(b.size_mm), str(b.size_in), str(b.unit) || 'Pcs', rate, b.low_stock === '' || b.low_stock == null ? p.low_stock : +b.low_stock, b.sort === '' || b.sort == null ? p.sort : +b.sort, b.active !== false, p.id])).rows[0];
    if (rate !== +p.current_rate) await c.query(`INSERT INTO ctp_prices(product_id,rate,old_rate,effective_from,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6)`, [p.id, rate, p.current_rate, today(), req.user.id, req.user.full_name]);
    await audit(c, req.user, 'update', 'ctp_product', p.id, { before: p, after: r });
    return r;
  }));
}));
app.get('/api/ctp/rates/history', can('ctp.view', 'ctp.rates'), wrap(async (req, res) =>
  res.json(await q(`SELECT h.*, p.name FROM ctp_prices h JOIN ctp_products p ON p.id=h.product_id ORDER BY h.created_at DESC LIMIT 300`))));

/* ============================== PVC ============================== */
app.get('/api/pvc/media', can('pvc.view', 'pvc.invoice', 'pvc.print', 'dashboard'), wrap(async (req, res) => res.json(await q(`SELECT * FROM pvc_media ORDER BY category, width_ft`))));
app.post('/api/pvc/media', can('pvc.media'), wrap(async (req, res) => {
  const b = req.body; const cat = str(b.category, 80); if (!cat) bad('Media category is required');
  const w = num(b.width_ft, 'Width');
  res.json(await tx(async c => {
    const r = (await c.query(`INSERT INTO pvc_media(category,width_ft,roll_length_ft,low_stock_ft,default_rate,active) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(category,width_ft) DO UPDATE SET roll_length_ft=EXCLUDED.roll_length_ft, low_stock_ft=EXCLUDED.low_stock_ft, default_rate=EXCLUDED.default_rate, active=EXCLUDED.active RETURNING *`,
      [cat, w, +b.roll_length_ft || 164, b.low_stock_ft === '' || b.low_stock_ft == null ? 20 : +b.low_stock_ft, +b.default_rate || 0, b.active !== false])).rows[0];
    await audit(c, req.user, 'save', 'pvc_media', r.id, r);
    return r;
  }));
}));
app.put('/api/pvc/media/:id', can('pvc.media'), wrap(async (req, res) => {
  const b = req.body;
  res.json(await tx(async c => {
    const r = (await c.query(`UPDATE pvc_media SET roll_length_ft=$1, low_stock_ft=$2, default_rate=$3, active=$4 WHERE id=$5 RETURNING *`,
      [+b.roll_length_ft || 164, +b.low_stock_ft || 0, +b.default_rate || 0, b.active !== false, req.params.id])).rows[0];
    if (!r) bad('Media not found', 404);
    await audit(c, req.user, 'update', 'pvc_media', r.id, r);
    return r;
  }));
}));
app.get('/api/pvc/stock', can('pvc.view', 'pvc.print', 'pvc.invoice', 'dashboard'), wrap(async (req, res) => {
  const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
  res.json(await q(`SELECT md.*,
      COALESCE(SUM(m.length_ft) FILTER (WHERE m.date < $1),0) before,
      COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='opening' AND m.date BETWEEN $1 AND $2),0) opening,
      COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='stock_in' AND m.date BETWEEN $1 AND $2),0) stock_in,
      COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='adj_in' AND m.date BETWEEN $1 AND $2),0) adj_in,
      -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type IN ('print','challan_out') AND m.date BETWEEN $1 AND $2),0) printed,
      -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='wastage' AND m.date BETWEEN $1 AND $2),0) wastage,
      -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='adj_out' AND m.date BETWEEN $1 AND $2),0) adj_out,
      COALESCE(SUM(m.length_ft) FILTER (WHERE m.date <= $2),0) closing,
      COALESCE(SUM(m.length_ft),0) balance
    FROM pvc_media md LEFT JOIN pvc_stock_movements m ON m.media_id=md.id GROUP BY md.id ORDER BY md.category, md.width_ft`, [from, to]));
}));
app.get('/api/pvc/movements', can('pvc.view'), wrap(async (req, res) => {
  const { type = '', media = '', from = '1900-01-01', to = '2999-12-31', q: s = '' } = req.query;
  res.json(await q(`SELECT m.*, md.category, md.width_ft FROM pvc_stock_movements m JOIN pvc_media md ON md.id=m.media_id
     WHERE ($1='' OR m.type=ANY(string_to_array($1,','))) AND ($2='' OR m.media_id=$2::int) AND m.date BETWEEN $3 AND $4
       AND ($5='' OR lower(COALESCE(m.reason,'')||' '||COALESCE(m.remarks,'')||' '||COALESCE(m.party,'')||' '||COALESCE(m.ref_no,'')||' '||COALESCE(m.supplier,'')) LIKE '%'||lower($5)||'%')
     ORDER BY m.date DESC, m.id DESC LIMIT 2000`, [type, String(media), from, to, s]));
}));
async function pvcRollEntry(req, type) {
  const b = req.body, u = req.user;
  const date = entryDate(req, b.date);
  const roll_qty = num(b.roll_qty, 'Roll quantity');
  const roll_length = num(b.roll_length, 'Roll length');
  return tx(async c => {
    await idem(c, req);
    const md = (await c.query(`SELECT * FROM pvc_media WHERE id=$1`, [b.media_id])).rows[0];
    if (!md) bad('Select a media option');
    const len = r2(roll_qty * roll_length);
    const m = await pvcMove(c, u, { date, media_id: md.id, type, length_ft: len, roll_qty, roll_length, area_sqft: len * md.width_ft, supplier: str(b.supplier), ref_no: str(b.ref_no), remarks: str(b.remarks) });
    await audit(c, u, 'create', 'pvc_' + type, m.id, { media: `${md.category} ${md.width_ft} ft`, roll_qty, roll_length, length: len });
    return { ...m, balance: await pvcBalance(c, md.id) };
  });
}
app.post('/api/pvc/opening', can('pvc.stockin'), wrap(async (req, res) => res.json(await pvcRollEntry(req, 'opening'))));
app.post('/api/pvc/stockin', can('pvc.stockin'), wrap(async (req, res) => res.json(await pvcRollEntry(req, 'stock_in'))));
app.post('/api/pvc/wastage', can('pvc.wastage'), wrap(async (req, res) => {
  const b = req.body; const len = num(b.length_ft, 'Wastage length'); const date = entryDate(req, b.date);
  if (!(await lists()).wastage_reasons.includes(b.reason)) bad('Select a wastage reason');
  res.json(await tx(async c => {
    await idem(c, req);
    const md = (await c.query(`SELECT * FROM pvc_media WHERE id=$1`, [b.media_id])).rows[0]; if (!md) bad('Select a media option');
    await lockStock(c, 'pvc', md.id);
    const bal = await pvcBalance(c, md.id);
    if (bal < len) bad(`Not enough stock. Available: ${bal} ft`);
    const m = await pvcMove(c, req.user, { date, media_id: md.id, type: 'wastage', length_ft: -len, area_sqft: len * md.width_ft, reason: b.reason, remarks: str(b.remarks) });
    await audit(c, req.user, 'create', 'pvc_wastage', m.id, { media: `${md.category} ${md.width_ft}`, len, reason: b.reason });
    return m;
  }));
}));
app.post('/api/pvc/adjust', can('stock.adjust'), wrap(async (req, res) => {
  const b = req.body; const len = num(b.length_ft, 'Length'); const reason = str(b.reason); if (!reason) bad('Reason is required');
  const date = entryDate(req, b.date);
  res.json(await tx(async c => {
    await idem(c, req);
    const md = (await c.query(`SELECT * FROM pvc_media WHERE id=$1`, [b.media_id])).rows[0]; if (!md) bad('Select a media option');
    await lockStock(c, 'pvc', md.id);
    const out = b.direction === 'out';
    if (out && (await pvcBalance(c, md.id)) < len) bad('Adjustment would make stock negative');
    const m = await pvcMove(c, req.user, { date, media_id: md.id, type: out ? 'adj_out' : 'adj_in', length_ft: out ? -len : len, area_sqft: len * md.width_ft, reason, remarks: str(b.remarks) });
    await audit(c, req.user, 'adjust', 'pvc_stock', m.id, { media: `${md.category} ${md.width_ft}`, len, out, reason });
    return m;
  }));
}));
app.post('/api/pvc/movements/:id/void', can('stock.adjust'), wrap(async (req, res) => {
  const reason = str(req.body.reason); if (!reason) bad('Reason is required');
  res.json(await tx(async c => {
    const m = (await c.query(`SELECT * FROM pvc_stock_movements WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!m) bad('Entry not found', 404);
    if (m.voided || m.is_reversal) bad('Already reversed');
    if (m.ref_type) bad('This movement belongs to a print entry / invoice / challan — void that record instead');
    await lockStock(c, 'pvc', m.media_id);
    if (m.length_ft > 0 && (await pvcBalance(c, m.media_id)) < m.length_ft) bad('Cannot void: stock would go negative');
    await c.query(`UPDATE pvc_stock_movements SET voided=true, void_reason=$1 WHERE id=$2`, [reason, m.id]);
    const r = await pvcMove(c, req.user, { ...m, date: today(), length_ft: -m.length_ft, area_sqft: m.area_sqft == null ? null : -m.area_sqft, is_reversal: true, reversal_of: m.id, remarks: 'VOID: ' + reason });
    await audit(c, req.user, 'void', 'pvc_' + m.type, m.id, { reason });
    return r;
  }));
}));
app.post('/api/pvc/calc', wrap(async (req, res) => {
  const md = await q1(`SELECT * FROM pvc_media WHERE id=$1`, [req.body.media_id]);
  if (!md) bad('Select media');
  res.json({ ...pvcCalc({ ...req.body, roll_width: md.width_ft }), roll_width: md.width_ft, balance: await pvcBalance(db, md.id) });
}));

/** Records physical usage for one print job (print + wastage movements) */
async function pvcConsume(c, u, { date, media, calc, wastage_length, wastage_reason, ref_type, ref_id, ref_no, party }) {
  await lockStock(c, 'pvc', media.id);
  const need = r2(calc.used_length + (+wastage_length || 0));
  const bal = await pvcBalance(c, media.id);
  if (bal + 1e-6 < need) bad(`Not enough ${media.category} ${media.width_ft} ft stock. Needed ${need} ft, available ${r2(bal)} ft`);
  await pvcMove(c, u, { date, media_id: media.id, type: 'print', length_ft: -calc.used_length, area_sqft: calc.consumed_sqft, ref_type, ref_id, ref_no, party });
  if (+wastage_length > 0)
    await pvcMove(c, u, { date, media_id: media.id, type: 'wastage', length_ft: -wastage_length, area_sqft: wastage_length * media.width_ft, reason: wastage_reason || 'Other', ref_type, ref_id, ref_no, party });
}
function checkFit(req, calc, override_reason) {
  if (calc.fits) return null;
  if (!req.user.perms.includes('fit.override')) bad(`Artwork does not fit the roll width in this orientation${calc.alt_orientation_fits ? ' — try Rotate' : ''}. An authorized override is required.`);
  const r = str(override_reason); if (!r) bad('Artwork does not fit. Enter an override reason to continue.');
  return r;
}
app.post('/api/pvc/print', can('pvc.print'), wrap(async (req, res) => {
  const b = req.body, u = req.user;
  const date = entryDate(req, b.date);
  const art_w = num(b.art_w, 'Artwork width'), art_l = num(b.art_l, 'Artwork length'), qty = num(b.qty, 'Quantity', { int: true });
  const wl = b.wastage_length ? num(b.wastage_length, 'Wastage', { allowZero: true }) : 0;
  if (wl > 0 && !(await lists()).wastage_reasons.includes(b.wastage_reason)) bad('Select a wastage reason');
  const orientation = b.orientation === 'Rotate' ? 'Rotate' : 'Normal';
  res.json(await tx(async c => {
    await idem(c, req);
    const md = (await c.query(`SELECT * FROM pvc_media WHERE id=$1`, [b.media_id])).rows[0]; if (!md) bad('Select a media option');
    const calc = pvcCalc({ roll_width: md.width_ft, art_w, art_l, qty, orientation, nest: !!b.nest });
    const ovr = checkFit(req, calc, b.override_reason);
    let cust = null;
    if (b.customer_id) { cust = (await c.query(`SELECT id,name FROM customers WHERE id=$1`, [b.customer_id])).rows[0]; if (!cust) bad('Customer not found'); }
    const job = str(b.job_name, 150);
    if (!cust && !job) bad('Select a customer or enter a job name');
    const e = (await c.query(`INSERT INTO pvc_print_entries(date,customer_id,job_name,media_id,roll_width,art_w,art_l,qty,orientation,across,printed_sqft,used_length,consumed_sqft,
        wastage_length,wastage_sqft,wastage_reason,fit_status,override_reason,remarks,created_by,created_by_name,created_role)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [date, cust?.id || null, job, md.id, md.width_ft, art_w, art_l, qty, orientation, calc.across, calc.printed_sqft, calc.used_length, calc.consumed_sqft,
        wl, r2(wl * md.width_ft), wl > 0 ? b.wastage_reason : null, ovr ? 'OVERRIDE' : 'OK', ovr, str(b.remarks), u.id, u.full_name, u.role_name])).rows[0];
    await pvcConsume(c, u, { date, media: md, calc, wastage_length: wl, wastage_reason: b.wastage_reason, ref_type: 'print_entry', ref_id: e.id, ref_no: 'PE-' + e.id, party: cust?.name || job });
    await audit(c, u, 'create', 'pvc_print', e.id, { media: `${md.category} ${md.width_ft}`, sqft: calc.printed_sqft, used: calc.used_length, wastage: wl });
    return { ...e, balance: await pvcBalance(c, md.id) };
  }));
}));
app.get('/api/pvc/prints', can('pvc.view', 'pvc.print', 'pvc.invoice'), wrap(async (req, res) => {
  const { from = '1900-01-01', to = '2999-12-31', customer = '', unbilled = '' } = req.query;
  res.json(await q(`SELECT e.*, md.category, md.width_ft, c.name customer, i.inv_no FROM pvc_print_entries e JOIN pvc_media md ON md.id=e.media_id
      LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN pvc_invoices i ON i.id=e.invoice_id
    WHERE e.date BETWEEN $1 AND $2 AND ($3='' OR e.customer_id=$3::int) AND ($4='' OR (e.invoice_id IS NULL AND NOT e.voided))
    ORDER BY e.date DESC, e.id DESC LIMIT 1000`, [from, to, String(customer), unbilled]));
}));
app.post('/api/pvc/prints/:id/void', can('stock.adjust'), wrap(async (req, res) => {
  const reason = str(req.body.reason); if (!reason) bad('Reason is required');
  res.json(await tx(async c => {
    const e = (await c.query(`SELECT * FROM pvc_print_entries WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!e) bad('Print entry not found', 404);
    if (e.voided) bad('Already voided');
    if (e.invoice_id) bad('This print entry is billed on an invoice. Cancel the invoice first.');
    const mv = (await c.query(`SELECT * FROM pvc_stock_movements WHERE ref_type='print_entry' AND ref_id=$1 AND NOT is_reversal AND NOT voided`, [e.id])).rows;
    for (const m of mv) {
      await c.query(`UPDATE pvc_stock_movements SET voided=true, void_reason=$1 WHERE id=$2`, [reason, m.id]);
      await pvcMove(c, req.user, { ...m, date: today(), length_ft: -m.length_ft, area_sqft: m.area_sqft == null ? null : -m.area_sqft, is_reversal: true, reversal_of: m.id, remarks: 'VOID: ' + reason });
    }
    await c.query(`UPDATE pvc_print_entries SET voided=true, void_reason=$1, updated_by=$2, updated_by_name=$3, updated_at=now() WHERE id=$4`, [reason, req.user.id, req.user.full_name, e.id]);
    await audit(c, req.user, 'void', 'pvc_print', e.id, { reason });
    return { ok: true };
  }));
}));

/* ---------- ink ---------- */
app.get('/api/ink', can('ink', 'pvc.view', 'dashboard'), wrap(async (req, res) => {
  const [rows, bal] = await Promise.all([
    q(`SELECT * FROM pvc_ink_stock ORDER BY date DESC, id DESC LIMIT 500`),
    q(`SELECT color, COALESCE(SUM(pcs),0)::int pcs, COALESCE(SUM(liters),0) liters FROM pvc_ink_stock GROUP BY color`),
  ]);
  res.json({ rows, balance: (await lists()).ink_colors.map(c => bal.find(b => b.color === c) || { color: c, pcs: 0, liters: 0 }) });
}));
app.post('/api/ink', can('ink'), wrap(async (req, res) => {
  const b = req.body; if (!(await lists()).ink_colors.includes(b.color)) bad('Select an ink color');
  const pcs = num(b.pcs, 'Pieces', { int: true, min: -100000 });
  if (pcs === 0) bad('Pieces cannot be zero');
  const date = entryDate(req, b.date);
  res.json(await tx(async c => {
    await idem(c, req);
    const r = (await c.query(`INSERT INTO pvc_ink_stock(date,color,pcs,liters,remarks,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [date, b.color, pcs, pcs * 1, str(b.remarks), req.user.id, req.user.full_name, req.user.role_name])).rows[0];
    await audit(c, req.user, 'create', 'ink', r.id, { color: b.color, pcs });
    return r;
  }));
}));

/* ============================== INVOICES ============================== */
const DIV = d => { if (d !== 'ctp' && d !== 'pvc') bad('Unknown division', 404); return d; };
const PAID_SQL = div => `COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='${div}' AND a.invoice_id=i.id AND NOT p.voided),0)`;

app.get('/api/:div/invoices', wrap(async (req, res) => {
  const div = DIV(req.params.div);
  if (!req.user.perms.some(p => [div + '.invoice', 'accounts.view', 'reports', div + '.challan'].includes(p))) bad('No permission', 403);
  const { status = '', q: s = '', from = '1900-01-01', to = '2999-12-31', customer = '', created_by = '', pay = '' } = req.query;
  const rows = await q(`SELECT i.*, c.name customer, c.phone, ${PAID_SQL(div)} paid,
      (SELECT COALESCE(SUM(qty),0) FROM ${div}_invoice_items WHERE invoice_id=i.id) item_qty,
      (SELECT COALESCE(SUM(ci.qty),0) FROM challan_items ci JOIN challans ch ON ch.id=ci.challan_id WHERE ch.division='${div}' AND ch.invoice_id=i.id AND ch.status='active') delivered_qty
      ${div === 'pvc' ? `, (SELECT COALESCE(SUM(sqft),0) FROM pvc_invoice_items WHERE invoice_id=i.id) sqft` : ''}
    FROM ${div}_invoices i JOIN customers c ON c.id=i.customer_id
    WHERE ($1='' OR i.status=$1) AND i.date BETWEEN $2 AND $3 AND ($4='' OR i.customer_id=$4::int) AND ($5='' OR i.created_by=$5::int)
      AND ($6='' OR lower(COALESCE(i.inv_no,'')||' '||c.name||' '||COALESCE(c.phone,'')||' '||COALESCE(i.remarks,'')) LIKE '%'||lower($6)||'%')
    ORDER BY i.date DESC, i.id DESC LIMIT 1500`, [status, from, to, String(customer), String(created_by), s]);
  for (const r of rows) {
    r.due = r.status === 'confirmed' ? r2(r.grand_total - r.paid) : 0;
    r.pay_status = r.status !== 'confirmed' ? '-' : r.due <= 0.004 ? 'Paid' : r.paid > 0 ? 'Partially Paid' : 'Due';
    r.delivery_status = r.status !== 'confirmed' ? '-' : r.delivered_qty <= 0 ? 'Pending' : r.delivered_qty < r.item_qty ? 'Partial' : 'Delivered';
  }
  res.json(pay ? rows.filter(r => r.pay_status === pay) : rows);
}));
async function getInvoice(c, div, id) {
  const inv = (await c.query(`SELECT i.*, c.name customer, c.company, c.phone, c.address, ${PAID_SQL(div)} paid FROM ${div}_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=$1`, [id])).rows[0];
  if (!inv) bad('Invoice not found', 404);
  inv.items = (await c.query(div === 'ctp'
    ? `SELECT ii.*, p.name product, p.size_mm, p.size_in, p.alias, (SELECT COALESCE(SUM(ci.qty),0) FROM challan_items ci JOIN challans ch ON ch.id=ci.challan_id WHERE ch.status='active' AND ci.invoice_item_id=ii.id AND ch.division='ctp') delivered
         FROM ctp_invoice_items ii JOIN ctp_products p ON p.id=ii.product_id WHERE invoice_id=$1 ORDER BY ii.id`
    : `SELECT ii.*, m.category, m.width_ft, (SELECT COALESCE(SUM(ci.qty),0) FROM challan_items ci JOIN challans ch ON ch.id=ci.challan_id WHERE ch.status='active' AND ci.invoice_item_id=ii.id AND ch.division='pvc') delivered
         FROM pvc_invoice_items ii LEFT JOIN pvc_media m ON m.id=ii.media_id WHERE invoice_id=$1 ORDER BY ii.id`, [id])).rows;
  inv.payments = (await c.query(`SELECT a.amount, a.created_at alloc_at, p.* FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division=$1 AND a.invoice_id=$2 AND NOT p.voided ORDER BY p.date`, [div, id])).rows;
  inv.challans = (await c.query(`SELECT * FROM challans WHERE division=$1 AND invoice_id=$2 ORDER BY id`, [div, id])).rows;
  inv.due = inv.status === 'confirmed' ? r2(inv.grand_total - inv.paid) : 0;
  inv.pay_status = inv.status !== 'confirmed' ? '-' : inv.due <= 0.004 ? 'Paid' : inv.paid > 0 ? 'Partially Paid' : 'Due';
  const tq = inv.items.reduce((s, i) => s + +i.qty, 0), dq = inv.items.reduce((s, i) => s + +i.delivered, 0);
  inv.delivery_status = inv.status !== 'confirmed' ? '-' : dq <= 0 ? 'Pending' : dq < tq ? 'Partial' : 'Delivered';
  inv.prev_due = r2((await c.query(`SELECT (${CUST_BAL}) b FROM customers c WHERE id=$1`, [inv.customer_id])).rows[0].b);
  inv.division = div;
  return inv;
}
app.get('/api/:div/invoices/:id', wrap(async (req, res) => {
  const div = DIV(req.params.div);
  if (!req.user.perms.some(p => [div + '.invoice', 'accounts.view', 'reports', div + '.challan', 'customers.view'].includes(p))) bad('No permission', 403);
  res.json(await getInvoice(pool, div, +req.params.id));
}));

/** Validates and normalises invoice lines; returns { items, subtotal } */
async function buildItems(c, req, div, items) {
  if (!Array.isArray(items) || !items.length) bad('Add at least one item');
  const out = [], L = await lists();
  for (const [ix, it] of items.entries()) {
    const n = `Line ${ix + 1}: `;
    if (div === 'ctp') {
      const p = (await c.query(`SELECT * FROM ctp_products WHERE id=$1 AND active`, [it.product_id])).rows[0];
      if (!p) bad(n + 'select a plate size');
      const qty = num(it.qty, n + 'Quantity', { int: true });
      const rate = num(it.rate, n + 'Rate', { allowZero: true });
      out.push({ product_id: p.id, qty, rate, line_total: r2(qty * rate), description: str(it.description) });
    } else if (it.kind === 'piece') {   // per-piece items (PVC ID card etc.) — priced per piece, no roll stock
      const desc = str(it.description, 200); if (!desc) bad(n + 'enter a description for the piece item (e.g. PVC ID Card)');
      const qty = num(it.qty, n + 'Quantity', { int: true });
      const rate = num(it.rate, n + 'Rate per piece', { allowZero: true });
      out.push({ kind: 'piece', media_id: null, art_w: 0, art_l: 0, qty, orientation: null, across: 1, sqft: 0, rate, line_total: r2(qty * rate), used_length: 0,
        wastage_length: 0, wastage_reason: null, fit_status: null, override_reason: null, print_entry_id: null, description: desc });
    } else {
      let pe = null;
      if (it.print_entry_id) {
        pe = (await c.query(`SELECT * FROM pvc_print_entries WHERE id=$1`, [it.print_entry_id])).rows[0];
        if (!pe || pe.voided) bad(n + 'linked print entry not found');
        if (pe.invoice_id && pe.invoice_id !== +req.params.id) bad(n + `print entry PE-${pe.id} is already billed`);
      }
      const md = (await c.query(`SELECT * FROM pvc_media WHERE id=$1`, [pe ? pe.media_id : it.media_id])).rows[0];
      if (!md) bad(n + 'select media');
      const art_w = pe ? +pe.art_w : num(it.art_w, n + 'Width'), art_l = pe ? +pe.art_l : num(it.art_l, n + 'Length');
      const qty = pe ? +pe.qty : num(it.qty, n + 'Quantity', { int: true });
      const orientation = pe ? pe.orientation : (it.orientation === 'Rotate' ? 'Rotate' : 'Normal');
      const rate = num(it.rate, n + 'Rate per sq ft', { allowZero: true });
      const calc = pe ? { fits: true, used_length: +pe.used_length, across: pe.across, printed_sqft: +pe.printed_sqft, fit_status: pe.fit_status }
        : pvcCalc({ roll_width: md.width_ft, art_w, art_l, qty, orientation, nest: !!it.nest });
      const ovr = pe ? pe.override_reason : checkFit(req, calc, it.override_reason);
      const wl = pe ? +pe.wastage_length : (+it.wastage_length || 0);
      if (!pe && wl > 0 && !L.wastage_reasons.includes(it.wastage_reason)) bad(n + 'select a wastage reason');
      const sqft = r2(art_w * art_l * qty);
      out.push({ kind: 'sqft', media_id: md.id, art_w, art_l, qty, orientation, across: calc.across, sqft, rate, line_total: r2(sqft * rate), used_length: calc.used_length,
        wastage_length: wl, wastage_reason: wl > 0 ? (pe ? pe.wastage_reason : it.wastage_reason) : null, fit_status: ovr ? 'OVERRIDE' : 'OK', override_reason: ovr,
        print_entry_id: pe?.id || null, description: str(it.description), _media: md, _calc: calc });
    }
  }
  return { items: out, subtotal: r2(out.reduce((s, i) => s + i.line_total, 0)) };
}
async function saveItems(c, div, invoiceId, items) {
  await c.query(`DELETE FROM ${div}_invoice_items WHERE invoice_id=$1`, [invoiceId]);
  for (const it of items) {
    if (div === 'ctp') await c.query(`INSERT INTO ctp_invoice_items(invoice_id,product_id,qty,rate,line_total,description) VALUES($1,$2,$3,$4,$5,$6)`,
      [invoiceId, it.product_id, it.qty, it.rate, it.line_total, it.description]);
    else await c.query(`INSERT INTO pvc_invoice_items(invoice_id,media_id,art_w,art_l,qty,orientation,across,sqft,rate,line_total,used_length,wastage_length,wastage_reason,fit_status,override_reason,print_entry_id,description,kind)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [invoiceId, it.media_id, it.art_w, it.art_l, it.qty, it.orientation, it.across, it.sqft, it.rate, it.line_total, it.used_length, it.wastage_length, it.wastage_reason, it.fit_status, it.override_reason, it.print_entry_id, it.description, it.kind || 'sqft']);
  }
}
async function recordPayment(c, u, { date, customer_id, amount, method, reference, remarks, division, allocations }) {
  const receipt_no = await nextNo(c, 'receipt');
  const p = (await c.query(`INSERT INTO payments(receipt_no,date,customer_id,amount,method,reference,division,remarks,created_by,created_by_name,created_role)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [receipt_no, date, customer_id, r2(amount), method || 'Cash', reference || null, division || 'common', remarks || null, u.id, u.full_name, u.role_name])).rows[0];
  for (const a of allocations || []) if (a.amount > 0)
    await c.query(`INSERT INTO payment_allocations(payment_id,division,invoice_id,amount,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6)`, [p.id, a.division, a.invoice_id, r2(a.amount), u.id, u.full_name]);
  return p;
}
async function confirmInvoice(c, req, div, id, paid) {
  const u = req.user;
  const inv = (await c.query(`SELECT i.*, cu.name customer FROM ${div}_invoices i JOIN customers cu ON cu.id=i.customer_id WHERE i.id=$1 FOR UPDATE OF i`, [id])).rows[0];
  if (!inv) bad('Invoice not found', 404);
  if (inv.status !== 'draft') bad('Only draft invoices can be confirmed');
  const { items } = await buildItems(c, req, div, (await c.query(`SELECT * FROM ${div}_invoice_items WHERE invoice_id=$1 ORDER BY id`, [id])).rows);
  const inv_no = await nextNo(c, div + '_inv');
  if (div === 'ctp') {
    const need = {};
    for (const it of items) need[it.product_id] = (need[it.product_id] || 0) + it.qty;
    const allowNeg = (await getSetting('ctp')).allow_negative_stock;
    for (const pid of Object.keys(need).sort()) {
      await lockStock(c, 'ctp', +pid);
      const bal = await ctpBalance(c, +pid);
      if (bal < need[pid] && !allowNeg) {
        const p = (await c.query(`SELECT name FROM ctp_products WHERE id=$1`, [pid])).rows[0];
        bad(`Not enough ${p.name} in stock. Available ${bal} pcs, invoice needs ${need[pid]} pcs`);
      }
    }
    for (const it of items) await ctpMove(c, u, { date: inv.date, product_id: it.product_id, type: 'sale', qty: -it.qty, ref_type: 'ctp_invoice', ref_id: id, ref_no: inv_no, party: inv.customer });
  } else {
    for (const it of items) {
      if (it.kind === 'piece') continue;   // no roll stock for piece items
      if (it.print_entry_id) {   // already physically deducted by the print entry
        await c.query(`UPDATE pvc_print_entries SET invoice_id=$1 WHERE id=$2`, [id, it.print_entry_id]);
        continue;
      }
      await pvcConsume(c, u, { date: inv.date, media: it._media, calc: it._calc, wastage_length: it.wastage_length, wastage_reason: it.wastage_reason, ref_type: 'pvc_invoice', ref_id: id, ref_no: inv_no, party: inv.customer });
    }
  }
  await c.query(`UPDATE ${div}_invoices SET status='confirmed', inv_no=$1, confirmed_by=$2, confirmed_by_name=$3, confirmed_at=now() WHERE id=$4`, [inv_no, u.id, u.full_name, id]);
  paid = r2(paid);
  if (paid > 0) {
    if (paid > inv.grand_total + 0.004) bad('Paid amount cannot be more than the invoice total. Record extra money as an advance payment from Accounts.');
    await recordPayment(c, u, { date: inv.date, customer_id: inv.customer_id, amount: paid, method: inv.payment_method, division: div, remarks: 'Paid at invoice ' + inv_no, allocations: [{ division: div, invoice_id: id, amount: paid }] });
  }
  await audit(c, u, 'confirm', div + '_invoice', id, { inv_no, total: inv.grand_total, paid });
  return inv_no;
}
app.post('/api/:div/invoices', wrap(async (req, res) => {
  const div = DIV(req.params.div); if (!req.user.perms.includes(div + '.invoice')) bad('No permission', 403);
  const b = req.body, u = req.user;
  const date = entryDate(req, b.date);
  const out = await tx(async c => {
    await idem(c, req);
    const cust = (await c.query(`SELECT id FROM customers WHERE id=$1`, [b.customer_id])).rows[0];
    if (!cust) bad('Select a customer from the list (or add a new one)');
    const { items, subtotal } = await buildItems(c, req, div, b.items);
    const discount = r2(b.discount); if (discount < 0 || discount > subtotal) bad('Discount must be between 0 and subtotal');
    const grand = r2(subtotal - discount);
    const inv = (await c.query(`INSERT INTO ${div}_invoices(date,customer_id,subtotal,discount,grand_total,payment_method,job_no,delivery_date,remarks,created_by,created_by_name,created_role)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [date, cust.id, subtotal, discount, grand, b.payment_method || 'Cash', str(b.job_no), b.delivery_date || null, str(b.remarks), u.id, u.full_name, u.role_name])).rows[0];
    await saveItems(c, div, inv.id, items);
    await audit(c, u, 'create', div + '_invoice', inv.id, { total: grand, items: items.length });
    if (b.confirm) await confirmInvoice(c, req, div, inv.id, b.paid_amount);
    return getInvoice(c, div, inv.id);
  });
  res.json(out);
}));
app.put('/api/:div/invoices/:id', wrap(async (req, res) => {
  const div = DIV(req.params.div); if (!req.user.perms.includes(div + '.invoice')) bad('No permission', 403);
  const b = req.body, u = req.user, id = +req.params.id;
  const out = await tx(async c => {
    const old = (await c.query(`SELECT * FROM ${div}_invoices WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!old) bad('Invoice not found', 404);
    if (old.status !== 'draft') bad('Confirmed invoices cannot be edited. Cancel and re-create if needed.');
    const date = b.date === old.date ? old.date : entryDate(req, b.date);
    const { items, subtotal } = await buildItems(c, req, div, b.items);
    const discount = r2(b.discount); if (discount < 0 || discount > subtotal) bad('Discount must be between 0 and subtotal');
    await c.query(`UPDATE ${div}_invoices SET date=$1, customer_id=$2, subtotal=$3, discount=$4, grand_total=$5, payment_method=$6, job_no=$7, delivery_date=$8, remarks=$9,
      updated_by=$10, updated_by_name=$11, updated_at=now() WHERE id=$12`,
      [date, b.customer_id, subtotal, discount, r2(subtotal - discount), b.payment_method || 'Cash', str(b.job_no), b.delivery_date || null, str(b.remarks), u.id, u.full_name, id]);
    await saveItems(c, div, id, items);
    await audit(c, u, 'update', div + '_invoice', id, { before: old.grand_total, after: r2(subtotal - discount) });
    if (b.confirm) await confirmInvoice(c, req, div, id, b.paid_amount);
    return getInvoice(c, div, id);
  });
  res.json(out);
}));
app.post('/api/:div/invoices/:id/confirm', wrap(async (req, res) => {
  const div = DIV(req.params.div); if (!req.user.perms.includes(div + '.invoice')) bad('No permission', 403);
  res.json(await tx(async c => { await confirmInvoice(c, req, div, +req.params.id, req.body.paid_amount); return getInvoice(c, div, +req.params.id); }));
}));
app.delete('/api/:div/invoices/:id', wrap(async (req, res) => {
  const div = DIV(req.params.div); if (!req.user.perms.includes(div + '.invoice')) bad('No permission', 403);
  await tx(async c => {
    const r = (await c.query(`DELETE FROM ${div}_invoices WHERE id=$1 AND status='draft' RETURNING id`, [req.params.id])).rows[0];
    if (!r) bad('Only drafts can be deleted');
    await audit(c, req.user, 'delete_draft', div + '_invoice', r.id);
  });
  res.json({ ok: true });
}));
app.post('/api/:div/invoices/:id/cancel', can('invoice.cancel'), wrap(async (req, res) => {
  const div = DIV(req.params.div), id = +req.params.id, u = req.user;
  const reason = str(req.body.reason); if (!reason) bad('Cancellation reason is required');
  res.json(await tx(async c => {
    const inv = (await c.query(`SELECT * FROM ${div}_invoices WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!inv) bad('Invoice not found', 404);
    if (inv.status !== 'confirmed') bad('Only confirmed invoices can be cancelled');
    const T = div === 'ctp' ? 'ctp_stock_movements' : 'pvc_stock_movements';
    const mv = (await c.query(`SELECT * FROM ${T} WHERE ref_type=$1 AND ref_id=$2 AND NOT is_reversal AND NOT voided`, [div + '_invoice', id])).rows;
    for (const m of mv) {
      await c.query(`UPDATE ${T} SET voided=true, void_reason=$1 WHERE id=$2`, ['Invoice cancelled: ' + reason, m.id]);
      if (div === 'ctp') await ctpMove(c, u, { ...m, date: today(), qty: -m.qty, is_reversal: true, reversal_of: m.id, remarks: 'CANCEL ' + inv.inv_no + ': ' + reason });
      else await pvcMove(c, u, { ...m, date: today(), length_ft: -m.length_ft, area_sqft: m.area_sqft == null ? null : -m.area_sqft, is_reversal: true, reversal_of: m.id, remarks: 'CANCEL ' + inv.inv_no + ': ' + reason });
    }
    if (div === 'pvc') await c.query(`UPDATE pvc_print_entries SET invoice_id=NULL WHERE invoice_id=$1`, [id]);
    const freed = (await c.query(`DELETE FROM payment_allocations WHERE division=$1 AND invoice_id=$2 RETURNING amount`, [div, id])).rows.reduce((s, r) => s + +r.amount, 0);
    await c.query(`UPDATE challans SET status='cancelled' WHERE division=$1 AND invoice_id=$2`, [div, id]);
    await c.query(`UPDATE ${div}_invoices SET status='cancelled', cancelled_by=$1, cancelled_by_name=$2, cancelled_at=now(), cancel_reason=$3 WHERE id=$4`, [u.id, u.full_name, reason, id]);
    await audit(c, u, 'cancel', div + '_invoice', id, { inv_no: inv.inv_no, reason, reversed_movements: mv.length, payments_released_as_credit: r2(freed) });
    return getInvoice(c, div, id);
  }));
}));

/* ============================== CHALLANS ============================== */
app.get('/api/:div/challans', wrap(async (req, res) => {
  const div = DIV(req.params.div); if (!req.user.perms.some(p => [div + '.challan', div + '.invoice', 'reports'].includes(p))) bad('No permission', 403);
  const { from = '1900-01-01', to = '2999-12-31', q: s = '' } = req.query;
  res.json(await q(`SELECT ch.*, c.name customer, i.inv_no, (SELECT COALESCE(SUM(qty),0) FROM challan_items WHERE challan_id=ch.id) qty
    FROM challans ch LEFT JOIN customers c ON c.id=ch.customer_id LEFT JOIN ${div}_invoices i ON i.id=ch.invoice_id
    WHERE ch.division=$1 AND ch.date BETWEEN $2 AND $3 AND ($4='' OR lower(ch.dc_no||' '||COALESCE(c.name,'')||' '||COALESCE(i.inv_no,'')||' '||COALESCE(ch.receiver,'')) LIKE '%'||lower($4)||'%')
    ORDER BY ch.date DESC, ch.id DESC LIMIT 1000`, [div, from, to, s]));
}));
app.get('/api/:div/challans/:id', wrap(async (req, res) => {
  const div = DIV(req.params.div);
  const ch = await q1(`SELECT ch.*, c.name customer, c.address, c.phone, c.company, i.inv_no FROM challans ch LEFT JOIN customers c ON c.id=ch.customer_id
    LEFT JOIN ${div}_invoices i ON i.id=ch.invoice_id WHERE ch.id=$1 AND ch.division=$2`, [req.params.id, div]);
  if (!ch) bad('Challan not found', 404);
  ch.items = await q(div === 'ctp'
    ? `SELECT ci.*, p.name product, p.size_mm, ii.rate FROM challan_items ci LEFT JOIN ctp_products p ON p.id=ci.product_id LEFT JOIN ctp_invoice_items ii ON ii.id=ci.invoice_item_id WHERE challan_id=$1 ORDER BY ci.id`
    : `SELECT ci.*, m.category, m.width_ft, ii.art_w, ii.art_l, ii.rate FROM challan_items ci LEFT JOIN pvc_media m ON m.id=ci.media_id LEFT JOIN pvc_invoice_items ii ON ii.id=ci.invoice_item_id WHERE challan_id=$1 ORDER BY ci.id`, [ch.id]);
  res.json(ch);
}));
app.post('/api/:div/challans', wrap(async (req, res) => {
  const div = DIV(req.params.div), u = req.user, b = req.body;
  if (!u.perms.includes(div + '.challan')) bad('No permission', 403);
  const date = entryDate(req, b.date);
  res.json(await tx(async c => {
    await idem(c, req);
    let customer_id, invoice = null; const lines = [];
    if (b.invoice_id) {
      invoice = await getInvoice(c, div, +b.invoice_id);
      await c.query(`SELECT id FROM ${div}_invoices WHERE id=$1 FOR UPDATE`, [invoice.id]);
      if (invoice.status !== 'confirmed') bad('Challan can only be created from a confirmed invoice');
      customer_id = invoice.customer_id;
      for (const l of b.items || []) {
        const qn = +l.qty; if (!qn) continue;
        if (qn < 0) bad('Quantity cannot be negative');
        const it = invoice.items.find(i => i.id === +l.invoice_item_id); if (!it) bad('Invalid invoice line');
        if (qn > +it.qty - +it.delivered + 1e-9) bad(`Delivered quantity exceeds remaining quantity for ${div === 'ctp' ? it.product : it.category}. Remaining: ${+it.qty - +it.delivered}`);
        lines.push(div === 'ctp' ? { invoice_item_id: it.id, product_id: it.product_id, qty: qn, description: it.product, cost: r2(qn * it.rate) }
          : it.kind === 'piece' ? { invoice_item_id: it.id, media_id: null, qty: qn, sqft: 0, description: it.description, cost: r2(qn * it.rate) }
          : { invoice_item_id: it.id, media_id: it.media_id, qty: qn, sqft: r2(it.art_w * it.art_l * qn), description: `${it.category} ${it.art_w}×${it.art_l} ft`, cost: r2(it.art_w * it.art_l * qn * it.rate) });
      }
      if (!lines.length) bad('Enter delivered quantity for at least one line');
    } else {
      if (!u.perms.includes('challan.standalone')) bad('Standalone challan (without invoice) needs authorization', 403);
      const cust = (await c.query(`SELECT id,name FROM customers WHERE id=$1`, [b.customer_id])).rows[0]; if (!cust) bad('Select a customer');
      customer_id = cust.id;
      if (!str(b.remarks)) bad('Reason / remarks required for standalone delivery');
      for (const l of b.items || []) {
        if (div === 'ctp') {
          const qn = num(l.qty, 'Quantity', { int: true });
          const p = (await c.query(`SELECT * FROM ctp_products WHERE id=$1`, [l.product_id])).rows[0]; if (!p) bad('Select plate');
          lines.push({ product_id: p.id, qty: qn, description: l.description || p.name, cost: r2(l.cost), _p: p });
        } else {
          const len = num(l.length_ft, 'Length (ft)');
          const md = (await c.query(`SELECT * FROM pvc_media WHERE id=$1`, [l.media_id])).rows[0]; if (!md) bad('Select media');
          lines.push({ media_id: md.id, qty: +l.qty || 1, length_ft: len, sqft: r2(len * md.width_ft), description: l.description || `${md.category} ${md.width_ft} ft`, cost: r2(l.cost), _m: md });
        }
      }
      if (!lines.length) bad('Add at least one line');
    }
    const dc_no = await nextNo(c, div + '_dc');
    const ch = (await c.query(`INSERT INTO challans(division,dc_no,date,invoice_id,customer_id,receiver,carried_by,issuing_authority,remarks,standalone,created_by,created_by_name,created_role)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [div, dc_no, date, invoice?.id || null, customer_id, str(b.receiver), str(b.carried_by), str(b.issuing_authority) || u.full_name, str(b.remarks), !invoice, u.id, u.full_name, u.role_name])).rows[0];
    for (const l of lines) {
      await c.query(`INSERT INTO challan_items(challan_id,invoice_item_id,product_id,media_id,qty,length_ft,sqft,description,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ch.id, l.invoice_item_id || null, l.product_id || null, l.media_id || null, l.qty, l.length_ft || null, l.sqft || null, l.description, l.cost || null]);
      if (!invoice) {   // standalone delivery: needs its own stock movement (invoice challans never deduct again)
        if (div === 'ctp') {
          await lockStock(c, 'ctp', l.product_id);
          if ((await ctpBalance(c, l.product_id)) < l.qty) bad(`Not enough ${l._p.name} in stock`);
          await ctpMove(c, u, { date, product_id: l.product_id, type: 'challan_out', qty: -l.qty, ref_type: 'challan', ref_id: ch.id, ref_no: dc_no, remarks: str(b.remarks) });
        } else {
          await lockStock(c, 'pvc', l.media_id);
          if ((await pvcBalance(c, l.media_id)) < l.length_ft) bad(`Not enough ${l._m.category} stock`);
          await pvcMove(c, u, { date, media_id: l.media_id, type: 'challan_out', length_ft: -l.length_ft, area_sqft: l.sqft, ref_type: 'challan', ref_id: ch.id, ref_no: dc_no, remarks: str(b.remarks) });
        }
      }
    }
    await audit(c, u, 'create', div + '_challan', ch.id, { dc_no, invoice: invoice?.inv_no || null, standalone: !invoice });
    return ch;
  }));
}));
app.post('/api/:div/challans/:id/cancel', wrap(async (req, res) => {
  const div = DIV(req.params.div), u = req.user;
  if (!u.perms.includes(div + '.challan') || !u.perms.includes('invoice.cancel')) bad('No permission', 403);
  const reason = str(req.body.reason); if (!reason) bad('Reason is required');
  res.json(await tx(async c => {
    const ch = (await c.query(`SELECT * FROM challans WHERE id=$1 AND division=$2 FOR UPDATE`, [req.params.id, div])).rows[0];
    if (!ch || ch.status !== 'active') bad('Challan not found / already cancelled');
    if (ch.standalone) {
      const T = div === 'ctp' ? 'ctp_stock_movements' : 'pvc_stock_movements';
      for (const m of (await c.query(`SELECT * FROM ${T} WHERE ref_type='challan' AND ref_id=$1 AND NOT is_reversal AND NOT voided`, [ch.id])).rows) {
        await c.query(`UPDATE ${T} SET voided=true, void_reason=$1 WHERE id=$2`, [reason, m.id]);
        if (div === 'ctp') await ctpMove(c, u, { ...m, date: today(), qty: -m.qty, is_reversal: true, reversal_of: m.id, remarks: 'CANCEL ' + ch.dc_no });
        else await pvcMove(c, u, { ...m, date: today(), length_ft: -m.length_ft, area_sqft: -m.area_sqft, is_reversal: true, reversal_of: m.id, remarks: 'CANCEL ' + ch.dc_no });
      }
    }
    await c.query(`UPDATE challans SET status='cancelled', remarks=COALESCE(remarks,'')||' [Cancelled: '||$1||']' WHERE id=$2`, [reason, ch.id]);
    await audit(c, u, 'cancel', div + '_challan', ch.id, { reason });
    return { ok: true };
  }));
}));

/* ============================== ACCOUNTS ============================== */
app.get('/api/payments', can('payments', 'accounts.view'), wrap(async (req, res) => {
  const { from = '1900-01-01', to = '2999-12-31', q: s = '', customer = '', created_by = '' } = req.query;
  res.json(await q(`SELECT p.*, c.name customer, COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0) allocated,
      (SELECT string_agg(CASE a.division WHEN 'ctp' THEN ci.inv_no ELSE pi.inv_no END, ', ') FROM payment_allocations a LEFT JOIN ctp_invoices ci ON a.division='ctp' AND ci.id=a.invoice_id
        LEFT JOIN pvc_invoices pi ON a.division='pvc' AND pi.id=a.invoice_id WHERE a.payment_id=p.id) invoices
    FROM payments p JOIN customers c ON c.id=p.customer_id
    WHERE p.date BETWEEN $1 AND $2 AND ($3='' OR p.customer_id=$3::int) AND ($4='' OR p.created_by=$4::int)
      AND ($5='' OR lower(c.name||' '||COALESCE(p.receipt_no,'')||' '||COALESCE(p.reference,'')||' '||COALESCE(p.method,'')) LIKE '%'||lower($5)||'%')
    ORDER BY p.date DESC, p.id DESC LIMIT 1500`, [from, to, String(customer), String(created_by), s]));
}));
async function allocate(c, customer_id, amount, allocations, auto, autoDivision) {
  const open = (await c.query(`SELECT * FROM (
      SELECT 'ctp' division, i.id, i.inv_no, i.date, i.grand_total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='ctp' AND a.invoice_id=i.id AND NOT p.voided),0) due FROM ctp_invoices i WHERE customer_id=$1 AND status='confirmed'
      UNION ALL SELECT 'pvc', i.id, i.inv_no, i.date, i.grand_total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='pvc' AND a.invoice_id=i.id AND NOT p.voided),0) FROM pvc_invoices i WHERE customer_id=$1 AND status='confirmed'
    ) x WHERE due > 0.004 ORDER BY date, id`, [customer_id])).rows;
  const out = []; let left = r2(amount);
  if (auto) {
    for (const o of open) { if (left <= 0) break; if (autoDivision && autoDivision !== 'all' && autoDivision !== 'common' && o.division !== autoDivision) continue; const a = Math.min(left, r2(o.due)); out.push({ division: o.division, invoice_id: o.id, amount: a }); left = r2(left - a); }
  } else for (const a of allocations || []) {
    const amt = r2(a.amount); if (!amt) continue;
    const o = open.find(x => x.division === a.division && x.id === +a.invoice_id);
    if (!o) bad('Selected invoice is not open for this customer');
    if (amt > r2(o.due) + 0.004) bad(`Allocation to ${o.inv_no} exceeds its due (${r2(o.due)})`);
    if (amt > left + 0.004) bad('Allocations exceed the payment amount');
    out.push({ division: o.division, invoice_id: o.id, amount: amt }); left = r2(left - amt);
  }
  return out;
}
app.post('/api/payments', can('payments'), wrap(async (req, res) => {
  const b = req.body, u = req.user;
  const amount = num(b.amount, 'Amount');
  const date = entryDate(req, b.date);
  if (!(await lists()).payment_methods.includes(b.method)) bad('Select a payment method');
  res.json(await tx(async c => {
    await idem(c, req);
    const cust = (await c.query(`SELECT id FROM customers WHERE id=$1 FOR UPDATE`, [b.customer_id])).rows[0]; if (!cust) bad('Select a customer');
    const al = await allocate(c, cust.id, amount, b.allocations, b.auto !== false && !(b.allocations || []).length, b.division);
    const divs = [...new Set(al.map(a => a.division))];
    const p = await recordPayment(c, u, { date, customer_id: cust.id, amount, method: b.method, reference: str(b.reference), remarks: str(b.remarks), division: divs.length === 1 ? divs[0] : (b.division && b.division !== 'all' ? b.division : 'common'), allocations: al });
    await audit(c, u, 'create', 'payment', p.id, { amount, allocations: al });
    return { ...p, allocations: al, unallocated: r2(amount - al.reduce((s, a) => s + a.amount, 0)) };
  }));
}));
app.post('/api/payments/:id/allocate', can('payments'), wrap(async (req, res) => {
  res.json(await tx(async c => {
    const p = (await c.query(`SELECT p.*, COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0) allocated FROM payments p WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!p || p.voided) bad('Payment not found');
    const free = r2(p.amount - p.allocated); if (free <= 0) bad('Nothing left to allocate');
    const al = await allocate(c, p.customer_id, free, req.body.allocations, !(req.body.allocations || []).length, req.body.division);
    for (const a of al) await c.query(`INSERT INTO payment_allocations(payment_id,division,invoice_id,amount,created_by,created_by_name) VALUES($1,$2,$3,$4,$5,$6)`, [p.id, a.division, a.invoice_id, a.amount, req.user.id, req.user.full_name]);
    await audit(c, req.user, 'allocate', 'payment', p.id, { allocations: al });
    return { allocated: al };
  }));
}));
app.post('/api/payments/:id/void', can('invoice.cancel'), wrap(async (req, res) => {
  const reason = str(req.body.reason); if (!reason) bad('Reason is required');
  res.json(await tx(async c => {
    const p = (await c.query(`SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!p || p.voided) bad('Payment not found / already voided');
    await c.query(`UPDATE payments SET voided=true, void_reason=$1 WHERE id=$2`, [reason, p.id]);
    await audit(c, req.user, 'void', 'payment', p.id, { amount: p.amount, reason });
    return { ok: true };
  }));
}));
app.get('/api/expenses', can('expenses', 'accounts.view'), wrap(async (req, res) => {
  const { from = '1900-01-01', to = '2999-12-31' } = req.query;
  res.json(await q(`SELECT * FROM expenses WHERE date BETWEEN $1 AND $2 ORDER BY date DESC, id DESC LIMIT 2000`, [from, to]));
}));
app.post('/api/expenses', can('expenses'), wrap(async (req, res) => {
  const b = req.body; const amount = num(b.amount, 'Amount'); const date = entryDate(req, b.date);
  if (!str(b.category)) bad('Select a category');
  res.json(await tx(async c => {
    await idem(c, req);
    const r = (await c.query(`INSERT INTO expenses(date,category,amount,method,description,division,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [date, str(b.category), amount, b.method || 'Cash', str(b.description), ['ctp', 'pvc'].includes(b.division) ? b.division : 'common', req.user.id, req.user.full_name, req.user.role_name])).rows[0];
    await audit(c, req.user, 'create', 'expense', r.id, { amount, category: b.category });
    return r;
  }));
}));
app.post('/api/expenses/:id/void', can('expenses'), wrap(async (req, res) => {
  await tx(async c => { await c.query(`UPDATE expenses SET voided=true WHERE id=$1`, [req.params.id]); await audit(c, req.user, 'void', 'expense', req.params.id, { reason: req.body.reason }); });
  res.json({ ok: true });
}));
async function receivables() {
  const r = await q1(`SELECT
     COALESCE((SELECT SUM(i.grand_total - ${PAID_SQL('ctp')}) FROM ctp_invoices i WHERE status='confirmed'),0) ctp_due,
     COALESCE((SELECT SUM(i.grand_total - ${PAID_SQL('pvc')}) FROM pvc_invoices i WHERE status='confirmed'),0) pvc_due,
     COALESCE((SELECT SUM(opening_balance) FROM customers),0) opening,
     COALESCE((SELECT SUM(p.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0)) FROM payments p WHERE NOT voided),0) unallocated,
     COALESCE((SELECT SUM(GREATEST(b,0)) FROM (SELECT (${CUST_BAL}) b FROM customers c) x),0) combined_due,
     COALESCE((SELECT SUM(LEAST(b,0)) FROM (SELECT (${CUST_BAL}) b FROM customers c) x),0) advances`);
  for (const k in r) r[k] = r2(r[k]);
  return r;
}
app.get('/api/accounts/summary', can('accounts.view', 'payments'), wrap(async (req, res) => {
  const { from = today().slice(0, 8) + '01', to = today() } = req.query;
  const [rec, col, top] = await Promise.all([
    receivables(),
    q1(`SELECT COALESCE(SUM(amount),0) total,
          COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE NOT p.voided AND a.division='ctp' AND p.date BETWEEN $1 AND $2),0) ctp,
          COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE NOT p.voided AND a.division='pvc' AND p.date BETWEEN $1 AND $2),0) pvc
        FROM payments WHERE NOT voided AND date BETWEEN $1 AND $2`, [from, to]),
    q(`SELECT c.id, c.name, c.phone, (${CUST_BAL}) balance FROM customers c ORDER BY balance DESC LIMIT 200`),
  ]);
  res.json({ receivables: rec, collection: col, customers: top.filter(t => t.balance > 0.004), advances: top.filter(t => t.balance < -0.004) });
}));

/* ============================== DASHBOARD ============================== */
app.get('/api/dashboard', can('dashboard'), wrap(async (req, res) => {
  const t = today();
  const from = req.query.from || t.slice(0, 8) + '01', to = req.query.to || t;
  const [sales, coll, exp, ctpStock, pvcStock, ink, recent, monthly, rec, ownuse, prints, counts] = await Promise.all([
    q1(`SELECT COALESCE((SELECT SUM(grand_total) FROM ctp_invoices WHERE status='confirmed' AND date BETWEEN $1 AND $2),0) ctp,
               COALESCE((SELECT SUM(grand_total) FROM pvc_invoices WHERE status='confirmed' AND date BETWEEN $1 AND $2),0) pvc,
               (SELECT COUNT(*) FROM ctp_invoices WHERE status='confirmed' AND date BETWEEN $1 AND $2)::int ctp_n,
               (SELECT COUNT(*) FROM pvc_invoices WHERE status='confirmed' AND date BETWEEN $1 AND $2)::int pvc_n,
               COALESCE((SELECT SUM(ii.qty) FROM ctp_invoice_items ii JOIN ctp_invoices i ON i.id=ii.invoice_id WHERE i.status='confirmed' AND i.date BETWEEN $1 AND $2),0)::int plates,
               COALESCE((SELECT SUM(ii.sqft) FROM pvc_invoice_items ii JOIN pvc_invoices i ON i.id=ii.invoice_id WHERE i.status='confirmed' AND i.date BETWEEN $1 AND $2),0) sqft`, [from, to]),
    q1(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE NOT voided AND date BETWEEN $1 AND $2`, [from, to]),
    q1(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE NOT voided AND date BETWEEN $1 AND $2`, [from, to]),
    q(`SELECT p.id, p.name, p.alias, p.current_rate, p.low_stock, COALESCE(SUM(m.qty),0)::int balance,
         COALESCE(SUM(m.qty) FILTER (WHERE m.type='production' AND m.date BETWEEN $1 AND $2),0)::int production,
         -COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('sale','challan_out') AND m.date BETWEEN $1 AND $2),0)::int sales,
         -COALESCE(SUM(m.qty) FILTER (WHERE m.type='own_use' AND m.date BETWEEN $1 AND $2),0)::int own_use
       FROM ctp_products p LEFT JOIN ctp_stock_movements m ON m.product_id=p.id WHERE p.active GROUP BY p.id ORDER BY p.sort`, [from, to]),
    q(`SELECT md.*, COALESCE(SUM(m.length_ft),0) balance,
         -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type IN ('print','challan_out') AND m.date BETWEEN $1 AND $2),0) printed,
         -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='wastage' AND m.date BETWEEN $1 AND $2),0) wastage
       FROM pvc_media md LEFT JOIN pvc_stock_movements m ON m.media_id=md.id WHERE md.active GROUP BY md.id ORDER BY md.category, md.width_ft`, [from, to]),
    q(`SELECT color, COALESCE(SUM(pcs),0)::int pcs, COALESCE(SUM(liters),0) liters FROM pvc_ink_stock GROUP BY color`),
    q(`SELECT * FROM (SELECT 'ctp' division, i.id, i.inv_no, i.date, i.grand_total, i.status, c.name customer, i.created_by_name, i.confirmed_at ts FROM ctp_invoices i JOIN customers c ON c.id=i.customer_id WHERE status='confirmed'
        UNION ALL SELECT 'pvc', i.id, i.inv_no, i.date, i.grand_total, i.status, c.name, i.created_by_name, i.confirmed_at FROM pvc_invoices i JOIN customers c ON c.id=i.customer_id WHERE status='confirmed') x ORDER BY ts DESC LIMIT 8`),
    q(`SELECT to_char(m, 'YYYY-MM') AS month,
         COALESCE((SELECT SUM(grand_total) FROM ctp_invoices WHERE status='confirmed' AND date_trunc('month',date)=m),0) ctp,
         COALESCE((SELECT SUM(grand_total) FROM pvc_invoices WHERE status='confirmed' AND date_trunc('month',date)=m),0) pvc,
         COALESCE((SELECT SUM(amount) FROM payments WHERE NOT voided AND date_trunc('month',date)=m),0) collection
       FROM generate_series(date_trunc('month', $1::date) - interval '11 months', date_trunc('month', $1::date), interval '1 month') m ORDER BY m`, [t]),
    receivables(),
    q1(`SELECT -COALESCE(SUM(qty),0)::int v FROM ctp_stock_movements WHERE type='own_use' AND date BETWEEN $1 AND $2`, [from, to]),
    q1(`SELECT COALESCE(SUM(printed_sqft) FILTER (WHERE NOT voided),0) sqft, COUNT(*) FILTER (WHERE NOT voided)::int n FROM pvc_print_entries WHERE date BETWEEN $1 AND $2`, [from, to]),
    q1(`SELECT (SELECT COUNT(*) FROM customers)::int customers, (SELECT COUNT(*) FROM ctp_invoices WHERE status='draft')::int ctp_drafts, (SELECT COUNT(*) FROM pvc_invoices WHERE status='draft')::int pvc_drafts`),
  ]);
  res.json({
    from, to, sales: { ...sales, total: r2(sales.ctp + sales.pvc), count: sales.ctp_n + sales.pvc_n }, collection: coll.v, expenses: exp.v, receivables: rec,
    ctp: ctpStock, pvc: pvcStock, ink: (await lists()).ink_colors.map(c => ink.find(i => i.color === c) || { color: c, pcs: 0, liters: 0 }),
    recent, monthly, own_use: ownuse.v, prints, counts,
    low: { ctp: ctpStock.filter(p => p.balance <= p.low_stock), pvc: pvcStock.filter(m => m.balance > 0 && m.balance <= m.low_stock_ft) },
  });
}));

/* ============================== REPORTS ============================== */
app.get('/api/reports/business', can('reports'), wrap(async (req, res) => {
  const { from = today(), to = today(), customer = '', product = '', media = '', width = '', created_by = '' } = req.query;
  const P = [from, to, String(customer), String(created_by)];
  const CI = `i.status='confirmed' AND i.date BETWEEN $1 AND $2 AND ($3='' OR i.customer_id=$3::int) AND ($4='' OR i.created_by=$4::int)`;
  const [ctpSize, ctpLines, ctpCust, ownUse, ownSize, ctpProd, pvcCust, pvcMedia, pvcLines, pvcUsage, fin, coll, exp, ctpInvTot, pvcInvTot, dueNow, expCat] = await Promise.all([
    q(`SELECT p.id, p.name, p.sort, COALESCE(SUM(ii.qty),0)::int qty, COALESCE(SUM(ii.line_total),0) amount FROM ctp_products p
        LEFT JOIN (ctp_invoice_items ii JOIN ctp_invoices i ON i.id=ii.invoice_id AND ${CI}) ON ii.product_id=p.id
        WHERE p.active GROUP BY p.id ORDER BY p.sort`, P),
    q(`SELECT i.id invoice_id, i.inv_no, i.date, c.name customer, p.name product, p.id product_id, ii.qty, ii.rate, ii.line_total, i.created_by_name
        FROM ctp_invoice_items ii JOIN ctp_invoices i ON i.id=ii.invoice_id JOIN customers c ON c.id=i.customer_id JOIN ctp_products p ON p.id=ii.product_id
        WHERE ${CI} AND ($5='' OR ii.product_id=$5::int) ORDER BY i.date, i.inv_no, ii.id`, [...P, String(product)]),
    q(`SELECT c.id, c.name, SUM(ii.qty)::int qty, SUM(ii.line_total) gross FROM ctp_invoice_items ii JOIN ctp_invoices i ON i.id=ii.invoice_id
        JOIN customers c ON c.id=i.customer_id WHERE ${CI} GROUP BY c.id ORDER BY gross DESC`, P),
    q(`SELECT m.id, m.date, p.name product, p.id product_id, -m.qty qty, m.purpose, m.job_ref, m.remarks, m.created_by_name, m.created_role, m.created_at, m.voided, m.void_reason
        FROM ctp_stock_movements m JOIN ctp_products p ON p.id=m.product_id WHERE m.type='own_use' AND NOT m.is_reversal AND m.date BETWEEN $1 AND $2
        AND ($3='' OR m.product_id=$3::int) ORDER BY m.date, m.id`, [from, to, String(product)]),
    q(`SELECT p.id, p.name, -COALESCE(SUM(m.qty),0)::int qty FROM ctp_products p LEFT JOIN ctp_stock_movements m ON m.product_id=p.id AND m.type='own_use' AND m.date BETWEEN $1 AND $2
        WHERE p.active GROUP BY p.id ORDER BY p.sort`, [from, to]),
    q(`SELECT p.id, p.name, COALESCE(SUM(m.qty) FILTER (WHERE m.type='production'),0)::int production, COALESCE(SUM(m.qty) FILTER (WHERE m.type IN ('stock_in','opening')),0)::int stock_in,
          COALESCE(SUM(m.qty) FILTER (WHERE m.type='adj_in'),0)::int adj_in, -COALESCE(SUM(m.qty) FILTER (WHERE m.type='adj_out'),0)::int adj_out
        FROM ctp_products p LEFT JOIN ctp_stock_movements m ON m.product_id=p.id AND m.date BETWEEN $1 AND $2 WHERE p.active GROUP BY p.id ORDER BY p.sort`, [from, to]),
    q(`SELECT c.id, c.name, SUM(ii.sqft) sqft, SUM(ii.line_total) gross, COUNT(DISTINCT i.id)::int invoices FROM pvc_invoice_items ii JOIN pvc_invoices i ON i.id=ii.invoice_id
        JOIN customers c ON c.id=i.customer_id LEFT JOIN pvc_media m ON m.id=ii.media_id WHERE ${CI} AND ($5='' OR m.category=$5) AND ($6='' OR m.width_ft=$6::numeric) GROUP BY c.id ORDER BY sqft DESC`, [...P, media, String(width)]),
    q(`SELECT COALESCE(m.category,'Piece items (ID card etc.)') category, m.width_ft, SUM(ii.sqft) sqft, SUM(ii.line_total) gross, SUM(ii.qty)::int pieces FROM pvc_invoice_items ii JOIN pvc_invoices i ON i.id=ii.invoice_id
        LEFT JOIN pvc_media m ON m.id=ii.media_id WHERE ${CI} AND ($5='' OR m.category=$5) AND ($6='' OR m.width_ft=$6::numeric) GROUP BY 1, m.width_ft ORDER BY 1, m.width_ft`, [...P, media, String(width)]),
    q(`SELECT i.id invoice_id, i.inv_no, i.date, c.name customer, COALESCE(m.category,'Piece item') category, m.width_ft, ii.kind, ii.description, ii.art_w, ii.art_l, ii.qty, ii.orientation, ii.sqft, ii.rate, ii.line_total, ii.used_length, ii.wastage_length, i.created_by_name
        FROM pvc_invoice_items ii JOIN pvc_invoices i ON i.id=ii.invoice_id JOIN customers c ON c.id=i.customer_id LEFT JOIN pvc_media m ON m.id=ii.media_id
        WHERE ${CI} AND ($5='' OR m.category=$5) AND ($6='' OR m.width_ft=$6::numeric) ORDER BY i.date, i.inv_no, ii.id`, [...P, media, String(width)]),
    q(`SELECT md.category, md.width_ft, -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type IN ('print','challan_out')),0) printed_ft, COALESCE(SUM(m.area_sqft) FILTER (WHERE m.type IN ('print','challan_out')),0) printed_area,
          -COALESCE(SUM(m.length_ft) FILTER (WHERE m.type='wastage'),0) wastage_ft, COALESCE(SUM(m.area_sqft) FILTER (WHERE m.type='wastage'),0) wastage_area,
          COALESCE(SUM(m.length_ft) FILTER (WHERE m.type IN ('stock_in','opening')),0) stock_in_ft
        FROM pvc_media md JOIN pvc_stock_movements m ON m.media_id=md.id AND m.date BETWEEN $1 AND $2 WHERE ($3='' OR md.category=$3) AND ($4='' OR md.width_ft=$4::numeric)
        GROUP BY md.category, md.width_ft ORDER BY md.category, md.width_ft`, [from, to, media, String(width)]),
    q1(`SELECT COALESCE((SELECT SUM(subtotal) FROM ctp_invoices i WHERE ${CI}),0) ctp_gross, COALESCE((SELECT SUM(discount) FROM ctp_invoices i WHERE ${CI}),0) ctp_discount,
               COALESCE((SELECT SUM(grand_total) FROM ctp_invoices i WHERE ${CI}),0) ctp_net,
               COALESCE((SELECT SUM(subtotal) FROM pvc_invoices i WHERE ${CI}),0) pvc_gross, COALESCE((SELECT SUM(discount) FROM pvc_invoices i WHERE ${CI}),0) pvc_discount,
               COALESCE((SELECT SUM(grand_total) FROM pvc_invoices i WHERE ${CI}),0) pvc_net,
               (SELECT COUNT(*) FROM ctp_invoices i WHERE ${CI})::int ctp_n, (SELECT COUNT(*) FROM pvc_invoices i WHERE ${CI})::int pvc_n,
               (SELECT COUNT(*) FROM ctp_invoices i WHERE status='cancelled' AND date BETWEEN $1 AND $2)::int ctp_cancelled, (SELECT COUNT(*) FROM pvc_invoices i WHERE status='cancelled' AND date BETWEEN $1 AND $2)::int pvc_cancelled`, P),
    q1(`SELECT COALESCE(SUM(p.amount),0) total,
          COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p2 ON p2.id=a.payment_id WHERE NOT p2.voided AND a.division='ctp' AND p2.date BETWEEN $1 AND $2 AND ($3='' OR p2.customer_id=$3::int)),0) ctp,
          COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p2 ON p2.id=a.payment_id WHERE NOT p2.voided AND a.division='pvc' AND p2.date BETWEEN $1 AND $2 AND ($3='' OR p2.customer_id=$3::int)),0) pvc
        FROM payments p WHERE NOT voided AND date BETWEEN $1 AND $2 AND ($3='' OR p.customer_id=$3::int)`, [from, to, String(customer)]),
    q(`SELECT division, COALESCE(SUM(amount),0) amount FROM expenses WHERE NOT voided AND date BETWEEN $1 AND $2 GROUP BY division`, [from, to]),
    q(`SELECT i.id, i.inv_no, i.date, c.name customer, i.grand_total, ${PAID_SQL('ctp')} paid, i.created_by_name FROM ctp_invoices i JOIN customers c ON c.id=i.customer_id WHERE ${CI} ORDER BY i.date, i.inv_no`, P),
    q(`SELECT i.id, i.inv_no, i.date, c.name customer, i.grand_total, ${PAID_SQL('pvc')} paid, i.created_by_name FROM pvc_invoices i JOIN customers c ON c.id=i.customer_id WHERE ${CI} ORDER BY i.date, i.inv_no`, P),
    receivables(),
    q(`SELECT category, division, SUM(amount) amount FROM expenses WHERE NOT voided AND date BETWEEN $1 AND $2 GROUP BY category, division ORDER BY amount DESC`, [from, to]),
  ]);
  // customer-wise CTP: exact per-size quantities
  const sizeMap = {};
  for (const l of ctpLines) { const k = l.customer; sizeMap[k] = sizeMap[k] || {}; sizeMap[k][l.product] = (sizeMap[k][l.product] || 0) + l.qty; }
  for (const cst of ctpCust) cst.sizes = sizeMap[cst.name] || {};
  const ctpDuePeriod = r2(ctpInvTot.reduce((s, i) => s + i.grand_total - i.paid, 0)), pvcDuePeriod = r2(pvcInvTot.reduce((s, i) => s + i.grand_total - i.paid, 0));
  const ex = d => r2(exp.filter(e => e.division === d).reduce((s, e) => s + e.amount, 0));
  res.json({
    from, to, generated_at: new Date().toISOString(), generated_by: req.user.full_name,
    ctp: { size: ctpSize, lines: ctpLines, customers: ctpCust, production: ctpProd, total_qty: ctpSize.reduce((s, x) => s + x.qty, 0), total_amount: r2(ctpSize.reduce((s, x) => s + x.amount, 0)) },
    own_use: { rows: ownUse, size: ownSize, total: ownSize.reduce((s, x) => s + x.qty, 0) },
    pvc: { customers: pvcCust, media: pvcMedia, lines: pvcLines, usage: pvcUsage, total_sqft: r2(pvcMedia.reduce((s, x) => s + x.sqft, 0)), total_amount: r2(pvcMedia.reduce((s, x) => s + x.gross, 0)),
      printed_ft: r2(pvcUsage.reduce((s, x) => s + x.printed_ft, 0)), wastage_ft: r2(pvcUsage.reduce((s, x) => s + x.wastage_ft, 0)), wastage_area: r2(pvcUsage.reduce((s, x) => s + x.wastage_area, 0)) },
    financial: { ...fin, combined_net: r2(fin.ctp_net + fin.pvc_net), combined_discount: r2(fin.ctp_discount + fin.pvc_discount),
      collection: coll, due_period: { ctp: ctpDuePeriod, pvc: pvcDuePeriod, combined: r2(ctpDuePeriod + pvcDuePeriod) },
      expenses: { ctp: ex('ctp'), pvc: ex('pvc'), common: ex('common'), total: r2(exp.reduce((s, e) => s + e.amount, 0)) }, expense_categories: expCat, outstanding_now: dueNow },
  });
}));
app.get('/api/reports/trend', can('reports'), wrap(async (req, res) => {
  const { from, to, group = 'day' } = req.query;
  const g = group === 'month' ? 'month' : 'day';
  const step = g === 'month' ? '1 month' : '1 day';
  res.json(await q(`SELECT to_char(d, ${g === 'month' ? `'YYYY-MM'` : `'YYYY-MM-DD'`}) period,
      COALESCE((SELECT SUM(grand_total) FROM ctp_invoices WHERE status='confirmed' AND date_trunc('${g}',date)=d),0) ctp_sales,
      COALESCE((SELECT SUM(grand_total) FROM pvc_invoices WHERE status='confirmed' AND date_trunc('${g}',date)=d),0) pvc_sales,
      COALESCE((SELECT SUM(ii.qty) FROM ctp_invoice_items ii JOIN ctp_invoices i ON i.id=ii.invoice_id WHERE i.status='confirmed' AND date_trunc('${g}',i.date)=d),0)::int ctp_qty,
      COALESCE((SELECT SUM(ii.sqft) FROM pvc_invoice_items ii JOIN pvc_invoices i ON i.id=ii.invoice_id WHERE i.status='confirmed' AND date_trunc('${g}',i.date)=d),0) pvc_sqft,
      -COALESCE((SELECT SUM(qty) FROM ctp_stock_movements WHERE type='own_use' AND date_trunc('${g}',date)=d),0)::int own_use,
      -COALESCE((SELECT SUM(length_ft) FROM pvc_stock_movements WHERE type='print' AND date_trunc('${g}',date)=d),0) printed_ft,
      -COALESCE((SELECT SUM(length_ft) FROM pvc_stock_movements WHERE type='wastage' AND date_trunc('${g}',date)=d),0) wastage_ft,
      COALESCE((SELECT SUM(amount) FROM payments WHERE NOT voided AND date_trunc('${g}',date)=d),0) collection,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE NOT voided AND date_trunc('${g}',date)=d),0) expenses
    FROM generate_series(date_trunc('${g}', $1::date), date_trunc('${g}', $2::date), interval '${step}') d ORDER BY d`, [from, to]));
}));
app.get('/api/reports/employee', can('reports.employee'), wrap(async (req, res) => {
  const { from = today(), to = today(), user = '' } = req.query;
  const P = [from, to, String(user)];
  const [sales, outstanding, activity, payments, summary] = await Promise.all([
    q(`SELECT * FROM (
        SELECT 'CTP' division, i.inv_no, i.date, c.name customer, i.grand_total total, ${PAID_SQL('ctp')} paid, i.created_by, i.created_by_name, i.created_role FROM ctp_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='confirmed' AND i.date BETWEEN $1 AND $2 AND ($3='' OR i.created_by=$3::int)
        UNION ALL SELECT 'PVC', i.inv_no, i.date, c.name, i.grand_total, ${PAID_SQL('pvc')}, i.created_by, i.created_by_name, i.created_role FROM pvc_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='confirmed' AND i.date BETWEEN $1 AND $2 AND ($3='' OR i.created_by=$3::int)
      ) x ORDER BY date, inv_no`, P),
    q(`SELECT * FROM (
        SELECT 'CTP' division, i.inv_no, i.date, c.name customer, c.phone, i.grand_total total, i.grand_total-${PAID_SQL('ctp')} due, i.created_by, i.created_by_name FROM ctp_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='confirmed' AND ($1='' OR i.created_by=$1::int)
        UNION ALL SELECT 'PVC', i.inv_no, i.date, c.name, c.phone, i.grand_total, i.grand_total-${PAID_SQL('pvc')}, i.created_by, i.created_by_name FROM pvc_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='confirmed' AND ($1='' OR i.created_by=$1::int)
      ) x WHERE due > 0.004 ORDER BY created_by_name, date`, [String(user)]),
    q(`SELECT user_id, user_name, role_name, action, entity, entity_id, details, created_at FROM audit_logs WHERE created_at::date BETWEEN $1 AND $2 AND ($3='' OR user_id=$3::int) AND action<>'login' ORDER BY created_at DESC LIMIT 3000`, P),
    q(`SELECT p.receipt_no, p.date, c.name customer, p.amount, p.method, p.created_by_name, p.created_role,
         (SELECT string_agg(CASE a.division WHEN 'ctp' THEN ci.inv_no ELSE pi.inv_no END || ' (by ' || COALESCE(CASE a.division WHEN 'ctp' THEN ci.created_by_name ELSE pi.created_by_name END,'?') || ')', ', ')
           FROM payment_allocations a LEFT JOIN ctp_invoices ci ON a.division='ctp' AND ci.id=a.invoice_id LEFT JOIN pvc_invoices pi ON a.division='pvc' AND pi.id=a.invoice_id WHERE a.payment_id=p.id) invoices
       FROM payments p JOIN customers c ON c.id=p.customer_id WHERE NOT p.voided AND p.date BETWEEN $1 AND $2 AND ($3='' OR p.created_by=$3::int) ORDER BY p.date, p.id`, P),
    q(`SELECT u.id, u.full_name, r.name role,
         (SELECT COUNT(*) FROM ctp_invoices WHERE created_by=u.id AND status='confirmed' AND date BETWEEN $1 AND $2)+(SELECT COUNT(*) FROM pvc_invoices WHERE created_by=u.id AND status='confirmed' AND date BETWEEN $1 AND $2) invoices,
         COALESCE((SELECT SUM(grand_total) FROM ctp_invoices WHERE created_by=u.id AND status='confirmed' AND date BETWEEN $1 AND $2),0)+COALESCE((SELECT SUM(grand_total) FROM pvc_invoices WHERE created_by=u.id AND status='confirmed' AND date BETWEEN $1 AND $2),0) sales,
         COALESCE((SELECT SUM(amount) FROM payments WHERE created_by=u.id AND NOT voided AND date BETWEEN $1 AND $2),0) collected,
         (SELECT COUNT(*) FROM audit_logs WHERE user_id=u.id AND action<>'login' AND created_at::date BETWEEN $1 AND $2) actions
       FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE ($3='' OR u.id=$3::int) ORDER BY sales DESC`, P),
  ]);
  for (const s of sales) s.due = r2(s.total - s.paid);
  res.json({ from, to, sales, outstanding, activity, payments, summary });
}));
app.get('/api/reports/register', can('reports'), wrap(async (req, res) => {
  const { type, from = today(), to = today() } = req.query;
  let rows;
  if (type === 'ctp_stock') rows = await q(`SELECT m.date, p.name product, m.type, m.qty, m.ref_no, m.party, m.purpose, m.job_ref, m.remarks, m.is_reversal, m.voided, m.created_by_name, m.created_at
      FROM ctp_stock_movements m JOIN ctp_products p ON p.id=m.product_id WHERE m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`, [from, to]);
  else if (type === 'pvc_stock') rows = await q(`SELECT m.date, md.category||' '||md.width_ft||' ft' media, m.type, m.length_ft, m.area_sqft, m.roll_qty, m.roll_length, m.reason, m.ref_no, m.party, m.supplier, m.remarks, m.is_reversal, m.voided, m.created_by_name, m.created_at
      FROM pvc_stock_movements m JOIN pvc_media md ON md.id=m.media_id WHERE m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`, [from, to]);
  else if (type === 'wastage') rows = await q(`SELECT m.date, md.category||' '||md.width_ft||' ft' media, -m.length_ft length_ft, m.area_sqft area_sqft, m.reason, m.ref_no, m.party, m.remarks, m.is_reversal, m.created_by_name
      FROM pvc_stock_movements m JOIN pvc_media md ON md.id=m.media_id WHERE m.type='wastage' AND m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`, [from, to]);
  else if (type === 'prints') rows = await q(`SELECT e.date, 'PE-'||e.id ref, COALESCE(c.name, e.job_name) customer, md.category||' '||md.width_ft||' ft' media, e.art_w, e.art_l, e.qty, e.orientation, e.across, e.printed_sqft, e.used_length, e.wastage_length, e.wastage_reason, e.fit_status, i.inv_no, e.voided, e.created_by_name
      FROM pvc_print_entries e JOIN pvc_media md ON md.id=e.media_id LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN pvc_invoices i ON i.id=e.invoice_id WHERE e.date BETWEEN $1 AND $2 ORDER BY e.date, e.id`, [from, to]);
  else if (type === 'sales') rows = await q(`SELECT * FROM (
      SELECT 'CTP' division, i.date, i.inv_no, i.status, c.name customer, i.subtotal, i.discount, i.grand_total, ${PAID_SQL('ctp')} paid, i.created_by_name, i.confirmed_by_name, i.cancel_reason FROM ctp_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status<>'draft' AND i.date BETWEEN $1 AND $2
      UNION ALL SELECT 'PVC', i.date, i.inv_no, i.status, c.name, i.subtotal, i.discount, i.grand_total, ${PAID_SQL('pvc')}, i.created_by_name, i.confirmed_by_name, i.cancel_reason FROM pvc_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status<>'draft' AND i.date BETWEEN $1 AND $2) x ORDER BY date, inv_no`, [from, to]);
  else if (type === 'collection') rows = await q(`SELECT p.date, p.receipt_no, c.name customer, p.amount, p.method, p.reference, p.division, p.voided, p.created_by_name FROM payments p JOIN customers c ON c.id=p.customer_id WHERE p.date BETWEEN $1 AND $2 ORDER BY p.date, p.id`, [from, to]);
  else if (type === 'expenses') rows = await q(`SELECT date, category, division, amount, method, description, voided, created_by_name FROM expenses WHERE date BETWEEN $1 AND $2 ORDER BY date, id`, [from, to]);
  else if (type === 'adjustments') rows = await q(`SELECT 'CTP' division, m.date, p.name item, m.type, m.qty::numeric amount, m.purpose reason, m.created_by_name, m.created_at FROM ctp_stock_movements m JOIN ctp_products p ON p.id=m.product_id WHERE m.type IN ('adj_in','adj_out') AND m.date BETWEEN $1 AND $2
      UNION ALL SELECT 'PVC', m.date, md.category||' '||md.width_ft||' ft', m.type, m.length_ft, m.reason, m.created_by_name, m.created_at FROM pvc_stock_movements m JOIN pvc_media md ON md.id=m.media_id WHERE m.type IN ('adj_in','adj_out') AND m.date BETWEEN $1 AND $2 ORDER BY 2`, [from, to]);
  else if (type === 'ink') rows = await q(`SELECT date, color, pcs, liters, remarks, created_by_name FROM pvc_ink_stock WHERE date BETWEEN $1 AND $2 ORDER BY date, id`, [from, to]);
  else bad('Unknown register');
  res.json(rows);
}));

/* ---------- Excel export (the UI sends exactly what is on screen) ---------- */
app.post('/api/export/xlsx', wrap(async (req, res) => {
  const { title = 'Report', meta = [], sheets = [] } = req.body;
  const company = (await getSetting('company')).name;
  const wb = new ExcelJS.Workbook(); wb.creator = company; wb.created = new Date();
  for (const sh of sheets.slice(0, 30)) {
    const ws = wb.addWorksheet(String(sh.name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    const cols = sh.columns || [];
    ws.addRow([company]).font = { bold: true, size: 14, color: { argb: 'FF172B43' } };
    ws.addRow([title + (sh.name ? ' — ' + sh.name : '')]).font = { bold: true, size: 12 };
    for (const m of meta) ws.addRow([m]).font = { size: 9, color: { argb: 'FF667788' } };
    ws.addRow([]);
    const hr = ws.addRow(cols.map(c => c.label));
    hr.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF287BC5' } }; cell.alignment = { vertical: 'middle' }; });
    for (const r of sh.rows || []) {
      const row = ws.addRow(cols.map(c => r[c.key]));
      if (r._total) row.eachCell(cell => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FC' } }; });
    }
    cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = Math.min(48, Math.max(10, String(c.label).length + 4, ...(sh.rows || []).slice(0, 300).map(r => String(r[c.key] ?? '').length + 2))); if (c.num) col.numFmt = '#,##0.00'; });
  }
  if (!sheets.length) wb.addWorksheet('Empty');
  const buf = await wb.xlsx.writeBuffer();
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${String(title).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'report'}.xlsx"`);
  res.send(Buffer.from(buf));
}));

/* ============================== USERS / SETTINGS ============================== */
app.get('/api/users', can('users'), wrap(async (req, res) => res.json(await q(`SELECT u.id,u.username,u.full_name,u.phone,u.active,u.last_login,u.created_at,u.role_id,r.name role FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY u.id`))));
app.post('/api/users', can('users'), wrap(async (req, res) => {
  const b = req.body; const un = str(b.username, 40), fn = str(b.full_name, 100);
  if (!un || !/^[a-zA-Z0-9_.-]+$/.test(un)) bad('Username: letters, numbers, _ . - only');
  if (!fn) bad('Full name is required');
  if (String(b.password || '').length < 6) bad('Password must be at least 6 characters');
  res.json(await tx(async c => {
    if ((await c.query(`SELECT 1 FROM users WHERE lower(username)=lower($1)`, [un])).rowCount) bad('Username already exists');
    const r = (await c.query(`INSERT INTO users(username,full_name,phone,password_hash,role_id,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,full_name`, [un, fn, str(b.phone), bcrypt.hashSync(b.password, 10), b.role_id, req.user.id])).rows[0];
    await audit(c, req.user, 'create', 'user', r.id, { username: un, role_id: b.role_id });
    return r;
  }));
}));
app.put('/api/users/:id', can('users'), wrap(async (req, res) => {
  const b = req.body, id = +req.params.id;
  res.json(await tx(async c => {
    const old = (await c.query(`SELECT * FROM users WHERE id=$1`, [id])).rows[0]; if (!old) bad('User not found', 404);
    if (id === req.user.id && b.active === false) bad('You cannot deactivate yourself');
    await c.query(`UPDATE users SET full_name=$1, phone=$2, role_id=$3, active=$4, updated_at=now(), updated_by=$5 WHERE id=$6`, [str(b.full_name) || old.full_name, str(b.phone), b.role_id || old.role_id, b.active !== false, req.user.id, id]);
    if (b.password) { if (String(b.password).length < 6) bad('Password must be at least 6 characters'); await c.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [bcrypt.hashSync(b.password, 10), id]); await pool.query(`DELETE FROM public.platform_sessions WHERE kind='tenant' AND tenant_id=$1 AND user_id=$2`, [req.tenant.id, id]); }
    if (b.active === false) await pool.query(`DELETE FROM public.platform_sessions WHERE kind='tenant' AND tenant_id=$1 AND user_id=$2`, [req.tenant.id, id]);
    await audit(c, req.user, 'update', 'user', id, { role_id: b.role_id, active: b.active, password_reset: !!b.password });
    return { ok: true };
  }));
}));
app.get('/api/roles', can('users'), wrap(async (req, res) => res.json({ roles: await q(`SELECT r.*, (SELECT COUNT(*) FROM users WHERE role_id=r.id)::int users FROM roles r ORDER BY id`), perms: PERMS })));
app.post('/api/roles', can('users'), wrap(async (req, res) => {
  const name = str(req.body.name, 50); if (!name) bad('Role name required');
  res.json(await tx(async c => {
    const r = (await c.query(`INSERT INTO roles(name, permissions) VALUES($1,$2) ON CONFLICT(name) DO NOTHING RETURNING *`, [name, JSON.stringify((req.body.permissions || []).filter(p => PERMS[p]))])).rows[0];
    if (!r) bad('Role already exists');
    await audit(c, req.user, 'create', 'role', r.id, { name }); return r;
  }));
}));
app.put('/api/roles/:id', can('users'), wrap(async (req, res) => {
  res.json(await tx(async c => {
    const r = (await c.query(`SELECT * FROM roles WHERE id=$1`, [req.params.id])).rows[0]; if (!r) bad('Role not found', 404);
    if (r.name === 'Admin') bad('Admin always has full access');
    const perms = (req.body.permissions || []).filter(p => PERMS[p]);
    await c.query(`UPDATE roles SET permissions=$1 WHERE id=$2`, [JSON.stringify(perms), r.id]);
    await audit(c, req.user, 'update_permissions', 'role', r.id, { name: r.name, before: r.permissions, after: perms });
    return { ok: true };
  }));
}));
function cleanLists(v) {
  const o = {};
  for (const k of Object.keys(DEFAULT_LISTS)) {
    const arr = [...new Set((Array.isArray(v?.[k]) ? v[k] : DEFAULT_LISTS[k]).map(x => String(x).trim().slice(0, 60)).filter(Boolean))];
    if (!arr.length) bad(`List "${k.replace('_', ' ')}" cannot be empty`);
    o[k] = arr;
  }
  return o;
}
async function getSetting(k) { const r = await q1(`SELECT value FROM settings WHERE key=$1`, [k]); return r ? r.value : ({ ...DEFAULT_SETTINGS, lists: DEFAULT_LISTS }[k] || {}); }
app.get('/api/settings', can('settings'), wrap(async (req, res) => {
  const [s, seq] = await Promise.all([q(`SELECT key, value FROM settings`), q(`SELECT * FROM invoice_sequences ORDER BY key`)]);
  res.json({ settings: Object.fromEntries(s.map(x => [x.key, x.value])), sequences: seq });
}));
app.put('/api/settings', can('settings'), wrap(async (req, res) => {
  await tx(async c => {
    for (const k of ['company', 'pvc', 'ctp', 'lists']) if (req.body.settings?.[k])
      await c.query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(k === 'lists' ? cleanLists(req.body.settings.lists) : { ...(await getSetting(k)), ...req.body.settings[k] })]);
    for (const s of req.body.sequences || []) {
      const cur = (await c.query(`SELECT * FROM invoice_sequences WHERE key=$1`, [s.key])).rows[0]; if (!cur) continue;
      const n = parseInt(s.last_no, 10); if (!(n >= 0)) bad('Sequence must be a positive number');
      if (n < cur.last_no) {   // never allow re-use of an already issued number
        const prefix = cur.prefix;
        const tbl = { ctp_inv: ['ctp_invoices', 'inv_no'], pvc_inv: ['pvc_invoices', 'inv_no'], ctp_dc: ['challans', 'dc_no'], pvc_dc: ['challans', 'dc_no'], receipt: ['payments', 'receipt_no'] }[s.key];
        const used = (await c.query(`SELECT 1 FROM ${tbl[0]} WHERE ${tbl[1]} LIKE $1||'%' LIMIT 1`, [prefix])).rowCount;
        if (used) bad(`Cannot lower ${s.key} below ${cur.last_no}: numbers already issued`);
      }
      await c.query(`UPDATE invoice_sequences SET last_no=$1, prefix=$2 WHERE key=$3`, [n, str(s.prefix, 20) || cur.prefix, s.key]);
    }
    await audit(c, req.user, 'update', 'settings', null, req.body);
  });
  res.json({ ok: true });
}));
app.get('/api/audit', can('audit'), wrap(async (req, res) => {
  const { from = today(), to = today(), user = '', entity = '' } = req.query;
  res.json(await q(`SELECT * FROM audit_logs WHERE created_at::date BETWEEN $1 AND $2 AND ($3='' OR user_id=$3::int) AND ($4='' OR entity LIKE '%'||$4||'%') ORDER BY id DESC LIMIT 3000`, [from, to, String(user), entity]));
}));

/* ---------- backup / restore ---------- */
const BACKUP_TABLES = ['roles', 'users', 'settings', 'invoice_sequences', 'customers', 'ctp_products', 'ctp_prices', 'pvc_media', 'pvc_print_entries', 'ctp_invoices', 'ctp_invoice_items',
  'pvc_invoices', 'pvc_invoice_items', 'ctp_stock_movements', 'pvc_stock_movements', 'pvc_ink_stock', 'challans', 'challan_items', 'payments', 'payment_allocations', 'expenses', 'audit_logs'];
app.get('/api/backup', can('backup'), wrap(async (req, res) => {
  const data = { app: 'sks-printers-ubm', version: 1, created_at: new Date().toISOString(), created_by: req.user.full_name, tables: {} };
  for (const t of BACKUP_TABLES) data.tables[t] = await q(`SELECT * FROM ${t} ORDER BY 1`);
  await audit(null, req.user, 'backup', 'system', null);
  res.set('Content-Type', 'application/json');
  res.set('Content-Disposition', `attachment; filename="${req.tenant.slug}-backup-${today()}.json"`);
  res.send(JSON.stringify(data));
}));
app.post('/api/restore', can('backup'), wrap(async (req, res) => {
  const d = req.body;
  if (!d || d.app !== 'sks-printers-ubm' || !d.tables) bad('This is not a valid backup file');
  if (req.body.confirm !== 'RESTORE') bad('Type RESTORE to confirm');
  await tx(async c => {
    await c.query(`TRUNCATE ${BACKUP_TABLES.slice().reverse().join(',')}, idem_keys RESTART IDENTITY CASCADE`);
    for (const t of BACKUP_TABLES) {
      const rows = d.tables[t] || [];
      if (!rows.length) continue;
      const cols = (await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 AND table_schema=current_schema()`, [t])).rows;
      const valid = cols.map(x => x.column_name), jsonCols = cols.filter(x => x.data_type === 'jsonb').map(x => x.column_name);
      for (const r of rows) {
        const ks = Object.keys(r).filter(k => valid.includes(k));
        await c.query(`INSERT INTO ${t}(${ks.map(k => '"' + k + '"').join(',')}) VALUES(${ks.map((_, i) => '$' + (i + 1)).join(',')})`,
          ks.map(k => (jsonCols.includes(k) && r[k] != null ? JSON.stringify(r[k]) : r[k])));
      }
      if (valid.includes('id') && t !== 'settings' && t !== 'invoice_sequences')
        await c.query(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}),1), (SELECT COUNT(*)>0 FROM ${t}))`);
    }
    await audit(c, req.user, 'restore', 'system', null, { from_backup: d.created_at });
  });
  await pool.query(`DELETE FROM public.platform_sessions WHERE kind='tenant' AND tenant_id=$1`, [req.tenant.id]);
  res.set('Set-Cookie', 'sks_sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
}));

/* ============================== SAAS: TENANT BILLING ============================== */
const PERIOD_ADD = (from, months) => { const d = new Date(from); d.setMonth(d.getMonth() + months); return d; };
async function activatePayment(c, pay, adminName) {
  const t = (await c.query(`SELECT * FROM public.platform_tenants WHERE id=$1 FOR UPDATE`, [pay.tenant_id])).rows[0];
  const start = new Date(Math.max(Date.now(), t.expires_at ? +new Date(t.expires_at) : 0, t.status === 'trial' && t.trial_ends_at ? +new Date(t.trial_ends_at) : 0));
  const end = PERIOD_ADD(start, pay.months);
  await c.query(`UPDATE public.platform_tenants SET status='active', expires_at=$1, plan_id=COALESCE($2, plan_id), updated_at=now() WHERE id=$3`, [end, pay.plan_id, t.id]);
  await c.query(`UPDATE public.platform_payments SET status='approved', reviewed_by=$1, reviewed_at=now(), period_from=$2, period_to=$3 WHERE id=$4`, [adminName, start, end, pay.id]);
  return { from: start, to: end };
}
app.get('/api/subscription', wrap(async (req, res) => {
  const [plans, payment, brand, history] = await Promise.all([
    pricedPlans(), platformSetting('payment'), platformSetting('brand'),
    pq(`SELECT id, plan_name, months, amount, original_amount, plan_discount, coupon_code, coupon_discount, method, txn_id, sender, status, reject_reason, period_from, period_to, submitted_by, created_at FROM public.platform_payments WHERE tenant_id=$1 ORDER BY id DESC`, [req.tenant.id]),
  ]);
  res.json({ tenant: { business_name: req.tenant.business_name, slug: req.tenant.slug, created_at: req.tenant.created_at, ...req.sub }, plans, payment, brand, history });
}));
app.get('/api/subscription/quote', wrap(async (req, res) => res.json(await quote(req.query.plan_id, req.query.coupon))));
app.post('/api/subscription/pay', wrap(async (req, res) => {
  if (!req.user.perms.includes('billing')) bad('Only the business admin can submit subscription payments', 403);
  const b = req.body;
  const qt = await quote(b.plan_id, b.coupon), plan = qt.plan;
  const txn = str(b.txn_id, 60); if (!txn) bad('Transaction ID is required');
  if (!str(b.method)) bad('Select the payment method you used');
  if (await pq1(`SELECT 1 FROM public.platform_payments WHERE lower(txn_id)=lower($1) AND status<>'rejected'`, [txn])) bad('This transaction ID was already submitted');
  if (await pq1(`SELECT 1 FROM public.platform_payments WHERE tenant_id=$1 AND status='pending'`, [req.tenant.id])) bad('You already have a payment waiting for verification');
  const r = await pq1(`INSERT INTO public.platform_payments(tenant_id,plan_id,plan_name,months,amount,original_amount,plan_discount,coupon_code,coupon_discount,method,txn_id,sender,note,submitted_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.tenant.id, plan.id, plan.name, plan.months, qt.total, qt.original, qt.plan_discount, qt.coupon?.code || null, qt.coupon_discount, str(b.method), txn, str(b.sender, 30), str(b.note), req.user.full_name]);
  await audit(null, req.user, 'submit_payment', 'subscription', r.id, { plan: plan.name, amount: qt.total, coupon: qt.coupon?.code, txn });
  res.json(r);
}));

/* ============================== SAAS: PUBLIC (landing + signup) ============================== */
app.get('/api/public/config', wrap(async (req, res) => {
  const [brand, trial_days, signup_open, payment, plans, app] = await Promise.all([platformSetting('brand'), platformSetting('trial_days'), platformSetting('signup_open'), platformSetting('payment'),
    pricedPlans(), latestRelease()]);
  res.json({ brand, trial_days, signup_open, plans, payment_numbers: payment?.numbers || [], base_url: await baseUrl(req),
    app: app ? { version_name: app.version_name, size: app.size } : null });
}));
app.get('/api/public/business/:slug', wrap(async (req, res) => {
  const t = await pq1(`SELECT business_name FROM public.platform_tenants WHERE lower(slug)=lower($1)`, [req.params.slug]);
  res.json(t ? { found: true, business_name: t.business_name } : { found: false });
}));
const RESERVED = ['admin', 'super', 'superadmin', 'app', 'api', 'www', 'baybex', 'public', 'login', 'signup', 'support', 'help'];
async function createTenant(b, source, adminForAudit) {
  const business_name = str(b.business_name, 120), owner = str(b.owner_name, 100), phone = str(b.phone, 30);
  if (!business_name) bad('Business name is required');
  if (!owner) bad('Owner name is required');
  if (!phone || !/^01\d{9}$/.test(phone.replace(/\D/g, '').slice(-11))) bad('Enter a valid mobile number (01XXXXXXXXX)');
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(slug)) bad('Business ID: 3–30 letters/numbers/dashes, e.g. sks-printers');
  if (RESERVED.includes(slug)) bad('This Business ID is reserved, choose another');
  const username = String(b.username || 'admin').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) bad('Username: letters, numbers, _ . - only');
  if (String(b.password || '').length < 6) bad('Password must be at least 6 characters');
  const trialDays = +(await platformSetting('trial_days')) || 7;
  const t = await ptx(async c => {
    if ((await c.query(`SELECT 1 FROM public.platform_tenants WHERE lower(slug)=$1`, [slug])).rowCount) bad('This Business ID is already taken, choose another', 409);
    const r = (await c.query(`INSERT INTO public.platform_tenants(slug,business_name,owner_name,phone,email,address,district,status,trial_ends_at,source,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,'trial', now() + ($8 || ' days')::interval, $9, $10) RETURNING *`,
      [slug, business_name, owner, phone, str(b.email), str(b.address), str(b.district), String(b.trial_days ?? trialDays), source, str(b.notes)])).rows[0];
    return (await c.query(`UPDATE public.platform_tenants SET schema_name=$1 WHERE id=$2 RETURNING *`, ['t_' + r.id, r.id])).rows[0];
  });
  try {
    await migrateTenant(t, { company: { name: business_name, address: str(b.address) || '', challan_address: str(b.address) || '', phone_ctp: phone, phone_manager: phone, email: str(b.email) || '', email2: '' },
      admin: { username, password: b.password, full_name: owner, phone } });
  } catch (e) {   // roll back a half-created tenant
    await pool.query(`DROP SCHEMA IF EXISTS "${t.schema_name}" CASCADE`); await pool.query(`DELETE FROM public.platform_tenants WHERE id=$1`, [t.id]); throw e;
  }
  await platformAudit(null, adminForAudit, 'tenant_created', t.id, { slug, business_name, source });
  return t;
}
app.post('/api/public/signup', wrap(async (req, res) => {
  if (!(await platformSetting('signup_open'))) bad('New signups are closed right now. Please contact Baybex Digital.', 403);
  const th = throttle('signup:' + req.ip, CONFIG.signupLimitPerHour, 3600e3);
  const t = await createTenant(req.body, 'signup', null);
  th.fail();
  const u = await inTenant(t, () => q1(`SELECT id FROM users ORDER BY id LIMIT 1`));
  await newSession(res, { kind: 'tenant', tenant_id: t.id, user_id: u.id });
  res.json({ ok: true, slug: t.slug, trial_ends_at: t.trial_ends_at });
}));

/* ============================== SAAS: SUPER ADMIN ============================== */
const superAuth = wrap(async (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  const t = cookie(req, 'bbx_sa');
  const a = t && await pq1(`SELECT a.id, a.username, a.full_name, a.active FROM public.platform_sessions s JOIN public.platform_admins a ON a.id=s.user_id
    WHERE s.token=$1 AND s.kind='super' AND s.expires_at>now()`, [sha(t)]);
  if (!a || !a.active) bad('Please log in', 401);
  req.admin = a; next();
});
app.use('/api/super', superAuth);
app.post('/api/super/login', wrap(async (req, res) => {
  const th = throttle('sa:' + req.ip, 8, 15 * 60e3);
  const a = await pq1(`SELECT * FROM public.platform_admins WHERE lower(username)=lower($1)`, [String(req.body.username || '')]);
  if (!a || !a.active || !bcrypt.compareSync(String(req.body.password || ''), a.password_hash)) { th.fail(); bad('Wrong username or password', 401); }
  th.clear();
  await newSession(res, { kind: 'super', user_id: a.id });
  await pool.query(`UPDATE public.platform_admins SET last_login=now() WHERE id=$1`, [a.id]);
  await platformAudit(null, a, 'login', null);
  res.json({ ok: true });
}));
app.post('/api/super/logout', wrap(async (req, res) => {
  const t = cookie(req, 'bbx_sa'); if (t) await pool.query(`DELETE FROM public.platform_sessions WHERE token=$1`, [sha(t)]);
  res.set('Set-Cookie', 'bbx_sa=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true });
}));
app.get('/api/super/me', wrap(async (req, res) => res.json({ admin: req.admin, today: today(), brand: await platformSetting('brand') })));
app.post('/api/super/me/password', wrap(async (req, res) => {
  const a = await pq1(`SELECT * FROM public.platform_admins WHERE id=$1`, [req.admin.id]);
  if (!bcrypt.compareSync(String(req.body.current || ''), a.password_hash)) bad('Current password is wrong');
  if (String(req.body.password || '').length < 8) bad('New password must be at least 8 characters');
  await pool.query(`UPDATE public.platform_admins SET password_hash=$1 WHERE id=$2`, [bcrypt.hashSync(req.body.password, 10), a.id]);
  res.json({ ok: true });
}));
async function tenantStats(t) {
  try {
    return await inTenant(t, () => q1(`SELECT (SELECT COUNT(*) FROM users)::int users, (SELECT COUNT(*) FROM customers)::int customers,
      (SELECT COUNT(*) FROM ctp_invoices WHERE status='confirmed')::int ctp_invoices, (SELECT COUNT(*) FROM pvc_invoices WHERE status='confirmed')::int pvc_invoices,
      COALESCE((SELECT SUM(grand_total) FROM ctp_invoices WHERE status='confirmed'),0)+COALESCE((SELECT SUM(grand_total) FROM pvc_invoices WHERE status='confirmed'),0) sales,
      (SELECT MAX(created_at) FROM audit_logs) last_activity`));
  } catch (e) { return { error: e.message }; }
}
app.get('/api/super/dashboard', wrap(async (req, res) => {
  const tenants = await pq(`SELECT * FROM public.platform_tenants ORDER BY id`);
  const st = tenants.map(t => ({ ...t, ...tenantState(t) }));
  const count = s => st.filter(t => t.state === s).length;
  const [rev, pending, monthly, plans] = await Promise.all([
    pq1(`SELECT COALESCE(SUM(amount) FILTER (WHERE date_trunc('month', reviewed_at)=date_trunc('month', now())),0) this_month, COALESCE(SUM(amount),0) total FROM public.platform_payments WHERE status='approved'`),
    pq(`SELECT p.*, t.business_name, t.slug FROM public.platform_payments p JOIN public.platform_tenants t ON t.id=p.tenant_id WHERE p.status='pending' ORDER BY p.id`),
    pq(`SELECT to_char(m,'YYYY-MM') AS month,
          (SELECT COUNT(*) FROM public.platform_tenants WHERE date_trunc('month',created_at)=m)::int signups,
          COALESCE((SELECT SUM(amount) FROM public.platform_payments WHERE status='approved' AND date_trunc('month',reviewed_at)=m),0) revenue
        FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`),
    pq(`SELECT * FROM public.platform_plans ORDER BY sort`),
  ]);
  // monthly recurring revenue: each active tenant's plan price spread per month
  const mrr = st.filter(t => t.state === 'active').reduce((s, t) => { const p = plans.find(x => x.id === t.plan_id); return s + (p ? pricePlan(p).per_month : 0); }, 0);
  res.json({ counts: { total: tenants.length, trial: count('trial'), active: count('active'), expired: count('expired'), suspended: count('suspended') },
    revenue: { ...rev, mrr: r2(mrr) }, pending, monthly,
    expiring: st.filter(t => !t.blocked && t.days_left <= 5).sort((a, b) => a.days_left - b.days_left).slice(0, 20),
    recent: st.slice(-8).reverse() });
}));
app.get('/api/super/tenants', wrap(async (req, res) => {
  const rows = await pq(`SELECT t.*, p.name plan_name FROM public.platform_tenants t LEFT JOIN public.platform_plans p ON p.id=t.plan_id ORDER BY t.id DESC`);
  const withStats = req.query.stats === '1';
  res.json(await Promise.all(rows.map(async t => ({ ...t, ...tenantState(t), ...(withStats ? await tenantStats(t) : {}) }))));
}));
app.post('/api/super/tenants', wrap(async (req, res) => {
  const t = await createTenant(req.body, 'super_admin', req.admin);
  res.json(t);
}));
app.get('/api/super/tenants/:id', wrap(async (req, res) => {
  const t = await pq1(`SELECT t.*, p.name plan_name FROM public.platform_tenants t LEFT JOIN public.platform_plans p ON p.id=t.plan_id WHERE t.id=$1`, [req.params.id]);
  if (!t) bad('Tenant not found', 404);
  const [stats, payments, users, audit] = await Promise.all([
    tenantStats(t), pq(`SELECT * FROM public.platform_payments WHERE tenant_id=$1 ORDER BY id DESC`, [t.id]),
    inTenant(t, () => q(`SELECT u.id, u.username, u.full_name, u.phone, u.active, u.last_login, r.name role FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY u.id`)).catch(() => []),
    pq(`SELECT * FROM public.platform_audit WHERE tenant_id=$1 ORDER BY id DESC LIMIT 100`, [t.id]),
  ]);
  res.json({ tenant: { ...t, ...tenantState(t) }, stats, payments, users, audit });
}));
app.put('/api/super/tenants/:id', wrap(async (req, res) => {
  const b = req.body;
  const t = await pq1(`SELECT * FROM public.platform_tenants WHERE id=$1`, [req.params.id]); if (!t) bad('Tenant not found', 404);
  const slug = b.slug ? String(b.slug).trim().toLowerCase() : t.slug;
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(slug)) bad('Invalid Business ID');
  if (slug !== t.slug && await pq1(`SELECT 1 FROM public.platform_tenants WHERE lower(slug)=$1 AND id<>$2`, [slug, t.id])) bad('Business ID already taken');
  if (b.status && !['trial', 'active', 'suspended'].includes(b.status)) bad('Invalid status');
  const r = await pq1(`UPDATE public.platform_tenants SET slug=$1, business_name=$2, owner_name=$3, phone=$4, email=$5, address=$6, district=$7, notes=$8, status=$9, plan_id=$10,
      trial_ends_at=$11, expires_at=$12, updated_at=now() WHERE id=$13 RETURNING *`,
    [slug, str(b.business_name, 120) || t.business_name, str(b.owner_name), str(b.phone, 30), str(b.email), str(b.address), str(b.district), str(b.notes, 2000), b.status || t.status,
      b.plan_id ? +b.plan_id : null, b.trial_ends_at || null, b.expires_at || null, t.id]);
  if (r.status === 'suspended') await pool.query(`DELETE FROM public.platform_sessions WHERE kind='tenant' AND tenant_id=$1 AND impersonated_by IS NULL`, [t.id]);
  await platformAudit(null, req.admin, 'tenant_updated', t.id, { before: t, after: r });
  res.json({ ...r, ...tenantState(r) });
}));
app.post('/api/super/tenants/:id/extend', wrap(async (req, res) => {
  const b = req.body;
  const out = await ptx(async c => {
    let plan = null; if (b.plan_id) plan = (await c.query(`SELECT * FROM public.platform_plans WHERE id=$1`, [b.plan_id])).rows[0];
    const months = plan ? plan.months : +b.months || 0, days = +b.days || 0;
    if (!months && !days) bad('Choose a plan, months or days');
    if (days && !months) {   // free days (e.g. trial extension / compensation)
      const t = (await c.query(`SELECT * FROM public.platform_tenants WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!t) bad('Tenant not found', 404);
      const field = t.status === 'trial' ? 'trial_ends_at' : 'expires_at';
      const base = Math.max(Date.now(), t[field] ? +new Date(t[field]) : 0);
      const to = new Date(base + days * 864e5);
      await c.query(`UPDATE public.platform_tenants SET ${field}=$1, updated_at=now() WHERE id=$2`, [to, t.id]);
      await platformAudit(c, req.admin, 'extended_days', t.id, { days, field, to });
      return { to };
    }
    const amount = b.amount === undefined || b.amount === '' ? (plan ? pricePlan(plan).final_price : 0) : r2(b.amount);
    const pay = (await c.query(`INSERT INTO public.platform_payments(tenant_id,plan_id,plan_name,months,amount,method,txn_id,note,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, plan?.id || null, plan?.name || months + ' month(s)', months, amount, str(b.method) || 'Manual', str(b.txn_id), str(b.note) || 'Recorded by super admin', req.admin.full_name])).rows[0];
    const period = await activatePayment(c, pay, req.admin.full_name);
    await platformAudit(c, req.admin, 'subscription_added', +req.params.id, { plan: pay.plan_name, months, amount, ...period });
    return period;
  });
  res.json(out);
}));
app.post('/api/super/tenants/:id/reset-password', wrap(async (req, res) => {
  const t = await pq1(`SELECT * FROM public.platform_tenants WHERE id=$1`, [req.params.id]); if (!t) bad('Tenant not found', 404);
  if (String(req.body.password || '').length < 6) bad('Password must be at least 6 characters');
  const u = await inTenant(t, async () => {
    const u = await q1(`SELECT id, username FROM users WHERE id=$1`, [req.body.user_id]); if (!u) bad('User not found');
    await db.query(`UPDATE users SET password_hash=$1, active=true, updated_at=now() WHERE id=$2`, [bcrypt.hashSync(req.body.password, 10), u.id]);
    return u;
  });
  await pool.query(`DELETE FROM public.platform_sessions WHERE kind='tenant' AND tenant_id=$1 AND user_id=$2`, [t.id, u.id]);
  await platformAudit(null, req.admin, 'password_reset', t.id, { username: u.username });
  res.json({ ok: true });
}));
app.post('/api/super/tenants/:id/impersonate', wrap(async (req, res) => {
  const t = await pq1(`SELECT * FROM public.platform_tenants WHERE id=$1`, [req.params.id]); if (!t) bad('Tenant not found', 404);
  const u = await inTenant(t, () => q1(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Admin' ORDER BY u.active DESC, u.id LIMIT 1`));
  if (!u) bad('This business has no admin user');
  await newSession(res, { kind: 'tenant', tenant_id: t.id, user_id: u.id, impersonated_by: req.admin.id });
  await platformAudit(null, req.admin, 'impersonate', t.id, { user_id: u.id });
  res.json({ ok: true, url: '/app' });
}));
app.delete('/api/super/tenants/:id', wrap(async (req, res) => {
  const t = await pq1(`SELECT * FROM public.platform_tenants WHERE id=$1`, [req.params.id]); if (!t) bad('Tenant not found', 404);
  if (req.body?.confirm !== t.slug) bad('Type the Business ID exactly to confirm deletion');
  await pool.query(`DROP SCHEMA IF EXISTS "${t.schema_name}" CASCADE`);
  await pool.query(`DELETE FROM public.platform_sessions WHERE tenant_id=$1`, [t.id]);
  await pool.query(`DELETE FROM public.platform_tenants WHERE id=$1`, [t.id]);
  await platformAudit(null, req.admin, 'tenant_deleted', t.id, { slug: t.slug, business_name: t.business_name });
  res.json({ ok: true });
}));
app.get('/api/super/tenants/:id/backup', wrap(async (req, res) => {
  const t = await pq1(`SELECT * FROM public.platform_tenants WHERE id=$1`, [req.params.id]); if (!t) bad('Tenant not found', 404);
  const data = { app: 'sks-printers-ubm', version: 1, created_at: new Date().toISOString(), created_by: req.admin.full_name + ' (Baybex)', tables: {} };
  await inTenant(t, async () => { for (const tb of BACKUP_TABLES) data.tables[tb] = await q(`SELECT * FROM ${tb} ORDER BY 1`); });
  res.set('Content-Disposition', `attachment; filename="${t.slug}-backup-${today()}.json"`); res.json(data);
}));
/* plans */
function planFields(b) {
  if (!str(b.name)) bad('Plan name required');
  const months = num(b.months, 'Months', { int: true }), price = num(b.price, 'Price', { allowZero: true });
  const dt = ['none', 'percent', 'flat'].includes(b.discount_type) ? b.discount_type : 'none';
  const dv = dt === 'none' ? 0 : num(b.discount_value, 'Discount', { allowZero: true });
  if (dt === 'percent' && dv > 100) bad('Percentage discount cannot be more than 100%');
  if (dt === 'flat' && dv > price) bad('Flat discount cannot be more than the plan price');
  const d = v => (v ? new Date(v).toISOString() : null);
  if (b.discount_starts && b.discount_ends && new Date(b.discount_starts) > new Date(b.discount_ends)) bad('Discount end date must be after the start date');
  const features = (Array.isArray(b.features) ? b.features : String(b.features || '').split('\n')).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 15);
  return [str(b.name), months, price, str(b.description, 300), str(b.badge, 30), +b.sort || 0, b.active !== false && b.active !== 'false', dt, dv, str(b.discount_label, 40),
    d(b.discount_starts), d(b.discount_ends), JSON.stringify(features), !!b.highlight && b.highlight !== 'false', str(b.button_text, 40)];
}
const PLAN_COLS = 'name,months,price,description,badge,sort,active,discount_type,discount_value,discount_label,discount_starts,discount_ends,features,highlight,button_text';
app.get('/api/super/plans', wrap(async (req, res) => {
  const rows = await pq(`SELECT p.*, (SELECT COUNT(*) FROM public.platform_tenants WHERE plan_id=p.id)::int tenants,
    (SELECT COALESCE(SUM(amount),0) FROM public.platform_payments WHERE plan_id=p.id AND status='approved') revenue FROM public.platform_plans p ORDER BY sort, months`);
  res.json(rows.map(pricePlan));
}));
app.post('/api/super/plans', wrap(async (req, res) => {
  const v = planFields(req.body);
  const r = await pq1(`INSERT INTO public.platform_plans(${PLAN_COLS}) VALUES(${v.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, v);
  await platformAudit(null, req.admin, 'plan_created', null, r); res.json(pricePlan(r));
}));
app.put('/api/super/plans/:id', wrap(async (req, res) => {
  const v = planFields(req.body), before = await pq1(`SELECT * FROM public.platform_plans WHERE id=$1`, [req.params.id]);
  if (!before) bad('Plan not found', 404);
  const r = await pq1(`UPDATE public.platform_plans SET ${PLAN_COLS.split(',').map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${v.length + 1} RETURNING *`, [...v, req.params.id]);
  await platformAudit(null, req.admin, 'plan_updated', null, { before, after: r }); res.json(pricePlan(r));
}));
app.delete('/api/super/plans/:id', wrap(async (req, res) => {
  const used = await pq1(`SELECT (SELECT COUNT(*) FROM public.platform_tenants WHERE plan_id=$1)::int t, (SELECT COUNT(*) FROM public.platform_payments WHERE plan_id=$1)::int p`, [req.params.id]);
  if (used.t || used.p) bad('This plan has businesses or payments. Hide it instead (untick “Visible”).');
  await pool.query(`DELETE FROM public.platform_plans WHERE id=$1`, [req.params.id]);
  await platformAudit(null, req.admin, 'plan_deleted', null, { id: req.params.id }); res.json({ ok: true });
}));
/* bulk discount: apply the same discount to many plans at once (e.g. Eid offer) */
app.post('/api/super/plans/bulk-discount', wrap(async (req, res) => {
  const b = req.body, ids = (b.plan_ids || []).map(Number).filter(Boolean); if (!ids.length) bad('Select at least one plan');
  const dt = ['none', 'percent', 'flat'].includes(b.discount_type) ? b.discount_type : 'none';
  const dv = dt === 'none' ? 0 : num(b.discount_value, 'Discount', { allowZero: true });
  if (dt === 'percent' && dv > 100) bad('Percentage discount cannot be more than 100%');
  if (dt === 'flat') { const over = await pq1(`SELECT name FROM public.platform_plans WHERE id = ANY($1::int[]) AND price < $2 LIMIT 1`, [ids, dv]); if (over) bad(`Flat discount is more than the ${over.name} price`); }
  await pool.query(`UPDATE public.platform_plans SET discount_type=$1, discount_value=$2, discount_label=$3, discount_starts=$4, discount_ends=$5 WHERE id = ANY($6::int[])`,
    [dt, dv, str(b.discount_label, 40), b.discount_starts ? new Date(b.discount_starts).toISOString() : null, b.discount_ends ? new Date(b.discount_ends).toISOString() : null, ids]);
  await platformAudit(null, req.admin, 'bulk_discount', null, { ids, dt, dv, label: b.discount_label }); res.json({ ok: true });
}));
/* coupons */
app.get('/api/super/coupons', wrap(async (req, res) => res.json(await pq(`SELECT c.*, (SELECT COALESCE(SUM(coupon_discount),0) FROM public.platform_payments WHERE lower(coupon_code)=lower(c.code) AND status='approved') given FROM public.platform_coupons c ORDER BY id DESC`))));
function couponFields(b) {
  const code = String(b.code || '').trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,30}$/.test(code)) bad('Coupon code: 3–30 letters/numbers, e.g. EID25');
  const type = b.type === 'flat' ? 'flat' : 'percent', value = num(b.value, 'Discount value');
  if (type === 'percent' && value > 100) bad('Percentage cannot be more than 100%');
  const d = v => (v ? new Date(v).toISOString() : null);
  return [code, type, value, JSON.stringify((b.plan_ids || []).map(Number).filter(Boolean)), parseInt(b.max_uses, 10) || 0, d(b.starts_at), d(b.ends_at), b.active !== false && b.active !== 'false', str(b.note, 200)];
}
app.post('/api/super/coupons', wrap(async (req, res) => {
  const v = couponFields(req.body);
  if (await pq1(`SELECT 1 FROM public.platform_coupons WHERE lower(code)=lower($1)`, [v[0]])) bad('This code already exists');
  const r = await pq1(`INSERT INTO public.platform_coupons(code,type,value,plan_ids,max_uses,starts_at,ends_at,active,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [...v, req.admin.full_name]);
  await platformAudit(null, req.admin, 'coupon_created', null, r); res.json(r);
}));
app.put('/api/super/coupons/:id', wrap(async (req, res) => {
  const v = couponFields(req.body);
  if (await pq1(`SELECT 1 FROM public.platform_coupons WHERE lower(code)=lower($1) AND id<>$2`, [v[0], req.params.id])) bad('This code already exists');
  const r = await pq1(`UPDATE public.platform_coupons SET code=$1,type=$2,value=$3,plan_ids=$4,max_uses=$5,starts_at=$6,ends_at=$7,active=$8,note=$9 WHERE id=$10 RETURNING *`, [...v, req.params.id]);
  if (!r) bad('Coupon not found', 404); await platformAudit(null, req.admin, 'coupon_updated', null, r); res.json(r);
}));
app.delete('/api/super/coupons/:id', wrap(async (req, res) => {
  await pool.query(`DELETE FROM public.platform_coupons WHERE id=$1`, [req.params.id]); await platformAudit(null, req.admin, 'coupon_deleted', null, { id: req.params.id }); res.json({ ok: true });
}));

/* subscription payments */
app.get('/api/super/payments', wrap(async (req, res) => res.json(await pq(`SELECT p.*, t.business_name, t.slug FROM public.platform_payments p JOIN public.platform_tenants t ON t.id=p.tenant_id
  WHERE ($1='' OR p.status=$1) ORDER BY p.id DESC LIMIT 2000`, [String(req.query.status || '')]))));
app.post('/api/super/payments/:id/approve', wrap(async (req, res) => {
  res.json(await ptx(async c => {
    const p = (await c.query(`SELECT * FROM public.platform_payments WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!p || p.status !== 'pending') bad('Payment not found or already reviewed');
    if (req.body.amount !== undefined && req.body.amount !== '') await c.query(`UPDATE public.platform_payments SET amount=$1 WHERE id=$2`, [r2(req.body.amount), p.id]);
    if (p.coupon_code) await c.query(`UPDATE public.platform_coupons SET used=used+1 WHERE lower(code)=lower($1)`, [p.coupon_code]);
    const period = await activatePayment(c, p, req.admin.full_name);
    await platformAudit(c, req.admin, 'payment_approved', p.tenant_id, { payment: p.id, txn: p.txn_id, ...period });
    return period;
  }));
}));
app.post('/api/super/payments/:id/reject', wrap(async (req, res) => {
  const reason = str(req.body.reason); if (!reason) bad('Reason is required');
  const p = await pq1(`UPDATE public.platform_payments SET status='rejected', reject_reason=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3 AND status='pending' RETURNING *`, [reason, req.admin.full_name, req.params.id]);
  if (!p) bad('Payment not found or already reviewed');
  await platformAudit(null, req.admin, 'payment_rejected', p.tenant_id, { payment: p.id, reason }); res.json(p);
}));
/* platform settings, admins, audit */
app.get('/api/super/settings', wrap(async (req, res) => {
  const rows = await pq(`SELECT key, value FROM public.platform_settings`);
  res.json({ ...DEFAULT_PLATFORM, ...Object.fromEntries(rows.map(r => [r.key, r.value])) });
}));
app.put('/api/super/settings', wrap(async (req, res) => {
  for (const k of Object.keys(DEFAULT_PLATFORM)) if (req.body[k] !== undefined)
    await pool.query(`INSERT INTO public.platform_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(req.body[k])]);
  await platformAudit(null, req.admin, 'settings_updated', null, req.body); res.json({ ok: true });
}));
app.get('/api/super/admins', wrap(async (req, res) => res.json(await pq(`SELECT id, username, full_name, active, last_login, created_at FROM public.platform_admins ORDER BY id`))));
app.post('/api/super/admins', wrap(async (req, res) => {
  const b = req.body; if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(b.username || '')) bad('Invalid username'); if (String(b.password || '').length < 8) bad('Password: min 8 characters');
  const r = await pq1(`INSERT INTO public.platform_admins(username, full_name, password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING RETURNING id, username, full_name`, [b.username, str(b.full_name) || b.username, bcrypt.hashSync(b.password, 10)]);
  if (!r) bad('Username exists'); await platformAudit(null, req.admin, 'admin_created', null, r); res.json(r);
}));
app.put('/api/super/admins/:id', wrap(async (req, res) => {
  const b = req.body, id = +req.params.id; if (id === req.admin.id && b.active === false) bad('You cannot disable yourself');
  await pool.query(`UPDATE public.platform_admins SET full_name=COALESCE($1, full_name), active=$2 WHERE id=$3`, [str(b.full_name), b.active !== false, id]);
  if (b.password) { if (String(b.password).length < 8) bad('Password: min 8 characters'); await pool.query(`UPDATE public.platform_admins SET password_hash=$1 WHERE id=$2`, [bcrypt.hashSync(b.password, 10), id]); }
  if (b.active === false || b.password) await pool.query(`DELETE FROM public.platform_sessions WHERE kind='super' AND user_id=$1`, [id]);
  await platformAudit(null, req.admin, 'admin_updated', null, { id, active: b.active }); res.json({ ok: true });
}));
app.get('/api/super/audit', wrap(async (req, res) => res.json(await pq(`SELECT a.*, t.business_name FROM public.platform_audit a LEFT JOIN public.platform_tenants t ON t.id=a.tenant_id ORDER BY a.id DESC LIMIT 2000`))));

/* ============================== ANDROID APP RELEASES ============================== */
const RELEASE_COLS = `id, version_code, version_name, notes, force_update, min_version_code, active, file_name, size, sha256, downloads, uploaded_by, created_at`;
const latestRelease = () => pq1(`SELECT ${RELEASE_COLS} FROM public.platform_app_releases WHERE active ORDER BY version_code DESC LIMIT 1`);
const apkCache = new Map();   // id -> Buffer (APK bytes are kept in PostgreSQL so they survive redeploys)
const apkName = r => `BaybexPrintersManager-v${String(r.version_name).replace(/[^\w.-]+/g, '_')}.apk`;
/** called by the Android app on every launch: ?current=<installed versionCode> */
app.get('/api/public/app/version', wrap(async (req, res) => {
  const r = await latestRelease();
  if (!r) return res.json({ available: false });
  const cur = parseInt(req.query.current, 10) || 0;
  const update = cur > 0 ? r.version_code > cur : true;
  res.json({ available: true, version_code: r.version_code, version_name: r.version_name, notes: r.notes || '', size: r.size, sha256: r.sha256,
    released_at: r.created_at, update, force: update && (r.force_update || cur < (r.min_version_code || 0)), download_url: '/api/public/app/download/' + r.version_code });
}));
async function sendApk(res, r) {
  let buf = apkCache.get(r.id);
  if (!buf) { buf = (await pq1(`SELECT apk FROM public.platform_app_releases WHERE id=$1`, [r.id])).apk; apkCache.clear(); apkCache.set(r.id, buf); }
  await pool.query(`UPDATE public.platform_app_releases SET downloads=downloads+1 WHERE id=$1`, [r.id]);
  res.set('Content-Type', 'application/vnd.android.package-archive');
  res.set('Content-Disposition', `attachment; filename="${apkName(r)}"`);
  res.set('Content-Length', String(buf.length)); res.set('Cache-Control', 'no-store');
  res.end(buf);
}
app.get('/api/public/app/download', wrap(async (req, res) => { const r = await latestRelease(); if (!r) bad('The Android app is not published yet', 404); await sendApk(res, r); }));
app.get('/api/public/app/download/:code', wrap(async (req, res) => {
  const r = await pq1(`SELECT ${RELEASE_COLS} FROM public.platform_app_releases WHERE version_code=$1`, [parseInt(req.params.code, 10) || 0]);
  if (!r) bad('Version not found', 404); await sendApk(res, r);
}));
async function baseUrl(req) {
  const u = String((await platformSetting('app_url')) || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(u) ? u : `${req.protocol}://${req.get('host')}`;
}
/* QR codes: ?for=apk (default) | site | signup | brochure | app */
app.get('/api/public/qr.svg', wrap(async (req, res) => {
  const base = await baseUrl(req);
  const target = { apk: '/api/public/app/download', site: '/', signup: '/#signup', brochure: '/api/public/brochure.pdf', app: '/app' }[req.query.for] || '/api/public/app/download';
  res.set('Content-Type', 'image/svg+xml'); res.set('Cache-Control', 'no-store');
  res.send(await QRCode.toString(base + target, { type: 'svg', margin: 1, color: { dark: '#16466e', light: '#ffffff' } }));
}));
app.get('/api/public/app/qr.svg', wrap(async (req, res) => {
  const url = `${await baseUrl(req)}/api/public/app/download`;
  res.set('Content-Type', 'image/svg+xml'); res.send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#16466e', light: '#ffffff' } }));
}));
/* super admin: upload & manage APK versions. Upload = raw APK bytes in the body, details in the query string */
app.get('/api/super/app/releases', wrap(async (req, res) => res.json(await pq(`SELECT ${RELEASE_COLS} FROM public.platform_app_releases ORDER BY version_code DESC`))));
app.post('/api/super/app/releases', express.raw({ type: () => true, limit: '300mb' }), wrap(async (req, res) => {
  const b = req.query, buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 1000) bad('Choose the APK file to upload');
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) bad('This is not an APK file (APK files are ZIP archives)');
  const code = parseInt(b.version_code, 10); if (!(code > 0)) bad('Version code must be a whole number (the versionCode in app/build.gradle.kts)');
  const name = str(b.version_name, 30); if (!name) bad('Version name is required, e.g. 1.0.1');
  const last = await pq1(`SELECT MAX(version_code) m FROM public.platform_app_releases`);
  if (last.m && code <= last.m) bad(`Version code must be higher than the latest uploaded one (${last.m})`);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const r = await pq1(`INSERT INTO public.platform_app_releases(version_code,version_name,notes,force_update,min_version_code,file_name,size,sha256,apk,uploaded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${RELEASE_COLS}`,
    [code, name, str(b.notes, 2000), b.force_update === 'true', parseInt(b.min_version_code, 10) || 0, str(b.file_name, 200), buf.length, sha, buf, req.admin.full_name]);
  await platformAudit(null, req.admin, 'app_uploaded', null, { version_code: code, version_name: name, size: buf.length, force: r.force_update });
  res.json(r);
}));
app.put('/api/super/app/releases/:id', wrap(async (req, res) => {
  const b = req.body;
  const r = await pq1(`UPDATE public.platform_app_releases SET notes=$1, force_update=$2, min_version_code=$3, active=$4 WHERE id=$5 RETURNING ${RELEASE_COLS}`,
    [str(b.notes, 2000), !!b.force_update, parseInt(b.min_version_code, 10) || 0, b.active !== false, req.params.id]);
  if (!r) bad('Release not found', 404);
  await platformAudit(null, req.admin, 'app_release_updated', null, { version_code: r.version_code, force: r.force_update, active: r.active }); res.json(r);
}));
app.delete('/api/super/app/releases/:id', wrap(async (req, res) => {
  const r = await pq1(`DELETE FROM public.platform_app_releases WHERE id=$1 RETURNING version_code`, [req.params.id]); if (!r) bad('Release not found', 404);
  apkCache.clear(); await platformAudit(null, req.admin, 'app_release_deleted', null, r); res.json({ ok: true });
}));

/* ============================== MARKETING FILES (brochure) ============================== */
const FILE_KEYS = { brochure: { mime: 'application/pdf', name: 'Baybex-Printers-Manager-Brochure.pdf', magic: '%PDF', fallback: path.join(PUB, 'brand', 'brochure.pdf') } };
app.get('/api/public/brochure.pdf', wrap(async (req, res) => {
  const f = await pq1(`SELECT * FROM public.platform_files WHERE key='brochure'`);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `${req.query.view ? 'inline' : 'attachment'}; filename="${FILE_KEYS.brochure.name}"`);
  if (f) { await pool.query(`UPDATE public.platform_files SET downloads=downloads+1 WHERE key='brochure'`); return res.end(f.data); }
  res.sendFile(FILE_KEYS.brochure.fallback, err => err && !res.headersSent && res.status(404).json({ error: 'Brochure not available yet' }));
}));
app.get('/api/super/files', wrap(async (req, res) => {
  const rows = await pq(`SELECT key, file_name, mime, size, downloads, updated_by, updated_at FROM public.platform_files`);
  res.json(Object.keys(FILE_KEYS).map(k => rows.find(r => r.key === k) || { key: k, file_name: null, builtin: true }));
}));
app.post('/api/super/files/:key', express.raw({ type: () => true, limit: '60mb' }), wrap(async (req, res) => {
  const def = FILE_KEYS[req.params.key]; if (!def) bad('Unknown file', 404);
  const buf = req.body; if (!Buffer.isBuffer(buf) || buf.length < 100) bad('Choose a file to upload');
  if (def.magic && buf.subarray(0, 4).toString() !== def.magic) bad('Please upload a PDF file');
  await pool.query(`INSERT INTO public.platform_files(key,file_name,mime,size,data,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT(key) DO UPDATE SET file_name=EXCLUDED.file_name, mime=EXCLUDED.mime, size=EXCLUDED.size, data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [req.params.key, str(req.query.file_name, 200) || def.name, def.mime, buf.length, buf, req.admin.full_name]);
  await platformAudit(null, req.admin, 'file_uploaded', null, { key: req.params.key, size: buf.length });
  res.json({ ok: true });
}));
app.delete('/api/super/files/:key', wrap(async (req, res) => {
  await pool.query(`DELETE FROM public.platform_files WHERE key=$1`, [req.params.key]);
  await platformAudit(null, req.admin, 'file_reset', null, { key: req.params.key }); res.json({ ok: true });
}));

/* ============================== ERRORS / START ============================== */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error: ' + err.message : err.message, existing: err.existing });
});

async function ensureDatabase() {
  const { Client } = require('pg');
  const c = new Client({ ...CONFIG.db, database: 'postgres' });
  try {
    await c.connect();
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [CONFIG.db.database]);
    if (!r.rowCount) { await c.query(`CREATE DATABASE "${CONFIG.db.database.replace(/"/g, '')}"`); console.log('  › Created database', CONFIG.db.database); }
  } catch (e) { /* no rights to the postgres db — assume the database already exists */ }
  finally { try { await c.end(); } catch (_) {} }
}

(async () => {
  try {
    await ensureDatabase();
    await migratePlatform();
    const tenants = await pq(`SELECT * FROM public.platform_tenants WHERE schema_name IS NOT NULL ORDER BY id`);
    for (const t of tenants) await migrateTenant(t);   // applies schema upgrades to every business
    console.log(`  › ${tenants.length} business account(s) ready`);
    app.listen(CONFIG.port, () => console.log(`\n  Baybex Printers Manager running\n    Website + signup →  http://localhost:${CONFIG.port}/\n    Business app     →  http://localhost:${CONFIG.port}/app\n    Super admin      →  http://localhost:${CONFIG.port}/super\n`));
  } catch (e) {
    console.error('\n  Could not start. Check PostgreSQL settings in CONFIG at the top of server.js\n  ', e.message, '\n');
    process.exit(1);
  }
})();
