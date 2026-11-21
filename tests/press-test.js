/* Printing Press workflow test — run with the server on localhost:3000:  node tests/press-test.js */
'use strict';
const BASE = process.env.BASE || 'http://localhost:3000';
const jars = {};
let passed = 0, failed = 0;
async function call(jar, method, path, body, idem = true, headers = {}) {
  const h = { Cookie: Object.entries(jars[jar] || {}).map(([k, v]) => `${k}=${v}`).join('; '), ...headers };
  let payload;
  if (Buffer.isBuffer(body)) { payload = body; h['Content-Type'] = h['Content-Type'] || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  if (idem && method === 'POST') h['X-Idempotency-Key'] = 'k' + Math.random();
  const r = await fetch(BASE + path, { method, headers: h, body: payload });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, v] = kv.split('='); (jars[jar] = jars[jar] || {})[k] = v; }
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const ok = (name, cond, extra = '') => { if (cond) { passed++; console.log('  ✓', name); } else { failed++; console.log('  ✗', name, extra); } };
const ex = async (name, p, status) => { const r = await p; ok(name, r.status === status, `→ ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r; };
const d = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() + n * 86400000));

(async () => {
  const BIZ = 'press-' + Date.now().toString(36);
  const A = 'a';
  console.log('\nSetup');
  await ex('Signup', call(A, 'POST', '/api/public/signup', { business_name: 'Test Offset Press', owner_name: 'Owner', phone: '01700000000', slug: BIZ, username: 'admin', password: 'admin123' }, false), 200);
  await ex('Login', call(A, 'POST', '/api/login', { business: BIZ, username: 'admin', password: 'admin123' }, false), 200);
  const meta = (await call(A, 'GET', '/api/meta')).data;
  ok('Marketing Officer + Store Staff roles exist', meta.roles.some(r => r.name === 'Marketing Officer') && meta.roles.some(r => r.name === 'Store Staff'));
  ok('PDF expense categories present', ['Paper Purchase', 'Ink Purchase', 'Plate Cost', 'Labour Cost', 'Outsourcing Cost', 'Office Expense'].every(x => meta.expense_categories.includes(x)));
  const cust = (await call(A, 'POST', '/api/customers', { name: 'Rahman Traders', phone: '01711111111' })).data;
  const cust2 = (await call(A, 'POST', '/api/customers', { name: 'Walk-in Customer', phone: '01722222222' })).data;

  console.log('\nBack-dated entries (paper register after power cut)');
  await ex('Future date blocked', call(A, 'POST', '/api/expenses', { date: d(2), category: 'Electricity', amount: 100, method: 'Cash' }), 400);
  await ex('Back-dated expense allowed', call(A, 'POST', '/api/expenses', { date: d(-3), category: 'Electricity', amount: 1200, method: 'Cash' }), 200);
  await ex('Invalid date blocked', call(A, 'POST', '/api/expenses', { date: '2026-02-31', category: 'Electricity', amount: 1, method: 'Cash' }), 400);

  console.log('\nStore — items, purchase (ream → sheet), stock');
  const paper = (await call(A, 'POST', '/api/store/items', { category: 'Paper', paper_type: 'Offset', gsm: '80', size: '23x36', unit: 'Sheet', low_stock: 500, rack: 'R1' }, false)).data;
  ok('Paper item auto-named and coded', paper.name === 'Offset 80 GSM 23x36' && /^ITM-/.test((await call(A, 'GET', '/api/store/items')).data.find(i => i.id === paper.id).code), paper.name);
  const ink = (await call(A, 'POST', '/api/store/items', { category: 'Ink', name: 'Offset Ink Black', unit: 'Kg', low_stock: 2 }, false)).data;
  const film = (await call(A, 'POST', '/api/store/items', { category: 'Lamination Film', name: 'Glossy film 12"', unit: 'ft', width_in: 12 }, false)).data;
  const sup = (await call(A, 'POST', '/api/press/suppliers', { name: 'Dhaka Paper House', phone: '0170' }, false)).data;
  const pur = await call(A, 'POST', '/api/store/purchases', { date: d(-2), supplier_id: sup.id, bill_ref: 'B-77', record_expense: true, method: 'Cash', lines: [{ item_id: paper.id, qty: 4, unit: 'Ream', rate: 3000 }, { item_id: ink.id, qty: 5, rate: 900 }, { item_id: film.id, qty: 600, rate: 2 }] });
  ok('Purchase saved, total 12000+4500+1200', pur.status === 200 && pur.data.total === 17700, JSON.stringify(pur.data).slice(0, 160));
  let items = (await call(A, 'GET', '/api/store/items')).data;
  const pb = items.find(i => i.id === paper.id);
  ok('4 reams → 2000 sheets, cost 6/sheet', +pb.balance === 2000 && Math.abs(+pb.avg_cost - 6) < 0.0001, `${pb.balance} ${pb.avg_cost}`);
  ok('Purchase recorded as expense (Paper/Ink mix → Other)', (await call(A, 'GET', '/api/expenses')).data.some(e => e.description && e.description.includes(pur.data.pur_no)));
  await ex('Own use needs purpose', call(A, 'POST', '/api/store/moves', { item_id: ink.id, type: 'use', qty: 1 }), 400);
  await ex('Adjustment (count = 4.5 kg) records before/after', call(A, 'POST', '/api/store/moves', { item_id: ink.id, type: 'adjust', new_qty: 4.5, reason: 'Physical count' }), 200);
  const adj = (await call(A, 'GET', `/api/store/moves?item=${ink.id}`)).data.find(m => m.type === 'adj_out');
  ok('Adjustment keeps previous 5 and new 4.5', adj && +adj.before_qty === 5 && +adj.after_qty === 4.5);

  console.log('\nOrder → design → production');
  const mach = (await call(A, 'POST', '/api/press/machines', { name: 'Two Colour Offset', type: 'Offset' }, false)).data;
  const ord = await call(A, 'POST', '/api/press/orders', {
    date: d(-1), customer_id: cust.id, order_type: 'Full Production', deadline: d(5), advance: { amount: 5000, method: 'Cash' },
    items: [
      { product: 'Leaflet', template: 'Poster / Leaflet / Brochure', qty: 1000, size: 'A4', paper: 'Offset', gsm: '80', colour: '4 colour', sides: 'Two side', unit_price: 3, machine_id: mach.id, est_cost: { paper: 900, plate: 400, printing: 500 } },
      { product: 'Business Card', template: 'Business / Invitation Card', qty: 500, unit_price: 2, est_cost: { paper: 150 } },
    ] });
  ok('Order created ORD-00001 with 2 products, total 4000', ord.status === 200 && ord.data.order_no === 'ORD-00001' && +ord.data.total === 4000 && ord.data.items.length === 2, JSON.stringify(ord.data).slice(0, 300));
  const O = ord.data, leaf = O.items[0], card = O.items[1];
  ok('Steps copied from template', leaf.steps.length === 8 && leaf.steps[3].name === 'Printing');
  ok('Advance 5000 recorded against order (no invoice yet)', O.paid === 5000 && O.payments[0].order_id === O.id);
  ok('Order creation did NOT touch stock', +(await call(A, 'GET', '/api/store/items')).data.find(i => i.id === paper.id).balance === 2000);
  await ex('Printing blocked before design approval', call(A, 'POST', `/api/press/items/${leaf.id}/step`, { index: 3, done: true }), 409);
  await ex('In Progress blocked before approval', call(A, 'PUT', `/api/press/items/${leaf.id}/production`, { prod_status: 'In Progress' }), 409);
  await call(A, 'POST', `/api/press/items/${leaf.id}/design`, { action: 'start' });
  await call(A, 'POST', `/api/press/items/${leaf.id}/design`, { action: 'send' });
  await ex('Revision needs a note', call(A, 'POST', `/api/press/items/${leaf.id}/design`, { action: 'revision' }), 400);
  await call(A, 'POST', `/api/press/items/${leaf.id}/design`, { action: 'revision', note: 'Change logo colour' });
  await ex('Design upload refused before approval', call(A, 'POST', `/api/press/items/${leaf.id}/design-file`, Buffer.from('PDFDATA'), false, { 'X-File-Name': 'leaflet.pdf' }), 400);
  await call(A, 'POST', `/api/press/items/${leaf.id}/design`, { action: 'send' });
  await call(A, 'POST', `/api/press/items/${leaf.id}/design`, { action: 'approve', approved_by: 'Mr. Rahman' });
  await ex('Final approved file stored', call(A, 'POST', `/api/press/items/${leaf.id}/design-file`, Buffer.from('%PDF-1.4 final'), false, { 'X-File-Name': 'leaflet-final.pdf', 'Content-Type': 'application/pdf' }), 200);
  const dl = await fetch(BASE + `/api/press/items/${leaf.id}/design-file`, { headers: { Cookie: Object.entries(jars[A]).map(([k, v]) => `${k}=${v}`).join('; ') } });
  ok('Design file downloads back', (await dl.text()) === '%PDF-1.4 final');
  for (let i = 0; i < 4; i++) await call(A, 'POST', `/api/press/items/${leaf.id}/step`, { index: i, done: true, date: d(0) });
  let od = (await call(A, 'GET', `/api/press/orders/${O.id}`)).data;
  ok('Order in production after first steps', od.status === 'in_production' && od.items[0].prod_status === 'In Progress', od.status);
  await call(A, 'POST', `/api/press/items/${card.id}/design`, { action: 'approve', approved_by: 'Mr. Rahman' });

  console.log('\nMaterial issue & return');
  await ex('Issue more than stock refused', call(A, 'POST', '/api/press/issues', { order_id: O.id, item_id: leaf.id, lines: [{ item_id: paper.id, qty: 5, unit: 'Ream' }] }), 400);
  const iss = await call(A, 'POST', '/api/press/issues', { order_id: O.id, item_id: leaf.id, received_by: 'Operator Karim', lines: [{ item_id: paper.id, qty: 600 }, { item_id: ink.id, qty: 1 }] });
  ok('Issue slip ISS-00001', iss.status === 200 && iss.data.issue_no === 'ISS-00001');
  ok('Stock reduced only by issue (2000-600=1400)', +(await call(A, 'GET', '/api/store/items')).data.find(i => i.id === paper.id).balance === 1400);
  const slip = (await call(A, 'GET', `/api/press/issues/${iss.data.id}`)).data;
  const pline = slip.lines.find(l => l.stock_item_id === paper.id);
  await ex('Return more than issued refused', call(A, 'POST', '/api/press/returns', { line_id: pline.id, qty: 700, condition: 'usable', reason: 'x' }), 400);
  await ex('Usable return → back to stock', call(A, 'POST', '/api/press/returns', { line_id: pline.id, qty: 50, condition: 'usable', reason: 'Extra sheets' }), 200);
  await ex('Damaged return → loss, not stock', call(A, 'POST', '/api/press/returns', { line_id: pline.id, qty: 10, condition: 'damaged', reason: 'Torn' }), 200);
  ok('Paper 1400 + 50 = 1450', +(await call(A, 'GET', '/api/store/items')).data.find(i => i.id === paper.id).balance === 1450);
  await ex('Issue with returns cannot be voided', call(A, 'POST', `/api/press/issues/${iss.data.id}/void`, { reason: 'x' }), 400);

  console.log('\nCustomer-supplied material (not our stock)');
  const cm = (await call(A, 'POST', '/api/press/materials', { order_id: O.id, description: 'Printed cartons', received_qty: 300, unit: 'pcs' })).data;
  await ex('Mismatch without reason refused', call(A, 'PUT', `/api/press/materials/${cm.id}/return`, { processed_qty: 300, good_qty: 290, returned_qty: 290, waste_qty: 5 }), 400);
  await ex('Return with mismatch reason saved', call(A, 'PUT', `/api/press/materials/${cm.id}/return`, { processed_qty: 300, good_qty: 290, returned_qty: 290, waste_qty: 5, diff_reason: '5 lost in die cutting', receiver_name: 'Rahman' }), 200);
  ok('Customer material never entered store items', (await call(A, 'GET', '/api/store/items')).data.every(i => !/carton/i.test(i.name)));

  console.log('\nOutsourcing + costs');
  const out = (await call(A, 'POST', '/api/press/outsourcing', { order_id: O.id, item_id: card.id, supplier_id: sup.id, work: 'Spot UV', qty: 500, cost: 600 })).data;
  await ex('Overpay outsourcing refused', call(A, 'POST', `/api/press/outsourcing/${out.id}/pay`, { amount: 700, method: 'Cash' }), 400);
  await ex('Pay outsourcing → expense', call(A, 'POST', `/api/press/outsourcing/${out.id}/pay`, { amount: 600, method: 'Cash' }), 200);
  await call(A, 'POST', `/api/press/orders/${O.id}/costs`, { category: 'labour', amount: 300, note: 'Overtime' });
  await call(A, 'POST', `/api/press/orders/${O.id}/costs`, { category: 'plate', amount: 400 });

  console.log('\nPartial delivery → challans, then final invoice');
  await ex('Invoice before full delivery refused', call(A, 'POST', '/api/press/invoices', { order_id: O.id }), 400);
  const ch1 = await call(A, 'POST', '/api/press/challans', { order_id: O.id, date: d(0), receiver: 'Rahman', items: [{ item_id: leaf.id, qty: 400 }] });
  ok('Challan 1 (400 of 1000)', ch1.status === 200 && ch1.data.items[0].previous == 0 && ch1.data.items[0].remaining === 600, JSON.stringify(ch1.data).slice(0, 200));
  await ex('Over-delivery refused', call(A, 'POST', '/api/press/challans', { order_id: O.id, items: [{ item_id: leaf.id, qty: 601 }] }), 400);
  const ch2 = await call(A, 'POST', '/api/press/challans', { order_id: O.id, items: [{ item_id: leaf.id, qty: 300 }, { item_id: card.id, qty: 500 }] });
  const ch2d = (await call(A, 'GET', `/api/press/challans/${ch2.data.id}`)).data;
  const l2 = ch2d.items.find(i => i.item_id === leaf.id);
  ok('Challan 2 shows previous 400, current 300, total 700, remaining 300', +l2.previous === 400 && +l2.current === 300 && l2.total_delivered === 700 && l2.remaining === 300, JSON.stringify(l2));
  ok('Order status partial delivery', (await call(A, 'GET', `/api/press/orders/${O.id}`)).data.status === 'partial_delivery');
  await call(A, 'POST', '/api/payments', { customer_id: cust.id, order_id: O.id, amount: 1000, method: 'bKash', time: '15:30', date: d(0) });
  await call(A, 'POST', '/api/press/challans', { order_id: O.id, items: [{ item_id: leaf.id, qty: 300 }] });
  ok('All delivered → status delivered', (await call(A, 'GET', `/api/press/orders/${O.id}`)).data.status === 'delivered');
  const prev = (await call(A, 'GET', `/api/press/orders/${O.id}/invoice-preview`)).data;
  ok('Invoice preview: all delivered, advance 6000', prev.all_delivered && prev.paid_advance === 6000, JSON.stringify(prev).slice(0, 150));
  await ex('Adjustment needs a note', call(A, 'POST', '/api/press/invoices', { order_id: O.id, adjustment: 100 }), 400);
  const inv = await call(A, 'POST', '/api/press/invoices', { order_id: O.id, discount: 200, adjustment: 50, adjustment_note: 'Extra packing', lines: [{ item_id: leaf.id, unit_price: 3 }, { item_id: card.id, unit_price: 2.2 }], current_payment: { amount: 0 } });
  ok('Final invoice PRS-INV-00001 = 3000+1100-200+50 = 3950', inv.status === 200 && inv.data.inv_no === 'PRS-INV-00001' && +inv.data.grand_total === 3950, JSON.stringify(inv.data).slice(0, 200));
  ok('Earlier payments applied (6000 paid ≥ 3950 → due 0)', inv.data.paid === 3950 && inv.data.due === 0, `${inv.data.paid}/${inv.data.due}`);
  await ex('Second invoice for same order refused', call(A, 'POST', '/api/press/invoices', { order_id: O.id }), 400);
  await ex('Invoiced order cannot be edited', call(A, 'PUT', `/api/press/orders/${O.id}`, { customer_id: cust.id, items: O.items.map(i => ({ ...i })) }), 400);
  let cd = (await call(A, 'GET', `/api/customers/${cust.id}`)).data;
  ok('Customer has 2050 credit (6000 paid − 3950)', cd.credit === 2050 && +cd.customer.balance === -2050, `${cd.credit} ${cd.customer.balance}`);

  console.log('\nRefund (cancelled / over-paid money)');
  await ex('Refund above credit refused', call(A, 'POST', '/api/refunds', { customer_id: cust.id, amount: 3000, method: 'Cash', reason: 'Return extra' }), 400);
  const rf = await call(A, 'POST', '/api/refunds', { customer_id: cust.id, amount: 2050, method: 'Cash', reason: 'Extra advance returned', order_id: O.id });
  ok('Refund RF-00001 saved', rf.status === 200 && rf.data.refund_no === 'RF-00001');
  cd = (await call(A, 'GET', `/api/customers/${cust.id}`)).data;
  ok('After refund: balance 0, credit 0', +cd.customer.balance === 0 && cd.credit === 0, `${cd.customer.balance} ${cd.credit}`);
  const led = (await call(A, 'GET', `/api/customers/${cust.id}/ledger`)).data;
  ok('Ledger shows Advance, Press Invoice and Refund, closing 0', led.rows.some(r => r.type === 'Press Invoice') && led.rows.some(r => r.type === 'Refund' && r.debit === 2050) && led.closing === 0, JSON.stringify(led.rows.map(r => r.type)));
  const p1 = (await call(A, 'GET', '/api/payments')).data.find(p => p.order_id === O.id);
  await ex('Payment void blocked while refund depends on it', call(A, 'POST', `/api/payments/${p1.id}/void`, { reason: 'x' }), 400);

  console.log('\nVoid invoice (register, payments kept)');
  await ex('Void needs category', call(A, 'POST', `/api/press/invoices/${inv.data.id}/void`, { reason: 'Wrong price' }), 400);
  await ex('Void invoice', call(A, 'POST', `/api/press/invoices/${inv.data.id}/void`, { reason: 'Business card price wrong', category: 'Wrong price' }), 200);
  const vr = (await call(A, 'GET', '/api/press/reports/void-register?from=' + d(-30) + '&to=' + d(0))).data;
  ok('Void register keeps original no, amount and linked payments', vr.rows.length === 1 && vr.rows[0].inv_no === 'PRS-INV-00001' && +vr.rows[0].linked_payments === 3950, JSON.stringify(vr.rows[0]));
  od = (await call(A, 'GET', `/api/press/orders/${O.id}`)).data;
  ok('Order back to delivered, payments stay with order', od.status === 'delivered' && od.paid === 6000);
  const inv2 = await call(A, 'POST', '/api/press/invoices', { order_id: O.id, lines: [{ item_id: card.id, unit_price: 2 }] });
  ok('New invoice gets a NEW number (old number never reused)', inv2.data.inv_no === 'PRS-INV-00002' && +inv2.data.grand_total === 4000, inv2.data.inv_no);
  cd = (await call(A, 'GET', `/api/customers/${cust.id}`)).data;
  ok('Re-invoice 4000 vs paid 6000 − refunded 2050 → due 50', +cd.customer.balance === 50, cd.customer.balance);

  console.log('\nJob costing');
  const cost = od.costing;
  ok('Estimated cost from order (900+400+500+150)', cost.est_total === 1950, JSON.stringify(cost.est));
  const fresh = (await call(A, 'GET', `/api/press/orders/${O.id}`)).data.costing;
  ok('Actual: paper (600−50)×6=3300, ink 900, outsourcing 600, labour 300, plate 400', fresh.actual.paper === 3300 && fresh.actual.printing === 900 && fresh.actual.outsourcing === 600 && fresh.actual.labour === 300 && fresh.actual.plate === 400, JSON.stringify(fresh.actual));
  ok('P/L uses final invoice 4000', fresh.selling === 4000 && fresh.actual_profit === r2(4000 - fresh.actual_total));

  console.log('\nCounter job (old "General" bill → press)');
  const qj = await call(A, 'POST', '/api/press/quick', { customer_id: cust2.id, paid_amount: 500, payment_method: 'Cash', items: [{ product: 'PVC ID Card', template: 'ID Card', qty: 20, unit_price: 40 }, { product: 'Lamination', template: 'Lamination (service)', qty: 10, unit_price: 30 }],
    materials: [{ item_id: film.id, qty: 15 }] });
  ok('Counter job → order + challan + invoice (1100), paid 500', qj.status === 200 && /PRS-INV/.test(qj.data.inv_no), JSON.stringify(qj.data));
  const qinv = (await call(A, 'GET', `/api/press/invoices/${qj.data.invoice_id}`)).data;
  ok('Counter invoice total 1100, due 600', +qinv.grand_total === 1100 && qinv.due === 600);
  ok('Film issued 600−15 = 585', +(await call(A, 'GET', '/api/store/items')).data.find(i => i.id === film.id).balance === 585);

  console.log('\nCancel order with advance → refund');
  const o3 = (await call(A, 'POST', '/api/press/orders', { customer_id: cust2.id, advance: { amount: 800, method: 'Cash' }, items: [{ product: 'Poster', qty: 100, unit_price: 10 }] })).data;
  await call(A, 'POST', `/api/press/orders/${o3.id}/cancel`, { reason: 'Customer changed mind' });
  const c2 = (await call(A, 'GET', `/api/customers/${cust2.id}`)).data;
  ok('Cancelled order advance shows as credit (800 − 600 due auto? no: 800 credit, 600 due)', c2.credit === 800 && +c2.customer.balance === -200, `${c2.credit} ${c2.customer.balance}`);
  await ex('Refund the cancelled order advance', call(A, 'POST', '/api/refunds', { customer_id: cust2.id, amount: 800, method: 'Cash', reason: 'Order cancelled', order_id: o3.id }), 200);
  ok('Now customer owes the 600 counter-job due', +(await call(A, 'GET', `/api/customers/${cust2.id}`)).data.customer.balance === 600);

  console.log('\nCTP invoice cancel with immediate refund');
  const ctpP = meta.products[0];
  await call(A, 'POST', '/api/ctp/opening', { product_id: ctpP.id, qty: 50 });
  const dr = (await call(A, 'POST', '/api/ctp/invoices', { customer_id: cust2.id, items: [{ product_id: ctpP.id, qty: 2, rate: 300 }] })).data;
  await call(A, 'POST', `/api/ctp/invoices/${dr.id}/confirm`, { paid_amount: 600 });
  const before = +(await call(A, 'GET', `/api/customers/${cust2.id}`)).data.customer.balance;
  await ex('Cancel + refund paid 600 in one step', call(A, 'POST', `/api/ctp/invoices/${dr.id}/cancel`, { reason: 'Job not done', refund: { amount: 600, method: 'Cash' } }), 200);
  const after = (await call(A, 'GET', `/api/customers/${cust2.id}`)).data;
  ok('Balance unchanged by cancel+refund, no advance left', +after.customer.balance === before && after.credit === 0, `${before} → ${after.customer.balance}, credit ${after.credit}`);

  console.log('\nDashboard & reports');
  const dash = (await call(A, 'GET', '/api/dashboard')).data;
  ok('Dashboard has press block + total sales incl. press', dash.press && typeof dash.press.running === 'number' && dash.sales.total >= dash.sales.press && dash.sales.press > 0, JSON.stringify(dash.sales));
  ok('Store low-stock alerts on dashboard', Array.isArray(dash.low.store));
  const reps = (await call(A, 'GET', '/api/press/reports')).data;
  let bad = [];
  for (const r of reps) { const x = await call(A, 'GET', `/api/press/reports/${r.key}?from=${d(-30)}&to=${d(0)}`); if (x.status !== 200 || !Array.isArray(x.data.rows)) bad.push(r.key + ':' + x.status + JSON.stringify(x.data).slice(0, 80)); }
  ok(`All ${reps.length} press reports run`, !bad.length, bad.join(' | '));
  const calc = (await call(A, 'POST', '/api/press/calculate', { sheet_w: 23, sheet_l: 36, piece_w: 8.27, piece_l: 11.69, qty: 1000, gsm: 80, sides: 2, make_ready: 50, wastage_pct: 3 })).data;
  ok('Calculator: A4 on 23×36 → 7 up (mixed layout), 143 run + 100 make-ready + 5 waste', calc.ups === 7 && calc.best === 'mixed' && calc.total_sheets === 248 && calc.weight_kg > 0, JSON.stringify(calc));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
function r2(n) { return Math.round(n * 100) / 100; }
