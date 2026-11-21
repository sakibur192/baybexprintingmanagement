'use strict';
/**
 * PRINTING PRESS (offset) — orders, order sheet, design, production & calendar, paper calculator,
 * main store (inventory, purchase, issue / return, adjustment), customer-supplied material, machines,
 * suppliers & outsourcing, delivery challan (A5), final invoice (A4) with void register, refunds, job costing.
 * Installed by server.js; every helper (q, tx, can…) comes from there so tenancy & transactions are shared.
 */

const COST_CATS = { paper: 'Paper / Board', plate: 'Plate', printing: 'Printing', design: 'Design', lamination: 'Lamination', finishing: 'Finishing', labour: 'Labour', outsourcing: 'Outsourcing', other: 'Other' };
const STORE_CATS = ['Paper', 'Board', 'Ink', 'Die', 'Plate (Aluminium)', 'Blanket', 'Remover', 'Lamination Film', 'Lamination Gum', 'Blue Gum', 'PVC Solvent', 'CTP Chemical', 'Consumables'];
const costCatOfStore = cat => {
  const c = String(cat || '').toLowerCase();
  if (/paper|board/.test(c)) return 'paper';
  if (/plate|aluminium|alumin/.test(c)) return 'plate';
  if (/lamination/.test(c)) return 'lamination';
  if (/die/.test(c)) return 'finishing';
  if (/ink|blanket|remover|gum|solvent|chemical/.test(c)) return 'printing';
  return 'other';
};
const PROD_STATUS = ['Pending', 'Assigned', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
const DESIGN_STATUS = ['Pending', 'In Progress', 'Approval Pending', 'Approved', 'Revision Required'];
const VOID_CATS = ['Wrong price', 'Wrong quantity', 'Wrong customer', 'Duplicate invoice', 'Order cancelled', 'Other'];
const PRINT_STEP = /print|plate/i;   // these production steps need an approved design first

const DEFAULT_PRESS = {
  templates: [
    { name: 'Diary / Notebook', steps: ['Cover design', 'Inner design', 'Design approval', 'Cover printing', 'Inner printing', 'Lamination', 'Cutting', 'Punching', 'Wire-O binding', 'Finishing & QC', 'Submit to office'] },
    { name: 'Book', steps: ['Design', 'Design approval', 'Plate', 'Printing', 'Folding', 'Binding', 'Cutting', 'Finishing & QC', 'Submit to office'] },
    { name: 'Poster / Leaflet / Brochure', steps: ['Design', 'Design approval', 'Plate', 'Printing', 'Lamination', 'Cutting', 'Packing', 'Submit to office'] },
    { name: 'Business / Invitation Card', steps: ['Design', 'Design approval', 'Plate', 'Printing', 'Lamination', 'Cutting', 'Submit to office'] },
    { name: 'Box / Packaging / Carton', steps: ['Design', 'Design approval', 'Plate', 'Printing', 'Lamination', 'Die cutting', 'Pasting', 'Finishing & QC', 'Submit to office'] },
    { name: 'Memo / Receipt Book', steps: ['Design', 'Design approval', 'Plate', 'Printing', 'Numbering', 'Binding', 'Cutting', 'Submit to office'] },
    { name: 'ID Card', steps: ['Design', 'Design approval', 'Printing', 'Lamination', 'Cutting', 'Submit to office'] },
    { name: 'Lamination (service)', steps: ['Lamination', 'Cutting', 'Submit to office'] },
    { name: 'Die cutting (service)', steps: ['Die cutting', 'Submit to office'] },
    { name: 'Cutting / Binding (service)', steps: ['Cutting', 'Binding', 'Submit to office'] },
    { name: 'Other', steps: ['Work', 'Submit to office'] },
  ],
  paper_sizes: [[23, 36], [18, 23], [20, 30], [26, 32], [22, 28], [20, 32], [23, 33], [28, 44], [35, 47], [41.5, 41.5]].map(([w, l]) => ({ w, l, gsm: [60, 70, 80, 100, 120, 150, 210, 250, 300] })),
  ream_sheets: 500, make_ready_sheets: 50, wastage_pct: 3,
  order_types: ['Full Production', 'Partial Production', 'Service Only'],
  customer_types: ['Own order', 'Business / institution', 'Local customer'],
  void_needs_approval: false, backdate_days: 31,
};

module.exports = function installPress(h) {
  const { app, q, q1, tx, can, wrap, bad, str, num, r2, audit, idem, nextNo, entryDate, today, lists, getSetting, recordPayment, paidSql } = h;
  const MV_OUT = ['use', 'job', 'issue', 'wastage', 'adj_out'];
  const perm = (u, ...p) => p.some(x => u.perms.includes(x));
  const need = (u, ...p) => { if (!perm(u, ...p)) bad('You do not have permission for this action', 403); };
  const dateOrNull = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const qf = n => Math.round((+n || 0) * 1000) / 1000;

  async function pressSettings(c) {
    const r = c ? (await c.query(`SELECT value FROM settings WHERE key='press'`)).rows[0] : await q1(`SELECT value FROM settings WHERE key='press'`);
    const v = { ...DEFAULT_PRESS, ...(r?.value || {}) };
    if (!Array.isArray(v.templates) || !v.templates.length) v.templates = DEFAULT_PRESS.templates;
    if (!Array.isArray(v.paper_sizes)) v.paper_sizes = DEFAULT_PRESS.paper_sizes;
    return v;
  }
  async function act(c, u, order_id, item_id, kind, text) {
    await c.query(`INSERT INTO press_activity(order_id,item_id,kind,text,by_name) VALUES($1,$2,$3,$4,$5)`, [order_id, item_id || null, kind, text, u.full_name]);
  }
  const canSeeAll = u => perm(u, 'press.orders.all', 'press.production', 'press.store', 'press.delivery', 'press.invoice', 'press.design');
  async function loadOrderFor(c, u, id, lock) {
    const o = (await c.query(`SELECT * FROM press_orders WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!o) bad('Order not found', 404);
    if (!canSeeAll(u) && o.created_by !== u.id && o.officer_id !== u.id) bad('This order belongs to another officer', 403);
    return o;
  }

  /* ---------------- order status (kept in one place) ---------------- */
  async function deliveredMap(c, orderId) {
    const r = (await c.query(`SELECT ci.item_id, SUM(ci.qty) qty FROM press_challan_items ci JOIN press_challans ch ON ch.id=ci.challan_id
      WHERE ch.order_id=$1 AND ch.status='active' GROUP BY ci.item_id`, [orderId])).rows;
    return Object.fromEntries(r.map(x => [x.item_id, +x.qty]));
  }
  async function refreshOrder(c, id) {
    const o = (await c.query(`SELECT * FROM press_orders WHERE id=$1`, [id])).rows[0]; if (!o) return;
    const items = (await c.query(`SELECT * FROM press_items WHERE order_id=$1 AND NOT cancelled`, [id])).rows;
    const total = r2(items.reduce((s, i) => s + +i.total, 0));
    let status = o.status;
    if (o.status !== 'cancelled') {
      const inv = (await c.query(`SELECT 1 FROM press_invoices WHERE order_id=$1 AND status='final'`, [id])).rowCount;
      const del = await deliveredMap(c, id);
      const allDel = items.length && items.every(i => (del[i.id] || 0) >= +i.qty - 1e-9), anyDel = items.some(i => (del[i.id] || 0) > 0);
      if (inv) status = 'invoiced';
      else if (allDel) status = 'delivered';
      else if (anyDel) status = 'partial_delivery';
      else if (items.length && items.every(i => i.prod_status === 'Completed')) status = 'ready';
      else if (items.some(i => ['Assigned', 'In Progress', 'Completed', 'On Hold'].includes(i.prod_status))) status = 'in_production';
      else status = 'pending';
    }
    await c.query(`UPDATE press_orders SET status=$1, total=$2, updated_at=now() WHERE id=$3`, [status, total, id]);
  }

  /* ---------------- job costing ---------------- */
  async function costing(c, orderId) {
    const items = (await c.query(`SELECT id, product, total, est_cost FROM press_items WHERE order_id=$1 AND NOT cancelled`, [orderId])).rows;
    const est = Object.fromEntries(Object.keys(COST_CATS).map(k => [k, 0])), actual = { ...est };
    for (const i of items) for (const k of Object.keys(COST_CATS)) est[k] += +(i.est_cost?.[k] || 0);
    const mat = (await c.query(`SELECT g.category, SUM(l.qty*l.unit_cost) amt FROM press_issue_lines l JOIN press_issues s ON s.id=l.issue_id JOIN gen_items g ON g.id=l.stock_item_id
      WHERE s.order_id=$1 AND NOT s.voided GROUP BY g.category`, [orderId])).rows;
    const ret = (await c.query(`SELECT g.category, SUM(r.qty*l.unit_cost) amt FROM press_returns r JOIN press_issue_lines l ON l.id=r.line_id JOIN press_issues s ON s.id=r.issue_id JOIN gen_items g ON g.id=l.stock_item_id
      WHERE s.order_id=$1 AND NOT s.voided AND r.condition='usable' GROUP BY g.category`, [orderId])).rows;
    for (const m of mat) actual[costCatOfStore(m.category)] += +m.amt;
    for (const m of ret) actual[costCatOfStore(m.category)] -= +m.amt;
    actual.outsourcing += +(await c.query(`SELECT COALESCE(SUM(cost),0) v FROM press_outsourcing WHERE order_id=$1`, [orderId])).rows[0].v;
    for (const m of (await c.query(`SELECT category, SUM(amount) amt FROM press_costs WHERE order_id=$1 AND NOT voided GROUP BY category`, [orderId])).rows) actual[COST_CATS[m.category] ? m.category : 'other'] += +m.amt;
    for (const k in est) { est[k] = r2(est[k]); actual[k] = r2(actual[k]); }
    const inv = (await c.query(`SELECT grand_total FROM press_invoices WHERE order_id=$1 AND status='final'`, [orderId])).rows[0];
    const selling = r2(inv ? +inv.grand_total : items.reduce((s, i) => s + +i.total, 0));
    const est_total = r2(Object.values(est).reduce((a, b) => a + b, 0)), actual_total = r2(Object.values(actual).reduce((a, b) => a + b, 0));
    return { selling, invoiced: !!inv, est, actual, est_total, actual_total, est_profit: r2(selling - est_total), actual_profit: r2(selling - actual_total) };
  }

  /* ---------------- settings ---------------- */
  app.get('/api/press/settings', wrap(async (req, res) => res.json({ ...(await pressSettings()), cost_cats: COST_CATS, store_cats: STORE_CATS, prod_status: PROD_STATUS, design_status: DESIGN_STATUS, void_cats: VOID_CATS })));
  app.put('/api/press/settings', can('settings', 'press.settings'), wrap(async (req, res) => {
    const b = req.body || {}, cur = await pressSettings();
    const v = { ...cur };
    if (Array.isArray(b.templates)) {
      v.templates = b.templates.slice(0, 80).map(t => ({ name: String(t.name || '').trim().slice(0, 80), steps: (Array.isArray(t.steps) ? t.steps : String(t.steps || '').split('\n')).map(s => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 40) })).filter(t => t.name && t.steps.length);
      if (!v.templates.length) bad('Keep at least one product template');
    }
    if (Array.isArray(b.paper_sizes)) v.paper_sizes = b.paper_sizes.slice(0, 80).map(p => ({ w: +p.w, l: +p.l, gsm: (Array.isArray(p.gsm) ? p.gsm : String(p.gsm || '').split(/[ ,]+/)).map(Number).filter(x => x > 0).slice(0, 30) })).filter(p => p.w > 0 && p.l > 0);
    for (const k of ['ream_sheets', 'make_ready_sheets', 'wastage_pct', 'backdate_days']) if (b[k] !== undefined) { const n = Number(b[k]); if (!(n >= 0) || n > 100000) bad(`Invalid value for ${k}`); v[k] = n; }
    if (v.ream_sheets < 1) bad('Sheets per ream must be at least 1');
    for (const k of ['order_types', 'customer_types']) if (Array.isArray(b[k])) v[k] = b[k].map(x => String(x).trim()).filter(Boolean).slice(0, 30);
    if (b.void_needs_approval !== undefined) v.void_needs_approval = !!b.void_needs_approval;
    await tx(async c => {
      await c.query(`INSERT INTO settings(key,value) VALUES('press',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(v)]);
      await audit(c, req.user, 'update', 'press_settings', null, { keys: Object.keys(b) });
    });
    h.clearRules && h.clearRules();
    res.json(v);
  }));

  /* ================================ ORDERS ================================ */
  function cleanItem(it, tpls) {
    const product = str(it.product, 120); if (!product) bad('Product name is required for every product');
    const qty = num(it.qty, `${product}: quantity`);
    const price = Number(it.unit_price || 0); if (!(price >= 0)) bad(`${product}: unit price must be 0 or more`);
    const tpl = tpls.find(t => t.name === it.template);
    const est = {}; for (const k of Object.keys(COST_CATS)) { const n = +(it.est_cost?.[k] || 0); if (n < 0) bad('Estimated cost cannot be negative'); if (n) est[k] = r2(n); }
    return {
      product, template: tpl ? tpl.name : null, description: str(it.description, 500), qty, unit: str(it.unit, 20) || 'pcs', size: str(it.size, 60), paper: str(it.paper, 80), gsm: str(it.gsm, 20),
      colour: str(it.colour, 40), sides: str(it.sides, 20), finishing: str(it.finishing, 300), unit_price: price, total: r2(qty * price),
      machine_id: +it.machine_id || null, plate_info: str(it.plate_info, 200), ins_printing: str(it.ins_printing, 500), ins_lamination: str(it.ins_lamination, 500), ins_cutting: str(it.ins_cutting, 500),
      ins_binding: str(it.ins_binding, 500), ins_diecut: str(it.ins_diecut, 500), ins_other: str(it.ins_other, 500), notes: str(it.notes, 500),
      design_required: it.design_required !== false, design_source: it.design_source === 'customer' ? 'customer' : 'inhouse',
      planned_start: dateOrNull(it.planned_start), est_completion: dateOrNull(it.est_completion), est_cost: est, _steps: tpl ? tpl.steps : null,
    };
  }
  const ITEM_COLS = ['product', 'template', 'description', 'qty', 'unit', 'size', 'paper', 'gsm', 'colour', 'sides', 'finishing', 'unit_price', 'total', 'machine_id', 'plate_info', 'ins_printing', 'ins_lamination',
    'ins_cutting', 'ins_binding', 'ins_diecut', 'ins_other', 'notes', 'design_required', 'design_source', 'planned_start', 'est_completion', 'est_cost'];
  async function insertItem(c, orderId, sl, it) {
    const steps = (it._steps || ['Work', 'Submit to office']).map(n => ({ name: n, done: false }));
    const vals = ITEM_COLS.map(k => (k === 'est_cost' ? JSON.stringify(it[k]) : it[k]));
    return (await c.query(`INSERT INTO press_items(order_id,sl,${ITEM_COLS.join(',')},steps,design_status) VALUES($1,$2,${ITEM_COLS.map((_, i) => '$' + (i + 3)).join(',')},$${ITEM_COLS.length + 3},$${ITEM_COLS.length + 4}) RETURNING *`,
      [orderId, sl, ...vals, JSON.stringify(steps), it.design_required ? 'Pending' : 'Approved'])).rows[0];
  }

  app.get('/api/press/orders', can('press.view', 'press.orders'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', status = '', q: s = '', customer = '', officer = '', overdue = '' } = req.query;
    const mine = canSeeAll(req.user) ? '' : String(req.user.id);
    res.json(await q(`SELECT o.*, c.name customer, c.phone,
        (SELECT string_agg(product || ' ×' || trim(to_char(qty,'FM999999990.##')), ', ' ORDER BY sl) FROM press_items WHERE order_id=o.id AND NOT cancelled) products,
        (SELECT COUNT(*) FROM press_items WHERE order_id=o.id AND NOT cancelled)::int n_items,
        (SELECT COALESCE(SUM(qty),0) FROM press_items WHERE order_id=o.id AND NOT cancelled) qty_total,
        (SELECT COALESCE(SUM(ci.qty),0) FROM press_challan_items ci JOIN press_challans ch ON ch.id=ci.challan_id WHERE ch.order_id=o.id AND ch.status='active') qty_delivered,
        (SELECT inv_no FROM press_invoices WHERE order_id=o.id AND status='final') inv_no,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id=o.id AND NOT voided) paid,
        (o.deadline < $8::date AND o.status NOT IN ('delivered','invoiced','cancelled')) overdue
      FROM press_orders o JOIN customers c ON c.id=o.customer_id
      WHERE o.date BETWEEN $1 AND $2 AND ($3='' OR o.status=$3) AND ($5='' OR o.customer_id=$5::int) AND ($6='' OR o.officer_id=$6::int OR o.created_by=$6::int)
        AND ($7='' OR o.officer_id=$7::int OR o.created_by=$7::int)
        AND ($4='' OR lower(o.order_no||' '||c.name||' '||COALESCE(c.phone,'')||' '||COALESCE((SELECT string_agg(product,' ') FROM press_items WHERE order_id=o.id),'')) LIKE '%'||lower($4)||'%')
        AND ($9='' OR (o.deadline < $8::date AND o.status NOT IN ('delivered','invoiced','cancelled')))
      ORDER BY o.date DESC, o.id DESC LIMIT 2000`, [from, to, status, s, String(customer), String(officer), mine, today(), String(overdue)]));
  }));
  async function orderDetail(c, u, id) {
    const o = await loadOrderFor(c, u, id);
    const cust = (await c.query(`SELECT id, name, company, contact_person, phone, address, email FROM customers WHERE id=$1`, [o.customer_id])).rows[0];
    const items = (await c.query(`SELECT i.*, m.name machine, (SELECT json_build_object('id',f.id,'filename',f.filename,'size',f.size,'uploaded_at',f.uploaded_at,'by',f.uploaded_by_name) FROM press_design_files f WHERE f.item_id=i.id ORDER BY f.id DESC LIMIT 1) design_file
      FROM press_items i LEFT JOIN machines m ON m.id=i.machine_id WHERE i.order_id=$1 ORDER BY i.sl, i.id`, [id])).rows;
    const del = await deliveredMap(c, id);
    for (const i of items) { i.delivered = del[i.id] || 0; i.remaining = r2(Math.max(0, +i.qty - i.delivered)); }
    const challans = await c.query(`SELECT ch.*, (SELECT json_agg(json_build_object('item_id',ci.item_id,'qty',ci.qty)) FROM press_challan_items ci WHERE ci.challan_id=ch.id) lines FROM press_challans ch WHERE order_id=$1 ORDER BY ch.date, ch.id`, [id]);
    const issues = await c.query(`SELECT s.*, (SELECT json_agg(json_build_object('id',l.id,'item',g.name,'code',g.code,'unit',g.unit,'qty',l.qty,'unit_cost',l.unit_cost,'stock_item_id',l.stock_item_id) ORDER BY l.id) FROM press_issue_lines l JOIN gen_items g ON g.id=l.stock_item_id WHERE l.issue_id=s.id) lines,
          pi.product FROM press_issues s LEFT JOIN press_items pi ON pi.id=s.item_id WHERE s.order_id=$1 ORDER BY s.date, s.id`, [id]);
    const returns = await c.query(`SELECT r.*, g.name item, g.unit, s.issue_no FROM press_returns r JOIN press_issues s ON s.id=r.issue_id JOIN gen_items g ON g.id=r.stock_item_id WHERE s.order_id=$1 ORDER BY r.date, r.id`, [id]);
    const outs = await c.query(`SELECT o.*, s.name supplier FROM press_outsourcing o LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.order_id=$1 ORDER BY o.id`, [id]);
    const costs = await c.query(`SELECT * FROM press_costs WHERE order_id=$1 ORDER BY date, id`, [id]);
    const mats = await c.query(`SELECT * FROM press_cust_materials WHERE order_id=$1 ORDER BY id`, [id]);
    const invoices = await c.query(`SELECT id, inv_no, date, grand_total, status, void_reason, voided_at, void_requested_name, void_req_reason FROM press_invoices WHERE order_id=$1 ORDER BY id`, [id]);
    const payments = await c.query(`SELECT p.*, COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0) allocated FROM payments p WHERE order_id=$1 ORDER BY date, id`, [id]);
    const activity = await c.query(`SELECT * FROM press_activity WHERE order_id=$1 ORDER BY id DESC LIMIT 200`, [id]);
    const refunds = await c.query(`SELECT * FROM refunds WHERE order_id=$1 ORDER BY id`, [id]);

    const paid = r2(payments.rows.filter(p => !p.voided).reduce((s, p) => s + +p.amount, 0));
    const fin = invoices.rows.find(i => i.status === 'final');
    return { ...o, customer: cust, items, challans: challans.rows, issues: issues.rows, returns: returns.rows, outsourcing: outs.rows, costs: costs.rows, materials: mats.rows,
      invoices: invoices.rows, invoice: fin || null, payments: payments.rows, refunds: refunds.rows, activity: activity.rows, paid,
      refunded: r2(refunds.rows.filter(r => !r.voided).reduce((s, r) => s + +r.amount, 0)),
      overdue: !!(o.deadline && o.deadline < today() && !['delivered', 'invoiced', 'cancelled'].includes(o.status)),
      costing: perm(u, 'press.costing') ? await costing(c, id) : null };
  }
  app.get('/api/press/orders/:id', can('press.view', 'press.orders'), wrap(async (req, res) => res.json(await tx(c => orderDetail(c, req.user, +req.params.id)))));

  app.post('/api/press/orders', can('press.orders'), wrap(async (req, res) => {
    const b = req.body, u = req.user, ps = await pressSettings();
    const date = entryDate(req, b.date);
    if (!Array.isArray(b.items) || !b.items.length) bad('Add at least one product');
    if (b.items.length > 60) bad('Too many products in one order');
    const items = b.items.map(it => cleanItem(it, ps.templates));
    const adv = Math.max(0, +(b.advance?.amount || 0));
    if (adv && !(await lists()).payment_methods.includes(b.advance.method)) bad('Select the advance payment method');
    res.json(await tx(async c => {
      await idem(c, req);
      const cust = (await c.query(`SELECT id, name FROM customers WHERE id=$1`, [b.customer_id])).rows[0]; if (!cust) bad('Select a customer');
      const off = +b.officer_id ? (await c.query(`SELECT id, full_name FROM users WHERE id=$1`, [b.officer_id])).rows[0] : null;
      const order_no = await nextNo(c, 'press_order');
      const o = (await c.query(`INSERT INTO press_orders(order_no,date,customer_id,order_type,officer_id,officer_name,deadline,instructions,remarks,created_by,created_by_name,created_role)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [order_no, date, cust.id, str(b.order_type, 40) || ps.order_types[0], off?.id || u.id, off?.full_name || u.full_name, dateOrNull(b.deadline), str(b.instructions, 2000), str(b.remarks, 1000), u.id, u.full_name, u.role_name])).rows[0];
      let sl = 0; for (const it of items) await insertItem(c, o.id, ++sl, it);
      if (adv > 0) await recordPayment(c, u, { date, time: str(b.advance.time, 8), customer_id: cust.id, amount: adv, method: b.advance.method, reference: str(b.advance.reference), division: 'press', remarks: 'Advance for ' + order_no, order_id: o.id, allocations: [] });
      await act(c, u, o.id, null, 'order', `Order created with ${items.length} product(s)${adv ? ' · advance ৳' + adv : ''}`);
      await refreshOrder(c, o.id);
      await audit(c, u, 'create', 'press_order', o.id, { order_no, items: items.length, advance: adv });
      return orderDetail(c, u, o.id);
    }));
  }));
  app.put('/api/press/orders/:id', can('press.orders'), wrap(async (req, res) => {
    const b = req.body, u = req.user, ps = await pressSettings();
    res.json(await tx(async c => {
      const o = await loadOrderFor(c, u, +req.params.id, true);
      if (['invoiced', 'cancelled'].includes(o.status)) bad(o.status === 'invoiced' ? 'This order is already invoiced — it cannot be edited (void the invoice first).' : 'Cancelled orders cannot be edited');
      const date = b.date && b.date !== o.date ? entryDate(req, b.date) : o.date;
      const cust = (await c.query(`SELECT id FROM customers WHERE id=$1`, [b.customer_id || o.customer_id])).rows[0]; if (!cust) bad('Select a customer');
      const hasDel = (await c.query(`SELECT 1 FROM press_challans WHERE order_id=$1 AND status='active' LIMIT 1`, [o.id])).rowCount;
      if (hasDel && cust.id !== o.customer_id) bad('Customer cannot change after a delivery challan was made');
      const off = +b.officer_id ? (await c.query(`SELECT id, full_name FROM users WHERE id=$1`, [b.officer_id])).rows[0] : null;
      await c.query(`UPDATE press_orders SET date=$1, customer_id=$2, order_type=$3, officer_id=$4, officer_name=$5, deadline=$6, instructions=$7, remarks=$8, updated_by_name=$9 WHERE id=$10`,
        [date, cust.id, str(b.order_type, 40) || o.order_type, off?.id || o.officer_id, off?.full_name || o.officer_name, dateOrNull(b.deadline), str(b.instructions, 2000), str(b.remarks, 1000), u.full_name, o.id]);
      if (Array.isArray(b.items)) {
        if (!b.items.length) bad('An order needs at least one product');
        const old = (await c.query(`SELECT * FROM press_items WHERE order_id=$1`, [o.id])).rows, del = await deliveredMap(c, o.id);
        const keep = new Set(b.items.filter(x => x.id).map(x => +x.id));
        for (const it of old) if (!keep.has(it.id) && !it.cancelled) {
          if (del[it.id] || (await c.query(`SELECT 1 FROM press_issues WHERE item_id=$1 AND NOT voided LIMIT 1`, [it.id])).rowCount) bad(`${it.product} has deliveries or material issues — it cannot be removed`);
          await c.query(`UPDATE press_items SET cancelled=true, prod_status='Cancelled' WHERE id=$1`, [it.id]);
          await act(c, u, o.id, it.id, 'item', `Removed product ${it.product}`);
        }
        let sl = 0;
        for (const raw of b.items) {
          const it = cleanItem(raw, ps.templates); sl++;
          if (raw.id) {
            const ex = old.find(x => x.id === +raw.id); if (!ex) bad('Product not found in this order');
            if ((del[ex.id] || 0) > it.qty + 1e-9) bad(`${it.product}: quantity cannot be less than already delivered (${del[ex.id]})`);
            const cols = ITEM_COLS.filter(k => k !== 'template' || it.template);
            await c.query(`UPDATE press_items SET sl=$1, ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$${cols.length + 2}`, [sl, ...cols.map(k => (k === 'est_cost' ? JSON.stringify(it[k]) : it[k])), ex.id]);
            if (it.template && it.template !== ex.template && !(ex.steps || []).some(s => s.done))
              await c.query(`UPDATE press_items SET steps=$1 WHERE id=$2`, [JSON.stringify(it._steps.map(n => ({ name: n, done: false }))), ex.id]);
            if (!it.design_required && ex.design_status !== 'Approved') await c.query(`UPDATE press_items SET design_status='Approved' WHERE id=$1`, [ex.id]);
          } else await insertItem(c, o.id, sl, it);
        }
      }
      await act(c, u, o.id, null, 'order', 'Order edited');
      await refreshOrder(c, o.id);
      await audit(c, u, 'update', 'press_order', o.id, { order_no: o.order_no });
      return orderDetail(c, u, o.id);
    }));
  }));
  app.post('/api/press/orders/:id/cancel', can('press.orders', 'invoice.cancel'), wrap(async (req, res) => {
    const reason = str(req.body.reason); if (!reason) bad('Reason is required');
    res.json(await tx(async c => {
      const o = await loadOrderFor(c, req.user, +req.params.id, true);
      if (o.status === 'cancelled') bad('Already cancelled');
      if (o.status === 'invoiced') bad('This order has a final invoice. Void the invoice first, then cancel the order.');
      await c.query(`UPDATE press_orders SET status='cancelled', cancelled_at=now(), cancelled_by_name=$1, cancel_reason=$2 WHERE id=$3`, [req.user.full_name, reason, o.id]);
      await c.query(`UPDATE press_items SET prod_status='Cancelled' WHERE order_id=$1 AND prod_status<>'Completed'`, [o.id]);
      await act(c, req.user, o.id, null, 'order', 'Order cancelled: ' + reason);
      await audit(c, req.user, 'cancel', 'press_order', o.id, { order_no: o.order_no, reason });
      return orderDetail(c, req.user, o.id);
    }));
  }));

  /* ---------------- design ---------------- */
  app.post('/api/press/items/:id/design', can('press.design', 'press.orders'), wrap(async (req, res) => {
    const { action, note, approved_by, designer } = req.body || {}, u = req.user;
    res.json(await tx(async c => {
      const it = (await c.query(`SELECT * FROM press_items WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!it) bad('Product not found', 404);
      const o = await loadOrderFor(c, u, it.order_id);
      if (o.status === 'cancelled') bad('Order is cancelled');
      if (!perm(u, 'press.design') && action !== 'approve') bad('Only the designer can change the design status', 403);
      const map = { start: ['In Progress', ['Pending', 'Revision Required', 'In Progress']], send: ['Approval Pending', ['In Progress', 'Pending', 'Revision Required']], approve: ['Approved', ['Approval Pending', 'Pending', 'In Progress', 'Revision Required']], revision: ['Revision Required', ['Approval Pending', 'Approved']], reset: ['Pending', DESIGN_STATUS] };
      const m = map[action]; if (!m) bad('Unknown design action');
      if (!m[1].includes(it.design_status)) bad(`Design is "${it.design_status}" — cannot ${action} now`);
      if (action === 'revision' && !str(note)) bad('Write what the customer wants changed');
      if (action === 'revision' && (it.steps || []).some(s => s.done && PRINT_STEP.test(s.name))) bad('Printing already started for this product — revision is not possible now');
      const revs = it.design_revisions || [];
      if (action === 'revision') revs.push({ at: new Date().toISOString(), by: u.full_name, note: str(note, 500) });
      await c.query(`UPDATE press_items SET design_status=$1, design_revisions=$2, designer=COALESCE($3, designer),
          design_approved_at=CASE WHEN $1='Approved' THEN now() ELSE NULL END, design_approved_by=CASE WHEN $1='Approved' THEN $4 ELSE NULL END WHERE id=$5`,
        [m[0], JSON.stringify(revs), str(designer, 80) || (action === 'start' ? u.full_name : null), str(approved_by, 80) || u.full_name, it.id]);
      await act(c, u, it.order_id, it.id, 'design', `${it.product}: design → ${m[0]}${note ? ' · ' + str(note, 200) : ''}${action === 'approve' ? ' (approved by ' + (str(approved_by, 80) || u.full_name) + ')' : ''}`);
      await audit(c, u, 'design_' + action, 'press_item', it.id, { status: m[0], note });
      return { ok: true, status: m[0] };
    }));
  }));
  app.post('/api/press/items/:id/design-file', h.express.raw({ type: () => true, limit: '60mb' }), can('press.design'), wrap(async (req, res) => {
    const name = String(req.get('X-File-Name') || 'design').replace(/[^\w.\- ()]+/g, '_').slice(0, 140);
    if (!req.body || !req.body.length) bad('Choose a file');
    res.json(await tx(async c => {
      const it = (await c.query(`SELECT * FROM press_items WHERE id=$1`, [req.params.id])).rows[0]; if (!it) bad('Product not found', 404);
      if (it.design_status !== 'Approved') bad('Only the final APPROVED print file is stored. Approve the design first.');
      await c.query(`DELETE FROM press_design_files WHERE item_id=$1`, [it.id]);   // only the final approved file is kept
      await c.query(`INSERT INTO press_design_files(item_id,filename,mime,size,data,uploaded_by_name) VALUES($1,$2,$3,$4,$5,$6)`, [it.id, name, req.get('Content-Type') || 'application/octet-stream', req.body.length, req.body, req.user.full_name]);
      await act(c, req.user, it.order_id, it.id, 'design', `${it.product}: final print file saved (${name})`);
      return { ok: true };
    }));
  }));
  app.get('/api/press/items/:id/design-file', can('press.view', 'press.design', 'press.orders'), wrap(async (req, res) => {
    const f = await q1(`SELECT * FROM press_design_files WHERE item_id=$1 ORDER BY id DESC LIMIT 1`, [req.params.id]); if (!f) bad('No file', 404);
    res.set('Content-Type', f.mime || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.send(f.data);
  }));
  app.get('/api/press/design', can('press.design', 'press.view'), wrap(async (req, res) => {
    const { status = '' } = req.query;
    res.json(await q(`SELECT i.id, i.order_id, i.product, i.qty, i.size, i.design_status, i.design_source, i.designer, i.design_approved_at, i.design_approved_by, i.design_revisions, o.order_no, o.deadline, o.date, c.name customer,
        EXISTS(SELECT 1 FROM press_design_files f WHERE f.item_id=i.id) has_file
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id
      WHERE NOT i.cancelled AND o.status<>'cancelled' AND i.design_required AND ($1='' OR i.design_status=$1) ORDER BY (i.design_status='Approved'), o.deadline NULLS LAST, o.id DESC LIMIT 1000`, [status]));
  }));

  /* ---------------- production ---------------- */
  const needApproved = it => { if (it.design_required && it.design_status !== 'Approved') bad(`${it.product}: design is not approved by the customer yet — printing cannot start.`, 409); };
  app.put('/api/press/items/:id/production', can('press.production'), wrap(async (req, res) => {
    const b = req.body, u = req.user;
    res.json(await tx(async c => {
      const it = (await c.query(`SELECT * FROM press_items WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!it || it.cancelled) bad('Product not found', 404);
      const o = (await c.query(`SELECT status FROM press_orders WHERE id=$1`, [it.order_id])).rows[0]; if (o.status === 'cancelled') bad('Order is cancelled');
      const st = b.prod_status || it.prod_status; if (!PROD_STATUS.includes(st)) bad('Invalid status');
      if (st === 'In Progress' && it.prod_status !== 'In Progress') needApproved(it);
      const t = today();
      const actual_start = dateOrNull(b.actual_start) || it.actual_start || (st === 'In Progress' || st === 'Completed' ? t : null);
      const actual_completion = st === 'Completed' ? (dateOrNull(b.actual_completion) || it.actual_completion || t) : dateOrNull(b.actual_completion);
      for (const d of [actual_start, actual_completion, b.planned_start, b.est_completion]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad('Invalid date');
      if (actual_start && actual_start > t) bad('Actual start cannot be in the future');
      if (actual_completion && actual_completion > t) bad('Actual completion cannot be in the future');
      await c.query(`UPDATE press_items SET prod_status=$1, planned_start=$2, est_completion=$3, actual_start=$4, actual_completion=$5, assigned_staff=$6, machine_id=$7, prod_notes=$8 WHERE id=$9`,
        [st, dateOrNull(b.planned_start) ?? it.planned_start, dateOrNull(b.est_completion) ?? it.est_completion, actual_start, actual_completion, b.assigned_staff !== undefined ? str(b.assigned_staff, 200) : it.assigned_staff,
          b.machine_id !== undefined ? +b.machine_id || null : it.machine_id, b.prod_notes !== undefined ? str(b.prod_notes, 1000) : it.prod_notes, it.id]);
      if (st !== it.prod_status) await act(c, u, it.order_id, it.id, 'production', `${it.product}: ${it.prod_status} → ${st}`);
      await refreshOrder(c, it.order_id);
      return { ok: true };
    }));
  }));
  app.post('/api/press/items/:id/step', can('press.production'), wrap(async (req, res) => {
    const { index, done, note, date } = req.body || {}, u = req.user;
    res.json(await tx(async c => {
      const it = (await c.query(`SELECT * FROM press_items WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!it || it.cancelled) bad('Product not found', 404);
      const steps = it.steps || []; const s = steps[+index]; if (!s) bad('Step not found');
      if (done && PRINT_STEP.test(s.name)) needApproved(it);
      const d = done ? entryDate(req, date) : null;
      steps[+index] = { ...s, done: !!done, date: d, by: done ? u.full_name : null, note: str(note, 300) || (done ? s.note : null) };
      let st = it.prod_status, as = it.actual_start, ac = it.actual_completion;
      if (done && ['Pending', 'Assigned'].includes(st)) { st = 'In Progress'; as = as || d; }
      if (steps.length && steps.every(x => x.done)) { st = 'Completed'; ac = ac || d; }
      else if (st === 'Completed') { st = 'In Progress'; ac = null; }
      await c.query(`UPDATE press_items SET steps=$1, prod_status=$2, actual_start=$3, actual_completion=$4 WHERE id=$5`, [JSON.stringify(steps), st, as, ac, it.id]);
      await act(c, u, it.order_id, it.id, 'production', `${it.product}: ${s.name} ${done ? 'done' : 're-opened'}${d ? ' (' + d + ')' : ''}`);
      await refreshOrder(c, it.order_id);
      return { ok: true, steps, prod_status: st };
    }));
  }));
  app.post('/api/press/items/:id/finish', can('press.production'), wrap(async (req, res) => {
    const b = req.body, u = req.user;
    res.json(await tx(async c => {
      const it = (await c.query(`SELECT * FROM press_items WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!it || it.cancelled) bad('Product not found', 404);
      const good = Number(b.good_qty), waste = Number(b.waste_qty || 0);
      if (!(good >= 0) || !(waste >= 0)) bad('Enter good and waste quantity');
      const d = entryDate(req, b.date);
      const steps = (it.steps || []).map(s => (s.done ? s : { ...s, done: true, date: d, by: u.full_name }));
      await c.query(`UPDATE press_items SET good_qty=$1, waste_qty=$2, prod_status='Completed', actual_completion=COALESCE(actual_completion,$3), actual_start=COALESCE(actual_start,$3), steps=$4 WHERE id=$5`, [good, waste, d, JSON.stringify(steps), it.id]);
      await act(c, u, it.order_id, it.id, 'production', `${it.product}: submitted to office · good ${good}, waste ${waste}`);
      await refreshOrder(c, it.order_id);
      return { ok: true };
    }));
  }));
  app.get('/api/press/production', can('press.view', 'press.production'), wrap(async (req, res) => {
    const { status = '', from = '', to = '' } = req.query;
    res.json(await q(`SELECT i.id, i.order_id, i.product, i.template, i.qty, i.size, i.prod_status, i.design_status, i.design_required, i.planned_start, i.est_completion, i.actual_start, i.actual_completion,
        i.assigned_staff, i.steps, i.good_qty, m.name machine, o.order_no, o.deadline, c.name customer,
        ((COALESCE(i.est_completion, o.deadline)) < $2::date AND i.prod_status NOT IN ('Completed','Cancelled')) overdue
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id LEFT JOIN machines m ON m.id=i.machine_id
      WHERE NOT i.cancelled AND o.status<>'cancelled' AND ($1='' OR i.prod_status=$1)
        AND ($3='' OR COALESCE(i.est_completion, o.deadline, i.planned_start) >= $3::date OR i.prod_status NOT IN ('Completed','Cancelled'))
        AND ($4='' OR COALESCE(i.planned_start, o.date) <= $4::date)
      ORDER BY (i.prod_status IN ('Completed','Cancelled')), COALESCE(i.est_completion, o.deadline) NULLS LAST, o.id LIMIT 2000`, [status, today(), from, to]));
  }));
  app.get('/api/press/calendar', can('press.view', 'press.production'), wrap(async (req, res) => {
    const { from, to } = req.query; if (!dateOrNull(from) || !dateOrNull(to)) bad('Select a date range');
    res.json(await q(`SELECT i.id, i.order_id, i.product, i.qty, i.prod_status, i.design_status, o.order_no, c.name customer, o.deadline,
        COALESCE(i.planned_start, o.date) start, COALESCE(i.est_completion, o.deadline, i.planned_start, o.date) finish, i.assigned_staff, m.name machine,
        ((COALESCE(i.est_completion, o.deadline)) < $3::date AND i.prod_status NOT IN ('Completed','Cancelled')) overdue
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id LEFT JOIN machines m ON m.id=i.machine_id
      WHERE NOT i.cancelled AND o.status<>'cancelled' AND COALESCE(i.planned_start, o.date) <= $2::date AND COALESCE(i.est_completion, o.deadline, i.planned_start, o.date) >= $1::date
      ORDER BY 7, o.id`, [from, to, today()]));
  }));

  /* ================================ MACHINES / SUPPLIERS ================================ */
  app.get('/api/press/machines', can('press.view', 'press.machines', 'press.production'), wrap(async (req, res) => res.json(await q(`SELECT m.*,
      (SELECT json_agg(json_build_object('id',i.id,'order_id',i.order_id,'order_no',o.order_no,'product',i.product,'status',i.prod_status,'due',COALESCE(i.est_completion,o.deadline)) ORDER BY COALESCE(i.est_completion,o.deadline))
        FROM press_items i JOIN press_orders o ON o.id=i.order_id WHERE i.machine_id=m.id AND NOT i.cancelled AND i.prod_status NOT IN ('Completed','Cancelled') AND o.status<>'cancelled') jobs
    FROM machines m ORDER BY m.active DESC, m.name`))));
  const machineFields = b => { const name = str(b.name, 100); if (!name) bad('Machine name is required');
    return [name, str(b.type, 80), str(b.specs, 1000), str(b.status, 40) || 'Active', str(b.maintenance, 1000), dateOrNull(b.last_service), dateOrNull(b.next_service), str(b.remarks, 500), b.active !== false]; };
  app.post('/api/press/machines', can('press.machines'), wrap(async (req, res) => res.json(await tx(async c => {
    const r = (await c.query(`INSERT INTO machines(name,type,specs,status,maintenance,last_service,next_service,remarks,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, machineFields(req.body))).rows[0];
    await audit(c, req.user, 'create', 'machine', r.id, { name: r.name }); return r;
  }))));
  app.put('/api/press/machines/:id', can('press.machines'), wrap(async (req, res) => res.json(await tx(async c => {
    const r = (await c.query(`UPDATE machines SET name=$1,type=$2,specs=$3,status=$4,maintenance=$5,last_service=$6,next_service=$7,remarks=$8,active=$9 WHERE id=$10 RETURNING *`, [...machineFields(req.body), req.params.id])).rows[0];
    if (!r) bad('Machine not found', 404); await audit(c, req.user, 'update', 'machine', r.id, { name: r.name }); return r;
  }))));
  app.delete('/api/press/machines/:id', can('press.machines'), wrap(async (req, res) => res.json(await tx(async c => {
    const m = (await c.query(`SELECT * FROM machines WHERE id=$1`, [req.params.id])).rows[0]; if (!m) bad('Machine not found', 404);
    if ((await c.query(`SELECT 1 FROM press_items WHERE machine_id=$1 LIMIT 1`, [m.id])).rowCount) { await c.query(`UPDATE machines SET active=false WHERE id=$1`, [m.id]); return { ok: true, archived: true }; }
    await c.query(`DELETE FROM machines WHERE id=$1`, [m.id]); await audit(c, req.user, 'delete', 'machine', m.id, { name: m.name }); return { ok: true, archived: false };
  }))));

  app.get('/api/press/suppliers', can('press.view', 'press.suppliers', 'press.store'), wrap(async (req, res) => res.json(await q(`SELECT s.*,
      (SELECT COALESCE(SUM(cost),0) FROM press_outsourcing WHERE supplier_id=s.id) out_cost, (SELECT COALESCE(SUM(paid),0) FROM press_outsourcing WHERE supplier_id=s.id) out_paid,
      (SELECT COALESCE(SUM(total),0) FROM store_purchases WHERE supplier_id=s.id AND NOT voided) purchases
    FROM suppliers s ORDER BY s.active DESC, s.name`))));
  const supFields = b => { const name = str(b.name, 120); if (!name) bad('Supplier name is required'); return [name, str(b.contact_person, 80), str(b.phone, 40), str(b.address, 300), str(b.supplies, 300), str(b.remarks, 500), b.active !== false]; };
  app.post('/api/press/suppliers', can('press.suppliers', 'press.store'), wrap(async (req, res) => res.json(await tx(async c => {
    const r = (await c.query(`INSERT INTO suppliers(name,contact_person,phone,address,supplies,remarks,active,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [...supFields(req.body), req.user.full_name])).rows[0];
    await audit(c, req.user, 'create', 'supplier', r.id, { name: r.name }); return r;
  }))));
  app.put('/api/press/suppliers/:id', can('press.suppliers', 'press.store'), wrap(async (req, res) => res.json(await tx(async c => {
    const r = (await c.query(`UPDATE suppliers SET name=$1,contact_person=$2,phone=$3,address=$4,supplies=$5,remarks=$6,active=$7 WHERE id=$8 RETURNING *`, [...supFields(req.body), req.params.id])).rows[0];
    if (!r) bad('Supplier not found', 404); await audit(c, req.user, 'update', 'supplier', r.id, { name: r.name }); return r;
  }))));
  app.delete('/api/press/suppliers/:id', can('press.suppliers'), wrap(async (req, res) => res.json(await tx(async c => {
    const s = (await c.query(`SELECT * FROM suppliers WHERE id=$1`, [req.params.id])).rows[0]; if (!s) bad('Supplier not found', 404);
    if ((await c.query(`SELECT 1 FROM press_outsourcing WHERE supplier_id=$1 UNION ALL SELECT 1 FROM store_purchases WHERE supplier_id=$1 LIMIT 1`, [s.id])).rowCount) { await c.query(`UPDATE suppliers SET active=false WHERE id=$1`, [s.id]); return { ok: true, archived: true }; }
    await c.query(`DELETE FROM suppliers WHERE id=$1`, [s.id]); await audit(c, req.user, 'delete', 'supplier', s.id, { name: s.name }); return { ok: true, archived: false };
  }))));

  /* outsourcing */
  app.get('/api/press/outsourcing', can('press.view', 'press.suppliers'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', supplier = '', status = '' } = req.query;
    res.json(await q(`SELECT x.*, s.name supplier, o.order_no, c.name customer, i.product FROM press_outsourcing x LEFT JOIN suppliers s ON s.id=x.supplier_id LEFT JOIN press_orders o ON o.id=x.order_id
      LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN press_items i ON i.id=x.item_id
      WHERE COALESCE(x.sent_date, x.created_at::date) BETWEEN $1 AND $2 AND ($3='' OR x.supplier_id=$3::int)
        AND ($4='' OR ($4='unpaid' AND x.paid < x.cost) OR ($4='paid' AND x.paid >= x.cost)) ORDER BY x.id DESC LIMIT 1500`, [from, to, String(supplier), status]));
  }));
  app.post('/api/press/outsourcing', can('press.suppliers'), wrap(async (req, res) => {
    const b = req.body; const work = str(b.work, 300); if (!work) bad('Describe the outsourced work');
    const cost = Number(b.cost || 0); if (!(cost >= 0)) bad('Cost must be 0 or more');
    res.json(await tx(async c => {
      await idem(c, req);
      const s = (await c.query(`SELECT id FROM suppliers WHERE id=$1`, [b.supplier_id])).rows[0]; if (!s) bad('Select a supplier');
      let order = null; if (b.order_id) order = await loadOrderFor(c, req.user, +b.order_id);
      const r = (await c.query(`INSERT INTO press_outsourcing(order_id,item_id,supplier_id,work,qty,cost,sent_date,delivery_date,remarks,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [order?.id || null, +b.item_id || null, s.id, work, +b.qty || null, r2(cost), entryDate(req, b.sent_date), dateOrNull(b.delivery_date), str(b.remarks, 500), req.user.full_name])).rows[0];
      if (order) await act(c, req.user, order.id, r.item_id, 'outsourcing', `Outsourced: ${work} · ৳${r2(cost)}`);
      await audit(c, req.user, 'create', 'outsourcing', r.id, { work, cost }); return r;
    }));
  }));
  app.put('/api/press/outsourcing/:id', can('press.suppliers'), wrap(async (req, res) => {
    const b = req.body;
    res.json(await tx(async c => {
      const x = (await c.query(`SELECT * FROM press_outsourcing WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!x) bad('Not found', 404);
      const cost = b.cost !== undefined ? Number(b.cost) : +x.cost; if (!(cost >= 0)) bad('Cost must be 0 or more');
      if (cost + 1e-9 < +x.paid) bad(`Cost cannot be less than already paid (${x.paid})`);
      const r = (await c.query(`UPDATE press_outsourcing SET work=$1, qty=$2, cost=$3, delivery_date=$4, received=$5, remarks=$6 WHERE id=$7 RETURNING *`,
        [str(b.work, 300) || x.work, b.qty !== undefined ? +b.qty || null : x.qty, r2(cost), b.delivery_date !== undefined ? dateOrNull(b.delivery_date) : x.delivery_date, b.received !== undefined ? !!b.received : x.received, b.remarks !== undefined ? str(b.remarks, 500) : x.remarks, x.id])).rows[0];
      await audit(c, req.user, 'update', 'outsourcing', x.id, { cost }); return r;
    }));
  }));
  app.post('/api/press/outsourcing/:id/pay', can('press.suppliers'), wrap(async (req, res) => {
    const amount = num(req.body.amount, 'Amount');
    if (!(await lists()).payment_methods.includes(req.body.method)) bad('Select a payment method');
    res.json(await tx(async c => {
      await idem(c, req);
      const x = (await c.query(`SELECT x.*, s.name supplier FROM press_outsourcing x JOIN suppliers s ON s.id=x.supplier_id WHERE x.id=$1 FOR UPDATE OF x`, [req.params.id])).rows[0]; if (!x) bad('Not found', 404);
      if (+x.paid + amount > +x.cost + 0.004) bad(`Only ৳${r2(x.cost - x.paid)} is left to pay`);
      const date = entryDate(req, req.body.date);
      const e = (await c.query(`INSERT INTO expenses(date,category,amount,method,description,division,created_by,created_by_name,created_role) VALUES($1,'Outsourcing Cost',$2,$3,$4,'press',$5,$6,$7) RETURNING id`,
        [date, r2(amount), req.body.method, `Paid ${x.supplier}: ${x.work}`, req.user.id, req.user.full_name, req.user.role_name])).rows[0];
      await c.query(`UPDATE press_outsourcing SET paid=paid+$1 WHERE id=$2`, [r2(amount), x.id]);
      await audit(c, req.user, 'pay', 'outsourcing', x.id, { amount, expense_id: e.id });
      return { ok: true };
    }));
  }));

  /* job costing: manual actual costs */
  app.post('/api/press/orders/:id/costs', can('press.costing'), wrap(async (req, res) => {
    const b = req.body; if (!COST_CATS[b.category]) bad('Select a cost category');
    const amount = num(b.amount, 'Amount');
    res.json(await tx(async c => {
      await idem(c, req);
      const o = await loadOrderFor(c, req.user, +req.params.id);
      const r = (await c.query(`INSERT INTO press_costs(order_id,item_id,date,category,amount,note,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [o.id, +b.item_id || null, entryDate(req, b.date), b.category, r2(amount), str(b.note, 300), req.user.full_name])).rows[0];
      await act(c, req.user, o.id, r.item_id, 'cost', `${COST_CATS[b.category]} cost ৳${r2(amount)}${r.note ? ' · ' + r.note : ''}`);
      return r;
    }));
  }));
  app.post('/api/press/costs/:id/void', can('press.costing'), wrap(async (req, res) => res.json(await tx(async c => {
    const r = (await c.query(`UPDATE press_costs SET voided=true WHERE id=$1 AND NOT voided RETURNING *`, [req.params.id])).rows[0]; if (!r) bad('Not found');
    await act(c, req.user, r.order_id, r.item_id, 'cost', `Cost entry removed (${COST_CATS[r.category]} ৳${r.amount})`); return { ok: true };
  }))));

  /* customer supplied material — never part of our stock */
  app.get('/api/press/materials', can('press.view', 'press.orders', 'press.store'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', status = '' } = req.query;
    res.json(await q(`SELECT m.*, c.name customer, o.order_no FROM press_cust_materials m LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN press_orders o ON o.id=m.order_id
      WHERE m.received_date BETWEEN $1 AND $2 AND ($3='' OR m.status=$3) ORDER BY m.received_date DESC, m.id DESC LIMIT 1500`, [from, to, status]));
  }));
  app.post('/api/press/materials', can('press.orders', 'press.store'), wrap(async (req, res) => {
    const b = req.body; const desc = str(b.description, 300); if (!desc) bad('Describe the material');
    const qty = num(b.received_qty, 'Received quantity');
    res.json(await tx(async c => {
      await idem(c, req);
      let order = null; if (b.order_id) order = await loadOrderFor(c, req.user, +b.order_id);
      const cust = order ? order.customer_id : +b.customer_id; if (!cust) bad('Select the customer or order');
      const r = (await c.query(`INSERT INTO press_cust_materials(order_id,customer_id,received_date,description,received_qty,unit,received_by,remarks,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [order?.id || null, cust, entryDate(req, b.received_date), desc, qty, str(b.unit, 20) || 'pcs', str(b.received_by, 80) || req.user.full_name, str(b.remarks, 500), req.user.full_name])).rows[0];
      if (order) await act(c, req.user, order.id, null, 'material', `Customer material received: ${desc} × ${qty}`);
      await audit(c, req.user, 'create', 'cust_material', r.id, { desc, qty }); return r;
    }));
  }));
  app.put('/api/press/materials/:id/return', can('press.orders', 'press.store'), wrap(async (req, res) => {
    const b = req.body;
    res.json(await tx(async c => {
      const m = (await c.query(`SELECT * FROM press_cust_materials WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!m) bad('Not found', 404);
      const [proc, good, ret, waste] = ['processed_qty', 'good_qty', 'returned_qty', 'waste_qty'].map(k => { const n = Number(b[k] || 0); if (!(n >= 0)) bad(k.replace('_', ' ') + ' must be 0 or more'); return n; });
      const diff = r2(+m.received_qty - ret - waste);
      if (Math.abs(diff) > 0.004 && !str(b.diff_reason)) bad(`Received ${+m.received_qty}, but returned ${ret} + waste ${waste} = ${r2(ret + waste)}. Write the reason for the difference of ${diff}.`);
      const r = (await c.query(`UPDATE press_cust_materials SET processed_qty=$1, good_qty=$2, returned_qty=$3, waste_qty=$4, return_date=$5, receiver_name=$6, receiver_signed=$7, diff_reason=$8, status='returned' WHERE id=$9 RETURNING *`,
        [proc, good, ret, waste, entryDate(req, b.return_date), str(b.receiver_name, 80), !!b.receiver_signed, str(b.diff_reason, 500), m.id])).rows[0];
      if (m.order_id) await act(c, req.user, m.order_id, null, 'material', `Customer material returned: good ${good}, returned ${ret}, waste ${waste}`);
      await audit(c, req.user, 'return', 'cust_material', m.id, { ret, waste, diff }); return r;
    }));
  }));

  /* ================================ STORE (main inventory) ================================ */
  async function itemBal(c, id) { return +(await c.query(`SELECT COALESCE(SUM(qty),0) b FROM gen_moves WHERE item_id=$1`, [id])).rows[0].b; }
  async function lockItem(c, id) { await c.query(`SELECT pg_advisory_xact_lock(hashtext('gen_item'), $1)`, [id]); }
  async function move(c, u, m) {
    return (await c.query(`INSERT INTO gen_moves(date,item_id,type,qty,unit_cost,purpose,party,ref_type,ref_id,ref_no,remarks,before_qty,after_qty,is_reversal,reversal_of,created_by,created_by_name,created_role)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [m.date, m.item_id, m.type, qf(m.qty), m.unit_cost ?? null, m.purpose || null, m.party || null, m.ref_type || null, m.ref_id || null, m.ref_no || null, m.remarks || null, m.before ?? null, m.after ?? null,
        !!m.is_reversal, m.reversal_of || null, u.id, u.full_name, u.role_name])).rows[0];
  }
  /** convert a quantity typed in Ream / Sheet into the item's own stock unit */
  function toItemQty(it, qty, unit, ream) {
    const iu = String(it.unit || '').toLowerCase(), uu = String(unit || it.unit || '').toLowerCase();
    if (!unit || uu === iu) return qty;
    if (iu === 'ream' && uu === 'sheet') return qty / ream;
    if (iu === 'sheet' && uu === 'ream') return qty * ream;
    bad(`${it.name} is stocked in ${it.unit}; it cannot be entered in ${unit}`);
  }
  app.get('/api/store/items', can('press.view', 'press.store', 'internal', 'press.orders'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', category = '' } = req.query;
    res.json(await q(`SELECT i.*, COALESCE(SUM(m.qty),0) balance, COALESCE(SUM(m.qty) FILTER (WHERE m.date<$1),0) opening_bal,
        COALESCE(SUM(m.qty) FILTER (WHERE m.qty>0 AND m.date BETWEEN $1 AND $2),0) qty_in, COALESCE(-SUM(m.qty) FILTER (WHERE m.qty<0 AND m.date BETWEEN $1 AND $2),0) qty_out
      FROM gen_items i LEFT JOIN gen_moves m ON m.item_id=i.id WHERE NOT i.deleted AND ($3='' OR i.category=$3) GROUP BY i.id ORDER BY i.category, i.sort, i.name`, [from, to, category]));
  }));
  function storeFields(b) {
    const name = str(b.name, 120) || [b.category === 'Paper' || b.category === 'Board' ? '' : '', b.paper_type, b.gsm ? b.gsm + ' GSM' : '', b.size, b.color].filter(Boolean).join(' ').trim();
    if (!name) bad('Item name is required');
    const cat = str(b.category, 60); if (!cat) bad('Select a category');
    return { name, category: cat, code: str(b.code, 40), unit: str(b.unit, 30) || 'Pcs', size: str(b.size, 60), gsm: str(b.gsm, 20), paper_type: str(b.paper_type, 60), color: str(b.color, 40),
      rack: str(b.rack, 60), width_in: b.width_in === '' || b.width_in == null ? null : Number(b.width_in), roll_length: b.roll_length === '' || b.roll_length == null ? null : Number(b.roll_length),
      low_stock: Math.max(0, +b.low_stock || 0), remarks: str(b.remarks, 300), sort: parseInt(b.sort, 10) || 0, active: b.active !== false };
  }
  const SF = ['name', 'category', 'code', 'unit', 'size', 'gsm', 'paper_type', 'color', 'rack', 'width_in', 'roll_length', 'low_stock', 'remarks', 'sort', 'active'];
  app.post('/api/store/items', can('press.store', 'internal'), wrap(async (req, res) => {
    const f = storeFields(req.body), open = Math.max(0, +req.body.opening || 0), rate = Math.max(0, +req.body.rate || 0);
    res.json(await tx(async c => {
      if ((await c.query(`SELECT 1 FROM gen_items WHERE lower(name)=lower($1) AND NOT deleted`, [f.name])).rowCount) bad('An item with this name already exists');
      if (f.code && (await c.query(`SELECT 1 FROM gen_items WHERE lower(code)=lower($1) AND NOT deleted`, [f.code])).rowCount) bad('This item code is already used');
      const r = (await c.query(`INSERT INTO gen_items(kind,${SF.join(',')},avg_cost,created_by,created_by_name) VALUES('store',${SF.map((_, i) => '$' + (i + 1)).join(',')},$${SF.length + 1},$${SF.length + 2},$${SF.length + 3}) RETURNING *`,
        [...SF.map(k => f[k]), rate, req.user.id, req.user.full_name])).rows[0];
      if (!r.code) await c.query(`UPDATE gen_items SET code='ITM-'||lpad(id::text,4,'0') WHERE id=$1`, [r.id]);
      if (open > 0) await move(c, req.user, { date: today(), item_id: r.id, type: 'opening', qty: open, unit_cost: rate, remarks: 'Opening stock', before: 0, after: open });
      await audit(c, req.user, 'create', 'store_item', r.id, { name: r.name, opening: open });
      return r;
    }));
  }));
  app.put('/api/store/items/:id', can('press.store', 'internal'), wrap(async (req, res) => {
    const f = storeFields(req.body);
    res.json(await tx(async c => {
      const old = (await c.query(`SELECT * FROM gen_items WHERE id=$1 AND NOT deleted FOR UPDATE`, [req.params.id])).rows[0]; if (!old) bad('Item not found', 404);
      if ((await c.query(`SELECT 1 FROM gen_items WHERE lower(name)=lower($1) AND NOT deleted AND id<>$2`, [f.name, old.id])).rowCount) bad('Another item has this name');
      if (f.code && (await c.query(`SELECT 1 FROM gen_items WHERE lower(code)=lower($1) AND NOT deleted AND id<>$2`, [f.code, old.id])).rowCount) bad('This item code is already used');
      if (old.unit !== f.unit && (await c.query(`SELECT 1 FROM gen_moves WHERE item_id=$1 LIMIT 1`, [old.id])).rowCount) bad(`Unit cannot change after stock entries exist (unit: ${old.unit})`);
      if (!f.code) f.code = old.code;
      const r = (await c.query(`UPDATE gen_items SET ${SF.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_by_name=$${SF.length + 1}, updated_at=now() WHERE id=$${SF.length + 2} RETURNING *`, [...SF.map(k => f[k]), req.user.full_name, old.id])).rows[0];
      await audit(c, req.user, 'update', 'store_item', r.id, { before: old.name, after: r.name }); return r;
    }));
  }));
  app.delete('/api/store/items/:id', can('press.store', 'internal'), wrap(async (req, res) => res.json(await tx(async c => {
    const it = (await c.query(`SELECT * FROM gen_items WHERE id=$1 AND NOT deleted FOR UPDATE`, [req.params.id])).rows[0]; if (!it) bad('Item not found', 404);
    const used = (await c.query(`SELECT 1 FROM gen_moves WHERE item_id=$1 UNION ALL SELECT 1 FROM press_issue_lines WHERE stock_item_id=$1 UNION ALL SELECT 1 FROM gen_invoice_items WHERE film_item_id=$1 OR paper_item_id=$1 LIMIT 1`, [it.id])).rowCount;
    if (used) {
      const bal = await itemBal(c, it.id); if (Math.abs(bal) > 1e-9) bad(`${it.name} still has ${qf(bal)} ${it.unit} in stock. Adjust it to zero first, then delete.`);
      await c.query(`UPDATE gen_items SET deleted=true, active=false WHERE id=$1`, [it.id]);
    } else await c.query(`DELETE FROM gen_items WHERE id=$1`, [it.id]);
    await audit(c, req.user, 'delete', 'store_item', it.id, { name: it.name, kept_history: !!used }); return { ok: true, archived: !!used };
  }))));
  app.get('/api/store/moves', can('press.view', 'press.store', 'internal'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', item = '', type = '' } = req.query;
    res.json(await q(`SELECT m.*, i.name item, i.code, i.unit, i.category FROM gen_moves m JOIN gen_items i ON i.id=m.item_id
      WHERE m.date BETWEEN $1 AND $2 AND ($3='' OR m.item_id=$3::int) AND ($4='' OR m.type=$4) ORDER BY m.date DESC, m.id DESC LIMIT 3000`, [from, to, String(item), type]));
  }));
  /* own use / wastage / adjustment (set counted quantity) */
  app.post('/api/store/moves', can('press.store', 'internal'), wrap(async (req, res) => {
    const b = req.body, u = req.user, type = b.type, ps = await pressSettings();
    if (!['use', 'wastage', 'adjust', 'opening', 'stock_in'].includes(type)) bad('Select an entry type');
    if (type === 'adjust' && !perm(u, 'stock.adjust')) bad('Stock adjustments need the "Stock adjustments" permission', 403);
    if (['adjust', 'wastage'].includes(type) && !str(b.reason)) bad('Reason is required');
    if (type === 'use' && !str(b.purpose)) bad('Write what it was used for');
    const date = entryDate(req, b.date);
    res.json(await tx(async c => {
      await idem(c, req);
      const it = (await c.query(`SELECT * FROM gen_items WHERE id=$1 AND NOT deleted`, [b.item_id])).rows[0]; if (!it) bad('Select an item');
      await lockItem(c, it.id);
      const bal = await itemBal(c, it.id);
      let r;
      if (type === 'adjust') {
        const nq = Number(b.new_qty); if (!(nq >= 0)) bad('Enter the correct (counted) quantity');
        const diff = qf(nq - bal); if (Math.abs(diff) < 1e-9) bad('Counted quantity is the same as the current stock');
        r = await move(c, u, { date, item_id: it.id, type: diff > 0 ? 'adj_in' : 'adj_out', qty: diff, unit_cost: it.avg_cost, purpose: str(b.reason), remarks: str(b.remarks), before: bal, after: nq });
      } else {
        const qty = qf(toItemQty(it, num(b.qty, 'Quantity'), b.unit, ps.ream_sheets));
        if (['use', 'wastage'].includes(type) && bal + 1e-9 < qty) bad(`Not enough ${it.name}. Available ${qf(bal)} ${it.unit}`);
        const sign = ['use', 'wastage'].includes(type) ? -1 : 1;
        if (type === 'stock_in' && +b.rate > 0) await c.query(`UPDATE gen_items SET avg_cost=CASE WHEN $1::numeric<=0 OR avg_cost IS NULL THEN $3::numeric ELSE ($1::numeric*avg_cost + $2::numeric*$3::numeric)/($1::numeric+$2::numeric) END WHERE id=$4`, [bal, qty, +b.rate, it.id]);
        r = await move(c, u, { date, item_id: it.id, type, qty: sign * qty, unit_cost: type === 'stock_in' && +b.rate > 0 ? +b.rate : it.avg_cost, purpose: str(b.purpose) || str(b.reason), party: str(b.party), remarks: str(b.remarks), before: bal, after: qf(bal + sign * qty) });
      }
      await audit(c, u, 'create', 'store_move', r.id, { item: it.name, type: r.type, qty: r.qty });
      return { ...r, balance: await itemBal(c, it.id) };
    }));
  }));
  app.post('/api/store/moves/:id/void', can('stock.adjust'), wrap(async (req, res) => {
    const reason = str(req.body.reason); if (!reason) bad('Reason is required');
    res.json(await tx(async c => {
      const m = (await c.query(`SELECT m.*, i.name FROM gen_moves m JOIN gen_items i ON i.id=m.item_id WHERE m.id=$1 FOR UPDATE OF m`, [req.params.id])).rows[0];
      if (!m || m.voided || m.is_reversal) bad('Entry not found / already voided');
      if (m.ref_type) bad(`This entry belongs to ${m.ref_no || m.ref_type}. Void that document instead.`);
      await lockItem(c, m.item_id);
      if (+m.qty > 0 && (await itemBal(c, m.item_id)) + 1e-9 < +m.qty) bad(`Cannot void: ${m.name} stock would go below zero`);
      await c.query(`UPDATE gen_moves SET voided=true, void_reason=$1 WHERE id=$2`, [reason, m.id]);
      await move(c, req.user, { date: today(), item_id: m.item_id, type: m.type, qty: -m.qty, unit_cost: m.unit_cost, is_reversal: true, reversal_of: m.id, remarks: 'VOID: ' + reason });
      await audit(c, req.user, 'void', 'store_move', m.id, { reason }); return { ok: true };
    }));
  }));

  /* purchases */
  app.get('/api/store/purchases', can('press.view', 'press.store'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', supplier = '' } = req.query;
    res.json(await q(`SELECT p.*, COALESCE(s.name, p.supplier_name) supplier,
        (SELECT json_agg(json_build_object('item',g.name,'code',g.code,'qty',m.qty,'unit',g.unit,'rate',m.unit_cost) ORDER BY m.id) FROM gen_moves m JOIN gen_items g ON g.id=m.item_id WHERE m.ref_type='purchase' AND m.ref_id=p.id AND NOT m.is_reversal) lines
      FROM store_purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.date BETWEEN $1 AND $2 AND ($3='' OR p.supplier_id=$3::int) ORDER BY p.date DESC, p.id DESC LIMIT 1500`, [from, to, String(supplier)]));
  }));
  app.post('/api/store/purchases', can('press.store'), wrap(async (req, res) => {
    const b = req.body, u = req.user, ps = await pressSettings();
    const date = entryDate(req, b.date);
    if (!Array.isArray(b.lines) || !b.lines.length) bad('Add at least one item');
    const payNow = !!b.record_expense;
    if (payNow && !(await lists()).payment_methods.includes(b.method)) bad('Select the payment method');
    res.json(await tx(async c => {
      await idem(c, req);
      let sup = null; if (b.supplier_id) { sup = (await c.query(`SELECT id, name FROM suppliers WHERE id=$1`, [b.supplier_id])).rows[0]; if (!sup) bad('Supplier not found'); }
      const pur_no = await nextNo(c, 'purchase');
      const p = (await c.query(`INSERT INTO store_purchases(pur_no,date,supplier_id,supplier_name,bill_ref,remarks,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [pur_no, date, sup?.id || null, sup?.name || str(b.supplier_name, 120), str(b.bill_ref, 80), str(b.remarks, 500), u.id, u.full_name, u.role_name])).rows[0];
      let total = 0; const cats = new Set();
      for (const l of b.lines) {
        const it = (await c.query(`SELECT * FROM gen_items WHERE id=$1 AND NOT deleted`, [l.item_id])).rows[0]; if (!it) bad('Select an item on every line');
        const typed = num(l.qty, `${it.name}: quantity`), rate = Number(l.rate || 0); if (!(rate >= 0)) bad(`${it.name}: rate must be 0 or more`);
        const qty = qf(toItemQty(it, typed, l.unit, ps.ream_sheets)), amount = r2(typed * rate), unitCost = qty ? amount / qty : 0;
        await lockItem(c, it.id); const bal = await itemBal(c, it.id);
        await c.query(`UPDATE gen_items SET avg_cost=CASE WHEN $1::numeric<=0 OR avg_cost IS NULL THEN $3::numeric ELSE ($1::numeric*avg_cost + $2::numeric*$3::numeric)/($1::numeric+$2::numeric) END WHERE id=$4`, [bal, qty, unitCost, it.id]);
        await move(c, u, { date, item_id: it.id, type: 'purchase', qty, unit_cost: unitCost, party: sup?.name || str(b.supplier_name), ref_type: 'purchase', ref_id: p.id, ref_no: pur_no, remarks: l.unit && l.unit !== it.unit ? `${typed} ${l.unit} @ ${rate}` : null, before: bal, after: qf(bal + qty) });
        total += amount; cats.add(it.category);
      }
      total = r2(total);
      let expId = null;
      if (payNow) {
        const cat = [...cats].every(x => /paper|board/i.test(x)) ? 'Paper Purchase' : [...cats].every(x => /ink/i.test(x)) ? 'Ink Purchase' : 'Other Expenses';
        expId = (await c.query(`INSERT INTO expenses(date,category,amount,method,description,division,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,'press',$6,$7,$8) RETURNING id`,
          [date, cat, total, b.method, `Purchase ${pur_no}${sup ? ' · ' + sup.name : ''}`, u.id, u.full_name, u.role_name])).rows[0].id;
      }
      await c.query(`UPDATE store_purchases SET total=$1, paid_expense_id=$2 WHERE id=$3`, [total, expId, p.id]);
      await audit(c, u, 'create', 'purchase', p.id, { pur_no, total, lines: b.lines.length });
      return { ...p, total };
    }));
  }));
  app.post('/api/store/purchases/:id/void', can('stock.adjust'), wrap(async (req, res) => {
    const reason = str(req.body.reason); if (!reason) bad('Reason is required');
    res.json(await tx(async c => {
      const p = (await c.query(`SELECT * FROM store_purchases WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!p || p.voided) bad('Purchase not found / already voided');
      const mv = (await c.query(`SELECT m.*, g.name FROM gen_moves m JOIN gen_items g ON g.id=m.item_id WHERE ref_type='purchase' AND ref_id=$1 AND NOT is_reversal AND NOT voided`, [p.id])).rows;
      for (const m of mv) { await lockItem(c, m.item_id); if ((await itemBal(c, m.item_id)) + 1e-9 < +m.qty) bad(`Cannot void: ${m.name} has already been used — stock would go below zero`); }
      for (const m of mv) {
        await c.query(`UPDATE gen_moves SET voided=true, void_reason=$1 WHERE id=$2`, [reason, m.id]);
        await move(c, req.user, { date: today(), item_id: m.item_id, type: 'purchase', qty: -m.qty, unit_cost: m.unit_cost, ref_type: 'purchase', ref_id: p.id, ref_no: p.pur_no, is_reversal: true, reversal_of: m.id, remarks: 'VOID: ' + reason });
      }
      if (p.paid_expense_id) await c.query(`UPDATE expenses SET voided=true WHERE id=$1`, [p.paid_expense_id]);
      await c.query(`UPDATE store_purchases SET voided=true, void_reason=$1 WHERE id=$2`, [reason, p.id]);
      await audit(c, req.user, 'void', 'purchase', p.id, { reason }); return { ok: true };
    }));
  }));

  /* material issue & return */
  app.get('/api/press/issues', can('press.view', 'press.store'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', order = '' } = req.query;
    res.json(await q(`SELECT s.*, o.order_no, c.name customer, pi.product,
        (SELECT json_agg(json_build_object('id',l.id,'item',g.name,'code',g.code,'unit',g.unit,'qty',l.qty,'unit_cost',l.unit_cost,'returned',
            COALESCE((SELECT SUM(r.qty) FROM press_returns r WHERE r.line_id=l.id),0)) ORDER BY l.id) FROM press_issue_lines l JOIN gen_items g ON g.id=l.stock_item_id WHERE l.issue_id=s.id) lines
      FROM press_issues s LEFT JOIN press_orders o ON o.id=s.order_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN press_items pi ON pi.id=s.item_id
      WHERE s.date BETWEEN $1 AND $2 AND ($3='' OR s.order_id=$3::int) ORDER BY s.date DESC, s.id DESC LIMIT 1500`, [from, to, String(order)]));
  }));
  app.get('/api/press/issues/:id', can('press.view', 'press.store'), wrap(async (req, res) => {
    const s = await q1(`SELECT s.*, o.order_no, c.name customer, pi.product FROM press_issues s LEFT JOIN press_orders o ON o.id=s.order_id LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN press_items pi ON pi.id=s.item_id WHERE s.id=$1`, [req.params.id]);
    if (!s) bad('Issue slip not found', 404);
    s.lines = await q(`SELECT l.*, g.name item, g.code, g.unit, g.category, COALESCE((SELECT SUM(r.qty) FROM press_returns r WHERE r.line_id=l.id),0) returned FROM press_issue_lines l JOIN gen_items g ON g.id=l.stock_item_id WHERE l.issue_id=$1 ORDER BY l.id`, [s.id]);
    s.returns = await q(`SELECT r.*, g.name item, g.unit FROM press_returns r JOIN gen_items g ON g.id=r.stock_item_id WHERE r.issue_id=$1 ORDER BY r.id`, [s.id]);
    res.json(s);
  }));
  async function createIssue(c, req, b) {
    const u = req.user, ps = await pressSettings(c);
    const date = entryDate(req, b.date);
    if (!Array.isArray(b.lines) || !b.lines.length) bad('Add at least one material');
    let order = null, item = null;
    if (b.order_id) {
      order = await loadOrderFor(c, u, +b.order_id);
      if (order.status === 'cancelled') bad('This order is cancelled');
      if (b.item_id) { item = (await c.query(`SELECT * FROM press_items WHERE id=$1 AND order_id=$2`, [b.item_id, order.id])).rows[0]; if (!item) bad('Product not found in this order'); }
    } else if (!str(b.remarks)) bad('Select the order, or write what the material is for');
    const issue_no = await nextNo(c, 'issue');
    const s = (await c.query(`INSERT INTO press_issues(issue_no,date,order_id,item_id,issued_by,received_by,remarks,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [issue_no, date, order?.id || null, item?.id || null, str(b.issued_by, 80) || u.full_name, str(b.received_by, 80), str(b.remarks, 500), u.id, u.full_name, u.role_name])).rows[0];
    const merged = new Map();
    for (const l of b.lines) {
      const it = (await c.query(`SELECT * FROM gen_items WHERE id=$1 AND NOT deleted`, [l.item_id])).rows[0]; if (!it) bad('Select a material on every line');
      const qty = qf(toItemQty(it, num(l.qty, `${it.name}: quantity`), l.unit, ps.ream_sheets));
      merged.set(it.id, { it, qty: qf((merged.get(it.id)?.qty || 0) + qty) });
    }
    let total = 0;
    for (const { it, qty } of [...merged.values()].sort((a, b2) => a.it.id - b2.it.id)) {
      await lockItem(c, it.id); const bal = await itemBal(c, it.id);
      if (bal + 1e-9 < qty) bad(`Not enough ${it.name} in store. Available ${qf(bal)} ${it.unit}, issue needs ${qf(qty)} ${it.unit}`);
      const mv = await move(c, u, { date, item_id: it.id, type: 'issue', qty: -qty, unit_cost: +it.avg_cost || 0, party: order ? order.order_no : null, ref_type: 'issue', ref_id: s.id, ref_no: issue_no, purpose: item ? item.product : str(b.remarks), before: bal, after: qf(bal - qty) });
      await c.query(`INSERT INTO press_issue_lines(issue_id,stock_item_id,qty,unit,unit_cost,move_id) VALUES($1,$2,$3,$4,$5,$6)`, [s.id, it.id, qty, it.unit, +it.avg_cost || 0, mv.id]);
      total += qty * (+it.avg_cost || 0);
    }
    await c.query(`UPDATE press_issues SET total_cost=$1 WHERE id=$2`, [r2(total), s.id]);
    if (order) await act(c, u, order.id, item?.id, 'issue', `Material issued ${issue_no}: ${[...merged.values()].map(x => `${x.it.name} ${x.qty} ${x.it.unit}`).join(', ')}`);
    await audit(c, u, 'create', 'issue', s.id, { issue_no, lines: merged.size });
    return s;
  }
  app.post('/api/press/issues', can('press.store'), wrap(async (req, res) => res.json(await tx(async c => { await idem(c, req); return createIssue(c, req, req.body); }))));
  app.post('/api/press/issues/:id/void', can('stock.adjust'), wrap(async (req, res) => {
    const reason = str(req.body.reason); if (!reason) bad('Reason is required');
    res.json(await tx(async c => {
      const s = (await c.query(`SELECT * FROM press_issues WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!s || s.voided) bad('Issue slip not found / already voided');
      if ((await c.query(`SELECT 1 FROM press_returns WHERE issue_id=$1`, [s.id])).rowCount) bad('This issue has returns recorded — it cannot be voided');
      for (const m of (await c.query(`SELECT * FROM gen_moves WHERE ref_type='issue' AND ref_id=$1 AND NOT is_reversal AND NOT voided`, [s.id])).rows) {
        await c.query(`UPDATE gen_moves SET voided=true, void_reason=$1 WHERE id=$2`, [reason, m.id]);
        await move(c, req.user, { date: today(), item_id: m.item_id, type: 'issue', qty: -m.qty, unit_cost: m.unit_cost, ref_type: 'issue', ref_id: s.id, ref_no: s.issue_no, is_reversal: true, reversal_of: m.id, remarks: 'VOID: ' + reason });
      }
      await c.query(`UPDATE press_issues SET voided=true, void_reason=$1 WHERE id=$2`, [reason, s.id]);
      if (s.order_id) await act(c, req.user, s.order_id, s.item_id, 'issue', `Issue ${s.issue_no} voided: ${reason}`);
      await audit(c, req.user, 'void', 'issue', s.id, { reason }); return { ok: true };
    }));
  }));
  app.get('/api/press/returns', can('press.view', 'press.store'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31' } = req.query;
    res.json(await q(`SELECT r.*, g.name item, g.unit, s.issue_no, o.order_no FROM press_returns r JOIN gen_items g ON g.id=r.stock_item_id JOIN press_issues s ON s.id=r.issue_id LEFT JOIN press_orders o ON o.id=s.order_id
      WHERE r.date BETWEEN $1 AND $2 ORDER BY r.date DESC, r.id DESC LIMIT 1500`, [from, to]));
  }));
  app.post('/api/press/returns', can('press.store'), wrap(async (req, res) => {
    const b = req.body, u = req.user;
    if (!['usable', 'damaged'].includes(b.condition)) bad('Select the material condition (usable / damaged)');
    if (!str(b.reason)) bad('Write the return reason');
    const qty = num(b.qty, 'Returned quantity');
    res.json(await tx(async c => {
      await idem(c, req);
      const l = (await c.query(`SELECT l.*, s.issue_no, s.order_id, s.item_id order_item, s.voided, g.name, g.unit FROM press_issue_lines l JOIN press_issues s ON s.id=l.issue_id JOIN gen_items g ON g.id=l.stock_item_id WHERE l.id=$1 FOR UPDATE OF l`, [b.line_id])).rows[0];
      if (!l || l.voided) bad('Issue line not found');
      const already = +(await c.query(`SELECT COALESCE(SUM(qty),0) v FROM press_returns WHERE line_id=$1`, [l.id])).rows[0].v;
      if (already + qty > +l.qty + 1e-9) bad(`Only ${qf(+l.qty - already)} ${l.unit} of ${l.name} can still be returned on ${l.issue_no}`);
      const date = entryDate(req, b.date);
      const return_no = await nextNo(c, 'mreturn');
      let mvId = null;
      if (b.condition === 'usable') {
        await lockItem(c, l.stock_item_id); const bal = await itemBal(c, l.stock_item_id);
        mvId = (await move(c, u, { date, item_id: l.stock_item_id, type: 'return', qty, unit_cost: l.unit_cost, ref_type: 'mreturn', ref_id: l.issue_id, ref_no: return_no, purpose: str(b.reason), remarks: `Return against ${l.issue_no}`, before: bal, after: qf(bal + qty) })).id;
      }
      const r = (await c.query(`INSERT INTO press_returns(return_no,date,issue_id,line_id,stock_item_id,qty,condition,reason,received_by,remarks,move_id,created_by_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [return_no, date, l.issue_id, l.id, l.stock_item_id, qty, b.condition, str(b.reason, 300), str(b.received_by, 80) || u.full_name, str(b.remarks, 300), mvId, u.full_name])).rows[0];
      if (l.order_id) await act(c, u, l.order_id, l.order_item, 'issue', `${l.name} ${qty} ${l.unit} returned (${b.condition === 'usable' ? 'back to stock' : 'damaged — recorded as loss'})`);
      await audit(c, u, 'create', 'material_return', r.id, { qty, condition: b.condition }); return r;
    }));
  }));

  /* ================================ DELIVERY CHALLAN ================================ */
  async function challanDetail(c, id) {
    const ch = (await c.query(`SELECT ch.*, o.order_no, o.date order_date, c.name customer, c.company, c.phone, c.address FROM press_challans ch JOIN press_orders o ON o.id=ch.order_id JOIN customers c ON c.id=ch.customer_id WHERE ch.id=$1`, [id])).rows[0];
    if (!ch) bad('Challan not found', 404);
    ch.items = (await c.query(`SELECT ci.qty current, i.id item_id, i.product, i.description, i.size, i.unit, i.qty ordered,
        COALESCE((SELECT SUM(x.qty) FROM press_challan_items x JOIN press_challans y ON y.id=x.challan_id WHERE x.item_id=i.id AND y.status='active' AND (y.date < ch.date OR (y.date=ch.date AND y.id<ch.id))),0) previous
      FROM press_challan_items ci JOIN press_items i ON i.id=ci.item_id, press_challans ch WHERE ch.id=ci.challan_id AND ci.challan_id=$1 ORDER BY i.sl, i.id`, [id])).rows;
    for (const it of ch.items) { it.total_delivered = r2(+it.previous + +it.current); it.remaining = r2(Math.max(0, +it.ordered - it.total_delivered)); }
    return ch;
  }
  app.get('/api/press/challans', can('press.view', 'press.delivery'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', q: s = '' } = req.query;
    res.json(await q(`SELECT ch.*, o.order_no, c.name customer, c.phone,
        (SELECT string_agg(i.product || ' ' || trim(to_char(ci.qty,'FM999999990.##')), ', ') FROM press_challan_items ci JOIN press_items i ON i.id=ci.item_id WHERE ci.challan_id=ch.id) items
      FROM press_challans ch JOIN press_orders o ON o.id=ch.order_id JOIN customers c ON c.id=ch.customer_id
      WHERE ch.date BETWEEN $1 AND $2 AND ($3='' OR lower(ch.dc_no||' '||o.order_no||' '||c.name) LIKE '%'||lower($3)||'%') ORDER BY ch.date DESC, ch.id DESC LIMIT 1500`, [from, to, s]));
  }));
  app.get('/api/press/challans/:id', can('press.view', 'press.delivery'), wrap(async (req, res) => res.json(await tx(c => challanDetail(c, +req.params.id)))));
  async function createChallan(c, req, b) {
    const u = req.user;
    const o = await loadOrderFor(c, u, +b.order_id, true);
    if (o.status === 'cancelled') bad('This order is cancelled');
    if (o.status === 'invoiced') bad('This order is already invoiced and closed');
    const date = entryDate(req, b.date);
    if (date < o.date) bad('Challan date cannot be before the order date');
    const lines = (b.items || []).filter(x => +x.qty > 0); if (!lines.length) bad('Enter the quantity delivered now');
    const items = (await c.query(`SELECT * FROM press_items WHERE order_id=$1 AND NOT cancelled`, [o.id])).rows, del = await deliveredMap(c, o.id);
    for (const l of lines) {
      const it = items.find(x => x.id === +l.item_id); if (!it) bad('Product not in this order');
      const rem = +it.qty - (del[it.id] || 0); if (+l.qty > rem + 1e-9) bad(`${it.product}: only ${r2(rem)} left to deliver`);
    }
    const dc_no = await nextNo(c, 'press_dc');
    const ch = (await c.query(`INSERT INTO press_challans(dc_no,date,order_id,customer_id,receiver,carried_by,prepared_by,prepared_nick,remarks,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [dc_no, date, o.id, o.customer_id, str(b.receiver, 80), str(b.carried_by, 80), str(b.prepared_by, 80) || u.full_name, b.prepared_nick === undefined ? (u.nickname || null) : str(b.prepared_nick, 40), str(b.remarks, 500), u.id, u.full_name, u.role_name])).rows[0];
    for (const l of lines) await c.query(`INSERT INTO press_challan_items(challan_id,item_id,qty) VALUES($1,$2,$3)`, [ch.id, l.item_id, +l.qty]);
    await act(c, u, o.id, null, 'delivery', `Challan ${dc_no}: ` + lines.map(l => `${items.find(x => x.id === +l.item_id).product} ${+l.qty}`).join(', '));
    await refreshOrder(c, o.id);
    await audit(c, u, 'create', 'press_challan', ch.id, { dc_no, order: o.order_no });
    return ch;
  }
  app.post('/api/press/challans', can('press.delivery'), wrap(async (req, res) => res.json(await tx(async c => { await idem(c, req); const ch = await createChallan(c, req, req.body); return challanDetail(c, ch.id); }))));
  app.post('/api/press/challans/:id/cancel', can('invoice.cancel'), wrap(async (req, res) => {
    const reason = str(req.body.reason); if (!reason) bad('Reason is required');
    res.json(await tx(async c => {
      const ch = (await c.query(`SELECT * FROM press_challans WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!ch || ch.status !== 'active') bad('Challan not found / already cancelled');
      if ((await c.query(`SELECT 1 FROM press_invoices WHERE order_id=$1 AND status='final'`, [ch.order_id])).rowCount) bad('The order is invoiced. Void the invoice first.');
      await c.query(`UPDATE press_challans SET status='cancelled', cancel_reason=$1, cancelled_by_name=$2 WHERE id=$3`, [reason, req.user.full_name, ch.id]);
      await act(c, req.user, ch.order_id, null, 'delivery', `Challan ${ch.dc_no} cancelled: ${reason}`);
      await refreshOrder(c, ch.order_id);
      await audit(c, req.user, 'cancel', 'press_challan', ch.id, { reason }); return { ok: true };
    }));
  }));

  /* ================================ FINAL INVOICE ================================ */
  async function invoiceDetail(c, id) {
    const inv = (await c.query(`SELECT i.*, o.order_no, o.date order_date, c.name customer, c.company, c.phone, c.address FROM press_invoices i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=i.customer_id WHERE i.id=$1`, [id])).rows[0];
    if (!inv) bad('Invoice not found', 404);
    inv.items = (await c.query(`SELECT * FROM press_invoice_items WHERE invoice_id=$1 ORDER BY id`, [id])).rows;
    const pays = (await c.query(`SELECT p.id, p.receipt_no, p.date, p.time, p.method, a.amount, a.created_at FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.division='press' AND a.invoice_id=$1 AND NOT p.voided ORDER BY p.date, p.id`, [id])).rows;
    inv.payments = pays;
    inv.paid = r2(pays.reduce((s, p) => s + +p.amount, 0));
    const cur = pays.filter(p => p.date === inv.date && new Date(p.created_at) >= new Date(inv.created_at) - 5000);
    inv.current_payment = r2(cur.reduce((s, p) => s + +p.amount, 0));
    inv.previous_payments = r2(inv.paid - inv.current_payment);
    inv.due = inv.status === 'final' ? r2(inv.grand_total - inv.paid) : 0;
    inv.division = 'press';
    return inv;
  }
  app.get('/api/press/orders/:id/invoice-preview', can('press.invoice'), wrap(async (req, res) => res.json(await tx(async c => {
    const o = await loadOrderFor(c, req.user, +req.params.id);
    const items = (await c.query(`SELECT * FROM press_items WHERE order_id=$1 AND NOT cancelled ORDER BY sl, id`, [o.id])).rows, del = await deliveredMap(c, o.id);
    const paid = +(await c.query(`SELECT COALESCE(SUM(p.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0)),0) v FROM payments p WHERE order_id=$1 AND NOT voided`, [o.id])).rows[0].v;
    return { order: o, all_delivered: items.every(i => (del[i.id] || 0) >= +i.qty - 1e-9), paid_advance: r2(paid),
      items: items.map(i => ({ item_id: i.id, product: i.product, description: [i.description, i.size, i.paper && `${i.paper} ${i.gsm || ''}`.trim(), i.colour].filter(Boolean).join(' · '), qty: +i.qty, delivered: del[i.id] || 0, unit: i.unit, unit_price: +i.unit_price })) };
  }))));
  async function createInvoice(c, req, b) {
    const u = req.user;
    const o = await loadOrderFor(c, u, +b.order_id, true);
    if (o.status === 'cancelled') bad('This order is cancelled');
    if ((await c.query(`SELECT 1 FROM press_invoices WHERE order_id=$1 AND status='final'`, [o.id])).rowCount) bad('This order already has a final invoice. One order = one final invoice.');
    const items = (await c.query(`SELECT * FROM press_items WHERE order_id=$1 AND NOT cancelled ORDER BY sl, id`, [o.id])).rows, del = await deliveredMap(c, o.id);
    const allDel = items.every(i => (del[i.id] || 0) >= +i.qty - 1e-9);
    const closeEarly = !allDel;
    if (closeEarly) {
      if (!b.close_early) bad('All products are not delivered yet. The final invoice is made after full delivery (partial deliveries get only a challan).');
      if (!perm(u, 'press.invoice.void')) bad('Only Admin / Manager can invoice an order that is closed before full delivery', 403);
      if (!str(b.close_reason)) bad('Write why the order is being closed before full delivery');
    }
    const date = entryDate(req, b.date);
    const priceOf = Object.fromEntries((b.lines || []).map(l => [+l.item_id, l.unit_price]));
    const lines = items.map(i => {
      const qty = closeEarly && b.bill_delivered_only !== false ? (del[i.id] || 0) : +i.qty;
      const up = priceOf[i.id] !== undefined ? Number(priceOf[i.id]) : +i.unit_price;
      if (!(up >= 0)) bad(`${i.product}: price must be 0 or more`);
      return { item_id: i.id, product: i.product, description: [i.description, i.size, i.paper && `${i.paper} ${i.gsm ? i.gsm + ' GSM' : ''}`.trim(), i.colour, i.sides, i.finishing].filter(Boolean).join(' · '), qty, unit: i.unit, unit_price: up, total: r2(qty * up) };
    }).filter(l => l.qty > 0);
    if (!lines.length) bad('Nothing was delivered — nothing to invoice');
    const subtotal = r2(lines.reduce((s, l) => s + l.total, 0));
    const discount = r2(Math.max(0, +b.discount || 0)), adjustment = r2(+b.adjustment || 0);
    if (adjustment && !str(b.adjustment_note)) bad('Write a note for the adjustment');
    const grand = r2(subtotal - discount + adjustment); if (grand < 0) bad('Final total cannot be negative');
    const inv_no = await nextNo(c, 'press_inv');
    const inv = (await c.query(`INSERT INTO press_invoices(inv_no,date,order_id,customer_id,status,subtotal,discount,adjustment,adjustment_note,grand_total,closed_early,close_reason,remarks,created_by,created_by_name,created_role)
      VALUES($1,$2,$3,$4,'final',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [inv_no, date, o.id, o.customer_id, subtotal, discount, adjustment, str(b.adjustment_note, 300), grand, closeEarly, str(b.close_reason, 500), str(b.remarks, 500), u.id, u.full_name, u.role_name])).rows[0];
    for (const l of lines) await c.query(`INSERT INTO press_invoice_items(invoice_id,item_id,product,description,qty,unit,unit_price,total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [inv.id, l.item_id, l.product, l.description, l.qty, l.unit, l.unit_price, l.total]);
    // earlier payments of this order (advance, during work, at delivery) are applied first
    let left = grand;
    for (const p of (await c.query(`SELECT p.id, p.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0) free FROM payments p WHERE order_id=$1 AND NOT voided ORDER BY date, id FOR UPDATE`, [o.id])).rows) {
      const a = r2(Math.min(+p.free, left)); if (a <= 0) continue;
      await c.query(`INSERT INTO payment_allocations(payment_id,division,invoice_id,amount,created_by,created_by_name) VALUES($1,'press',$2,$3,$4,$5)`, [p.id, inv.id, a, u.id, u.full_name]);
      left = r2(left - a); if (left <= 0) break;
    }
    const cur = r2(+(b.current_payment?.amount || 0));
    if (cur > 0) {
      if (cur > left + 0.004) bad(`Current payment is more than the balance due (৳${left})`);
      if (!(await lists()).payment_methods.includes(b.current_payment.method)) bad('Select the payment method');
      await recordPayment(c, u, { date, time: str(b.current_payment.time, 8), customer_id: o.customer_id, amount: cur, method: b.current_payment.method, reference: str(b.current_payment.reference), division: 'press', remarks: 'Paid at invoice ' + inv_no, order_id: o.id, allocations: [{ division: 'press', invoice_id: inv.id, amount: cur }] });
    }
    await act(c, u, o.id, null, 'invoice', `Final invoice ${inv_no} · ৳${grand}${closeEarly ? ' (order closed before full delivery: ' + str(b.close_reason, 200) + ')' : ''}`);
    await refreshOrder(c, o.id);
    await audit(c, u, 'create', 'press_invoice', inv.id, { inv_no, total: grand, order: o.order_no, close_early: closeEarly });
    return inv;
  }
  app.post('/api/press/invoices', can('press.invoice'), wrap(async (req, res) => res.json(await tx(async c => { await idem(c, req); const inv = await createInvoice(c, req, req.body); return invoiceDetail(c, inv.id); }))));
  app.get('/api/press/invoices', can('press.view', 'press.invoice', 'reports'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', status = '', q: s = '' } = req.query;
    res.json(await q(`SELECT i.*, o.order_no, c.name customer, c.phone, ${paidSql('press')} paid FROM press_invoices i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=i.customer_id
      WHERE ${status === 'void' ? `COALESCE(i.voided_at::date, i.date)` : 'i.date'} BETWEEN $1 AND $2 AND ($3='' OR i.status=$3 OR ($3='void_requested' AND i.status='final' AND i.void_requested_at IS NOT NULL))
        AND ($4='' OR lower(i.inv_no||' '||o.order_no||' '||c.name||' '||COALESCE(c.phone,'')) LIKE '%'||lower($4)||'%') ORDER BY i.date DESC, i.id DESC LIMIT 1500`, [from, to, status, s]));
  }));
  app.get('/api/press/invoices/:id', can('press.view', 'press.invoice', 'reports', 'accounts.view'), wrap(async (req, res) => res.json(await tx(c => invoiceDetail(c, +req.params.id)))));
  async function doVoid(c, u, inv, reason, category, approver) {
    const snap = await invoiceDetail(c, inv.id);
    const alloc = (await c.query(`DELETE FROM payment_allocations WHERE division='press' AND invoice_id=$1 RETURNING *`, [inv.id])).rows;
    await c.query(`UPDATE press_invoices SET status='void', voided_at=now(), voided_by=$1, voided_by_name=$2, void_reason=$3, void_category=$4, void_approved_by_name=$5, snapshot=$6 WHERE id=$7`,
      [u.id, u.full_name, reason, category, approver || null, JSON.stringify({ ...snap, released_allocations: alloc }), inv.id]);
    await act(c, u, inv.order_id, null, 'invoice', `Invoice ${inv.inv_no} VOID (${category}): ${reason}. Linked payments ৳${r2(alloc.reduce((s, a) => s + +a.amount, 0))} stay with the order as advance.`);
    await refreshOrder(c, inv.order_id);
    await audit(c, u, 'void', 'press_invoice', inv.id, { inv_no: inv.inv_no, reason, category, approver });
  }
  app.post('/api/press/invoices/:id/void', can('press.invoice.void'), wrap(async (req, res) => {
    const reason = str(req.body.reason), category = VOID_CATS.includes(req.body.category) ? req.body.category : null;
    if (!reason) bad('Reason is required'); if (!category) bad('Select the reason category');
    const ps = await pressSettings();
    res.json(await tx(async c => {
      const inv = (await c.query(`SELECT * FROM press_invoices WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!inv || inv.status !== 'final') bad('Invoice not found / already void');
      if (ps.void_needs_approval) {
        if (inv.void_requested_at) bad('A void request is already waiting for approval');
        await c.query(`UPDATE press_invoices SET void_requested_by=$1, void_requested_name=$2, void_requested_at=now(), void_req_reason=$3, void_req_category=$4 WHERE id=$5`, [req.user.id, req.user.full_name, reason, category, inv.id]);
        await act(c, req.user, inv.order_id, null, 'invoice', `Void requested for ${inv.inv_no}: ${reason} — waiting for a second approver`);
        await audit(c, req.user, 'void_request', 'press_invoice', inv.id, { reason, category });
        return { pending_approval: true };
      }
      await doVoid(c, req.user, inv, reason, category);
      return { ok: true };
    }));
  }));
  app.post('/api/press/invoices/:id/void-approve', can('press.invoice.void'), wrap(async (req, res) => res.json(await tx(async c => {
    const inv = (await c.query(`SELECT * FROM press_invoices WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!inv || inv.status !== 'final' || !inv.void_requested_at) bad('No void request for this invoice');
    if (inv.void_requested_by === req.user.id) bad('A different person must approve the void request', 403);
    await doVoid(c, req.user, inv, inv.void_req_reason, inv.void_req_category, req.user.full_name);
    return { ok: true };
  }))));
  app.post('/api/press/invoices/:id/void-reject', can('press.invoice.void'), wrap(async (req, res) => res.json(await tx(async c => {
    const inv = (await c.query(`SELECT * FROM press_invoices WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0]; if (!inv || !inv.void_requested_at) bad('No void request for this invoice');
    await c.query(`UPDATE press_invoices SET void_requested_by=NULL, void_requested_name=NULL, void_requested_at=NULL, void_req_reason=NULL, void_req_category=NULL WHERE id=$1`, [inv.id]);
    await act(c, req.user, inv.order_id, null, 'invoice', `Void request for ${inv.inv_no} rejected`); return { ok: true };
  }))));

  /* ---------------- counter job: order + delivery + invoice in one step (replaces the old "General" bill) ---------------- */
  app.post('/api/press/quick', can('press.orders'), wrap(async (req, res) => {
    const b = req.body, u = req.user;
    if (!perm(u, 'press.invoice') || !perm(u, 'press.delivery')) bad('A counter job needs the delivery and invoice permissions', 403);
    const ps = await pressSettings();
    if (!Array.isArray(b.items) || !b.items.length) bad('Add at least one job line');
    const items = b.items.map(it => cleanItem({ ...it, design_required: false }, ps.templates));
    const date = entryDate(req, b.date);
    res.json(await tx(async c => {
      await idem(c, req);
      const cust = (await c.query(`SELECT id FROM customers WHERE id=$1`, [b.customer_id])).rows[0]; if (!cust) bad('Select a customer');
      const order_no = await nextNo(c, 'press_order');
      const o = (await c.query(`INSERT INTO press_orders(order_no,date,customer_id,order_type,officer_id,officer_name,deadline,remarks,quick,created_by,created_by_name,created_role)
        VALUES($1,$2,$3,'Service Only',$4,$5,$2,$6,true,$4,$5,$7) RETURNING *`, [order_no, date, cust.id, u.id, u.full_name, str(b.remarks, 1000), u.role_name])).rows[0];
      let sl = 0; const made = [];
      for (const it of items) {
        const r = await insertItem(c, o.id, ++sl, it);
        const steps = (r.steps || []).map(s => ({ ...s, done: true, date, by: u.full_name }));
        await c.query(`UPDATE press_items SET prod_status='Completed', actual_start=$1, actual_completion=$1, good_qty=qty, steps=$2 WHERE id=$3`, [date, JSON.stringify(steps), r.id]);
        made.push(r);
      }
      if (Array.isArray(b.materials) && b.materials.filter(m => m.item_id && +m.qty > 0).length)
        await createIssue(c, req, { date, order_id: o.id, issued_by: u.full_name, received_by: u.full_name, remarks: 'Counter job', lines: b.materials.filter(m => m.item_id && +m.qty > 0) });
      await createChallan(c, req, { order_id: o.id, date, receiver: str(b.receiver, 80), prepared_by: u.full_name, items: made.map(r => ({ item_id: r.id, qty: +r.qty })) });
      const inv = await createInvoice(c, req, { order_id: o.id, date, discount: b.discount, adjustment: 0, current_payment: { amount: b.paid_amount, method: b.payment_method }, remarks: str(b.remarks, 500) });
      await audit(c, u, 'create', 'press_quick', o.id, { order_no, inv: inv.inv_no });
      return { order_id: o.id, invoice_id: inv.id, inv_no: inv.inv_no, order_no };
    }));
  }));

  /* ================================ REFUNDS ================================ */
  async function customerCredit(c, cid) {
    return r2(+(await c.query(`SELECT COALESCE((SELECT SUM(p.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations WHERE payment_id=p.id),0)) FROM payments p WHERE p.customer_id=$1 AND NOT p.voided),0)
      - COALESCE((SELECT SUM(amount) FROM refunds WHERE customer_id=$1 AND NOT voided),0) v`, [cid])).rows[0].v);
  }
  h.customerCredit = customerCredit;
  app.get('/api/customers/:id/credit', can('payments', 'refunds', 'accounts.view'), wrap(async (req, res) => res.json({ credit: await tx(c => customerCredit(c, +req.params.id)) })));
  app.get('/api/refunds', can('refunds', 'payments', 'accounts.view'), wrap(async (req, res) => {
    const { from = '1900-01-01', to = '2999-12-31', customer = '' } = req.query;
    res.json(await q(`SELECT r.*, c.name customer, c.phone, o.order_no FROM refunds r JOIN customers c ON c.id=r.customer_id LEFT JOIN press_orders o ON o.id=r.order_id
      WHERE r.date BETWEEN $1 AND $2 AND ($3='' OR r.customer_id=$3::int) ORDER BY r.date DESC, r.id DESC LIMIT 2000`, [from, to, String(customer)]));
  }));
  async function createRefund(c, req, b) {
    const u = req.user, amount = r2(num(b.amount, 'Refund amount'));
    if (!(await lists()).payment_methods.includes(b.method)) bad('Select how the money was returned');
    const reason = str(b.reason, 500); if (!reason) bad('Write the refund reason');
    const date = entryDate(req, b.date);
    const cust = (await c.query(`SELECT id, name FROM customers WHERE id=$1 FOR UPDATE`, [b.customer_id])).rows[0]; if (!cust) bad('Select a customer');
    const credit = await customerCredit(c, cust.id);
    if (amount > credit + 0.004) bad(`${cust.name} has only ৳${credit} advance / credit available to refund.`);
    const refund_no = await nextNo(c, 'refund');
    const r = (await c.query(`INSERT INTO refunds(refund_no,date,time,customer_id,amount,method,reference,reason,order_id,related,created_by,created_by_name,created_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [refund_no, date, str(b.time, 8), cust.id, amount, b.method, str(b.reference, 80), reason, +b.order_id || null, str(b.related, 80), u.id, u.full_name, u.role_name])).rows[0];
    if (r.order_id) await act(c, u, r.order_id, null, 'payment', `Refund ${refund_no} ৳${amount} (${b.method}): ${reason}`);
    await audit(c, u, 'create', 'refund', r.id, { refund_no, amount, customer: cust.name, reason });
    return r;
  }
  h.createRefund = createRefund;
  app.post('/api/refunds', can('refunds'), wrap(async (req, res) => res.json(await tx(async c => { await idem(c, req); return createRefund(c, req, req.body); }))));
  app.post('/api/refunds/:id/void', can('invoice.cancel'), wrap(async (req, res) => {
    const reason = str(req.body.reason); if (!reason) bad('Reason is required');
    res.json(await tx(async c => {
      const r = (await c.query(`UPDATE refunds SET voided=true, void_reason=$1 WHERE id=$2 AND NOT voided RETURNING *`, [reason, req.params.id])).rows[0]; if (!r) bad('Refund not found / already voided');
      await audit(c, req.user, 'void', 'refund', r.id, { reason, amount: r.amount }); return { ok: true };
    }));
  }));

  /* ================================ PAPER CALCULATOR ================================ */
  app.post('/api/press/calculate', wrap(async (req, res) => {
    const b = req.body, ps = await pressSettings();
    const sw = +b.sheet_w, sl = +b.sheet_l, pw = +b.piece_w, pl = +b.piece_l, qty = Math.max(0, +b.qty || 0), gsm = +b.gsm || 0;
    const margin = Math.max(0, +b.margin || 0), gripper = Math.max(0, +b.gripper || 0), gap = Math.max(0, +b.gap || 0);
    if (!(sw > 0 && sl > 0 && pw > 0 && pl > 0)) bad('Enter sheet size and product size');
    const uw = sw - 2 * margin, ul = sl - 2 * margin - gripper;
    const fit = (W, L, a, b2) => Math.max(0, Math.floor((W + gap) / (a + gap))) * Math.max(0, Math.floor((L + gap) / (b2 + gap)));
    const normal = fit(uw, ul, pw, pl), rotated = fit(uw, ul, pl, pw);
    // mixed layout: fill with normal orientation, then rotated pieces in the leftover strip
    let mixed = 0;
    for (let cols = 0; cols * (pw + gap) <= uw + gap; cols++) {
      const usedW = cols * (pw + gap); const a = cols * Math.max(0, Math.floor((ul + gap) / (pl + gap)));
      const rest = fit(uw - usedW, ul, pl, pw); mixed = Math.max(mixed, a + rest);
    }
    const ups = Math.max(normal, rotated, b.allow_mixed === false ? 0 : mixed);
    if (!ups) bad('The product does not fit on this sheet');
    const sides = +b.sides === 2 ? 2 : 1;
    const run = Math.ceil(qty / ups);
    const makeReady = b.make_ready === '' || b.make_ready == null ? ps.make_ready_sheets : Math.max(0, +b.make_ready);
    const wastePct = b.wastage_pct === '' || b.wastage_pct == null ? ps.wastage_pct : Math.max(0, +b.wastage_pct);
    const waste = Math.ceil(run * wastePct / 100);
    const total = run + makeReady * sides + waste;
    const ream = +b.ream_sheets || ps.ream_sheets;
    const areaM2 = (sw * 0.0254) * (sl * 0.0254), sheetKg = areaM2 * gsm / 1000;
    const weight = Math.round(total * sheetKg * 1000) / 1000;
    let cost = null; const price = +b.price || 0;
    if (price > 0) cost = r2(b.price_unit === 'kg' ? weight * price : b.price_unit === 'ream' ? total / ream * price : total * price);
    res.json({ usable: { w: uw, l: ul }, ups, normal, rotated, mixed, best: ups === normal ? 'normal' : ups === rotated ? 'rotated' : 'mixed', run_sheets: run, make_ready: makeReady * sides, wastage: waste, wastage_pct: wastePct,
      total_sheets: total, reams: Math.round(total / ream * 1000) / 1000, ream_sheets: ream, sheet_kg: Math.round(sheetKg * 10000) / 10000, weight_kg: weight, cost, extra_pieces: run * ups - qty,
      note: 'Simple calculation — check against your machine gripper, margin and imposition before buying paper.' });
  }));

  /* ================================ DASHBOARD + REPORTS ================================ */
  h.pressDashboard = async (from, to) => {
    const t = today();
    const [k, monthly, recent, lowStore, overdueList, todayDel] = await Promise.all([
      q1(`SELECT (SELECT COUNT(*) FROM press_orders WHERE status<>'cancelled' AND date BETWEEN $1 AND $2)::int orders,
          (SELECT COUNT(*) FROM press_orders WHERE status<>'cancelled')::int all_orders,
          (SELECT COUNT(*) FROM press_orders WHERE date=$3 AND status<>'cancelled')::int today_orders,
          (SELECT COUNT(*) FROM press_orders WHERE status='in_production')::int running,
          (SELECT COUNT(*) FROM press_orders WHERE status='pending')::int pending,
          (SELECT COUNT(*) FROM press_orders WHERE status IN ('ready','partial_delivery'))::int ready,
          (SELECT COUNT(*) FROM press_orders WHERE status IN ('delivered','invoiced') AND date BETWEEN $1 AND $2)::int completed,
          (SELECT COUNT(*) FROM press_orders WHERE status='delivered')::int to_invoice,
          (SELECT COUNT(*) FROM press_orders WHERE deadline < $3 AND status NOT IN ('delivered','invoiced','cancelled'))::int overdue,
          (SELECT COUNT(*) FROM press_items i JOIN press_orders o ON o.id=i.order_id WHERE NOT i.cancelled AND o.status<>'cancelled' AND i.prod_status='In Progress')::int jobs_running,
          (SELECT COUNT(*) FROM press_items i JOIN press_orders o ON o.id=i.order_id WHERE NOT i.cancelled AND o.status<>'cancelled' AND i.design_required AND i.design_status IN ('Approval Pending'))::int design_waiting,
          (SELECT COUNT(*) FROM press_challans WHERE date=$3 AND status='active')::int today_delivery,
          COALESCE((SELECT SUM(grand_total) FROM press_invoices WHERE status='final' AND date BETWEEN $1 AND $2),0) sales,
          (SELECT COUNT(*) FROM press_invoices WHERE status='final' AND date BETWEEN $1 AND $2)::int invoices,
          COALESCE((SELECT SUM(total) FROM press_orders WHERE status<>'cancelled' AND date BETWEEN $1 AND $2),0) order_value,
          COALESCE((SELECT SUM(amount) FROM refunds WHERE NOT voided AND date BETWEEN $1 AND $2),0) refunds,
          (SELECT COUNT(*) FROM press_invoices WHERE status='final' AND void_requested_at IS NOT NULL)::int void_requests`, [from, to, t]),
      q(`SELECT to_char(m,'YYYY-MM') AS month, COALESCE((SELECT SUM(grand_total) FROM press_invoices WHERE status='final' AND date_trunc('month',date)=m),0)
          + COALESCE((SELECT SUM(grand_total) FROM gen_invoices WHERE status='confirmed' AND date_trunc('month',date)=m),0) press,
          COALESCE((SELECT SUM(amount) FROM expenses WHERE NOT voided AND date_trunc('month',date)=m),0) expenses,
          COALESCE((SELECT SUM(amount) FROM refunds WHERE NOT voided AND date_trunc('month',date)=m),0) refunds
        FROM generate_series(date_trunc('month',$1::date) - interval '11 months', date_trunc('month',$1::date), interval '1 month') m ORDER BY m`, [t]),
      q(`SELECT 'press' division, i.id, i.inv_no, i.date, i.grand_total, c.name customer, i.created_by_name, i.created_at ts FROM press_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='final' ORDER BY i.created_at DESC LIMIT 8`),
      q(`SELECT i.id, i.name, i.unit, i.category, i.low_stock, COALESCE(SUM(m.qty),0) balance FROM gen_items i LEFT JOIN gen_moves m ON m.item_id=i.id WHERE i.active AND NOT i.deleted GROUP BY i.id HAVING COALESCE(SUM(m.qty),0) <= i.low_stock AND i.low_stock > 0 ORDER BY i.category, i.name`),
      q(`SELECT o.id, o.order_no, o.deadline, o.status, c.name customer, (SELECT string_agg(product, ', ') FROM press_items WHERE order_id=o.id AND NOT cancelled) products
         FROM press_orders o JOIN customers c ON c.id=o.customer_id WHERE o.deadline < $1 AND o.status NOT IN ('delivered','invoiced','cancelled') ORDER BY o.deadline LIMIT 8`, [t]),
      q(`SELECT o.id, o.order_no, o.deadline, o.status, c.name customer, (SELECT string_agg(product, ', ') FROM press_items WHERE order_id=o.id AND NOT cancelled) products
         FROM press_orders o JOIN customers c ON c.id=o.customer_id WHERE o.deadline BETWEEN $1 AND ($1::date + 2) AND o.status NOT IN ('delivered','invoiced','cancelled') ORDER BY o.deadline LIMIT 8`, [t]),
    ]);
    for (const x of ['sales', 'order_value', 'refunds']) k[x] = r2(k[x]);
    return { ...k, monthly, recent, low_store: lowStore, overdue_list: overdueList, due_soon: todayDel };
  };

  const REPORTS = {
    'orders-date': ['Orders — date-wise', `SELECT o.date, o.order_no, c.name customer, o.order_type, o.officer_name officer, o.status, (SELECT COUNT(*) FROM press_items WHERE order_id=o.id AND NOT cancelled)::int products, o.total, o.deadline
      FROM press_orders o JOIN customers c ON c.id=o.customer_id WHERE o.date BETWEEN $1 AND $2 AND ($3='' OR o.customer_id=$3::int) ORDER BY o.date, o.id`, { total: 'total' }],
    'orders-customer': ['Orders — customer-wise', `SELECT c.name customer, c.phone, COUNT(*)::int orders, SUM(o.total) value, COUNT(*) FILTER (WHERE o.status IN ('delivered','invoiced'))::int completed
      FROM press_orders o JOIN customers c ON c.id=o.customer_id WHERE o.status<>'cancelled' AND o.date BETWEEN $1 AND $2 AND ($3='' OR o.customer_id=$3::int) GROUP BY c.id ORDER BY value DESC`, { value: 'value', orders: 'orders' }],
    'orders-product': ['Orders — product-wise', `SELECT i.product, COALESCE(i.template,'—') type, COUNT(DISTINCT i.order_id)::int orders, SUM(i.qty) qty, SUM(i.total) value
      FROM press_items i JOIN press_orders o ON o.id=i.order_id WHERE NOT i.cancelled AND o.status<>'cancelled' AND o.date BETWEEN $1 AND $2 AND ($3='' OR o.customer_id=$3::int) GROUP BY 1,2 ORDER BY value DESC`, { value: 'value' }],
    'orders-officer': ['Orders — marketing officer-wise', `SELECT COALESCE(o.officer_name, o.created_by_name) officer, COUNT(*)::int orders, SUM(o.total) value, COUNT(*) FILTER (WHERE o.status IN ('delivered','invoiced'))::int completed, COUNT(DISTINCT o.customer_id)::int customers
      FROM press_orders o WHERE o.status<>'cancelled' AND o.date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY value DESC`, { value: 'value', orders: 'orders' }],
    'order-status': ['Order status', `SELECT o.status, COUNT(*)::int orders, SUM(o.total) value FROM press_orders o WHERE o.date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`, { orders: 'orders', value: 'value' }],
    'prod-running': ['Production — running jobs', `SELECT o.order_no, c.name customer, i.product, i.qty, i.prod_status status, i.assigned_staff staff, m.name machine, i.actual_start started, COALESCE(i.est_completion,o.deadline) due
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id LEFT JOIN machines m ON m.id=i.machine_id WHERE NOT i.cancelled AND o.status<>'cancelled' AND i.prod_status IN ('Assigned','In Progress','On Hold') ORDER BY due NULLS LAST`],
    'prod-pending': ['Production — pending jobs', `SELECT o.order_no, c.name customer, i.product, i.qty, i.design_status design, i.planned_start, COALESCE(i.est_completion,o.deadline) due
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id WHERE NOT i.cancelled AND o.status<>'cancelled' AND i.prod_status='Pending' ORDER BY due NULLS LAST`],
    'prod-completed': ['Production — completed jobs', `SELECT i.actual_completion completed, o.order_no, c.name customer, i.product, i.qty, i.good_qty good, i.waste_qty waste, i.actual_start started
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id WHERE NOT i.cancelled AND i.prod_status='Completed' AND i.actual_completion BETWEEN $1 AND $2 ORDER BY 1`],
    'prod-overdue': ['Production — overdue jobs', `SELECT o.order_no, c.name customer, i.product, i.qty, i.prod_status status, COALESCE(i.est_completion,o.deadline) due, ($4::date - COALESCE(i.est_completion,o.deadline)) days_late
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL AND $3::text IS NOT NULL AND NOT i.cancelled AND o.status<>'cancelled' AND i.prod_status NOT IN ('Completed','Cancelled') AND COALESCE(i.est_completion,o.deadline) < $4::date ORDER BY due`],
    'challan-register': ['Delivery challan register', `SELECT ch.date, ch.dc_no, o.order_no, c.name customer, (SELECT string_agg(i.product||' '||trim(to_char(ci.qty,'FM999999990.##')), ', ') FROM press_challan_items ci JOIN press_items i ON i.id=ci.item_id WHERE ci.challan_id=ch.id) items, ch.receiver, ch.prepared_by, ch.status
      FROM press_challans ch JOIN press_orders o ON o.id=ch.order_id JOIN customers c ON c.id=ch.customer_id WHERE ch.date BETWEEN $1 AND $2 AND ($3='' OR ch.customer_id=$3::int) ORDER BY ch.date, ch.id`],
    'delivery-remaining': ['Remaining quantity to deliver', `SELECT o.order_no, c.name customer, i.product, i.qty ordered, COALESCE(d.qty,0) delivered, i.qty - COALESCE(d.qty,0) remaining, o.deadline
      FROM press_items i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id
      LEFT JOIN (SELECT ci.item_id, SUM(ci.qty) qty FROM press_challan_items ci JOIN press_challans ch ON ch.id=ci.challan_id WHERE ch.status='active' GROUP BY 1) d ON d.item_id=i.id
      WHERE NOT i.cancelled AND o.status NOT IN ('cancelled','invoiced') AND i.qty - COALESCE(d.qty,0) > 0 ORDER BY o.deadline NULLS LAST, o.id`],
    'stock-current': ['Current stock (store)', `SELECT i.code, i.name item, i.category, i.size, i.gsm, i.rack, i.unit, COALESCE(SUM(m.qty),0) balance, i.low_stock min, i.avg_cost, COALESCE(SUM(m.qty),0)*COALESCE(i.avg_cost,0) value
      FROM gen_items i LEFT JOIN gen_moves m ON m.item_id=i.id WHERE NOT i.deleted GROUP BY i.id ORDER BY i.category, i.name`, { value: 'value' }],
    'stock-low': ['Low stock', `SELECT i.code, i.name item, i.category, i.unit, COALESCE(SUM(m.qty),0) balance, i.low_stock min, i.rack
      FROM gen_items i LEFT JOIN gen_moves m ON m.item_id=i.id WHERE NOT i.deleted AND i.active GROUP BY i.id HAVING COALESCE(SUM(m.qty),0) <= i.low_stock ORDER BY i.category, i.name`],
    'purchases': ['Purchase report', `SELECT p.date, p.pur_no, COALESCE(s.name,p.supplier_name) supplier, g.name item, m.qty, g.unit, m.unit_cost rate, m.qty*m.unit_cost amount, p.bill_ref, CASE WHEN p.voided THEN 'VOID' ELSE '' END status
      FROM store_purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id JOIN gen_moves m ON m.ref_type='purchase' AND m.ref_id=p.id AND NOT m.is_reversal JOIN gen_items g ON g.id=m.item_id WHERE p.date BETWEEN $1 AND $2 ORDER BY p.date, p.id`, { amount: 'amount' }],
    'issues': ['Material issue report', `SELECT s.date, s.issue_no, o.order_no, pi.product, g.name item, l.qty, g.unit, l.unit_cost rate, l.qty*l.unit_cost cost, s.issued_by, s.received_by, CASE WHEN s.voided THEN 'VOID' ELSE '' END status
      FROM press_issues s JOIN press_issue_lines l ON l.issue_id=s.id JOIN gen_items g ON g.id=l.stock_item_id LEFT JOIN press_orders o ON o.id=s.order_id LEFT JOIN press_items pi ON pi.id=s.item_id WHERE s.date BETWEEN $1 AND $2 ORDER BY s.date, s.id`, { cost: 'cost' }],
    'returns': ['Material return report', `SELECT r.date, r.return_no, s.issue_no, o.order_no, g.name item, r.qty, g.unit, r.condition, r.reason, r.received_by
      FROM press_returns r JOIN press_issues s ON s.id=r.issue_id JOIN gen_items g ON g.id=r.stock_item_id LEFT JOIN press_orders o ON o.id=s.order_id WHERE r.date BETWEEN $1 AND $2 ORDER BY r.date, r.id`],
    'adjustments': ['Stock adjustments', `SELECT m.date, g.name item, g.unit, m.before_qty previous, m.after_qty new_qty, m.qty change, m.purpose reason, m.created_by_name by, m.created_at entered
      FROM gen_moves m JOIN gen_items g ON g.id=m.item_id WHERE m.type IN ('adj_in','adj_out') AND NOT m.is_reversal AND m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`],
    'movement': ['Item movement', `SELECT m.date, g.name item, m.type, m.qty, g.unit, m.ref_no ref, COALESCE(m.purpose, m.party) note, m.created_by_name by
      FROM gen_moves m JOIN gen_items g ON g.id=m.item_id WHERE m.date BETWEEN $1 AND $2 ORDER BY m.date, m.id`],
    'wastage': ['Wastage / loss', `SELECT m.date, g.name item, -m.qty qty, g.unit, m.purpose reason, m.created_by_name by FROM gen_moves m JOIN gen_items g ON g.id=m.item_id WHERE m.type='wastage' AND NOT m.is_reversal AND m.date BETWEEN $1 AND $2
      UNION ALL SELECT r.date, g.name, r.qty, g.unit, 'Damaged return: ' || COALESCE(r.reason,''), r.created_by_name FROM press_returns r JOIN gen_items g ON g.id=r.stock_item_id WHERE r.condition='damaged' AND r.date BETWEEN $1 AND $2 ORDER BY 1`],
    'invoice-register': ['Invoice register (final)', `SELECT i.date, i.inv_no, o.order_no, c.name customer, i.subtotal, i.discount, i.adjustment, i.grand_total total, ${paidSql('press')} paid, i.grand_total - ${paidSql('press')} due
      FROM press_invoices i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=i.customer_id WHERE i.status='final' AND i.date BETWEEN $1 AND $2 AND ($3='' OR i.customer_id=$3::int) ORDER BY i.date, i.id`, { total: 'total', paid: 'paid', due: 'due' }],
    'void-register': ['Cancelled / void invoice register', `SELECT i.voided_at::date void_date, i.inv_no, o.order_no, c.name customer, i.grand_total amount, i.void_category category, i.void_reason reason, i.voided_by_name voided_by, i.void_approved_by_name approved_by,
        COALESCE((SELECT SUM((x->>'amount')::numeric) FROM jsonb_array_elements(i.snapshot->'released_allocations') x),0) linked_payments
      FROM press_invoices i JOIN press_orders o ON o.id=i.order_id JOIN customers c ON c.id=i.customer_id WHERE i.status='void' AND i.voided_at::date BETWEEN $1 AND $2 ORDER BY i.voided_at`, { amount: 'amount' }],
    'payment-register': ['Payment register', `SELECT p.date, p.time, p.receipt_no, c.name customer, o.order_no, p.method, p.reference, p.amount, p.created_by_name received_by, CASE WHEN p.voided THEN 'VOID' ELSE '' END status
      FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN press_orders o ON o.id=p.order_id WHERE p.date BETWEEN $1 AND $2 AND ($3='' OR p.customer_id=$3::int) ORDER BY p.date, p.id`, { amount: 'amount' }],
    'refund-register': ['Refund register', `SELECT r.date, r.time, r.refund_no, c.name customer, o.order_no, r.method, r.amount, r.reason, r.created_by_name by, CASE WHEN r.voided THEN 'VOID' ELSE '' END status
      FROM refunds r JOIN customers c ON c.id=r.customer_id LEFT JOIN press_orders o ON o.id=r.order_id WHERE r.date BETWEEN $1 AND $2 AND ($3='' OR r.customer_id=$3::int) ORDER BY r.date, r.id`, { amount: 'amount' }],
    'income-expense': ['Income & expense', `SELECT to_char(d,'YYYY-MM') AS month,
        COALESCE((SELECT SUM(amount) FROM payments WHERE NOT voided AND date_trunc('month',date)=d AND date BETWEEN $1 AND $2),0) income,
        COALESCE((SELECT SUM(amount) FROM refunds WHERE NOT voided AND date_trunc('month',date)=d AND date BETWEEN $1 AND $2),0) refunds,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE NOT voided AND date_trunc('month',date)=d AND date BETWEEN $1 AND $2),0) expenses,
        COALESCE((SELECT SUM(amount) FROM payments WHERE NOT voided AND date_trunc('month',date)=d AND date BETWEEN $1 AND $2),0) - COALESCE((SELECT SUM(amount) FROM refunds WHERE NOT voided AND date_trunc('month',date)=d AND date BETWEEN $1 AND $2),0)
          - COALESCE((SELECT SUM(amount) FROM expenses WHERE NOT voided AND date_trunc('month',date)=d AND date BETWEEN $1 AND $2),0) net
      FROM generate_series(date_trunc('month',$1::date), date_trunc('month',$2::date), interval '1 month') d ORDER BY d`, { income: 'income', refunds: 'refunds', expenses: 'expenses', net: 'net' }],
    'expense-category': ['Expenses by category', `SELECT category, COUNT(*)::int entries, SUM(amount) amount FROM expenses WHERE NOT voided AND date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 3 DESC`, { amount: 'amount' }],
  };
  const COSTING_REPORTS = { 'cost-estimated': 'Order-wise estimated cost', 'cost-actual': 'Order-wise actual cost', 'profit-loss': 'Profit / loss by order', 'cost-monthly': 'Monthly cost analysis' };
  app.get('/api/press/reports', can('reports'), wrap(async (req, res) => res.json([...Object.entries(REPORTS).map(([k, v]) => ({ key: k, title: v[0] })), ...Object.entries(COSTING_REPORTS).map(([k, t]) => ({ key: k, title: t }))])));
  app.get('/api/press/reports/:key', can('reports'), wrap(async (req, res) => {
    const { from = today().slice(0, 8) + '01', to = today(), customer = '' } = req.query, key = req.params.key;
    if (REPORTS[key]) {
      const [title, sql, totals] = REPORTS[key];
      const rows = await q(sql, sql.includes('$4') ? [from, to, String(customer), today()] : sql.includes('$3') ? [from, to, String(customer)] : sql.includes('$1') ? [from, to] : []);
      return res.json({ title, rows, totals: totals || {} });
    }
    if (!COSTING_REPORTS[key]) bad('Unknown report', 404);
    if (!perm(req.user, 'press.costing')) bad('Job costing reports need the job costing permission', 403);
    const orders = await q(`SELECT o.id, o.order_no, o.date, c.name customer FROM press_orders o JOIN customers c ON c.id=o.customer_id WHERE o.status<>'cancelled' AND o.date BETWEEN $1 AND $2 AND ($3='' OR o.customer_id=$3::int) ORDER BY o.date, o.id`, [from, to, String(customer)]);
    const rows = await tx(async c => { const out = []; for (const o of orders) out.push({ ...o, ...(await costing(c, o.id)) }); return out; });
    if (key === 'cost-monthly') {
      const m = {};
      for (const r of rows) { const k = r.date.slice(0, 7); m[k] = m[k] || { month: k, orders: 0, selling: 0, est_cost: 0, actual_cost: 0 }; m[k].orders++; m[k].selling += r.selling; m[k].est_cost += r.est_total; m[k].actual_cost += r.actual_total; }
      return res.json({ title: COSTING_REPORTS[key], rows: Object.values(m).map(x => ({ ...x, selling: r2(x.selling), est_cost: r2(x.est_cost), actual_cost: r2(x.actual_cost), profit: r2(x.selling - x.actual_cost) })), totals: { selling: 'selling', actual_cost: 'actual_cost', profit: 'profit' } });
    }
    const flat = rows.map(r => key === 'profit-loss'
      ? { date: r.date, order_no: r.order_no, customer: r.customer, selling_price: r.selling, estimated_cost: r.est_total, actual_cost: r.actual_total, estimated_profit: r.est_profit, actual_profit: r.actual_profit }
      : { date: r.date, order_no: r.order_no, customer: r.customer, ...Object.fromEntries(Object.keys(COST_CATS).map(k => [k, (key === 'cost-estimated' ? r.est : r.actual)[k]])), total: key === 'cost-estimated' ? r.est_total : r.actual_total });
    res.json({ title: COSTING_REPORTS[key], rows: flat, totals: key === 'profit-loss' ? { selling_price: 'selling_price', actual_cost: 'actual_cost', actual_profit: 'actual_profit' } : { total: 'total' } });
  }));

  h.pressSettings = pressSettings;
  return { DEFAULT_PRESS, COST_CATS };
};

module.exports.DEFAULT_PRESS = DEFAULT_PRESS;
module.exports.SCHEMA = `
ALTER TABLE gen_items DROP CONSTRAINT IF EXISTS gen_items_kind_check;
ALTER TABLE gen_items ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE gen_items ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE gen_items ADD COLUMN IF NOT EXISTS rack TEXT;
ALTER TABLE gen_items ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(14,4) DEFAULT 0;
UPDATE gen_items SET category = CASE kind WHEN 'lamination' THEN 'Lamination Film' WHEN 'paper' THEN 'Paper' ELSE 'Consumables' END WHERE category IS NULL;
UPDATE gen_items SET code = 'ITM-' || lpad(id::text, 4, '0') WHERE code IS NULL;
ALTER TABLE gen_moves DROP CONSTRAINT IF EXISTS gen_moves_type_check;
ALTER TABLE gen_moves ADD CONSTRAINT gen_moves_type_check CHECK (type IN ('opening','stock_in','purchase','use','job','issue','return','wastage','adj_in','adj_out'));
ALTER TABLE gen_moves ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,4);
ALTER TABLE gen_moves ADD COLUMN IF NOT EXISTS before_qty NUMERIC(14,3);
ALTER TABLE gen_moves ADD COLUMN IF NOT EXISTS after_qty NUMERIC(14,3);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS order_id INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS time TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT;
CREATE INDEX IF NOT EXISTS ix_pay_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS machines(id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT, specs TEXT, status TEXT DEFAULT 'Active', maintenance TEXT, last_service DATE, next_service DATE, remarks TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS suppliers(id SERIAL PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT, phone TEXT, address TEXT, supplies TEXT, remarks TEXT, active BOOLEAN DEFAULT true, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_orders(id SERIAL PRIMARY KEY, order_no TEXT UNIQUE, date DATE NOT NULL, customer_id INT NOT NULL REFERENCES customers(id), order_type TEXT, officer_id INT, officer_name TEXT,
  deadline DATE, instructions TEXT, remarks TEXT, status TEXT NOT NULL DEFAULT 'pending', total NUMERIC(14,2) DEFAULT 0, quick BOOLEAN DEFAULT false,
  cancelled_at TIMESTAMPTZ, cancelled_by_name TEXT, cancel_reason TEXT, created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ, updated_by_name TEXT);
CREATE INDEX IF NOT EXISTS ix_po_date ON press_orders(date, status);
CREATE TABLE IF NOT EXISTS press_items(id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES press_orders(id) ON DELETE CASCADE, sl INT, product TEXT NOT NULL, template TEXT, description TEXT,
  qty NUMERIC(14,2) NOT NULL, unit TEXT DEFAULT 'pcs', size TEXT, paper TEXT, gsm TEXT, colour TEXT, sides TEXT, finishing TEXT, unit_price NUMERIC(14,4) DEFAULT 0, total NUMERIC(14,2) DEFAULT 0,
  machine_id INT REFERENCES machines(id), plate_info TEXT, ins_printing TEXT, ins_lamination TEXT, ins_cutting TEXT, ins_binding TEXT, ins_diecut TEXT, ins_other TEXT, notes TEXT,
  design_required BOOLEAN DEFAULT true, design_source TEXT DEFAULT 'inhouse', design_status TEXT DEFAULT 'Pending', design_approved_at TIMESTAMPTZ, design_approved_by TEXT, design_revisions JSONB DEFAULT '[]', designer TEXT,
  prod_status TEXT DEFAULT 'Pending', planned_start DATE, est_completion DATE, actual_start DATE, actual_completion DATE, assigned_staff TEXT, prod_notes TEXT, steps JSONB DEFAULT '[]',
  good_qty NUMERIC(14,2), waste_qty NUMERIC(14,2), est_cost JSONB DEFAULT '{}', cancelled BOOLEAN DEFAULT false);
CREATE INDEX IF NOT EXISTS ix_pi_order ON press_items(order_id);
CREATE TABLE IF NOT EXISTS press_design_files(id SERIAL PRIMARY KEY, item_id INT NOT NULL REFERENCES press_items(id) ON DELETE CASCADE, filename TEXT, mime TEXT, size INT, data BYTEA, uploaded_by_name TEXT, uploaded_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_activity(id SERIAL PRIMARY KEY, order_id INT, item_id INT, kind TEXT, text TEXT, by_name TEXT, at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_pact ON press_activity(order_id);
CREATE TABLE IF NOT EXISTS store_purchases(id SERIAL PRIMARY KEY, pur_no TEXT UNIQUE, date DATE NOT NULL, supplier_id INT REFERENCES suppliers(id), supplier_name TEXT, bill_ref TEXT, remarks TEXT,
  total NUMERIC(14,2) DEFAULT 0, paid_expense_id INT, voided BOOLEAN DEFAULT false, void_reason TEXT, created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_issues(id SERIAL PRIMARY KEY, issue_no TEXT UNIQUE, date DATE NOT NULL, order_id INT REFERENCES press_orders(id), item_id INT REFERENCES press_items(id), issued_by TEXT, received_by TEXT,
  remarks TEXT, total_cost NUMERIC(14,2) DEFAULT 0, voided BOOLEAN DEFAULT false, void_reason TEXT, created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_issue_lines(id SERIAL PRIMARY KEY, issue_id INT NOT NULL REFERENCES press_issues(id) ON DELETE CASCADE, stock_item_id INT NOT NULL REFERENCES gen_items(id), qty NUMERIC(14,3) NOT NULL, unit TEXT, unit_cost NUMERIC(14,4) DEFAULT 0, move_id INT);
CREATE TABLE IF NOT EXISTS press_returns(id SERIAL PRIMARY KEY, return_no TEXT UNIQUE, date DATE NOT NULL, issue_id INT NOT NULL REFERENCES press_issues(id), line_id INT NOT NULL REFERENCES press_issue_lines(id), stock_item_id INT,
  qty NUMERIC(14,3) NOT NULL, condition TEXT NOT NULL, reason TEXT, received_by TEXT, remarks TEXT, move_id INT, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_cust_materials(id SERIAL PRIMARY KEY, order_id INT REFERENCES press_orders(id), customer_id INT REFERENCES customers(id), received_date DATE NOT NULL, description TEXT NOT NULL,
  received_qty NUMERIC(14,2) NOT NULL, unit TEXT, received_by TEXT, remarks TEXT, processed_qty NUMERIC(14,2), good_qty NUMERIC(14,2), returned_qty NUMERIC(14,2), waste_qty NUMERIC(14,2), return_date DATE,
  receiver_name TEXT, receiver_signed BOOLEAN DEFAULT false, diff_reason TEXT, status TEXT DEFAULT 'received', created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_outsourcing(id SERIAL PRIMARY KEY, order_id INT REFERENCES press_orders(id), item_id INT REFERENCES press_items(id), supplier_id INT REFERENCES suppliers(id), work TEXT NOT NULL,
  qty NUMERIC(14,2), cost NUMERIC(14,2) DEFAULT 0, sent_date DATE, delivery_date DATE, received BOOLEAN DEFAULT false, paid NUMERIC(14,2) DEFAULT 0, remarks TEXT, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_costs(id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES press_orders(id), item_id INT REFERENCES press_items(id), date DATE NOT NULL, category TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL,
  note TEXT, voided BOOLEAN DEFAULT false, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_challans(id SERIAL PRIMARY KEY, dc_no TEXT UNIQUE, date DATE NOT NULL, order_id INT NOT NULL REFERENCES press_orders(id), customer_id INT NOT NULL REFERENCES customers(id),
  receiver TEXT, carried_by TEXT, prepared_by TEXT, prepared_nick TEXT, remarks TEXT, status TEXT DEFAULT 'active', cancel_reason TEXT, cancelled_by_name TEXT,
  created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS press_challan_items(id SERIAL PRIMARY KEY, challan_id INT NOT NULL REFERENCES press_challans(id) ON DELETE CASCADE, item_id INT NOT NULL REFERENCES press_items(id), qty NUMERIC(14,2) NOT NULL);
CREATE TABLE IF NOT EXISTS press_invoices(id SERIAL PRIMARY KEY, inv_no TEXT UNIQUE, date DATE NOT NULL, order_id INT NOT NULL REFERENCES press_orders(id), customer_id INT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('final','void')), subtotal NUMERIC(14,2) DEFAULT 0, discount NUMERIC(14,2) DEFAULT 0, adjustment NUMERIC(14,2) DEFAULT 0, adjustment_note TEXT,
  grand_total NUMERIC(14,2) DEFAULT 0, closed_early BOOLEAN DEFAULT false, close_reason TEXT, remarks TEXT, created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now(),
  void_requested_by INT, void_requested_name TEXT, void_requested_at TIMESTAMPTZ, void_req_reason TEXT, void_req_category TEXT,
  voided_at TIMESTAMPTZ, voided_by INT, voided_by_name TEXT, void_reason TEXT, void_category TEXT, void_approved_by_name TEXT, snapshot JSONB);
CREATE UNIQUE INDEX IF NOT EXISTS ux_press_inv_order ON press_invoices(order_id) WHERE status='final';
CREATE TABLE IF NOT EXISTS press_invoice_items(id SERIAL PRIMARY KEY, invoice_id INT NOT NULL REFERENCES press_invoices(id) ON DELETE CASCADE, item_id INT REFERENCES press_items(id), product TEXT, description TEXT,
  qty NUMERIC(14,2), unit TEXT, unit_price NUMERIC(14,4), total NUMERIC(14,2));
CREATE TABLE IF NOT EXISTS refunds(id SERIAL PRIMARY KEY, refund_no TEXT UNIQUE, date DATE NOT NULL, time TEXT, customer_id INT NOT NULL REFERENCES customers(id), amount NUMERIC(14,2) NOT NULL, method TEXT, reference TEXT,
  reason TEXT NOT NULL, order_id INT, related TEXT, voided BOOLEAN DEFAULT false, void_reason TEXT, created_by INT, created_by_name TEXT, created_role TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_refund_c ON refunds(customer_id);
`;
module.exports.TABLES = ['machines', 'suppliers', 'press_orders', 'press_items', 'press_design_files', 'press_activity', 'store_purchases', 'press_issues', 'press_issue_lines', 'press_returns',
  'press_cust_materials', 'press_outsourcing', 'press_costs', 'press_challans', 'press_challan_items', 'press_invoices', 'press_invoice_items'];
module.exports.SEQUENCES = [['press_order', 'ORD-'], ['press_dc', 'PRS-DC-'], ['press_inv', 'PRS-INV-'], ['issue', 'ISS-'], ['mreturn', 'RET-'], ['purchase', 'PUR-'], ['refund', 'RF-']];
module.exports.PERMS = {
  'press.view': 'Press: view orders, production & store', 'press.orders': 'Press: create customers / orders / order sheet', 'press.orders.all': 'Press: see every officer\'s orders',
  'press.design': 'Press: design management', 'press.production': 'Press: production update & calendar', 'press.store': 'Store: purchase, issue, return, stock',
  'press.delivery': 'Press: delivery challan', 'press.invoice': 'Press: final invoice', 'press.invoice.void': 'Press: void invoice / close order early',
  'press.costing': 'Press: job costing & profit', 'press.machines': 'Machines', 'press.suppliers': 'Suppliers & outsourcing', 'press.settings': 'Press settings (templates, paper sizes)',
  'refunds': 'Refund customer money',
};
