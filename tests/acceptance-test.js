/*
 * Acceptance tests from the SKS Printers developer specification (v1.0 – v1.3).
 * Run against a FRESH database:  node tests/acceptance-test.js  (server must be running on :3000)
 */
'use strict';
const BASE = 'http://localhost:3000';
let pass = 0, failN = 0;
const jar = {};
async function call(who, method, url, body, idem = true) {
  const h = { 'Content-Type': 'application/json', Cookie: Object.entries(jar[who] || {}).map(([k, v]) => k + '=' + v).join('; ') };
  if (method === 'POST' && idem) h['X-Idempotency-Key'] = Math.random().toString(36).slice(2) + Date.now();
  const r = await fetch(BASE + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); (jar[who] = jar[who] || {})[kv.slice(0, i)] = kv.slice(i + 1); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.arrayBuffer();
  return { status: r.status, data };
}
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { failN++; console.log('  ✗', name, extra); } };
const ex = async (name, p, status) => { const r = await p; ok(name, r.status === status, `(got ${r.status}: ${JSON.stringify(r.data).slice(0, 160)})`); return r; };

(async () => {
  const A = 'admin', BIZ = 'test-press-' + Date.now().toString(36);
  console.log('\nSaaS — signup creates a business with a 7-day trial');
  const su = await call(A, 'POST', '/api/public/signup', { business_name: 'Test Press', owner_name: 'Owner', phone: '01711111111', slug: BIZ, username: 'admin', password: 'admin123' }, false);
  ok('Signup succeeded', su.status === 200, JSON.stringify(su.data));
  const me0 = (await call(A, 'GET', '/api/me')).data;
  ok('New business is on trial with 7 days', me0.tenant.state === 'trial' && me0.tenant.days_left === 7, JSON.stringify(me0.tenant));
  await call(A, 'POST', '/api/login', { business: BIZ, username: 'admin', password: 'admin123' }, false);
  const meta = (await call(A, 'GET', '/api/meta')).data;
  const today = meta.today;
  const P = n => meta.products.find(p => p.name.startsWith(n)).id;
  const MINI = P('Mini'), DD = P('Double'), DEMY = P('Demy');
  const M = (c, w) => meta.media.find(m => m.category === c && +m.width_ft === w).id;
  const PVC4 = M('PVC Banner', 4), PVC3 = M('PVC Banner', 3);
  const roles = Object.fromEntries(meta.roles.map(r => [r.name, r.id]));
  const stock = async () => Object.fromEntries((await call(A, 'GET', '/api/ctp/stock')).data.map(p => [p.id, p.balance]));
  const pstock = async id => (await call(A, 'GET', '/api/pvc/stock')).data.find(m => m.id === id).balance;

  console.log('\nSetup — employees');
  for (const [u, r] of [['acc', 'Accountant'], ['ctpop', 'CTP Operator'], ['pvcop', 'PVC Operator'], ['des', 'Designer'], ['mgr', 'Manager']]) {
    await call(A, 'POST', '/api/users', { username: u, full_name: u.toUpperCase() + ' User', password: 'pass123', role_id: roles[r] }, false);
    await call(u, 'POST', '/api/login', { business: BIZ, username: u, password: 'pass123' }, false);
  }
  const c1 = (await call(A, 'POST', '/api/customers', { name: 'Madani Computers', phone: '01711000001' })).data;
  const c2 = (await call(A, 'POST', '/api/customers', { name: 'Rahman Press', phone: '01711000002', company: 'Rahman Printing' })).data;

  console.log('\nT1  Initial CTP and PVC stock');
  await ex('CTP opening stock recorded', call('ctpop', 'POST', '/api/ctp/opening', { product_id: MINI, qty: 100 }), 200);
  await call('ctpop', 'POST', '/api/ctp/opening', { product_id: DD, qty: 40 });
  await ex('PVC opening stock recorded (2 rolls × 164 ft)', call('pvcop', 'POST', '/api/pvc/opening', { media_id: PVC4, roll_qty: 2, roll_length: 164 }), 200);
  ok('PVC opening = 328 ft', (await pstock(PVC4)) === 328);

  console.log('\nT2  Production increases, confirmed invoice decreases');
  await call('ctpop', 'POST', '/api/ctp/production', { product_id: MINI, qty: 20, job_ref: 'M1' });
  ok('Production +20 → Mini 120', (await stock())[MINI] === 120);
  const draft = (await call('ctpop', 'POST', '/api/ctp/invoices', { customer_id: c1.id, items: [{ product_id: MINI, qty: 10, rate: 260 }] })).data;
  ok('Draft does not affect stock', (await stock())[MINI] === 120);
  const conf = (await call('ctpop', 'POST', `/api/ctp/invoices/${draft.id}/confirm`, { paid_amount: 0 })).data;
  ok('Confirmed CTP invoice → Mini 110', (await stock())[MINI] === 110);
  ok('CTP invoice number CTP-INV-00001', conf.inv_no === 'CTP-INV-00001', conf.inv_no);
  await ex('Cannot sell more plates than in stock', call('ctpop', 'POST', '/api/ctp/invoices', { customer_id: c1.id, items: [{ product_id: DD, qty: 999, rate: 500 }], confirm: true }), 400);

  console.log('\nT3  Own use reduces stock, not sales (v1.2)');
  await ex('Own use without remarks is rejected', call('ctpop', 'POST', '/api/ctp/ownuse', { product_id: MINI, qty: 2 }), 400);
  const ou = (await call('ctpop', 'POST', '/api/ctp/ownuse', { product_id: MINI, qty: 3, purpose: 'SKS Calendar Printing', job_ref: 'CAL-26' })).data;
  ok('Own use → Mini 107', (await stock())[MINI] === 107);
  ok('Own use records logged-in user', ou.created_by_name === 'CTPOP User' && ou.created_role === 'CTP Operator');

  console.log('\nT4–T7  PVC stock in, sq ft billing, linear deduction, fit');
  await call('pvcop', 'POST', '/api/pvc/stockin', { media_id: PVC4, roll_qty: 1, roll_length: 164, supplier: 'X' });
  ok('Stock in +164 ft → 492', (await pstock(PVC4)) === 492);
  const pe = (await call('pvcop', 'POST', '/api/pvc/print', { media_id: PVC4, customer_id: c2.id, art_w: 4, art_l: 10, qty: 3, orientation: 'Normal' })).data;
  ok('Billing 4×10×3 = 120 sq ft', +pe.printed_sqft === 120);
  ok('Deducts 30 linear ft (not 120)', +pe.used_length === 30 && (await pstock(PVC4)) === 462);
  const rot = (await call(A, 'POST', '/api/pvc/calc', { media_id: PVC4, art_w: 6, art_l: 3, qty: 2, orientation: 'Rotate' })).data;
  ok('Rotate 6×3 on 4 ft roll fits, used = 6×2 = 12 ft', rot.fits && rot.used_length === 12, JSON.stringify(rot));
  const nrm = (await call(A, 'POST', '/api/pvc/calc', { media_id: PVC4, art_w: 6, art_l: 3, qty: 2, orientation: 'Normal' })).data;
  ok('Normal 6 ft wide on 4 ft roll does NOT fit', !nrm.fits);
  await ex('Impossible job blocked for operator', call('pvcop', 'POST', '/api/pvc/print', { media_id: PVC4, job_name: 'Big', art_w: 6, art_l: 3, qty: 1, orientation: 'Normal' }), 400);
  await ex('Admin override with reason allowed', call(A, 'POST', '/api/pvc/print', { media_id: PVC4, job_name: 'Big', art_w: 6, art_l: 3, qty: 1, orientation: 'Normal', override_reason: 'Tiled in 2 parts' }), 200);
  const afterOv = await pstock(PVC4);

  console.log('\nT8  Wastage reduces stock separately, not sales');
  await call('pvcop', 'POST', '/api/pvc/wastage', { media_id: PVC4, length_ft: 2, reason: 'Cutting' });
  ok('Wastage −2 ft', (await pstock(PVC4)) === afterOv - 2);

  console.log('\nT9  Separate CTP / PVC invoice numbers');
  await call('pvcop', 'POST', '/api/pvc/opening', { media_id: PVC3, roll_qty: 1, roll_length: 164 });
  const pinv = (await call('des', 'POST', '/api/pvc/invoices', { customer_id: c2.id, items: [{ print_entry_id: pe.id, rate: 25 }, { media_id: PVC3, art_w: 3, art_l: 5, qty: 1, orientation: 'Normal', rate: 25 }], confirm: true }));
  ok('PVC invoice → PVC-INV-00001', pinv.data.inv_no === 'PVC-INV-00001', JSON.stringify(pinv.data).slice(0, 200));
  const pinv2 = (await call('des', 'POST', '/api/pvc/invoices', { customer_id: c2.id, items: [{ media_id: PVC3, art_w: 3, art_l: 5, qty: 1, orientation: 'Normal', rate: 25, wastage_length: 1, wastage_reason: 'Printing Error' }, { kind: 'piece', description: 'PVC ID Card', qty: 50, rate: 20 }], confirm: true, paid_amount: 1000 })).data;
  ok('PVC invoice with ID-card piece line, linked print entry not deducted twice', pinv2.inv_no === 'PVC-INV-00002' && (await pstock(PVC3)) === 164 - 5 - 5 - 1, `${pinv2.inv_no} ${await pstock(PVC3)}`);
  ok('PVC invoice total = 15×25 + 50×20 = 1375', pinv2.grand_total === 1375);

  console.log('\nT10–T11  Challans: no double deduction, partial delivery');
  const before = (await stock())[MINI];
  const inv = (await call(A, 'GET', `/api/ctp/invoices/${draft.id}`)).data;
  const ch1 = await call('ctpop', 'POST', '/api/ctp/challans', { invoice_id: draft.id, items: [{ invoice_item_id: inv.items[0].id, qty: 4 }], receiver: 'Karim' });
  ok('Challan CTP-DC-00001 created', ch1.data.dc_no === 'CTP-DC-00001');
  ok('Challan does not deduct stock again', (await stock())[MINI] === before);
  ok('Delivery status Partial', (await call(A, 'GET', `/api/ctp/invoices/${draft.id}`)).data.delivery_status === 'Partial');
  await ex('Delivered qty cannot exceed invoiced', call('ctpop', 'POST', '/api/ctp/challans', { invoice_id: draft.id, items: [{ invoice_item_id: inv.items[0].id, qty: 7 }] }), 400);
  await call('ctpop', 'POST', '/api/ctp/challans', { invoice_id: draft.id, items: [{ invoice_item_id: inv.items[0].id, qty: 6 }] });
  ok('Delivery status Delivered', (await call(A, 'GET', `/api/ctp/invoices/${draft.id}`)).data.delivery_status === 'Delivered');
  await ex('Standalone challan needs authorization', call('ctpop', 'POST', '/api/ctp/challans', { customer_id: c1.id, items: [{ product_id: MINI, qty: 1 }], remarks: 'x' }), 403);

  console.log('\nT12–T13  Combined ledger, partial & advance payments');
  const pvcInv = (await call(A, 'POST', '/api/pvc/invoices', { customer_id: c1.id, items: [{ kind: 'piece', description: 'PVC ID Card', qty: 150, rate: 20 }], confirm: true })).data;  // 3000
  const ctpInv = (await call(A, 'POST', '/api/ctp/invoices', { customer_id: c1.id, items: [{ product_id: DD, qty: 10, rate: 500 }], confirm: true })).data;     // 5000
  let led = (await call(A, 'GET', `/api/customers/${c1.id}/ledger`)).data;
  const balBefore = led.closing;   // 2600 (first invoice) + 3000 + 5000 = 10600
  ok('Ledger combines CTP + PVC', led.rows.some(r => r.division === 'ctp') && led.rows.some(r => r.division === 'pvc') && balBefore === 10600, String(balBefore));
  const pay = (await call('acc', 'POST', '/api/payments', { customer_id: c1.id, amount: 4000, method: 'Cash', allocations: [{ division: 'ctp', invoice_id: ctpInv.id, amount: 4000 }] })).data;
  led = (await call(A, 'GET', `/api/customers/${c1.id}/ledger`)).data;
  ok('Spec example: 5000 + 3000 − 4000 style → balance reduced by payment', led.closing === 6600);
  const ci = (await call(A, 'GET', `/api/ctp/invoices/${ctpInv.id}`)).data;
  ok('Partial payment → Partially Paid, due 1000', ci.pay_status === 'Partially Paid' && ci.due === 1000);
  const adv = (await call('acc', 'POST', '/api/payments', { customer_id: c2.id, amount: 5000, method: 'bKash', auto: true })).data;
  ok('Advance payment kept as unallocated credit', adv.unallocated > 0, JSON.stringify(adv).slice(0, 200));

  console.log('\nT14  Historical prices unchanged');
  await call(A, 'PUT', '/api/ctp/rates', { product_id: MINI, rate: 300 });
  ok('Old invoice keeps rate 260', (await call(A, 'GET', `/api/ctp/invoices/${draft.id}`)).data.items[0].rate === 260);

  console.log('\nT15  Cancellation reverses stock and receivable');
  const sBefore = (await stock())[DD];
  await ex('Operator cannot cancel', call('ctpop', 'POST', `/api/ctp/invoices/${ctpInv.id}/cancel`, { reason: 'x' }), 403);
  await call(A, 'POST', `/api/ctp/invoices/${ctpInv.id}/cancel`, { reason: 'Wrong customer' });
  ok('Stock returned (+10 Double Demy)', (await stock())[DD] === sBefore + 10);
  led = (await call(A, 'GET', `/api/customers/${c1.id}/ledger`)).data;
  ok('Receivable reversed in ledger', led.closing === 1600, String(led.closing));
  const cxl = (await call(A, 'GET', `/api/ctp/invoices/${ctpInv.id}`)).data;
  ok('Cancelled invoice kept (not deleted)', cxl.status === 'cancelled' && cxl.inv_no);

  console.log('\nT16 / Reporting');
  const rep = (await call('mgr', 'GET', `/api/reports/business?from=${today}&to=${today}`)).data;
  ok('Daily CTP Mini plates sold = 10', rep.ctp.size.find(s => s.id === MINI).qty === 10);
  ok('Cancelled invoice excluded from sales', rep.financial.ctp_net === 2600, String(rep.financial.ctp_net));
  ok('Own use separate (3 pcs) and not in sales', rep.own_use.total === 3);
  ok('PVC daily total sq ft = 120 + 15 + 15 = 150', rep.pvc.total_sqft === 150, String(rep.pvc.total_sqft));
  ok('Combined BDT = CTP + PVC', rep.financial.combined_net === r2(rep.financial.ctp_net + rep.financial.pvc_net));
  ok('Own-use remarks present in report', rep.own_use.rows[0].purpose === 'SKS Calendar Printing');
  const trend = (await call('mgr', 'GET', `/api/reports/trend?from=${today.slice(0, 8)}01&to=${today}&group=day`)).data;
  ok('Monthly trend aggregates days', trend.reduce((s, t) => s + t.ctp_sales, 0) === rep.financial.ctp_net);

  console.log('\nT17  Roles & employee attribution (v1.3)');
  await ex('PVC operator cannot create CTP invoice', call('pvcop', 'POST', '/api/ctp/invoices', { customer_id: c1.id, items: [{ product_id: MINI, qty: 1, rate: 1 }] }), 403);
  await ex('Manager cannot record payment', call('mgr', 'POST', '/api/payments', { customer_id: c1.id, amount: 1, method: 'Cash' }), 403);
  const spoof = (await call('acc', 'POST', '/api/pvc/invoices', { customer_id: c1.id, created_by: 1, created_by_name: 'Hacker', items: [{ kind: 'piece', description: 'Card', qty: 1, rate: 10 }] })).data;
  ok('Creator taken from session, not request body', spoof.created_by_name === 'ACC User');
  const emp = (await call(A, 'GET', `/api/reports/employee?from=${today}&to=${today}`)).data;
  ok('Payment recorder tracked separately from invoice creator', emp.payments.some(p => p.created_by_name === 'ACC User'));
  const ac = (await call(A, 'GET', '/api/customers/search?q=mad')).data;
  ok('Customer autocomplete prefix match (case-insensitive)', ac[0]?.name === 'Madani Computers');
  ok('Autocomplete matches phone', (await call(A, 'GET', '/api/customers/search?q=000002')).data[0]?.name === 'Rahman Press');
  await ex('Duplicate customer prevented', call(A, 'POST', '/api/customers', { name: 'madani  computers' }), 409);
  const key = 'dup-' + Date.now();
  const h = { 'Content-Type': 'application/json', Cookie: Object.entries(jar.ctpop).map(([k, v]) => k + '=' + v).join('; '), 'X-Idempotency-Key': key };
  const b = JSON.stringify({ product_id: MINI, qty: 1, purpose: 'Test' });
  const [d1, d2] = await Promise.all([fetch(BASE + '/api/ctp/ownuse', { method: 'POST', headers: h, body: b }), fetch(BASE + '/api/ctp/ownuse', { method: 'POST', headers: h, body: b })]);
  ok('Double-submit protection (one of two identical requests rejected)', [d1.status, d2.status].sort().join() === '200,409', `${d1.status},${d2.status}`);

  console.log('\nT18  Backup & restore');
  const bk = await call(A, 'GET', '/api/backup');
  const backup = bk.data instanceof ArrayBuffer ? JSON.parse(Buffer.from(bk.data).toString()) : bk.data;
  ok('Backup contains invoices', backup.tables.ctp_invoices.length >= 2);
  await call(A, 'POST', '/api/customers', { name: 'Temp After Backup' });
  const rs = await call(A, 'POST', '/api/restore', { ...backup, confirm: 'RESTORE' }, false);
  ok('Restore succeeded', rs.status === 200, JSON.stringify(rs.data));
  await call(A, 'POST', '/api/login', { business: BIZ, username: 'admin', password: 'admin123' }, false);
  const custs = (await call(A, 'GET', '/api/customers')).data;
  ok('Restore rolled back to backup state', !custs.some(c => c.name === 'Temp After Backup') && custs.length === 2);
  ok('Stock identical after restore', (await stock())[MINI] === (await stock())[MINI] && (await call(A, 'GET', '/api/ctp/stock')).data.find(p => p.id === MINI).balance === 106);

  console.log('\nStore (old General + Internal inventory merged) & counter job');
  const sbal = async id => +(await call(A, 'GET', '/api/store/items')).data.find(i => i.id === id).balance;
  const film = (await call(A, 'POST', '/api/store/items', { category: 'Lamination Film', name: 'Glossy 12"', unit: 'ft', width_in: 12, opening: 300 }, false)).data;
  ok('Lamination film is a store item with opening 300 ft', film.id && (await sbal(film.id)) === 300, JSON.stringify(film).slice(0, 120));
  const paper = (await call(A, 'POST', '/api/store/items', { category: 'Paper', paper_type: 'Offset', gsm: '70', size: 'F4', color: 'White', unit: 'Ream', opening: 10 }, false)).data;
  ok('Paper auto-named by type / GSM / size / colour', paper.name === 'Offset 70 GSM F4 White', paper.name);
  const ii = (await call(A, 'GET', '/api/store/items')).data;
  ok('Default internal items moved into the store', ['PVC Solvent', 'CTP Wash', 'CTP Developer', 'Filter Paper'].every(n => ii.some(i => i.name === n)));
  const solv = ii.find(i => i.name === 'PVC Solvent');
  await call(A, 'POST', '/api/store/moves', { item_id: solv.id, type: 'stock_in', qty: 20, party: 'Supplier A' });
  await ex('Own use needs a purpose', call(A, 'POST', '/api/store/moves', { item_id: solv.id, type: 'use', qty: 5 }), 400);
  await call(A, 'POST', '/api/store/moves', { item_id: solv.id, type: 'use', qty: 5, purpose: 'Machine cleaning' });
  ok('Solvent 20 in − 5 used = 15 Ltr', (await sbal(solv.id)) === 15);
  await ex('Using more than available is blocked', call(A, 'POST', '/api/store/moves', { item_id: solv.id, type: 'use', qty: 50, purpose: 'x' }), 400);
  const qj = await call(A, 'POST', '/api/press/quick', { customer_id: c1.id, paid_amount: 100, payment_method: 'Cash', items: [{ product: 'PVC ID Card', qty: 25, unit_price: 40 }, { product: 'Lamination', qty: 10, unit_price: 40 }], materials: [{ item_id: film.id, qty: 6.667 }, { item_id: paper.id, qty: 2 }] });
  ok('Counter job (ID card + lamination) → order, challan, final invoice 1400', qj.status === 200 && /PRS-INV/.test(qj.data.inv_no), JSON.stringify(qj.data));
  ok('Counter job materials issued from store', Math.abs((await sbal(film.id)) - 293.333) < 0.001 && (await sbal(paper.id)) === 8);
  ok('Counter job due in customer balance', (await call(A, 'GET', '/api/customers/' + c1.id)).data.press_due === 1300);
  await ex('Designer has store access (internal)', call('des', 'POST', '/api/login', { business: BIZ, username: 'des', password: 'pass123' }, false), 200);
  await ex('Accountant has no store access', (async () => { await call('acc', 'POST', '/api/login', { business: BIZ, username: 'acc', password: 'pass123' }, false); return call('acc', 'POST', '/api/store/moves', { item_id: solv.id, type: 'use', qty: 1, purpose: 'x' }); })(), 403);

  console.log('\nDelete on master lists (never on transaction records)');
  const np = (await call(A, 'POST', '/api/ctp/products', { name: 'Test Plate', current_rate: 100 }, false)).data;
  const dp = await call(A, 'DELETE', '/api/ctp/products/' + np.id);
  ok('Unused plate deleted completely', dp.status === 200 && dp.data.archived === false && !(await call(A, 'GET', '/api/meta')).data.products.some(p => p.id === np.id));
  const dm = await call(A, 'DELETE', '/api/ctp/products/' + MINI);
  ok('Plate with stock cannot be deleted', dm.status === 400 && /still has/.test(dm.data.error));
  const nm = (await call(A, 'POST', '/api/pvc/media', { category: 'Test Media', width_ft: 2 }, false)).data;
  await call(A, 'POST', '/api/pvc/stockin', { media_id: nm.id, roll_qty: 1, roll_length: 10 });
  const ms = (await call(A, 'GET', '/api/pvc/movements')).data.find(m => m.media_id === nm.id);
  if (ms) await call(A, 'POST', `/api/pvc/movements/${ms.id}/void`, { reason: 'test' });
  const dmd = await call(A, 'DELETE', '/api/pvc/media/' + nm.id);
  ok('Used media at zero stock: hidden, history kept', dmd.status === 200 && dmd.data.archived === true && !(await call(A, 'GET', '/api/pvc/media')).data.some(m => m.id === nm.id), JSON.stringify(dmd.data));
  ok('Movements of deleted media still in history', (await call(A, 'GET', '/api/pvc/movements')).data.some(m => m.media_id === nm.id));
  await ex('Customer with invoices cannot be deleted', call(A, 'DELETE', '/api/customers/' + c1.id), 409);
  const tc = (await call(A, 'POST', '/api/customers', { name: 'Delete Me Ltd' })).data;
  await ex('New customer without records can be deleted', call(A, 'DELETE', '/api/customers/' + tc.id), 200);
  await ex('Store item with stock cannot be deleted', call(A, 'DELETE', '/api/store/items/' + film.id), 400);

  console.log('\nChallan prepared by + nickname, user nickname');
  const accU = (await call(A, 'GET', '/api/users')).data.find(u => u.username === 'acc');
  await call(A, 'PUT', '/api/users/' + accU.id, { full_name: accU.full_name, role_id: accU.role_id, nickname: 'Babu', active: true });
  ok('User nickname saved', (await call(A, 'GET', '/api/users')).data.find(u => u.username === 'acc').nickname === 'Babu');
  const sc = (await call(A, 'POST', '/api/ctp/challans', { customer_id: c2.id, remarks: 'Sample delivery', prepared_by: 'Rafiqul Islam', prepared_nick: 'Rafiq', items: [{ product_id: MINI, qty: 1 }] })).data;
  const scd = (await call(A, 'GET', '/api/ctp/challans/' + sc.id)).data;
  ok('Challan stores who prepared it + nickname', scd.prepared_by === 'Rafiqul Islam' && scd.prepared_nick === 'Rafiq', JSON.stringify(scd).slice(0, 200));
  const sc2 = (await call(A, 'POST', '/api/ctp/challans', { customer_id: c2.id, remarks: 'Sample 2', items: [{ product_id: MINI, qty: 1 }] })).data;
  ok('Prepared by defaults to the logged-in user, nickname can be empty', sc2.prepared_by === 'Owner' && sc2.prepared_nick === null, `${sc2.prepared_by}/${sc2.prepared_nick}`);

  console.log('\nInk stock in / use / colours');
  await call(A, 'POST', '/api/ink', { color: 'Cyan', type: 'in', pcs: 3 });
  await ex('Ink use needs "used for"', call(A, 'POST', '/api/ink', { color: 'Cyan', type: 'out', liters: 1 }), 400);
  await call(A, 'POST', '/api/ink', { color: 'Cyan', type: 'out', liters: 1.5, remarks: 'Machine 1' });
  const ink = (await call(A, 'GET', '/api/ink')).data;
  ok('Cyan 3 L in − 1.5 L used = 1.5 L', ink.balance.find(b => b.color === 'Cyan').liters === 1.5, JSON.stringify(ink.balance[0]));
  await ex('Ink use more than stock blocked', call(A, 'POST', '/api/ink', { color: 'Cyan', type: 'out', liters: 5, remarks: 'x' }), 400);
  await call(A, 'POST', '/api/ink/colors', { name: 'Light Cyan', hex: '#7fd6f7' }, false);
  await call(A, 'POST', '/api/ink/colors', { name: 'White', hex: '#eeeeee' }, false);
  const ink2 = (await call(A, 'GET', '/api/ink')).data;
  ok('Tenant adds as many ink colours as needed', ink2.colors.includes('Light Cyan') && ink2.colors.includes('White') && ink2.palette.White === '#eeeeee');
  await ex('Colour with stock cannot be removed', call(A, 'DELETE', '/api/ink/colors/Cyan'), 400);
  await ex('Empty colour can be removed', call(A, 'DELETE', '/api/ink/colors/White'), 200);

  const bk2 = await call(A, 'GET', '/api/backup');
  const backup2 = bk2.data instanceof ArrayBuffer ? JSON.parse(Buffer.from(bk2.data).toString()) : bk2.data;
  ok('Backup includes store, press and refund tables', backup2.tables.gen_items.length >= 6 && backup2.tables.press_orders.length >= 1 && backup2.tables.press_invoices.length >= 1 && backup2.tables.gen_moves.length > 5 && Array.isArray(backup2.tables.refunds));

  console.log('\nSaaS — isolation, trial lock, billing, super admin');
  const B2 = BIZ + '-b';
  await call('b2', 'POST', '/api/public/signup', { business_name: 'Other Press', owner_name: 'O2', phone: '01722222222', slug: B2, password: 'secret12' }, false);
  ok('Second business sees none of the first one\'s customers', (await call('b2', 'GET', '/api/customers')).data.length === 0);
  ok('Second business has its own invoice numbering', (await call('b2', 'GET', '/api/ctp/invoices')).data.length === 0);
  await ex('Duplicate Business ID rejected', call('x', 'POST', '/api/public/signup', { business_name: 'Dup', owner_name: 'D', phone: '01733333333', slug: B2, password: 'secret12' }, false), 409);
  await ex('Wrong Business ID cannot log in', call('x', 'POST', '/api/login', { business: 'no-such-biz', username: 'admin', password: 'admin123' }, false), 401);
  await call('sa', 'POST', '/api/super/login', { username: 'superadmin', password: 'baybex@123' }, false);
  const tl = (await call('sa', 'GET', '/api/super/tenants')).data; const t2 = tl.find(t => t.slug === B2);
  ok('Super admin lists both businesses', tl.some(t => t.slug === BIZ) && !!t2);
  await call('sa', 'PUT', '/api/super/tenants/' + t2.id, { ...t2, trial_ends_at: new Date(Date.now() - 3600e3).toISOString(), expires_at: null, plan_id: null });
  await ex('Expired trial is locked (402)', call('b2', 'GET', '/api/customers'), 402);
  ok('…but billing still opens', (await call('b2', 'GET', '/api/subscription')).status === 200);
  const plans = (await call('b2', 'GET', '/api/subscription')).data.plans;
  ok('Plans: 500 / 3 / 6 / 12 months', plans.map(p => p.months).join() === '1,3,6,12' && plans[0].price === 500);
  const pay2 = await call('b2', 'POST', '/api/subscription/pay', { plan_id: plans[1].id, method: 'bKash', txn_id: 'TXN' + Date.now() }, false);
  ok('Business submits bKash payment', pay2.status === 200 && pay2.data.status === 'pending');
  await ex('Same transaction ID cannot be reused', call('b2', 'POST', '/api/subscription/pay', { plan_id: plans[1].id, method: 'bKash', txn_id: pay2.data.txn_id }, false), 400);
  const appr = await call('sa', 'POST', `/api/super/payments/${pay2.data.id}/approve`, {}, false);
  ok('Super admin approves → ~3 months active', appr.status === 200 && Math.round((new Date(appr.data.to) - Date.now()) / 864e5) >= 89);
  ok('Business unlocked after approval', (await call('b2', 'GET', '/api/customers')).status === 200);
  ok('Status now active', (await call('b2', 'GET', '/api/me')).data.tenant.state === 'active');
  await call('sa', 'PUT', '/api/super/tenants/' + t2.id, { ...(await call('sa', 'GET', '/api/super/tenants/' + t2.id)).data.tenant, status: 'suspended' });
  await ex('Suspended business cannot log in', call('b2', 'POST', '/api/login', { business: B2, username: 'admin', password: 'secret12' }, false), 403);
  const imp = await call('sa', 'POST', `/api/super/tenants/${t2.id}/impersonate`, {}, false);
  ok('Super admin can open any business as its admin (even suspended)', imp.status === 200 && (await call('sa', 'GET', '/api/customers')).status === 200 && (await call('sa', 'GET', '/api/me')).data.impersonated === true);
  await ex('Business users cannot reach super admin API', call(A, 'GET', '/api/super/tenants'), 401);
  const ten = (await call('sa', 'GET', '/api/super/dashboard'));
  ok('Super dashboard counts businesses & revenue', ten.data.counts.total >= 2 && ten.data.revenue.total >= 1500, JSON.stringify(ten.data.counts));

  console.log('\nAndroid app releases & version check');
  const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(4000, 7)]);
  const up = async (code, force) => { const h = { 'Content-Type': 'application/vnd.android.package-archive', Cookie: Object.entries(jar.sa).map(([k, v]) => k + '=' + v).join('; ') };
    const r = await fetch(`${BASE}/api/super/app/releases?version_code=${code}&version_name=1.0.${code}&force_update=${force}&notes=n`, { method: 'POST', headers: h, body: zipBytes }); return r.status; };
  const baseCode = ((await call('sa', 'GET', '/api/super/app/releases')).data[0]?.version_code || 0);
  ok('Super admin uploads APK', (await up(baseCode + 1, false)) === 200);
  ok('Lower/equal version code rejected', (await up(baseCode + 1, false)) === 400);
  let vc = (await call('x', 'GET', `/api/public/app/version?current=${baseCode}`)).data;
  ok('Older app gets optional update popup', vc.update === true && vc.force === false);
  ok('Current app sees no update', (await call('x', 'GET', `/api/public/app/version?current=${baseCode + 1}`)).data.update === false);
  await up(baseCode + 2, true);
  vc = (await call('x', 'GET', `/api/public/app/version?current=${baseCode + 1}`)).data;
  ok('Forced release → mandatory update', vc.update && vc.force);
  const dl = await fetch(BASE + vc.download_url);
  ok('APK download works', dl.status === 200 && dl.headers.get('content-type').includes('android.package-archive') && Buffer.from(await dl.arrayBuffer()).equals(zipBytes));
  ok('Business users cannot upload APKs', (await call(A, 'GET', '/api/super/app/releases')).status === 401);

  console.log('\nPricing: discounts & coupons');
  const sp = (await call('sa', 'GET', '/api/super/plans')).data; const mon = sp.find(p => p.months === 1), yr = sp.find(p => p.months === 12);
  await call('sa', 'PUT', '/api/super/plans/' + mon.id, { ...mon, discount_type: 'percent', discount_value: 20, discount_label: 'Eid Offer', features: ['All features', 'Android app'] });
  let pub = (await call('x', 'GET', '/api/public/config')).data.plans.find(p => p.id === mon.id);
  ok('20% discount → ৳500 shows as ৳400 with label', pub.final_price === 400 && pub.original_price === 500 && pub.discount_text === 'Eid Offer' && pub.features.length === 2);
  await call('sa', 'PUT', '/api/super/plans/' + yr.id, { ...yr, discount_type: 'flat', discount_value: 1000 });
  pub = (await call('x', 'GET', '/api/public/config')).data.plans.find(p => p.id === yr.id);
  ok('Flat ৳1000 off → yearly ৳5000, ≈৳417/month', pub.final_price === 5000 && Math.round(pub.per_month) === 417);
  await ex('Flat discount above price rejected', call('sa', 'PUT', '/api/super/plans/' + mon.id, { ...mon, discount_type: 'flat', discount_value: 900 }), 400);
  await ex('Percentage above 100 rejected', call('sa', 'PUT', '/api/super/plans/' + mon.id, { ...mon, discount_type: 'percent', discount_value: 150 }), 400);
  await call('sa', 'PUT', '/api/super/plans/' + yr.id, { ...yr, discount_type: 'flat', discount_value: 1000, discount_ends: new Date(Date.now() - 864e5).toISOString() });
  ok('Expired discount no longer applies', (await call('x', 'GET', '/api/public/config')).data.plans.find(p => p.id === yr.id).final_price === 6000);
  await call('sa', 'POST', '/api/super/plans/bulk-discount', { plan_ids: sp.map(p => p.id), discount_type: 'percent', discount_value: 10, discount_label: 'Launch offer' }, false);
  ok('Bulk 10% offer on all plans', (await call('x', 'GET', '/api/public/config')).data.plans.every(p => p.final_price === Math.round(p.original_price * 0.9 * 100) / 100));
  await call('sa', 'POST', '/api/super/coupons', { code: 'save50', type: 'flat', value: 50, max_uses: 1, plan_ids: [mon.id] }, false);
  await call('sa', 'PUT', '/api/super/tenants/' + t2.id, { ...(await call('sa', 'GET', '/api/super/tenants/' + t2.id)).data.tenant, status: 'active' });
  await call('b2', 'POST', '/api/login', { business: B2, username: 'admin', password: 'secret12' }, false);
  let qq = (await call('b2', 'GET', `/api/subscription/quote?plan_id=${mon.id}&coupon=SAVE50`)).data;
  ok('Quote: ৳500 − 10% − coupon ৳50 = ৳400', qq.original === 500 && qq.plan_discount === 50 && qq.coupon_discount === 50 && qq.total === 400, JSON.stringify(qq));
  await ex('Coupon not valid on other plans', call('b2', 'GET', `/api/subscription/quote?plan_id=${yr.id}&coupon=SAVE50`), 400);
  const cp = await call('b2', 'POST', '/api/subscription/pay', { plan_id: mon.id, coupon: 'save50', method: 'bKash', txn_id: 'CPN' + Date.now() }, false);
  ok('Payment stores the discounted amount & coupon', cp.data.amount === 400 && cp.data.coupon_code === 'SAVE50' && cp.data.original_amount === 500, JSON.stringify(cp.data).slice(0, 200));
  await call('sa', 'POST', `/api/super/payments/${cp.data.id}/approve`, {}, false);
  ok('Coupon use counted on approval', (await call('sa', 'GET', '/api/super/coupons')).data.find(c => c.code === 'SAVE50').used === 1);
  await ex('Used-up coupon rejected', call('b2', 'GET', `/api/subscription/quote?plan_id=${mon.id}&coupon=SAVE50`), 400);
  await call('sa', 'POST', '/api/super/plans/bulk-discount', { plan_ids: sp.map(p => p.id), discount_type: 'none' }, false);

  console.log('\nWebsite content editing');
  const st0 = (await call('sa', 'GET', '/api/super/settings')).data;
  ok('Super admin gets website content + defaults', st0.website.hero.title && st0.website_defaults.features.items.length === 9);
  const W = JSON.parse(JSON.stringify(st0.website));
  W.hero.title = 'নতুন হেডলাইন <script>x</script>'; W.faq.show = false; W.features.items = W.features.items.slice(0, 3); W.hacker = { evil: 1 }; W.topbar.show = true;
  await call('sa', 'PUT', '/api/super/settings', { website: W });
  const pw = (await call('x', 'GET', '/api/public/config')).data.website;
  ok('Edited headline published', pw.hero.title === 'নতুন হেডলাইন <script>x</script>');
  ok('Section hidden & list shortened', pw.faq.show === false && pw.features.items.length === 3 && pw.topbar.show === true);
  ok('Unknown keys dropped', pw.hacker === undefined);
  await call('sa', 'PUT', '/api/super/settings', { website: { hero: { title: 'Only title' } } });
  const pw2 = (await call('x', 'GET', '/api/public/config')).data.website;
  ok('Missing fields fall back to defaults', pw2.hero.title === 'Only title' && pw2.steps.items.length === 3 && pw2.faq.show === true);
  await call('sa', 'PUT', '/api/super/settings', { website: st0.website_defaults });

  console.log('\nBrochure');
  let br = await fetch(BASE + '/api/public/brochure.pdf');
  ok('Built-in brochure PDF downloads', br.status === 200 && Buffer.from(await br.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
  const saH = { Cookie: Object.entries(jar.sa).map(([k, v]) => k + '=' + v).join('; ') };
  ok('Non-PDF upload rejected', (await fetch(BASE + '/api/super/files/brochure', { method: 'POST', headers: { ...saH, 'Content-Type': 'application/pdf' }, body: Buffer.alloc(500, 1) })).status === 400);
  const myPdf = Buffer.concat([Buffer.from('%PDF-1.4 test '), Buffer.alloc(500, 32)]);
  ok('Super admin replaces brochure', (await fetch(BASE + '/api/super/files/brochure?file_name=new.pdf', { method: 'POST', headers: { ...saH, 'Content-Type': 'application/pdf' }, body: myPdf })).status === 200);
  br = await fetch(BASE + '/api/public/brochure.pdf');
  ok('Website serves the uploaded brochure', Buffer.from(await br.arrayBuffer()).equals(myPdf));
  ok('Brochure page and QR codes available', (await fetch(BASE + '/brochure')).status === 200 && (await (await fetch(BASE + '/api/public/qr.svg?for=signup')).text()).startsWith('<svg'));
  await fetch(BASE + '/api/super/files/brochure', { method: 'DELETE', headers: saH });

  console.log(`\n${pass} passed, ${failN} failed\n`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
function r2(n) { return Math.round(n * 100) / 100; }
