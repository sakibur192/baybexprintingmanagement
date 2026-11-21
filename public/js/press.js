/* PRINTING PRESS — orders, order sheet, design, production, store, issue/return, delivery (A5), final invoice (A4), costing */
'use strict';
let PS = null;   // press settings (templates, paper sizes…)
async function pressSet(force) { if (!PS || force) PS = await GET('/api/press/settings'); return PS; }
const qn = n => nf0.format(Math.round((+n || 0) * 1000) / 1000);
const OSTAT = { pending: ['Pending', 'gray'], in_production: ['In production', ''], ready: ['Ready', 'teal'], partial_delivery: ['Partly delivered', 'orange'], delivered: ['Delivered', 'green'], invoiced: ['Invoiced', 'green'], cancelled: ['Cancelled', 'red'] };
const oTag = s => `<span class="tag ${(OSTAT[s] || [0, 'gray'])[1]}">${(OSTAT[s] || [s])[0]}</span>`;
const PCOL = { Pending: 'gray', Assigned: 'teal', 'In Progress': '', Completed: 'green', 'On Hold': 'orange', Cancelled: 'red' };
const pTag = s => `<span class="tag ${PCOL[s] ?? 'gray'}">${esc(s)}</span>`;
const DCOL = { Pending: 'gray', 'In Progress': '', 'Approval Pending': 'orange', Approved: 'green', 'Revision Required': 'red' };
const dTag = (s, req = true) => req ? `<span class="tag ${DCOL[s] ?? 'gray'}">${esc(s)}</span>` : '<span class="tag gray">Not needed</span>';
const sideTabs = (tabs, cur, base) => `<div class="tabs">${tabs.map(([k, l, n]) => `<button data-t="${k}" class="${k === cur ? 'on' : ''}" onclick="App.go('${base}/${k}')">${l}${n ? ` <span class="tag gray" style="padding:0 6px">${n}</span>` : ''}</button>`).join('')}</div>`;
const progress = (a, b) => `<div class="bar" style="--c:var(--ok);margin-top:4px"><i style="width:${b ? Math.min(100, a / b * 100) : 0}%"></i></div>`;

/* ======================= PRINT TEMPLATES ======================= */
function orderSheetDoc(o) {
  const row = (k, v) => v ? `<tr><th style="width:30%;text-align:left">${k}</th><td>${esc(v)}</td></tr>` : '';
  return `<div class="doc">${companyHeader(`<div style="text-align:right"><div class="doc-title">ORDER SHEET</div><div style="font-size:20px;font-weight:800;margin-top:8px">${esc(o.order_no)}</div><div class="muted">Production instruction</div></div>`)}
    <div class="meta"><div><b>Order date:</b> ${fdate(o.date)}</div><div><b>Delivery deadline:</b> ${fdate(o.deadline) || '—'}</div>
      <div><b>Customer:</b> ${esc(o.customer.name)}${o.customer.company ? ' — ' + esc(o.customer.company) : ''}</div><div><b>Phone:</b> ${esc(o.customer.phone || '')}</div>
      <div><b>Order type:</b> ${esc(o.order_type || '')}</div><div><b>Marketing officer:</b> ${esc(o.officer_name || '')}</div></div>
    ${o.instructions ? `<div class="fine" style="margin:6px 0"><b>Special instructions:</b> ${esc(o.instructions)}</div>` : ''}
    ${o.items.filter(i => !i.cancelled).map((i, k) => `<div style="page-break-inside:avoid;margin-top:10px"><div style="background:#f0f4f8;padding:6px 10px;font-weight:800;border:1px solid #cfd8e3;border-bottom:0">${k + 1}. ${esc(i.product)} — ${qn(i.qty)} ${esc(i.unit || 'pcs')}${i.template ? ` <span class="muted" style="font-weight:600">(${esc(i.template)})</span>` : ''}</div>
      <table style="margin:0"><tbody>${row('Description', i.description)}${row('Size', i.size)}${row('Paper / board', i.paper)}${row('GSM', i.gsm)}${row('Printing colour', i.colour)}${row('One side / two side', i.sides)}
        ${row('Printing machine', i.machine)}${row('Plate information', i.plate_info)}${row('Printing instructions', i.ins_printing)}${row('Lamination', i.ins_lamination)}${row('Cutting', i.ins_cutting)}
        ${row('Binding', i.ins_binding)}${row('Die cutting', i.ins_diecut)}${row('Other finishing', [i.finishing, i.ins_other].filter(Boolean).join(' · '))}${row('Special notes', i.notes)}
        ${row('Design', i.design_required ? `${i.design_status}${i.design_approved_by ? ' — approved by ' + i.design_approved_by : ''}` : 'Not needed (customer material)')}
        ${row('Production steps', (i.steps || []).map(s => s.name).join(' → '))}</tbody></table></div>`).join('')}
    <div class="sign"><div>Prepared by<br><span class="muted">${esc(o.created_by_name || '')}</span></div><div>Production in-charge</div><div>Store (materials)</div></div></div>`;
}
function issueSlipDoc(s) {
  return `<div class="doc">${companyHeader(`<div style="text-align:right"><div class="doc-title">MATERIAL ISSUE SLIP</div><div style="font-size:18px;font-weight:800;margin-top:8px">${esc(s.issue_no)}</div></div>`)}
    <div class="meta"><div><b>Issue date:</b> ${fdate(s.date)}</div><div><b>Order ID:</b> ${esc(s.order_no || '—')}</div><div><b>Product:</b> ${esc(s.product || '—')}</div><div><b>Customer:</b> ${esc(s.customer || '')}</div></div>
    <table><thead><tr><th>SL</th><th>Item</th><th class="n">Quantity</th><th>Unit</th><th class="n">Returned</th></tr></thead><tbody>
      ${s.lines.map((l, k) => `<tr><td>${k + 1}</td><td><b>${esc(l.item)}</b> <span class="muted">${esc(l.code || '')}</span></td><td class="n">${qn(l.qty)}</td><td>${esc(l.unit)}</td><td class="n">${+l.returned ? qn(l.returned) : ''}</td></tr>`).join('')}</tbody></table>
    ${s.remarks ? `<div class="fine"><b>Remarks:</b> ${esc(s.remarks)}</div>` : ''}${s.voided ? `<div class="watermark">VOID</div>` : ''}
    <div class="sign"><div>Issued by<br><span class="muted">${esc(s.issued_by || '')}</span></div><div>Received by<br><span class="muted">${esc(s.received_by || '')}</span></div><div>Store in-charge</div></div></div>`;
}
function pressChallanDoc(ch) {
  const c = App.meta.settings.company || {};
  return `<div class="doc" style="position:relative">${ch.status === 'cancelled' ? '<div class="watermark">CANCELLED</div>' : ''}
    ${companyHeader(`<div style="text-align:right"><div class="doc-title">${esc(c.challan_title || 'DELIVERY CHALLAN')}</div><div style="font-size:18px;font-weight:800;margin-top:8px">${esc(ch.dc_no)}</div></div>`)}
    <div class="meta"><div><b>Challan date:</b> ${fdate(ch.date)}</div><div><b>Order ID:</b> ${esc(ch.order_no)}</div><div><b>Customer:</b> ${esc(ch.customer)}</div><div><b>Phone:</b> ${esc(ch.phone || '')}</div>
      ${ch.address ? `<div style="grid-column:1/-1"><b>Address:</b> ${esc(ch.address)}</div>` : ''}</div>
    <table><thead><tr><th>SL</th><th>Product</th><th class="n">Ordered</th><th class="n">Previously delivered</th><th class="n">This delivery</th><th class="n">Total delivered</th><th class="n">Balance</th></tr></thead><tbody>
      ${ch.items.map((i, k) => `<tr><td>${k + 1}</td><td><b>${esc(i.product)}</b>${i.size ? `<div class="muted">${esc(i.size)}</div>` : ''}</td><td class="n">${qn(i.ordered)}</td><td class="n">${qn(i.previous)}</td><td class="n"><b>${qn(i.current)}</b></td><td class="n">${qn(i.total_delivered)}</td><td class="n">${qn(i.remaining)}</td></tr>`).join('')}</tbody></table>
    ${ch.remarks ? `<div class="fine"><b>Remarks:</b> ${esc(ch.remarks)}</div>` : ''}
    <div class="meta" style="margin-top:6px"><div><b>Carried by:</b> ${esc(ch.carried_by || '')}</div><div><b>Prepared by:</b> ${esc(ch.prepared_by || ch.created_by_name || '')}${ch.prepared_nick ? ` (${esc(ch.prepared_nick)})` : ''}</div></div>
    <div class="sign"><div>Receiver's name & signature<br><span class="muted">${esc(ch.receiver || '')}</span></div><div>Authorized signature</div></div></div>`;
}
function pressInvoiceDoc(inv) {
  const c = App.meta.settings.company || {};
  return `<div class="doc" style="position:relative">${inv.status === 'void' ? '<div class="watermark">VOID</div>' : ''}
    ${companyHeader(`<div style="text-align:right"><div class="doc-title">${esc(c.press_invoice_title || 'INVOICE')}</div><div style="font-size:20px;font-weight:800;margin-top:8px">${esc(inv.inv_no)}</div></div>`)}
    <div class="meta"><div><b>Invoice date:</b> ${fdate(inv.date)}</div><div><b>Order ID:</b> ${esc(inv.order_no)} <span class="muted">(${fdate(inv.order_date)})</span></div>
      <div><b>Customer:</b> ${esc(inv.customer)}${inv.company ? ' — ' + esc(inv.company) : ''}</div><div><b>Phone:</b> ${esc(inv.phone || '')}</div>${inv.address ? `<div style="grid-column:1/-1"><b>Address:</b> ${esc(inv.address)}</div>` : ''}</div>
    <table><thead><tr><th>SL</th><th>Product description</th><th class="n">Quantity</th><th class="n">Unit price</th><th class="n">Total</th></tr></thead><tbody>
      ${inv.items.map((i, k) => `<tr><td>${k + 1}</td><td><b>${esc(i.product)}</b>${i.description ? `<div class="muted">${esc(i.description)}</div>` : ''}</td><td class="n">${qn(i.qty)} ${esc(i.unit || '')}</td><td class="n">${nf2.format(i.unit_price)}</td><td class="n">${nf2.format(i.total)}</td></tr>`).join('')}</tbody></table>
    <div class="row" style="align-items:flex-start;margin-top:10px">
      <div style="flex:1;font-size:12px"><div><b>In word:</b> ${inWords(inv.grand_total)}</div>${inv.adjustment_note ? `<div><b>Adjustment:</b> ${esc(inv.adjustment_note)}</div>` : ''}${inv.closed_early ? `<div><b>Order closed before full delivery:</b> ${esc(inv.close_reason || '')}</div>` : ''}${inv.remarks ? `<div><b>Remarks:</b> ${esc(inv.remarks)}</div>` : ''}</div>
      <div class="sum"><div><span>Total amount</span><span>${nf2.format(inv.subtotal)}</span></div>${+inv.discount ? `<div><span>Discount</span><span>− ${nf2.format(inv.discount)}</span></div>` : ''}${+inv.adjustment ? `<div><span>Adjustment</span><span>${inv.adjustment > 0 ? '+' : '−'} ${nf2.format(Math.abs(inv.adjustment))}</span></div>` : ''}
        <div class="k"><span>FINAL TOTAL</span><span>${nf2.format(inv.grand_total)}</span></div><div><span>Previous payments</span><span>${nf2.format(inv.previous_payments)}</span></div><div><span>Current payment</span><span>${nf2.format(inv.current_payment)}</span></div><div class="k"><span>BALANCE DUE</span><span>${nf2.format(inv.due)}</span></div></div></div>
    <div class="fine">N.B: ${esc(c.invoice_note || '')}</div>
    <div class="sign"><div>Customer's signature</div><div style="text-align:center">${c.seal ? `<img src="${esc(c.seal)}" style="height:60px;opacity:.85"><br>` : '<div style="height:40px"></div>'}Company seal</div><div>Authorized signature<br><span class="muted">${esc(inv.created_by_name || '')}</span></div></div></div>`;
}

/* ======================= ORDERS ======================= */
App.pages['press-orders'] = {
  title: 'Orders', f: null,
  async render(v, a, b) {
    if (a === 'new') return this.form(v, null);
    if (a === 'counter') return this.counter(v);
    if (a && b === 'edit') return this.form(v, +a);
    if (a && /^\d+$/.test(a)) return this.detail(v, +a, b);
    const f = this.f = this.f || { from: monthStart(App.today).slice(0, 5) + '01-01', to: App.today, status: '', q: '', overdue: '' };
    const rows = await GET('/api/press/orders', f);
    const cnt = k => rows.filter(r => r.status === k).length;
    v.innerHTML = `<div class="head"><div class="row" style="flex-wrap:wrap;gap:6px">
        <input type="date" class="inp" id="of" value="${f.from}" style="width:150px"><input type="date" class="inp" id="ot" value="${f.to}" style="width:150px"><button class="btn sm" id="ogo">Apply</button>
        <label class="check" style="margin-left:8px"><input type="checkbox" id="ovd" ${f.overdue ? 'checked' : ''}> Overdue only</label></div>
        <div class="row">${can('press.orders') && can('press.invoice') && can('press.delivery') ? `<button class="btn ghost" onclick="App.go('press-orders/counter')">${ICON.money} Counter job</button>` : ''}${can('press.orders') ? `<button class="btn" onclick="App.go('press-orders/new')">${ICON.plus} New order</button>` : ''}</div></div>
      <div class="seg mb" id="ost">${[['', 'All', rows.length], ...Object.entries(OSTAT).map(([k, [l]]) => [k, l, cnt(k)])].map(([k, l, n]) => `<button type="button" data-s="${k}" class="${k === f.status ? 'on' : ''}">${l} ${n ? `<b>${n}</b>` : ''}</button>`).join('')}</div>
      <div class="panel"><div id="otbl"></div></div>`;
    const shown = f.status ? rows.filter(r => r.status === f.status) : rows;
    dataTable($('#otbl', v), shown.map(r => ({ ...r, _cls: r.status === 'cancelled' ? 'void' : '' })), [
      { k: 'order_no', label: 'Order', f: r => `<b>${esc(r.order_no)}</b>${r.quick ? ' <span class="tag gray">counter</span>' : ''}<div class="sub">${fdate(r.date)}</div>` },
      { k: 'customer', label: 'Customer', f: r => `${esc(r.customer)}<div class="sub">${esc(r.phone || '')}</div>` },
      { k: 'products', label: 'Products', f: r => `<span class="small">${esc(r.products || '')}</span>` },
      { k: 'deadline', label: 'Deadline', f: r => r.deadline ? `${fdate(r.deadline)}${r.overdue ? ' <span class="tag red">Overdue</span>' : ''}` : '—' },
      { k: 'qty_delivered', label: 'Delivered', f: r => `<span class="small">${qn(r.qty_delivered)} / ${qn(r.qty_total)}</span>${progress(+r.qty_delivered, +r.qty_total)}` },
      { k: 'total', label: 'Value', n: 1, f: r => tk(r.total), total: d => tk(d.filter(r => r.status !== 'cancelled').reduce((s, r) => s + +r.total, 0)) },
      { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid) },
      { k: 'status', label: 'Status', f: r => oTag(r.status) + (r.inv_no ? `<div class="sub">${esc(r.inv_no)}</div>` : '') },
      { k: 'officer_name', label: 'Officer', f: r => `<span class="sub">${esc(r.officer_name || '')}</span>` },
    ], { onRow: r => App.go('press-orders/' + r.id), totals: true, empty: 'No orders in this period', id: 'po' });
    $$('#ost button', v).forEach(x => x.onclick = () => { f.status = x.dataset.s; App.refresh(); });
    $('#ogo', v).onclick = () => { Object.assign(f, { from: $('#of', v).value, to: $('#ot', v).value }); App.refresh(); };
    $('#ovd', v).onchange = e => { f.overdue = e.target.checked ? '1' : ''; App.refresh(); };
  },

  /* ---------- create / edit order ---------- */
  async form(v, id) {
    const [ps, machines, o] = await Promise.all([pressSet(true), GET('/api/press/machines'), id ? GET('/api/press/orders/' + id) : null]);
    let cust = o ? o.customer : (this.prefill?.customer || null); this.prefill = null;
    const items = o ? o.items.filter(i => !i.cancelled).map(i => ({ ...i })) : [{ product: '', template: ps.templates[0].name, qty: '', unit: 'pcs', unit_price: '', design_required: true, design_source: 'inhouse', est_cost: {} }];
    const officers = App.meta.users;
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="history.back()">← Back</button><div class="sub">${o ? 'Editing ' + esc(o.order_no) : 'Stock does not change when an order is created — only Material Issue takes stock out'}</div></div>
      <div class="panel"><div class="form f4" id="oh">
        <div class="field span2">Customer <span class="req">*</span><div id="ocp"></div></div>${field('Order date', dateInput('date', o?.date))}${field('Delivery deadline', `<input type="date" name="deadline" value="${o?.deadline || ''}">`)}
        ${field('Order type', `<select name="order_type">${ps.order_types.map(t => opt(t, t, o?.order_type)).join('')}</select>`)}
        ${field('Marketing officer', `<select name="officer_id">${officers.map(u => opt(u.id, u.full_name, o ? o.officer_id : App.user.id)).join('')}</select>`)}
        ${field('Special instructions', `<input name="instructions" value="${esc(o?.instructions || '')}">`, 'span2')}
        ${o ? '' : field('Advance received (৳)', `<input type="number" min="0" step="0.01" name="adv" value="0">`)}${o ? '' : field('Advance method', `<select name="adv_method">${App.meta.payment_methods.map(m => opt(m, m)).join('')}</select>`)}
        ${field('Remarks', `<input name="remarks" value="${esc(o?.remarks || '')}">`, o ? 'span2' : 'span2')}</div></div>
      <div class="panel"><div class="head"><div><h2>Products in this order</h2><div class="sub">Each product has its own design, production, delivery and cost</div></div><button class="btn sm ghost" id="oadd">${ICON.plus} Add product</button></div><div id="oitems"></div>
        <div class="row mt" style="justify-content:flex-end"><div style="min-width:240px;border:1px solid var(--line);border-radius:12px;padding:10px 14px"><div class="row" style="justify-content:space-between;font-size:20px;font-weight:800"><span>Order total</span><span id="otot">৳ 0</span></div></div></div>
        <div class="actions"><button class="btn" id="osave">${ICON.check} ${o ? 'Save changes' : 'Create order'}</button></div></div>`;
    custPicker($('#ocp', v), { value: cust, onPick: c => (cust = c) });
    const COST = ps.cost_cats;
    const draw = () => {
      $('#oitems', v).innerHTML = items.map((it, i) => `<details class="kpi" style="margin-bottom:10px" ${i === items.length - 1 || !it.product ? 'open' : ''} data-i="${i}"><summary style="cursor:pointer;font-weight:700;display:flex;justify-content:space-between;gap:10px">
          <span>${i + 1}. ${esc(it.product || 'New product')} ${it.qty ? `× ${qn(it.qty)}` : ''}</span><span class="row" style="gap:8px"><b data-lt>${tk((+it.qty || 0) * (+it.unit_price || 0))}</b>${items.length > 1 ? `<button type="button" class="btn xs ghost" data-rm="${i}" style="color:var(--danger)">✕</button>` : ''}</span></summary>
        <div class="form f4 mt">
          ${field('Product name <span class="req">*</span>', `<input data-k="product" value="${esc(it.product || '')}" placeholder="e.g. Leaflet, Diary, Medicine box">`)}
          ${field('Product type (steps)', `<select data-k="template">${ps.templates.map(t => opt(t.name, t.name, it.template)).join('')}</select>`)}
          ${field('Quantity <span class="req">*</span>', `<input type="number" min="0" step="any" data-k="qty" value="${esc(it.qty ?? '')}">`)}${field('Unit', `<input data-k="unit" value="${esc(it.unit || 'pcs')}">`)}
          ${field('Size', `<input data-k="size" value="${esc(it.size || '')}" placeholder="A4 / 8.5×11 in">`)}${field('Paper / board', `<input data-k="paper" value="${esc(it.paper || '')}" placeholder="Offset, Art card…">`)}
          ${field('GSM', `<input data-k="gsm" value="${esc(it.gsm || '')}">`)}${field('Printing colour', `<input data-k="colour" value="${esc(it.colour || '')}" placeholder="4 colour / 1 colour">`)}
          ${field('Side', `<select data-k="sides">${['', 'One side', 'Two side'].map(x => opt(x, x || '—', it.sides)).join('')}</select>`)}${field('Unit price (৳)', `<input type="number" min="0" step="any" data-k="unit_price" value="${esc(it.unit_price ?? '')}">`)}
          ${field('Machine', `<select data-k="machine_id"><option value="">—</option>${machines.filter(m => m.active || m.id === it.machine_id).map(m => opt(m.id, m.name, it.machine_id)).join('')}</select>`)}
          ${field('Finishing', `<input data-k="finishing" value="${esc(it.finishing || '')}" placeholder="Lamination, die cut, binding…">`)}
          ${field('Description', `<input data-k="description" value="${esc(it.description || '')}">`, 'span2')}
          ${field('Design', `<select data-k="design_mode"><option value="inhouse" ${it.design_required !== false && it.design_source !== 'customer' ? 'selected' : ''}>Our designer makes it</option><option value="customer" ${it.design_required !== false && it.design_source === 'customer' ? 'selected' : ''}>Customer gives design (needs approval)</option><option value="none" ${it.design_required === false ? 'selected' : ''}>No design (service / customer material)</option></select>`, 'span2')}
          ${field('Planned start', `<input type="date" data-k="planned_start" value="${it.planned_start || ''}">`)}${field('Estimated completion', `<input type="date" data-k="est_completion" value="${it.est_completion || ''}">`)}
        </div>
        <details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:700">Order sheet instructions</summary><div class="form f2 mt">
          ${[['plate_info', 'Plate information'], ['ins_printing', 'Printing instructions'], ['ins_lamination', 'Lamination instructions'], ['ins_cutting', 'Cutting instructions'], ['ins_binding', 'Binding instructions'], ['ins_diecut', 'Die cutting instructions'], ['ins_other', 'Other finishing'], ['notes', 'Special notes']].map(([k, l]) => field(l, `<input data-k="${k}" value="${esc(it[k] || '')}">`)).join('')}</div></details>
        ${can('press.costing') || !id ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:700">Estimated cost (job costing)</summary><div class="form f4 mt">
          ${Object.entries(COST).map(([k, l]) => field(l, `<input type="number" min="0" step="any" data-c="${k}" value="${(it.est_cost || {})[k] || ''}">`)).join('')}</div></details>` : ''}
      </details>`).join('');
      tot();
    };
    const tot = () => { $('#otot', v).textContent = tk(items.reduce((s, it) => s + (+it.qty || 0) * (+it.unit_price || 0), 0)); };
    $('#oitems', v).addEventListener('input', e => {
      const box = e.target.closest('[data-i]'); if (!box) return; const it = items[+box.dataset.i];
      if (e.target.dataset.k) {
        const k = e.target.dataset.k;
        if (k === 'design_mode') { it.design_required = e.target.value !== 'none'; it.design_source = e.target.value === 'customer' ? 'customer' : 'inhouse'; }
        else it[k] = e.target.value;
        if (k === 'qty' || k === 'unit_price') { $('[data-lt]', box).textContent = tk((+it.qty || 0) * (+it.unit_price || 0)); tot(); }
        if (k === 'product') $('summary span', box).firstChild.textContent = `${+box.dataset.i + 1}. ${it.product || 'New product'} `;
      }
      if (e.target.dataset.c) { it.est_cost = { ...(it.est_cost || {}), [e.target.dataset.c]: e.target.value }; }
    });
    $('#oitems', v).addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { e.preventDefault(); items.splice(+b.dataset.rm, 1); draw(); } });
    $('#oadd', v).onclick = () => { items.push({ product: '', template: ps.templates[0].name, qty: '', unit: 'pcs', unit_price: '', design_required: true, est_cost: {} }); draw(); };
    const key = uid();
    $('#osave', v).onclick = () => busy($('#osave', v), async () => {
      if (!cust) { toast('Select a customer', '', 'warn'); return; }
      const h = formData($('#oh', v));
      if (items.some(i => !String(i.product || '').trim() || !(+i.qty > 0))) { toast('Every product needs a name and quantity', '', 'warn'); return; }
      const body = { ...h, customer_id: cust.id, items: items.map(i => ({ ...i, machine_id: i.machine_id || null })) };
      if (!o && +h.adv > 0) body.advance = { amount: h.adv, method: h.adv_method };
      const r = o ? await PUT('/api/press/orders/' + o.id, body) : await POST('/api/press/orders', body, { idemKey: key });
      toast(o ? 'Order saved' : 'Order created', r.order_no); App.go('press-orders/' + r.id);
    });
    draw();
  },

  /* ---------- counter job (walk-in: deliver + invoice now) ---------- */
  async counter(v) {
    const [ps, store] = await Promise.all([pressSet(), GET('/api/store/items')]);
    let cust = null; const lines = [{ product: '', template: (ps.templates.find(t => /ID/i.test(t.name)) || ps.templates[0]).name, qty: 1, unit_price: '' }], mats = [];
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="history.back()">← Back</button><div class="sub">Walk-in / ready job: order, delivery challan and final invoice are made together — ID cards, lamination, binding, cutting…</div></div>
      <div class="panel"><div class="form f4" id="qh"><div class="field span2">Customer <span class="req">*</span><div id="qcp"></div></div>${field('Date', dateInput())}${field('Received by', `<input name="receiver">`)}${field('Remarks', `<input name="remarks">`, 'span4')}</div></div>
      <div class="grid g2"><div class="panel"><div class="head"><h2>Jobs</h2><button class="btn sm ghost" id="qadd">${ICON.plus} Add</button></div><div id="ql"></div></div>
        <div class="panel"><div class="head"><div><h2>Materials used (from store)</h2><div class="sub">optional — film, paper… taken out of stock with an issue slip</div></div><button class="btn sm ghost" id="madd">${ICON.plus} Add</button></div><div id="ml"></div></div></div>
      <div class="panel"><div class="row" style="justify-content:flex-end;gap:14px;align-items:flex-end">${field('Discount (৳)', `<input type="number" min="0" step="any" id="qdisc" value="0" style="width:130px">`)}
        ${field('Paid now (৳)', `<input type="number" min="0" step="any" id="qpaid" value="0" style="width:130px">`)}${field('Method', `<select id="qmeth">${App.meta.payment_methods.map(m => opt(m, m)).join('')}</select>`)}
        <div style="min-width:220px;border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:20px;font-weight:800" class="row"><span style="flex:1">Total</span><span id="qtot">৳ 0</span></div></div>
        <div class="actions"><button class="btn" id="qsave">${ICON.check} Save & make invoice</button></div></div>`;
    custPicker($('#qcp', v), { onPick: c => (cust = c) });
    const tot = () => { const s = lines.reduce((a, l) => a + (+l.qty || 0) * (+l.unit_price || 0), 0) - (+$('#qdisc', v).value || 0); $('#qtot', v).textContent = tk(Math.max(0, s)); };
    const drawL = () => { $('#ql', v).innerHTML = lines.map((l, i) => `<div class="form f4 kpi" style="margin-bottom:8px" data-l="${i}">${field('Job', `<input data-k="product" value="${esc(l.product)}" placeholder="PVC ID card, Lamination…">`)}
        ${field('Type', `<select data-k="template">${ps.templates.map(t => opt(t.name, t.name, l.template)).join('')}</select>`)}${field('Qty', `<input type="number" min="0" step="any" data-k="qty" value="${esc(l.qty)}">`)}
        ${field('Unit price', `<input type="number" min="0" step="any" data-k="unit_price" value="${esc(l.unit_price)}">`)}${field('Size', `<input data-k="size" value="${esc(l.size || '')}">`)}${field('Description', `<input data-k="description" value="${esc(l.description || '')}">`, 'span2')}
        <div class="field" style="align-self:end;text-align:right">${lines.length > 1 ? `<button class="btn xs ghost" data-rm="${i}" style="color:var(--danger)">✕</button>` : ''}</div></div>`).join(''); tot(); };
    const drawM = () => { $('#ml', v).innerHTML = mats.length ? mats.map((m, i) => `<div class="form f2" style="margin-bottom:6px" data-m="${i}">${field('Material', `<select data-k="item_id"><option value="">—</option>${store.filter(s => s.active).map(s => opt(s.id, `${s.name} (${qn(s.balance)} ${s.unit})`, m.item_id)).join('')}</select>`)}
        ${field('Qty', `<span class="row"><input type="number" min="0" step="any" data-k="qty" value="${esc(m.qty || '')}"><button class="btn xs ghost" data-mrm="${i}" style="color:var(--danger)">✕</button></span>`)}</div>`).join('') : '<div class="empty">No material taken from store</div>'; };
    $('#ql', v).addEventListener('input', e => { const b = e.target.closest('[data-l]'); if (b && e.target.dataset.k) { lines[+b.dataset.l][e.target.dataset.k] = e.target.value; tot(); } });
    $('#ql', v).addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(+b.dataset.rm, 1); drawL(); } });
    $('#ml', v).addEventListener('input', e => { const b = e.target.closest('[data-m]'); if (b && e.target.dataset.k) mats[+b.dataset.m][e.target.dataset.k] = e.target.value; });
    $('#ml', v).addEventListener('click', e => { const b = e.target.closest('[data-mrm]'); if (b) { mats.splice(+b.dataset.mrm, 1); drawM(); } });
    $('#qadd', v).onclick = () => { lines.push({ product: '', template: lines[0].template, qty: 1, unit_price: '' }); drawL(); };
    $('#madd', v).onclick = () => { mats.push({ item_id: '', qty: '' }); drawM(); };
    $('#qdisc', v).oninput = tot;
    const key = uid();
    $('#qsave', v).onclick = () => busy($('#qsave', v), async () => {
      if (!cust) { toast('Select a customer', '', 'warn'); return; }
      if (lines.some(l => !String(l.product).trim() || !(+l.qty > 0))) { toast('Every job needs a name and quantity', '', 'warn'); return; }
      const h = formData($('#qh', v));
      const r = await POST('/api/press/quick', { ...h, customer_id: cust.id, items: lines, materials: mats, discount: $('#qdisc', v).value, paid_amount: $('#qpaid', v).value, payment_method: $('#qmeth', v).value }, { idemKey: key });
      toast('Saved', `${r.order_no} · ${r.inv_no}`); App.go('press-invoices/' + r.invoice_id);
    });
    drawL(); drawM();
  },

  /* ---------- order detail ---------- */
  async detail(v, id, tab) {
    const [o] = await Promise.all([GET('/api/press/orders/' + id), pressSet()]);
    $('#title').textContent = o.order_no;
    this.tab = tab || this.tab || 'overview';
    const live = o.items.filter(i => !i.cancelled);
    const tabs = [['overview', 'Overview'], ['design', 'Design'], ['production', 'Production'], ['materials', 'Materials', o.issues.length + o.materials.length || ''], ['delivery', 'Delivery', o.challans.filter(c => c.status === 'active').length || ''],
      ['invoice', 'Invoice & payments'], ...(o.costing ? [['costing', 'Job costing']] : []), ['outsourcing', 'Outsourcing', o.outsourcing.length || ''], ['activity', 'Activity']];
    if (!tabs.some(t => t[0] === this.tab)) this.tab = 'overview';
    const due = o.invoice ? null : r2(o.total - o.paid);
    v.innerHTML = `<div class="head"><div class="row"><button class="btn ghost" onclick="App.go('press-orders')">← Orders</button>${oTag(o.status)}${o.overdue ? '<span class="tag red">Overdue</span>' : ''}</div>
        <div class="row">${can('press.orders') && !['invoiced', 'cancelled'].includes(o.status) ? `<button class="btn ghost" onclick="App.go('press-orders/${id}/edit')">Edit</button>` : ''}
          <button class="btn ghost" id="osheet">${ICON.print} Order sheet</button>
          ${can('payments') && o.status !== 'cancelled' ? `<button class="btn green" id="opay">${ICON.money} Payment</button>` : ''}
          ${can('press.orders', 'invoice.cancel') && !['invoiced', 'cancelled'].includes(o.status) ? `<button class="btn ghost" id="ocan" style="color:var(--danger)">Cancel order</button>` : ''}</div></div>
      <div class="stats stagger" style="grid-template-columns:repeat(5,1fr)">
        <div class="stat"><small>Customer</small><b style="font-size:16px"><a href="#/customers/${o.customer.id}">${esc(o.customer.name)}</a></b><div class="foot">${esc(o.customer.phone || '')}</div></div>
        <div class="stat"><small>Order date · deadline</small><b style="font-size:16px">${fdate(o.date)}</b><div class="foot">Deadline ${fdate(o.deadline) || '—'}</div></div>
        <div class="stat" style="--c:var(--blue)"><small>Order value</small><b>${tk(o.total)}</b><div class="foot">${live.length} product(s) · ${esc(o.order_type || '')}</div></div>
        <div class="stat" style="--c:var(--ok)"><small>Paid so far</small><b>${tk(o.paid - o.refunded)}</b><div class="foot">${o.refunded ? `refunded ${tk(o.refunded)}` : (o.invoice ? 'invoice ' + esc(o.invoice.inv_no) : 'advance / payments')}</div></div>
        <div class="stat" style="--c:var(--danger)"><small>${o.invoice ? 'Invoice' : 'Not invoiced'}</small><b>${o.invoice ? tk(o.invoice.grand_total) : tk(Math.max(0, due))}</b><div class="foot">${o.invoice ? `<a href="#/press-invoices/${o.invoice.id}">${esc(o.invoice.inv_no)}</a>` : due < 0 ? `advance exceeds value by ${tk(-due)}` : 'expected balance'}</div></div></div>
      ${o.status === 'cancelled' ? `<div class="note danger">Cancelled by ${esc(o.cancelled_by_name)} · ${esc(o.cancel_reason || '')}${o.paid - o.refunded > 0 ? ` — <b>${tk(o.paid - o.refunded)}</b> received for this order is held as customer credit. <a href="javascript:void 0" id="orf">Refund it</a>` : ''}</div>` : ''}
      ${sideTabs(tabs, this.tab, 'press-orders/' + id)}<div id="pane" class="tabpane"></div>`;
    $('#osheet', v).onclick = () => printHTML(orderSheetDoc(o), { size: 'A4', orient: 'portrait' });
    if ($('#opay', v)) $('#opay', v).onclick = () => paymentModal({ customer: o.customer, order: o }, () => App.refresh());
    if ($('#orf', v)) $('#orf', v).onclick = () => refundModal({ customer: o.customer, order: o, amount: r2(o.paid - o.refunded) }, () => App.refresh());
    if ($('#ocan', v)) $('#ocan', v).onclick = async () => { const r = await confirmBox('Cancel ' + o.order_no + '?', 'Production stops. Materials already issued can be returned to store from the Materials tab. Payments stay as customer credit — you can refund them afterwards.', { ok: 'Cancel order', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/press/orders/${id}/cancel`, { reason: r }); toast('Order cancelled'); App.refresh(); } catch (e) { fail(e); } } };
    const pane = $('#pane', v);
    await this['t_' + this.tab](pane, o, live);
  },
  t_overview(el, o, live) {
    el.innerHTML = `<div class="panel"><div class="tbl-wrap"><table><thead><tr><th>#</th><th>Product</th><th class="n">Qty</th><th>Design</th><th>Production</th><th>Delivered</th><th class="n">Unit price</th><th class="n">Total</th></tr></thead><tbody>
      ${o.items.map((i, k) => `<tr class="${i.cancelled ? 'void' : ''}"><td>${k + 1}</td><td><b>${esc(i.product)}</b><div class="sub">${esc([i.size, i.paper && `${i.paper} ${i.gsm || ''}`, i.colour, i.sides].filter(Boolean).join(' · '))}</div></td>
        <td class="n">${qn(i.qty)} ${esc(i.unit)}</td><td>${dTag(i.design_status, i.design_required)}</td><td>${pTag(i.prod_status)}<div class="sub">${(i.steps || []).filter(s => s.done).length}/${(i.steps || []).length} steps</div></td>
        <td><span class="small">${qn(i.delivered)} / ${qn(i.qty)}</span>${progress(i.delivered, +i.qty)}</td><td class="n">${nf2.format(i.unit_price)}</td><td class="n">${tk(i.total)}</td></tr>`).join('')}</tbody></table></div>
      ${o.instructions ? `<div class="note mt">${esc(o.instructions)}</div>` : ''}</div>
      <div class="grid g2"><div class="panel"><h2>Next step</h2><div class="mt">${this.nextStep(o, live)}</div></div>
        <div class="panel"><h2>Details</h2><div class="kv mt"><span>Order type</span><b>${esc(o.order_type || '')}</b><span>Marketing officer</span><b>${esc(o.officer_name || '')}</b><span>Created by</span><b>${esc(o.created_by_name)} · ${fdt(o.created_at)}</b>${o.remarks ? `<span>Remarks</span><b>${esc(o.remarks)}</b>` : ''}</div></div></div>`;
    $$('[data-go]', el).forEach(b => b.onclick = () => App.go(b.dataset.go));
  },
  nextStep(o, live) {
    const id = o.id;
    if (o.status === 'cancelled') return '<div class="empty">Order cancelled</div>';
    if (o.status === 'invoiced') return `<div class="note">Invoiced — <a href="#/press-invoices/${o.invoice.id}">${esc(o.invoice.inv_no)}</a>. Remaining payments can still be received.</div>`;
    const waitDesign = live.filter(i => i.design_required && i.design_status !== 'Approved');
    const notDone = live.filter(i => i.prod_status !== 'Completed');
    const toDeliver = live.filter(i => i.remaining > 0);
    const btn = (to, label) => `<button class="btn sm light" data-go="press-orders/${id}/${to}">${label}</button>`;
    if (waitDesign.length) return `<p>${waitDesign.length} product(s) waiting for design approval: ${waitDesign.map(i => `<b>${esc(i.product)}</b> (${esc(i.design_status)})`).join(', ')}</p>${btn('design', 'Open design')}`;
    if (notDone.length && !o.issues.length) return `<p>Designs approved. Issue paper / materials from the store and start production.</p>${btn('materials', 'Issue materials')} ${btn('production', 'Update production')}`;
    if (notDone.length) return `<p>${notDone.length} product(s) in production.</p>${btn('production', 'Update production')}`;
    if (toDeliver.length) return `<p>Production done. Deliver to the customer (partial deliveries allowed — each gets an A5 challan).</p>${btn('delivery', 'Make delivery challan')}`;
    return `<p>Everything delivered. Make the final A4 invoice — earlier payments are applied automatically.</p>${btn('invoice', 'Make final invoice')}`;
  },
  t_design(el, o, live) {
    el.innerHTML = `<div class="grid g2">${live.map(i => `<div class="panel"><div class="head"><div><h2>${esc(i.product)}</h2><div class="sub">${qn(i.qty)} ${esc(i.unit)} · ${i.design_source === 'customer' ? 'Customer gives design' : 'Our designer'}${i.designer ? ' · ' + esc(i.designer) : ''}</div></div>${dTag(i.design_status, i.design_required)}</div>
      ${!i.design_required ? '<div class="empty">No design needed for this product</div>' : `
      <div class="row" style="flex-wrap:wrap;gap:6px">${can('press.design') && ['Pending', 'Revision Required'].includes(i.design_status) ? `<button class="btn sm light" data-d="start" data-i="${i.id}">Start design</button>` : ''}
        ${can('press.design') && ['In Progress', 'Pending', 'Revision Required'].includes(i.design_status) ? `<button class="btn sm" data-d="send" data-i="${i.id}">Send for customer approval</button>` : ''}
        ${i.design_status !== 'Approved' && can('press.design', 'press.orders') ? `<button class="btn sm green" data-d="approve" data-i="${i.id}">${ICON.check} Customer approved</button>` : ''}
        ${can('press.design') && ['Approval Pending', 'Approved'].includes(i.design_status) ? `<button class="btn sm ghost" data-d="revision" data-i="${i.id}" style="color:var(--danger)">Revision required</button>` : ''}</div>
      ${i.design_approved_at ? `<div class="note mt" style="background:#e6f6ef">Approved by <b>${esc(i.design_approved_by || '')}</b> · ${fdt(i.design_approved_at)}</div>` : ''}
      ${(i.design_revisions || []).length ? `<div class="mt"><b class="small">Revisions</b>${i.design_revisions.map(r => `<div class="sub">• ${fdt(r.at)} · ${esc(r.by)}: ${esc(r.note)}</div>`).join('')}</div>` : ''}
      <div class="divider"></div><div class="row" style="justify-content:space-between"><div><b class="small">Final approved print file</b><div class="sub">${i.design_file ? `${esc(i.design_file.filename)} · ${n0(i.design_file.size / 1024)} KB · ${esc(i.design_file.by || '')}` : 'not uploaded'}</div></div>
        <div class="row">${i.design_file ? `<a class="btn sm ghost" href="/api/press/items/${i.id}/design-file">Download</a>` : ''}${can('press.design') && i.design_status === 'Approved' ? `<label class="btn sm light">${ICON.plus} Upload final file<input type="file" data-up="${i.id}" hidden></label>` : ''}</div></div>`}</div>`).join('')}</div>`;
    el.onclick = async e => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      const a = b.dataset.d; let body = { action: a };
      if (a === 'revision') { const n = await confirmBox('Revision required', 'What does the customer want changed?', { ok: 'Save', input: 'Changes needed' }); if (!n) return; body.note = n; }
      if (a === 'approve') { const n = await confirmBox('Customer approved the design?', 'Printing can start only after approval. Who approved (customer side)?', { ok: 'Approved', input: 'Approved by (name)' }); if (!n) return; body.approved_by = n; }
      try { await POST(`/api/press/items/${b.dataset.i}/design`, body, { idem: false }); toast('Design updated'); App.refresh(); } catch (er) { fail(er); }
    };
    $$('[data-up]', el).forEach(inp => inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; if (f.size > 60 * 1024 * 1024) { toast('File is larger than 60 MB', '', 'warn'); return; }
      try { await api('POST', `/api/press/items/${inp.dataset.up}/design-file`, f, { idem: false, headers: { 'X-File-Name': encodeURIComponent(f.name).slice(0, 200) } }); toast('Final file saved', f.name); App.refresh(); } catch (er) { fail(er); }
    });
  },
  async t_production(el, o, live) {
    const machines = await GET('/api/press/machines');
    el.innerHTML = live.map(i => `<div class="panel"><div class="head"><div><h2>${esc(i.product)} <span class="muted" style="font-weight:600">× ${qn(i.qty)}</span></h2><div class="sub">${esc(i.template || '')} · design ${dTag(i.design_status, i.design_required)}</div></div>${pTag(i.prod_status)}</div>
      <div class="grid" style="grid-template-columns:1.2fr 1fr;gap:16px"><div><b class="small">Steps</b><div class="mt">${(i.steps || []).map((s, k) => `<label class="check" style="display:flex;padding:6px 0;border-bottom:1px dashed var(--line)"><input type="checkbox" data-step="${k}" data-i="${i.id}" ${s.done ? 'checked' : ''} ${can('press.production') && i.prod_status !== 'Cancelled' ? '' : 'disabled'}>
          <span style="flex:1">${esc(s.name)}${/print|plate/i.test(s.name) && i.design_required && i.design_status !== 'Approved' ? ' <span class="tag orange">needs approved design</span>' : ''}</span><span class="sub">${s.done ? `${fdate(s.date)} · ${esc(s.by || '')}` : ''}</span></label>`).join('')}</div></div>
        <div class="form f2" data-pf="${i.id}">${field('Status', `<select name="prod_status">${PS.prod_status.map(x => opt(x, x, i.prod_status)).join('')}</select>`)}${field('Machine', `<select name="machine_id"><option value="">—</option>${machines.map(m => opt(m.id, m.name, i.machine_id)).join('')}</select>`)}
          ${field('Planned start', `<input type="date" name="planned_start" value="${i.planned_start || ''}">`)}${field('Est. completion', `<input type="date" name="est_completion" value="${i.est_completion || ''}">`)}
          ${field('Actual start', `<input type="date" name="actual_start" value="${i.actual_start || ''}" max="${App.today}">`)}${field('Actual completion', `<input type="date" name="actual_completion" value="${i.actual_completion || ''}" max="${App.today}">`)}
          ${field('Assigned staff', `<input name="assigned_staff" value="${esc(i.assigned_staff || '')}" placeholder="operator names (they don't log in)">`, 'span2')}${field('Production notes', `<input name="prod_notes" value="${esc(i.prod_notes || '')}">`, 'span2')}
          ${can('press.production') ? `<div class="span2 row" style="justify-content:space-between"><button class="btn sm ghost" data-fin="${i.id}">Submit to office (good / waste)</button><button class="btn sm" data-ps="${i.id}">Save</button></div>` : ''}
          ${i.good_qty != null ? `<div class="span2 note">Submitted to office: good <b>${qn(i.good_qty)}</b> · waste <b>${qn(i.waste_qty)}</b></div>` : ''}</div></div></div>`).join('');
    el.onchange = async e => {
      const s = e.target.closest('[data-step]'); if (!s) return;
      let date = App.today;
      if (s.checked) { const d = await askDate('When was "' + s.parentElement.textContent.trim().split('\n')[0] + '" done?'); if (!d) { s.checked = false; return; } date = d; }
      try { await POST(`/api/press/items/${s.dataset.i}/step`, { index: +s.dataset.step, done: s.checked, date }, { idem: false }); toast('Step updated'); App.refresh(); } catch (er) { s.checked = !s.checked; fail(er); }
    };
    el.onclick = async e => {
      const b = e.target.closest('[data-ps]'), f = e.target.closest('[data-fin]');
      if (b) busy(b, async () => { await PUT(`/api/press/items/${b.dataset.ps}/production`, formData($(`[data-pf="${b.dataset.ps}"]`, el))); toast('Production saved'); App.refresh(); });
      if (f) {
        const it = live.find(x => x.id === +f.dataset.fin);
        const m = modal({ title: 'Submit finished goods to office', size: 'narrow', body: `<div class="form" id="ff">${field('Date', dateInput())}${field('Good quantity', `<input type="number" min="0" step="any" name="good_qty" value="${+it.qty}">`)}${field('Waste quantity', `<input type="number" min="0" step="any" name="waste_qty" value="0">`)}</div><div class="actions"><button class="btn" id="fs">Save</button></div>` });
        $('#fs', m.el).onclick = () => busy($('#fs', m.el), async () => { await POST(`/api/press/items/${it.id}/finish`, formData($('#ff', m.el)), { idem: false }); m.close(); toast('Submitted to office'); App.refresh(); });
      }
    };
  },
  async t_materials(el, o, live) {
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Material issue slips</h2><div class="sub">Stock goes down only here. Unused / cancelled-job material can come back with a return.</div></div>${can('press.store') && o.status !== 'cancelled' ? `<button class="btn sm" id="niss">${ICON.plus} Issue material</button>` : ''}</div>
        ${o.issues.length ? o.issues.map(s => `<div class="kpi ${s.voided ? 'void' : ''}" style="margin-bottom:8px"><div class="row" style="justify-content:space-between"><div><b>${esc(s.issue_no)}</b> · ${fdate(s.date)} · ${esc(s.product || 'whole order')} ${s.voided ? '<span class="tag red">VOID</span>' : ''}<div class="sub">Issued by ${esc(s.issued_by || '')} → received by ${esc(s.received_by || '')}</div></div>
          <div class="row"><button class="btn xs ghost" data-slip="${s.id}">${ICON.print} Slip</button>${!s.voided && can('press.store') ? `<button class="btn xs light" data-ret="${s.id}">Return</button>` : ''}</div></div>
          <div class="sub mt">${(s.lines || []).map(l => `${esc(l.item)} <b>${qn(l.qty)} ${esc(l.unit)}</b>`).join(' · ')}</div></div>`).join('') : '<div class="empty">No material issued yet</div>'}
        ${o.returns.length ? `<h2 class="mt">Returns</h2><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Return</th><th>Issue</th><th>Item</th><th class="n">Qty</th><th>Condition</th><th>Reason</th></tr></thead><tbody>${o.returns.map(r => `<tr><td>${fdate(r.date)}</td><td>${esc(r.return_no)}</td><td>${esc(r.issue_no)}</td><td>${esc(r.item)}</td><td class="n">${qn(r.qty)} ${esc(r.unit)}</td><td>${r.condition === 'usable' ? '<span class="tag green">Usable → stock</span>' : '<span class="tag red">Damaged / loss</span>'}</td><td>${esc(r.reason || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
      <div class="panel"><div class="head"><div><h2>Customer-supplied material</h2><div class="sub">Not our stock — only received / returned is recorded</div></div>${can('press.orders', 'press.store') ? `<button class="btn sm ghost" id="ncm">${ICON.plus} Receive material</button>` : ''}</div><div id="cmt"></div></div>`;
    materialsTable($('#cmt', el), o.materials);
    if ($('#niss', el)) $('#niss', el).onclick = () => issueModal({ order: o }, () => App.refresh());
    if ($('#ncm', el)) $('#ncm', el).onclick = () => receiveMaterialModal({ order: o }, () => App.refresh());
    el.addEventListener('click', async e => {
      const s = e.target.closest('[data-slip]'), r = e.target.closest('[data-ret]');
      if (s) printHTML(issueSlipDoc(await GET('/api/press/issues/' + s.dataset.slip)), { size: 'A5' });
      if (r) returnModal(+r.dataset.ret, () => App.refresh());
    });
  },
  t_delivery(el, o, live) {
    const canDel = can('press.delivery') && !['invoiced', 'cancelled'].includes(o.status) && live.some(i => i.remaining > 0);
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Deliveries</h2><div class="sub">Every partial or full delivery gets its own A5 challan. No invoice until everything is delivered.</div></div>${canDel ? `<button class="btn" id="ndc">${ICON.truck} New delivery challan</button>` : ''}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Product</th><th class="n">Ordered</th><th class="n">Delivered</th><th class="n">Remaining</th><th class="n">Finished (good)</th></tr></thead><tbody>${live.map(i => `<tr><td><b>${esc(i.product)}</b></td><td class="n">${qn(i.qty)}</td><td class="n">${qn(i.delivered)}</td><td class="n"><b>${qn(i.remaining)}</b></td><td class="n">${i.good_qty != null ? qn(i.good_qty) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <h2 class="mt">Challans</h2><div class="feed mt">${o.challans.map(c => `<div class="feed-item" onclick="App.go('press-delivery/${c.id}')"><div class="feed-ic" style="background:${c.status === 'active' ? 'var(--blue)' : 'var(--danger)'}">DC</div><div class="t"><b>${esc(c.dc_no)}</b><small>${fdate(c.date)} · ${(c.lines || []).map(l => `${esc(live.find(i => i.id === l.item_id)?.product || '')} ${qn(l.qty)}`).join(', ')} ${c.status !== 'active' ? '· cancelled' : ''}</small></div></div>`).join('') || '<div class="empty">Not delivered yet</div>'}</div></div>`;
    if ($('#ndc', el)) $('#ndc', el).onclick = () => challanModal(o, () => App.refresh());
  },
  async t_invoice(el, o, live) {
    const allDel = live.every(i => i.remaining <= 0);
    el.innerHTML = `<div class="grid g2"><div class="panel"><div class="head"><h2>Final invoice</h2></div>
        ${o.invoice ? `<div class="kv"><span>Invoice</span><b><a href="#/press-invoices/${o.invoice.id}">${esc(o.invoice.inv_no)}</a></b><span>Date</span><b>${fdate(o.invoice.date)}</b><span>Total</span><b>${tk(o.invoice.grand_total)}</b></div>
          ${o.invoice.void_requested_name ? `<div class="note mt">Void requested by ${esc(o.invoice.void_requested_name)}: ${esc(o.invoice.void_req_reason)}</div>` : ''}`
        : o.status === 'cancelled' ? '<div class="empty">Order cancelled</div>'
        : `<p class="sub">${allDel ? 'All products delivered — ready for the final invoice.' : 'Not everything is delivered yet. The final invoice is made after full delivery.'}</p>
          ${can('press.invoice') ? `<button class="btn ${allDel ? '' : 'ghost'}" id="ninv">${ICON.invoice} ${allDel ? 'Make final invoice' : 'Close order early & invoice (Admin / Manager)'}</button>` : ''}`}
        ${o.invoices.filter(i => i.status === 'void').length ? `<h2 class="mt">Void invoices</h2>${o.invoices.filter(i => i.status === 'void').map(i => `<div class="sub">• <a href="#/press-invoices/${i.id}">${esc(i.inv_no)}</a> ${tk(i.grand_total)} — ${esc(i.void_reason || '')}</div>`).join('')}` : ''}</div>
      <div class="panel"><div class="head"><h2>Payments for this order</h2><div class="row">${can('refunds') && o.paid - o.refunded > 0 ? `<button class="btn sm ghost" id="nrf">Refund</button>` : ''}${can('payments') && o.status !== 'cancelled' ? `<button class="btn sm green" id="npay">${ICON.plus} Payment</button>` : ''}</div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th class="n">Amount</th><th>Status</th></tr></thead><tbody>
        ${o.payments.map(p => `<tr class="${p.voided ? 'void' : ''}"><td>${fdate(p.date)} <span class="sub">${esc(p.time || '')}</span></td><td>${esc(p.receipt_no)}</td><td>${esc(p.method)}</td><td class="n">${tk(p.amount)}</td><td>${p.voided ? '<span class="tag red">Void</span>' : +p.allocated >= +p.amount - 0.004 ? '<span class="tag green">On invoice</span>' : '<span class="tag orange">Advance</span>'}</td></tr>`).join('')}
        ${o.refunds.map(r => `<tr class="${r.voided ? 'void' : ''}"><td>${fdate(r.date)}</td><td>${esc(r.refund_no)}</td><td>${esc(r.method)}</td><td class="n" style="color:var(--danger)">− ${tk(r.amount)}</td><td><span class="tag red">Refund</span></td></tr>`).join('')}
        ${!o.payments.length && !o.refunds.length ? '<tr><td colspan="5" class="empty">No payments yet</td></tr>' : ''}</tbody></table></div></div></div>`;
    if ($('#ninv', el)) $('#ninv', el).onclick = () => invoiceModal(o, allDel);
    if ($('#npay', el)) $('#npay', el).onclick = () => paymentModal({ customer: o.customer, order: o }, () => App.refresh());
    if ($('#nrf', el)) $('#nrf', el).onclick = () => refundModal({ customer: o.customer, order: o }, () => App.refresh());
  },
  t_costing(el, o) {
    const c = o.costing, C = PS?.cost_cats || {};
    el.innerHTML = `<div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><small>Selling price</small><b>${tk(c.selling)}</b><div class="foot">${c.invoiced ? 'final invoice' : 'order value'}</div></div>
        <div class="stat" style="--c:var(--warn)"><small>Estimated cost</small><b>${tk(c.est_total)}</b><div class="foot">profit ${tk(c.est_profit)}</div></div>
        <div class="stat" style="--c:var(--danger)"><small>Actual cost</small><b>${tk(c.actual_total)}</b><div class="foot">from issues, outsourcing & costs</div></div>
        <div class="stat" style="--c:${c.actual_profit >= 0 ? 'var(--ok)' : 'var(--danger)'}"><small>Actual profit / loss</small><b>${tk(c.actual_profit)}</b><div class="foot">${c.selling ? Math.round(c.actual_profit / c.selling * 100) : 0}% margin</div></div></div>
      <div class="grid g2"><div class="panel"><h2>Estimated vs actual</h2><div class="tbl-wrap mt"><table><thead><tr><th>Cost</th><th class="n">Estimated</th><th class="n">Actual</th><th class="n">Difference</th></tr></thead><tbody>
        ${Object.entries(C).map(([k, l]) => `<tr><td>${l}</td><td class="n">${tk(c.est[k])}</td><td class="n">${tk(c.actual[k])}</td><td class="n" style="color:${c.actual[k] > c.est[k] ? 'var(--danger)' : 'var(--ok)'}">${tk(c.actual[k] - c.est[k])}</td></tr>`).join('')}
        <tr><th>Total</th><th class="n">${tk(c.est_total)}</th><th class="n">${tk(c.actual_total)}</th><th class="n">${tk(c.actual_total - c.est_total)}</th></tr></tbody></table></div>
        <div class="sub mt">Paper, ink, plate, film… come automatically from Material Issue (average purchase cost) minus usable returns. Outsourcing from the Outsourcing tab.</div></div>
      <div class="panel"><div class="head"><h2>Other actual costs</h2><button class="btn sm" id="ncost">${ICON.plus} Add cost</button></div><div class="sub">Labour, printing (machine), design, plate (CTP), transport…</div>
        <div class="tbl-wrap mt"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="n">Amount</th><th></th></tr></thead><tbody>${o.costs.map(x => `<tr class="${x.voided ? 'void' : ''}"><td>${fdate(x.date)}</td><td>${esc(C[x.category] || x.category)}</td><td>${esc(x.note || '')}</td><td class="n">${tk(x.amount)}</td><td>${x.voided ? '' : `<button class="btn xs ghost" data-cv="${x.id}">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No extra costs</td></tr>'}</tbody></table></div></div></div>`;
    $('#ncost', el).onclick = () => {
      const m = modal({ title: 'Add actual cost', size: 'narrow', body: `<div class="form" id="cf">${field('Date', dateInput())}${field('Category', `<select name="category">${Object.entries(C).map(([k, l]) => opt(k, l)).join('')}</select>`)}
        ${field('Product', `<select name="item_id"><option value="">Whole order</option>${o.items.filter(i => !i.cancelled).map(i => opt(i.id, i.product)).join('')}</select>`)}${field('Amount (৳)', `<input type="number" min="0" step="any" name="amount">`)}${field('Note', `<input name="note">`)}</div><div class="actions"><button class="btn" id="cs">Save</button></div>` });
      const key = uid();
      $('#cs', m.el).onclick = () => busy($('#cs', m.el), async () => { if (!requireFields(m.el, ['amount'])) return; await POST(`/api/press/orders/${o.id}/costs`, formData($('#cf', m.el)), { idemKey: key }); m.close(); toast('Cost added'); App.refresh(); });
    };
    el.addEventListener('click', async e => { const b = e.target.closest('[data-cv]'); if (b && await confirmBox('Remove this cost?', '', { ok: 'Remove', danger: true })) { try { await POST(`/api/press/costs/${b.dataset.cv}/void`, {}); App.refresh(); } catch (er) { fail(er); } } });
  },
  async t_outsourcing(el, o) {
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Outsourced work</h2><div class="sub">Outside binding, special finishing… cost goes to job costing</div></div>${can('press.suppliers') ? `<button class="btn sm" id="nout">${ICON.plus} Outsource work</button>` : ''}</div><div id="ot"></div></div>`;
    outsourcingTable($('#ot', el), o.outsourcing);
    if ($('#nout', el)) $('#nout', el).onclick = () => outsourceModal({ order: o }, () => App.refresh());
  },
  t_activity(el, o) {
    el.innerHTML = `<div class="panel"><div class="feed">${o.activity.map(a => `<div class="feed-item"><div class="feed-ic" style="background:var(--blue)">${esc((a.kind || '?')[0].toUpperCase())}</div><div class="t"><b>${esc(a.text)}</b><small>${fdt(a.at)} · ${esc(a.by_name || '')}</small></div></div>`).join('') || '<div class="empty">No activity</div>'}</div></div>`;
  },
};

/* small "which date?" box — for entering work from the paper register later */
function askDate(title) {
  return new Promise(res => {
    const m = modal({ title, size: 'narrow', body: `<div class="form">${field('Date', dateInput('d'))}</div><div class="sub">Pick the real date the work happened (back-dating is allowed after a power / internet cut).</div><div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="ok">OK</button></div>` });
    $('[data-x]', m.el).onclick = () => { m.close(); res(null); };
    $('#ok', m.el).onclick = () => { const d = $('[name=d]', m.el).value; m.close(); res(d || App.today); };
  });
}

/* ---------- modals shared by several pages ---------- */
function challanModal(o, done) {
  const live = o.items.filter(i => !i.cancelled && i.remaining > 0);
  const m = modal({ title: 'Delivery challan — ' + o.order_no, size: 'wide', body: `<div class="form f4" id="dcf">${field('Delivery date', dateInput())}${field('Received by', `<input name="receiver" placeholder="receiver name">`)}${field('Carried by', `<input name="carried_by">`)}
      ${field('Prepared by', `<input name="prepared_by" value="${esc(App.user.full_name)}">`)}${field('Nickname', `<input name="prepared_nick" value="${esc(App.user.nickname || '')}" placeholder="optional">`)}${field('Remarks', `<input name="remarks">`, 'span3')}</div>
    <div class="tbl-wrap mt"><table><thead><tr><th>Product</th><th class="n">Ordered</th><th class="n">Delivered</th><th class="n">Remaining</th><th class="n" style="width:150px">Deliver now</th></tr></thead><tbody>
      ${live.map(i => `<tr><td><b>${esc(i.product)}</b></td><td class="n">${qn(i.qty)}</td><td class="n">${qn(i.delivered)}</td><td class="n">${qn(i.remaining)}</td><td class="n"><input class="inp" type="number" min="0" step="any" max="${i.remaining}" data-dq="${i.id}" value="${i.remaining}" style="text-align:right"></td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="dcs">${ICON.check} Create challan</button></div>` });
  $('[data-x]', m.el).onclick = m.close;
  const key = uid();
  $('#dcs', m.el).onclick = () => busy($('#dcs', m.el), async () => {
    const items = $$('[data-dq]', m.el).map(x => ({ item_id: +x.dataset.dq, qty: +x.value || 0 })).filter(x => x.qty > 0);
    if (!items.length) { toast('Enter the quantity delivered now', '', 'warn'); return; }
    const ch = await POST('/api/press/challans', { ...formData($('#dcf', m.el)), order_id: o.id, items }, { idemKey: key });
    m.close(); toast('Challan created', ch.dc_no); printHTML(pressChallanDoc(ch), { size: 'A5', orient: 'portrait' }); done && done();
  });
}
async function invoiceModal(o, allDel) {
  const p = await GET(`/api/press/orders/${o.id}/invoice-preview`);
  const lines = p.items.map(i => ({ ...i, bill: allDel ? i.qty : i.delivered }));
  const m = modal({ title: 'Final invoice — ' + o.order_no, size: 'wide', body: `${allDel ? '' : `<div class="note danger">Not fully delivered. Closing the order early bills only what was delivered. Admin / Manager only.</div>`}
    <div class="form f4" id="ivf">${field('Invoice date', dateInput())}${field('Discount (৳)', `<input type="number" min="0" step="any" name="discount" value="0">`)}${field('Adjustment (+/− ৳)', `<input type="number" step="any" name="adjustment" value="0">`)}${field('Adjustment note', `<input name="adjustment_note">`)}
      ${allDel ? '' : field('Why close early? <span class="req">*</span>', `<input name="close_reason">`, 'span4')}${field('Remarks', `<input name="remarks">`, 'span4')}</div>
    <div class="tbl-wrap mt"><table><thead><tr><th>Product</th><th class="n">Qty billed</th><th class="n" style="width:150px">Unit price (৳)</th><th class="n">Total</th></tr></thead><tbody>
      ${lines.map((l, i) => `<tr><td><b>${esc(l.product)}</b><div class="sub">${esc(l.description || '')}</div></td><td class="n">${qn(l.bill)} ${esc(l.unit)}</td><td class="n"><input class="inp" type="number" min="0" step="any" data-up="${i}" value="${l.unit_price}" style="text-align:right"></td><td class="n" data-lt="${i}">${tk(l.bill * l.unit_price)}</td></tr>`).join('')}</tbody></table></div>
    <div class="row mt" style="justify-content:space-between;align-items:flex-start"><div class="form f2" id="ivp" style="max-width:420px">${field('Current payment (৳)', `<input type="number" min="0" step="any" name="amount" value="0">`)}${field('Method', `<select name="method">${App.meta.payment_methods.map(x => opt(x, x)).join('')}</select>`)}</div>
      <div style="min-width:280px;border:1px solid var(--line);border-radius:12px;padding:10px 14px" id="ivs"></div></div>
    <div class="note">After finalizing, the invoice cannot be edited. Mistakes are corrected by VOID (the number is never reused). Payments can still be received later.</div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="ivgo">${ICON.check} Finalize invoice</button></div>` });
  const sum = () => {
    const sub = lines.reduce((s, l) => s + l.bill * l.unit_price, 0), d = +$('[name=discount]', m.el).value || 0, a = +$('[name=adjustment]', m.el).value || 0, tot = r2(sub - d + a);
    const prevPaid = Math.min(p.paid_advance, Math.max(0, tot));
    $('#ivs', m.el).innerHTML = `<div class="row" style="justify-content:space-between"><span>Total amount</span><b>${tk(sub)}</b></div>${d ? `<div class="row" style="justify-content:space-between"><span>Discount</span><span>− ${tk(d)}</span></div>` : ''}${a ? `<div class="row" style="justify-content:space-between"><span>Adjustment</span><span>${tk(a)}</span></div>` : ''}
      <div class="row" style="justify-content:space-between;font-size:18px;font-weight:800"><span>Final total</span><span>${tk(tot)}</span></div><div class="row" style="justify-content:space-between"><span>Previous payments</span><span>${tk(prevPaid)}</span></div>
      <div class="row" style="justify-content:space-between;font-weight:800;color:var(--danger)"><span>Balance due</span><span>${tk(Math.max(0, tot - prevPaid))}</span></div>${p.paid_advance > tot ? `<div class="sub">Extra ${tk(p.paid_advance - tot)} stays as customer credit (refund possible).</div>` : ''}`;
  };
  m.el.addEventListener('input', e => { if (e.target.dataset.up != null) { const i = +e.target.dataset.up; lines[i].unit_price = +e.target.value || 0; $(`[data-lt="${i}"]`, m.el).textContent = tk(lines[i].bill * lines[i].unit_price); } sum(); });
  $('[data-x]', m.el).onclick = m.close; sum();
  const key = uid();
  $('#ivgo', m.el).onclick = () => busy($('#ivgo', m.el), async () => {
    const h = formData($('#ivf', m.el)), pay = formData($('#ivp', m.el));
    if (!allDel && !String(h.close_reason || '').trim()) { toast('Write why the order is closed early', '', 'warn'); return; }
    if (!await confirmBox('Finalize invoice?', 'It cannot be edited afterwards.', { ok: 'Finalize' })) return;
    const inv = await POST('/api/press/invoices', { ...h, order_id: o.id, close_early: !allDel, lines: lines.map(l => ({ item_id: l.item_id, unit_price: l.unit_price })), current_payment: pay }, { idemKey: key });
    m.close(); toast('Final invoice', inv.inv_no); App.go('press-invoices/' + inv.id);
  });
}
async function issueModal({ order = null } = {}, done) {
  const [store, ps] = await Promise.all([GET('/api/store/items'), pressSet()]);
  let o = order; const lines = [{ item_id: '', qty: '', unit: '' }];
  const m = modal({ title: 'Material issue' + (o ? ' — ' + o.order_no : ''), size: 'wide', body: `<div class="form f4" id="isf">${field('Issue date', dateInput())}
      ${o ? field('Product', `<select name="item_id"><option value="">Whole order</option>${o.items.filter(i => !i.cancelled).map(i => opt(i.id, i.product)).join('')}</select>`) : `<div class="field span2">Order<select name="order_id" id="iso"><option value="">— no order (internal use) —</option></select></div>`}
      ${field('Issued by', `<input name="issued_by" value="${esc(App.user.full_name)}">`)}${field('Received by (operator)', `<input name="received_by">`)}${field('Remarks', `<input name="remarks">`, o ? 'span4' : 'span2')}</div>
    <div class="mt" id="isl"></div><button class="btn sm ghost mt" id="isadd">${ICON.plus} Add material</button>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="iss">${ICON.check} Issue & print slip</button></div>` });
  if (!o) GET('/api/press/orders', { from: '2000-01-01', to: App.today }).then(rows => { const s = $('#iso', m.el); if (s) s.innerHTML += rows.filter(r => !['cancelled', 'invoiced'].includes(r.status)).map(r => opt(r.id, `${r.order_no} · ${r.customer} · ${r.products || ''}`.slice(0, 90))).join(''); });
  const draw = () => { $('#isl', m.el).innerHTML = lines.map((l, i) => { const it = store.find(s => s.id === +l.item_id); const ream = it && /^(ream|sheet)$/i.test(it.unit);
    return `<div class="form f4" data-l="${i}" style="margin-bottom:6px">${field('Material', `<select data-k="item_id"><option value="">—</option>${store.filter(s => s.active).map(s => opt(s.id, `${s.code || ''} ${s.name} — ${qn(s.balance)} ${s.unit}`, l.item_id)).join('')}</select>`, 'span2')}
      ${field('Quantity', `<input type="number" min="0" step="any" data-k="qty" value="${esc(l.qty)}">`)}${field('Unit', `<span class="row"><select data-k="unit">${it ? (ream ? ['Ream', 'Sheet'] : [it.unit]).map(u => opt(u, u + (u !== it.unit ? ` (${ps.ream_sheets} sheets = 1 ream)` : ''), l.unit || it.unit)).join('') : ''}</select>${lines.length > 1 ? `<button class="btn xs ghost" data-rm="${i}" style="color:var(--danger)">✕</button>` : ''}</span>`)}</div>`; }).join(''); };
  m.el.addEventListener('input', e => { const b = e.target.closest('[data-l]'); if (b && e.target.dataset.k) { lines[+b.dataset.l][e.target.dataset.k] = e.target.value; if (e.target.dataset.k === 'item_id') { lines[+b.dataset.l].unit = ''; draw(); } } });
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(+b.dataset.rm, 1); draw(); } });
  $('#isadd', m.el).onclick = () => { lines.push({ item_id: '', qty: '', unit: '' }); draw(); };
  $('[data-x]', m.el).onclick = m.close; draw();
  const key = uid();
  $('#iss', m.el).onclick = () => busy($('#iss', m.el), async () => {
    const h = formData($('#isf', m.el)); const ls = lines.filter(l => l.item_id && +l.qty > 0);
    if (!ls.length) { toast('Add the material and quantity', '', 'warn'); return; }
    const s = await POST('/api/press/issues', { ...h, order_id: o ? o.id : h.order_id || null, item_id: o ? h.item_id || null : null, lines: ls }, { idemKey: key });
    m.close(); toast('Material issued', s.issue_no); printHTML(issueSlipDoc(await GET('/api/press/issues/' + s.id)), { size: 'A5' }); done && done();
  });
}
async function returnModal(issueId, done) {
  const s = await GET('/api/press/issues/' + issueId);
  const m = modal({ title: 'Return material — ' + s.issue_no, size: 'narrow', body: `<div class="form" id="rf">${field('Return date', dateInput())}
      ${field('Material', `<select name="line_id">${s.lines.map(l => opt(l.id, `${l.item} — issued ${qn(l.qty)} ${l.unit}, returned ${qn(l.returned)}`)).join('')}</select>`)}
      ${field('Returned quantity', `<input type="number" min="0" step="any" name="qty">`)}${field('Condition', `<select name="condition"><option value="usable">Usable — add back to stock</option><option value="damaged">Damaged — record as waste / loss</option></select>`)}
      ${field('Return reason <span class="req">*</span>', `<input name="reason" placeholder="printing not done, order cancelled, extra…">`)}${field('Received by', `<input name="received_by" value="${esc(App.user.full_name)}">`)}</div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="rs">Save return</button></div>` });
  $('[data-x]', m.el).onclick = m.close;
  const key = uid();
  $('#rs', m.el).onclick = () => busy($('#rs', m.el), async () => { if (!requireFields(m.el, ['qty', 'reason'])) return; await POST('/api/press/returns', formData($('#rf', m.el)), { idemKey: key }); m.close(); toast('Return recorded'); done && done(); });
}
function materialsTable(el, rows) {
  dataTable(el, rows, [{ k: 'received_date', label: 'Received', f: r => fdate(r.received_date) }, ...(rows.some(r => r.order_no) ? [{ k: 'order_no', label: 'Order', f: r => esc(r.order_no || '') }] : []), ...(rows.some(r => r.customer) ? [{ k: 'customer', label: 'Customer' }] : []),
    { k: 'description', label: 'Material' }, { k: 'received_qty', label: 'Received', n: 1, f: r => `${qn(r.received_qty)} ${esc(r.unit || '')}` },
    { k: 'returned_qty', label: 'Returned / waste', n: 1, f: r => r.status === 'returned' ? `${qn(r.returned_qty)} / ${qn(r.waste_qty)}` : '—' },
    { k: 'status', label: 'Status', f: r => r.status === 'returned' ? `<span class="tag green">Returned</span>${r.diff_reason ? `<div class="sub">${esc(r.diff_reason)}</div>` : ''}` : '<span class="tag orange">With us</span>' },
    { k: 'x', label: '', sort: false, f: r => r.status !== 'returned' && can('press.orders', 'press.store') ? `<button class="btn xs light" data-cmr="${r.id}">Process & return</button>` : '' }], { search: false, empty: 'No customer material' });
  el.addEventListener('click', e => { const b = e.target.closest('[data-cmr]'); if (b) returnMaterialModal(rows.find(r => r.id === +b.dataset.cmr), () => App.refresh()); });
}
async function receiveMaterialModal({ order = null } = {}, done) {
  let cust = order ? order.customer : null;
  const m = modal({ title: 'Receive customer material', size: 'narrow', body: `<div class="note">Customer's own material (printed sheets, cartons…). It is NOT added to our stock.</div><div class="form" id="rmf">
    ${order ? '' : `<div class="field">Customer<div id="rmc"></div></div>`}${field('Received date', dateInput('received_date'))}${field('Material description <span class="req">*</span>', `<input name="description">`)}
    ${field('Received quantity', `<input type="number" min="0" step="any" name="received_qty">`)}${field('Unit', `<input name="unit" value="pcs">`)}${field('Received by', `<input name="received_by" value="${esc(App.user.full_name)}">`)}${field('Remarks', `<input name="remarks">`)}</div>
    <div class="actions"><button class="btn" id="rms">Save</button></div>` });
  if (!order) custPicker($('#rmc', m.el), { onPick: c => (cust = c) });
  const key = uid();
  $('#rms', m.el).onclick = () => busy($('#rms', m.el), async () => {
    if (!requireFields(m.el, ['description', 'received_qty'])) return; if (!cust) { toast('Select a customer', '', 'warn'); return; }
    await POST('/api/press/materials', { ...formData($('#rmf', m.el)), order_id: order?.id, customer_id: cust.id }, { idemKey: key }); m.close(); toast('Material received'); done && done();
  });
}
function returnMaterialModal(r, done) {
  const m = modal({ title: 'Process & return — ' + r.description, size: 'narrow', body: `<div class="sub">Received ${qn(r.received_qty)} ${esc(r.unit || '')}</div><div class="form f2" id="rtf">
    ${field('Processed qty', `<input type="number" min="0" step="any" name="processed_qty" value="${+r.received_qty}">`)}${field('Good output', `<input type="number" min="0" step="any" name="good_qty" value="${+r.received_qty}">`)}
    ${field('Returned qty', `<input type="number" min="0" step="any" name="returned_qty" value="${+r.received_qty}">`)}${field('Waste / damaged', `<input type="number" min="0" step="any" name="waste_qty" value="0">`)}
    ${field('Return date', dateInput('return_date'))}${field('Receiver name', `<input name="receiver_name">`)}${field('Reason for any difference', `<input name="diff_reason">`, 'span2')}
    <label class="check span2"><input type="checkbox" name="receiver_signed"> Receiver signed</label></div><div class="note" id="rtn"></div><div class="actions"><button class="btn" id="rts">Save</button></div>` });
  const chk = () => { const d = formData($('#rtf', m.el)); const diff = r2(+r.received_qty - (+d.returned_qty || 0) - (+d.waste_qty || 0)); $('#rtn', m.el).innerHTML = diff ? `Difference <b>${qn(diff)}</b> — write the reason.` : 'Received = returned + waste ✓'; };
  $('#rtf', m.el).oninput = chk; chk();
  $('#rts', m.el).onclick = () => busy($('#rts', m.el), async () => { await PUT(`/api/press/materials/${r.id}/return`, formData($('#rtf', m.el))); m.close(); toast('Saved'); done && done(); });
}
function outsourcingTable(el, rows) {
  dataTable(el, rows, [{ k: 'sent_date', label: 'Sent', f: r => fdate(r.sent_date) }, ...(rows.some(r => r.order_no) ? [{ k: 'order_no', label: 'Order' }] : []), { k: 'supplier', label: 'Supplier' }, { k: 'work', label: 'Work', f: r => `${esc(r.work)}${r.product ? `<div class="sub">${esc(r.product)}</div>` : ''}` },
    { k: 'qty', label: 'Qty', n: 1, f: r => r.qty ? qn(r.qty) : '' }, { k: 'delivery_date', label: 'Due back', f: r => `${fdate(r.delivery_date)}${r.received ? ' <span class="tag green">Received</span>' : ''}` },
    { k: 'cost', label: 'Cost', n: 1, f: r => tk(r.cost), total: d => tk(d.reduce((s, r) => s + +r.cost, 0)) }, { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid) },
    { k: 'x', label: '', sort: false, f: r => can('press.suppliers') ? `${!r.received ? `<button class="btn xs ghost" data-orc="${r.id}">Received</button> ` : ''}${+r.paid < +r.cost ? `<button class="btn xs green" data-opay="${r.id}">Pay</button>` : '<span class="tag green">Paid</span>'}` : '' }], { search: false, totals: true, empty: 'Nothing outsourced' });
  el.addEventListener('click', async e => {
    const p = e.target.closest('[data-opay]'), rc = e.target.closest('[data-orc]');
    if (rc) { try { await PUT(`/api/press/outsourcing/${rc.dataset.orc}`, { received: true }); App.refresh(); } catch (er) { fail(er); } }
    if (p) { const r = rows.find(x => x.id === +p.dataset.opay);
      const m = modal({ title: 'Pay ' + r.supplier, size: 'narrow', body: `<div class="form" id="opf">${field('Date', dateInput())}${field('Amount (৳)', `<input type="number" min="0" step="any" name="amount" value="${r2(r.cost - r.paid)}">`)}${field('Method', `<select name="method">${App.meta.payment_methods.map(x => opt(x, x)).join('')}</select>`)}</div><div class="sub">Recorded as an "Outsourcing Cost" expense.</div><div class="actions"><button class="btn green" id="ops">Pay</button></div>` });
      const key = uid(); $('#ops', m.el).onclick = () => busy($('#ops', m.el), async () => { await POST(`/api/press/outsourcing/${r.id}/pay`, formData($('#opf', m.el)), { idemKey: key }); m.close(); toast('Paid'); App.refresh(); }); }
  });
}
async function outsourceModal({ order = null } = {}, done) {
  const sups = (await GET('/api/press/suppliers')).filter(s => s.active);
  if (!sups.length) { toast('Add a supplier first', 'Suppliers & Outsourcing', 'warn'); App.go('press-suppliers'); return; }
  const m = modal({ title: 'Outsource work', size: 'narrow', body: `<div class="form" id="osf">${field('Supplier', `<select name="supplier_id">${sups.map(s => opt(s.id, s.name)).join('')}</select>`)}
    ${order ? field('Product', `<select name="item_id"><option value="">Whole order</option>${order.items.filter(i => !i.cancelled).map(i => opt(i.id, i.product)).join('')}</select>`) : ''}
    ${field('Work description <span class="req">*</span>', `<input name="work" placeholder="Outside binding, spot UV…">`)}${field('Quantity', `<input type="number" min="0" step="any" name="qty">`)}${field('Cost (৳)', `<input type="number" min="0" step="any" name="cost">`)}
    ${field('Sent date', dateInput('sent_date'))}${field('Expected back', `<input type="date" name="delivery_date">`)}${field('Remarks', `<input name="remarks">`)}</div><div class="actions"><button class="btn" id="oss">Save</button></div>` });
  const key = uid();
  $('#oss', m.el).onclick = () => busy($('#oss', m.el), async () => { if (!requireFields(m.el, ['work'])) return; await POST('/api/press/outsourcing', { ...formData($('#osf', m.el)), order_id: order?.id }, { idemKey: key }); m.close(); toast('Saved'); done && done(); });
}

/* ======================= PRODUCTION BOARD + CALENDAR ======================= */
App.pages['press-production'] = {
  title: 'Production & Calendar', tab: 'board', cal: null,
  async render(v, sub) {
    if (['board', 'calendar', 'design'].includes(sub)) this.tab = sub;
    await pressSet();
    v.innerHTML = `${sideTabs([['board', 'Production board'], ['calendar', 'Calendar'], ['design', 'Design queue']], this.tab, 'press-production')}<div id="pane" class="tabpane"></div>`;
    const pane = $('#pane', v);
    if (this.tab === 'design') return designQueue(pane);
    if (this.tab === 'calendar') return this.calendar(pane);
    const rows = await GET('/api/press/production');
    const cols = ['Pending', 'Assigned', 'In Progress', 'On Hold', 'Completed'];
    pane.innerHTML = `<div class="row mb" style="gap:14px"><span class="tag red">${rows.filter(r => r.overdue).length} overdue</span><span class="sub">Operators don't log in — office staff update the steps from the order page.</span></div>
      <div style="display:grid;grid-template-columns:repeat(${cols.length},minmax(220px,1fr));gap:12px;overflow-x:auto">${cols.map(c => { const list = rows.filter(r => r.prod_status === c).slice(0, c === 'Completed' ? 25 : 200);
        return `<div class="panel" style="padding:12px;background:var(--card2)"><div class="row" style="justify-content:space-between;margin-bottom:8px">${pTag(c)}<b>${rows.filter(r => r.prod_status === c).length}</b></div>
        ${list.map(r => { const st = r.steps || [], done = st.filter(s => s.done).length; return `<div class="kpi" style="margin-bottom:8px;cursor:pointer;${r.overdue ? 'border-left:4px solid var(--danger)' : ''}" onclick="App.go('press-orders/${r.order_id}/production')">
          <div style="font-weight:800;font-size:14px;line-height:1.3">${esc(r.product)} <span class="sub" style="font-weight:600">× ${qn(r.qty)}</span></div><div class="sub">${esc(r.order_no)} · ${esc(r.customer)}</div>
          <div class="sub">${r.machine ? esc(r.machine) + ' · ' : ''}${r.assigned_staff ? esc(r.assigned_staff) : ''}</div>
          <div class="row" style="justify-content:space-between"><span class="sub">${done}/${st.length} · ${esc((st.find(s => !s.done) || {}).name || 'done')}</span><span class="sub" style="color:${r.overdue ? 'var(--danger)' : ''}">${fdate(r.est_completion || r.deadline)}</span></div>
          ${progress(done, st.length)}${r.design_required && r.design_status !== 'Approved' ? `<div class="mt">${dTag(r.design_status)}</div>` : ''}</div>`; }).join('') || '<div class="sub" style="text-align:center;padding:12px">—</div>'}</div>`; }).join('')}</div>`;
  },
  async calendar(el) {
    const c = this.cal = this.cal || { view: 'month', d: App.today };
    const d0 = new Date(c.d + 'T00:00:00');
    let from, to;
    if (c.view === 'month') { const f = new Date(d0.getFullYear(), d0.getMonth(), 1); const s = new Date(f); s.setDate(1 - ((f.getDay() + 6) % 7)); from = s; to = new Date(s); to.setDate(s.getDate() + 41); }
    else if (c.view === 'week') { from = new Date(d0); from.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); to = new Date(from); to.setDate(from.getDate() + 6); }
    else { from = new Date(d0); to = new Date(d0); }
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const rows = await GET('/api/press/calendar', { from: iso(from), to: iso(to) });
    const days = []; for (let x = new Date(from); x <= to; x.setDate(x.getDate() + 1)) days.push(iso(x));
    const on = day => rows.filter(r => r.start <= day && r.finish >= day);
    const shift = n => { const x = new Date(d0); if (c.view === 'month') x.setMonth(x.getMonth() + n); else x.setDate(x.getDate() + (c.view === 'week' ? 7 : 1) * n); c.d = iso(x); App.refresh(); };
    el.innerHTML = `<div class="head"><div class="row"><button class="btn sm ghost" id="cp">‹</button><b style="min-width:200px;text-align:center">${c.view === 'month' ? d0.toLocaleString('en', { month: 'long', year: 'numeric' }) : `${fdate(iso(from))} – ${fdate(iso(to))}`}</b><button class="btn sm ghost" id="cn">›</button><button class="btn sm ghost" id="ct">Today</button></div>
      <div class="seg">${['day', 'week', 'month'].map(x => `<button type="button" data-cv="${x}" class="${x === c.view ? 'on' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div></div>
      ${c.view === 'month' ? `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="sub" style="text-align:center;font-weight:700">${x}</div>`).join('')}
        ${days.map(day => { const L = on(day), dl = rows.filter(r => r.deadline === day); return `<div class="kpi" style="min-height:96px;padding:6px;${day === App.today ? 'outline:2px solid var(--blue)' : ''};${day.slice(5, 7) !== c.d.slice(5, 7) ? 'opacity:.45' : ''}">
          <div class="row" style="justify-content:space-between"><b class="small">${+day.slice(8)}</b>${dl.length ? `<span class="tag orange" title="deadline">${dl.length} due</span>` : ''}</div>
          ${L.slice(0, 3).map(r => `<div class="small" onclick="App.go('press-orders/${r.order_id}/production')" style="cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 4px;border-radius:4px;margin-top:2px;background:${r.overdue ? '#fde3e3' : r.prod_status === 'Completed' ? '#e2f5ec' : '#e7eef8'}">${esc(r.product)} · ${esc(r.customer)}</div>`).join('')}${L.length > 3 ? `<div class="sub">+${L.length - 3} more</div>` : ''}</div>`; }).join('')}</div>`
      : days.map(day => `<div class="panel"><h2>${new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</h2><div class="feed mt">${on(day).map(r => `<div class="feed-item" onclick="App.go('press-orders/${r.order_id}/production')"><div class="feed-ic" style="background:${r.overdue ? 'var(--danger)' : 'var(--blue)'}">${esc(r.product[0] || '?')}</div><div class="t"><b>${esc(r.product)} × ${qn(r.qty)}</b><small>${esc(r.order_no)} · ${esc(r.customer)} · ${esc(r.prod_status)}${r.machine ? ' · ' + esc(r.machine) : ''}${r.assigned_staff ? ' · ' + esc(r.assigned_staff) : ''} · ${fdate(r.start)} → ${fdate(r.finish)}</small></div>${r.overdue ? '<span class="tag red">Overdue</span>' : ''}</div>`).join('') || '<div class="empty">Nothing scheduled</div>'}</div></div>`).join('')}`;
    $('#cp', el).onclick = () => shift(-1); $('#cn', el).onclick = () => shift(1); $('#ct', el).onclick = () => { c.d = App.today; App.refresh(); };
    $$('[data-cv]', el).forEach(b => b.onclick = () => { c.view = b.dataset.cv; App.refresh(); });
  },
};
async function designQueue(el) {
  const rows = await GET('/api/press/design');
  dataTable(el, rows, [{ k: 'order_no', label: 'Order', f: r => `<b>${esc(r.order_no)}</b><div class="sub">${esc(r.customer)}</div>` }, { k: 'product', label: 'Product', f: r => `${esc(r.product)} × ${qn(r.qty)}<div class="sub">${r.design_source === 'customer' ? 'customer design' : 'our designer'}${r.designer ? ' · ' + esc(r.designer) : ''}</div>` },
    { k: 'design_status', label: 'Status', f: r => dTag(r.design_status) + ((r.design_revisions || []).length ? ` <span class="sub">${r.design_revisions.length} revision(s)</span>` : '') },
    { k: 'deadline', label: 'Deadline', f: r => fdate(r.deadline) }, { k: 'has_file', label: 'Final file', f: r => r.has_file ? '<span class="tag green">Saved</span>' : '—' },
    { k: 'design_approved_by', label: 'Approved by', f: r => r.design_approved_by ? `${esc(r.design_approved_by)}<div class="sub">${fdt(r.design_approved_at)}</div>` : '' }], { onRow: r => App.go(`press-orders/${r.order_id}/design`), empty: 'No designs' });
}

/* ======================= STORE ======================= */
App.pages['press-store'] = {
  title: 'Store / Inventory', tab: 'stock', f: null,
  async render(v, sub) {
    if (['stock', 'purchases', 'issues', 'returns', 'moves'].includes(sub)) this.tab = sub;
    const ps = await pressSet();
    const f = this.f = this.f || { from: monthStart(App.today), to: App.today, category: '' };
    v.innerHTML = `<div class="head"><div class="row"><input type="date" class="inp" id="sf" value="${f.from}" style="width:150px"><input type="date" class="inp" id="st" value="${f.to}" style="width:150px"><button class="btn sm" id="sgo">Apply</button></div>
      <div class="row">${can('press.store', 'internal') ? `<button class="btn ghost" id="sadd">${ICON.plus} Item</button>` : ''}${can('press.store') ? `<button class="btn green" id="spur">${ICON.plus} Purchase</button><button class="btn" id="siss">${ICON.truck} Issue material</button>` : ''}</div></div>
      ${sideTabs([['stock', 'Items & stock'], ['purchases', 'Purchases'], ['issues', 'Issue slips'], ['returns', 'Returns'], ['moves', 'All movements']], this.tab, 'press-store')}<div id="pane" class="tabpane"></div>`;
    $('#sgo', v).onclick = () => { Object.assign(f, { from: $('#sf', v).value, to: $('#st', v).value }); App.refresh(); };
    if ($('#sadd', v)) $('#sadd', v).onclick = () => storeItemModal(null, () => App.refresh());
    if ($('#spur', v)) $('#spur', v).onclick = () => purchaseModal(() => App.refresh());
    if ($('#siss', v)) $('#siss', v).onclick = () => issueModal({}, () => App.refresh());
    const pane = $('#pane', v);
    if (this.tab === 'stock') {
      const items = await GET('/api/store/items', { from: f.from, to: f.to });
      const cats = [...new Set(items.map(i => i.category))];
      const shown = f.category ? items.filter(i => i.category === f.category) : items;
      const low = items.filter(i => i.active && +i.low_stock > 0 && +i.balance <= +i.low_stock);
      pane.innerHTML = `<div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><small>Items</small><b>${items.length}</b></div><div class="stat" style="--c:var(--danger)"><small>Low stock</small><b>${low.length}</b><div class="foot">${low.slice(0, 3).map(i => esc(i.name)).join(', ')}</div></div>
          <div class="stat" style="--c:var(--ok)"><small>Stock value</small><b>${tk(items.reduce((s, i) => s + (+i.balance) * (+i.avg_cost || 0), 0))}</b><div class="foot">at average purchase cost</div></div><div class="stat" style="--c:var(--warn)"><small>Categories</small><b>${cats.length}</b></div></div>
        <div class="seg mb">${[['', 'All'], ...cats.map(c => [c, c])].map(([k, l]) => `<button type="button" data-c="${esc(k)}" class="${k === f.category ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
        <div class="panel"><div id="it"></div></div>`;
      $$('[data-c]', pane).forEach(b => b.onclick = () => { f.category = b.dataset.c; App.refresh(); });
      dataTable($('#it', pane), shown.map(i => ({ ...i, _cls: i.active ? '' : 'void' })), [
        { k: 'code', label: 'Code', f: r => `<span class="sub">${esc(r.code || '')}</span>` }, { k: 'name', label: 'Item', f: r => `<b>${esc(r.name)}</b><div class="sub">${esc([r.category, r.size, r.gsm && r.gsm + ' GSM', r.rack && 'Rack ' + r.rack].filter(Boolean).join(' · '))}</div>` },
        { k: 'opening_bal', label: 'B/F', n: 1, f: r => qn(r.opening_bal) }, { k: 'qty_in', label: 'In', n: 1, f: r => qn(r.qty_in) }, { k: 'qty_out', label: 'Out', n: 1, f: r => qn(r.qty_out) },
        { k: 'balance', label: 'Current stock', n: 1, f: r => `<b>${qn(r.balance)}</b> ${esc(r.unit)}${/^sheet$/i.test(r.unit) ? `<div class="sub">≈ ${qn(r.balance / ps.ream_sheets)} ream</div>` : ''}${r.active && +r.low_stock > 0 && +r.balance <= +r.low_stock ? ' <span class="tag orange">Low</span>' : ''}` },
        { k: 'low_stock', label: 'Minimum', n: 1, f: r => qn(r.low_stock) }, { k: 'avg_cost', label: 'Avg cost', n: 1, f: r => nf2.format(r.avg_cost || 0) },
        { k: 'x', label: '', sort: false, f: r => `${can('press.store', 'internal') ? `<button class="btn xs ghost" data-mv="${r.id}">Use / adjust</button> <button class="btn xs ghost" data-ed="${r.id}">Edit</button> <button class="btn xs ghost" data-del="${r.id}" style="color:var(--danger)">${ICON.trash.replace('<svg', '<svg width="13"')}</button>` : ''}` },
      ], { id: 'store', empty: 'No items — add paper, board, ink, plates, film, gum… ' });
      pane.onclick = e => {
        const ed = e.target.closest('[data-ed]'), dl = e.target.closest('[data-del]'), mv = e.target.closest('[data-mv]');
        if (ed) storeItemModal(items.find(i => i.id === +ed.dataset.ed), () => App.refresh());
        if (dl) { const it = items.find(i => i.id === +dl.dataset.del); masterDelete('/api/store/items/' + it.id, it.name); }
        if (mv) storeMoveModal(items.find(i => i.id === +mv.dataset.mv), () => App.refresh());
      };
    } else if (this.tab === 'purchases') {
      const rows = await GET('/api/store/purchases', f);
      pane.innerHTML = '<div class="panel"><div id="pt"></div></div>';
      dataTable($('#pt', pane), rows.map(r => ({ ...r, _cls: r.voided ? 'void' : '' })), [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'pur_no', label: 'Purchase', f: r => `<b>${esc(r.pur_no)}</b>${r.bill_ref ? `<div class="sub">Bill ${esc(r.bill_ref)}</div>` : ''}` }, { k: 'supplier', label: 'Supplier' },
        { k: 'lines', label: 'Items', f: r => `<span class="small">${(r.lines || []).map(l => `${esc(l.item)} ${qn(l.qty)} ${esc(l.unit)} @ ${nf2.format(l.rate)}`).join('<br>')}</span>` },
        { k: 'total', label: 'Total', n: 1, f: r => tk(r.total), total: d => tk(d.filter(r => !r.voided).reduce((s, r) => s + +r.total, 0)) }, { k: 'paid_expense_id', label: 'Paid', f: r => r.paid_expense_id ? '<span class="tag green">Expense</span>' : '<span class="tag gray">Credit</span>' },
        { k: 'created_by_name', label: 'By', f: r => `<span class="sub">${esc(r.created_by_name)}</span>` }, { k: 'x', label: '', sort: false, f: r => !r.voided && can('stock.adjust') ? `<button class="btn xs ghost" data-pv="${r.id}">Void</button>` : r.voided ? '<span class="tag red">Void</span>' : '' }], { totals: true, empty: 'No purchases' });
      pane.onclick = async e => { const b = e.target.closest('[data-pv]'); if (b) { const r = await confirmBox('Void purchase?', 'Stock is taken back out (only if not used yet).', { ok: 'Void', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/store/purchases/${b.dataset.pv}/void`, { reason: r }); App.refresh(); } catch (er) { fail(er); } } } };
    } else if (this.tab === 'issues') {
      const rows = await GET('/api/press/issues', f);
      pane.innerHTML = '<div class="panel"><div id="ist"></div></div>';
      dataTable($('#ist', pane), rows.map(r => ({ ...r, _cls: r.voided ? 'void' : '' })), [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'issue_no', label: 'Issue', f: r => `<b>${esc(r.issue_no)}</b>` },
        { k: 'order_no', label: 'Order / product', f: r => r.order_no ? `<a href="#/press-orders/${r.order_id}/materials">${esc(r.order_no)}</a><div class="sub">${esc(r.product || '')}</div>` : `<span class="sub">${esc(r.remarks || 'internal')}</span>` },
        { k: 'lines', label: 'Materials', f: r => `<span class="small">${(r.lines || []).map(l => `${esc(l.item)} ${qn(l.qty)} ${esc(l.unit)}${+l.returned ? ` (ret ${qn(l.returned)})` : ''}`).join('<br>')}</span>` },
        { k: 'total_cost', label: 'Cost', n: 1, f: r => tk(r.total_cost) }, { k: 'received_by', label: 'Received by' },
        { k: 'x', label: '', sort: false, f: r => `<button class="btn xs ghost" data-slip="${r.id}">${ICON.print}</button>${!r.voided && can('press.store') ? ` <button class="btn xs light" data-ret="${r.id}">Return</button>` : ''}${!r.voided && can('stock.adjust') && !(r.lines || []).some(l => +l.returned) ? ` <button class="btn xs ghost" data-iv="${r.id}">Void</button>` : ''}` }], { empty: 'No issue slips' });
      pane.onclick = async e => {
        const s = e.target.closest('[data-slip]'), rt = e.target.closest('[data-ret]'), iv = e.target.closest('[data-iv]');
        if (s) printHTML(issueSlipDoc(await GET('/api/press/issues/' + s.dataset.slip)), { size: 'A5' });
        if (rt) returnModal(+rt.dataset.ret, () => App.refresh());
        if (iv) { const r = await confirmBox('Void issue slip?', 'Materials go back to stock.', { ok: 'Void', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/press/issues/${iv.dataset.iv}/void`, { reason: r }); App.refresh(); } catch (er) { fail(er); } } }
      };
    } else if (this.tab === 'returns') {
      const rows = await GET('/api/press/returns', f);
      pane.innerHTML = '<div class="panel"><div id="rt"></div></div>';
      dataTable($('#rt', pane), rows, [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'return_no', label: 'Return' }, { k: 'issue_no', label: 'Original issue' }, { k: 'order_no', label: 'Order' }, { k: 'item', label: 'Item' },
        { k: 'qty', label: 'Qty', n: 1, f: r => `${qn(r.qty)} ${esc(r.unit)}` }, { k: 'condition', label: 'Condition', f: r => r.condition === 'usable' ? '<span class="tag green">Usable</span>' : '<span class="tag red">Damaged</span>' }, { k: 'reason', label: 'Reason' }, { k: 'received_by', label: 'Received by' }], { empty: 'No returns' });
    } else {
      const rows = await GET('/api/store/moves', f);
      const T = { opening: 'Opening', stock_in: 'Stock in', purchase: 'Purchase', use: 'Own use', job: 'Job', issue: 'Issue', return: 'Return', wastage: 'Wastage', adj_in: 'Adjust +', adj_out: 'Adjust −' };
      pane.innerHTML = '<div class="panel"><div id="mt"></div></div>';
      dataTable($('#mt', pane), rows.map(r => ({ ...r, _cls: r.voided ? 'void' : '' })), [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'item', label: 'Item', f: r => `${esc(r.item)}<div class="sub">${esc(r.category || '')}</div>` },
        { k: 'type', label: 'Type', f: r => `<span class="tag ${r.qty > 0 ? 'green' : 'orange'}">${T[r.type] || r.type}</span>${r.is_reversal ? ' <span class="tag gray">reversal</span>' : ''}` },
        { k: 'qty', label: 'Qty', n: 1, f: r => `<b style="color:${r.qty < 0 ? 'var(--danger)' : 'var(--ok)'}">${r.qty > 0 ? '+' : ''}${qn(r.qty)}</b> ${esc(r.unit)}` },
        { k: 'before_qty', label: 'Before → after', f: r => r.before_qty != null ? `<span class="sub">${qn(r.before_qty)} → ${qn(r.after_qty)}</span>` : '' },
        { k: 'ref_no', label: 'Ref / note', f: r => `${esc(r.ref_no || '')} <span class="sub">${esc(r.purpose || r.party || r.remarks || '')}</span>` },
        { k: 'created_by_name', label: 'By', f: r => `${esc(r.created_by_name)}<div class="sub">${fdt(r.created_at)}</div>` },
        { k: 'x', label: '', sort: false, f: r => !r.voided && !r.is_reversal && !r.ref_type && can('stock.adjust') ? `<button class="btn xs ghost" data-mvv="${r.id}">Void</button>` : '' }], { empty: 'No movements' });
      pane.onclick = async e => { const b = e.target.closest('[data-mvv]'); if (b) { const r = await confirmBox('Void this entry?', 'A reversal entry is recorded.', { ok: 'Void', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/store/moves/${b.dataset.mvv}/void`, { reason: r }); App.refresh(); } catch (er) { fail(er); } } } };
    }
  },
};
function storeItemModal(it, done) {
  const cats = PS?.store_cats || ['Paper'];
  const m = modal({ title: it ? 'Edit ' + it.name : 'Add store item', body: `<div class="form f2" id="sif">
    ${field('Category <span class="req">*</span>', `<input name="category" list="scl" value="${esc(it?.category || 'Paper')}"><datalist id="scl">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`)}${field('Item code', `<input name="code" value="${esc(it?.code || '')}" placeholder="auto if empty">`)}
    ${field('Item name', `<input name="name" value="${esc(it?.name || '')}" placeholder="auto for paper: type + GSM + size">`, 'span2')}
    ${field('Paper type', `<input name="paper_type" value="${esc(it?.paper_type || '')}" placeholder="Offset, Art card, Duplex…">`)}${field('GSM', `<input name="gsm" value="${esc(it?.gsm || '')}">`)}
    ${field('Size', `<input name="size" value="${esc(it?.size || '')}" placeholder="23x36">`)}${field('Colour', `<input name="color" value="${esc(it?.color || '')}">`)}
    ${field('Unit', `<input name="unit" list="sul" value="${esc(it?.unit || 'Sheet')}"><datalist id="sul">${['Sheet', 'Ream', 'Kg', 'Ltr', 'Pcs', 'Roll', 'ft', 'Box', 'Packet', 'Set'].map(u => `<option value="${u}">`).join('')}</datalist>`, '', 'Sheet or Ream: buy in reams, issue in sheets')}
    ${field('Minimum stock (alert)', `<input type="number" min="0" step="any" name="low_stock" value="${it ? +it.low_stock : 0}">`)}${field('Rack / shelf', `<input name="rack" value="${esc(it?.rack || '')}">`)}${field('Film width (inch)', `<input type="number" min="0" step="any" name="width_in" value="${it?.width_in ?? ''}">`)}
    ${it ? '' : field('Opening stock', `<input type="number" min="0" step="any" name="opening" value="0">`) + field('Opening cost / unit (৳)', `<input type="number" min="0" step="any" name="rate" value="0">`)}
    ${field('Remarks', `<input name="remarks" value="${esc(it?.remarks || '')}">`, 'span2')}<label class="check span2"><input type="checkbox" name="active" ${!it || it.active ? 'checked' : ''}> Active</label></div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="sis">Save</button></div>` });
  $('[data-x]', m.el).onclick = m.close;
  $('#sis', m.el).onclick = () => busy($('#sis', m.el), async () => { const b = formData($('#sif', m.el)); if (it) await PUT('/api/store/items/' + it.id, b); else await POST('/api/store/items', b, { idem: false }); m.close(); toast('Saved'); done && done(); });
}
function storeMoveModal(it, done) {
  const m = modal({ title: it.name, size: 'narrow', body: `<div class="sub">Current stock <b>${qn(it.balance)} ${esc(it.unit)}</b></div>
    <div class="seg mt" id="smt"><button type="button" data-t="use" class="on">Own use</button><button type="button" data-t="wastage">Waste / loss</button>${can('stock.adjust') ? '<button type="button" data-t="adjust">Count correction</button>' : ''}</div>
    <div class="form mt" id="smf">${field('Date', dateInput())}<div data-for="use wastage">${field('Quantity', `<input type="number" min="0" step="any" name="qty">`)}</div><div data-for="adjust" class="hide">${field('Correct quantity (counted)', `<input type="number" min="0" step="any" name="new_qty" value="${+it.balance}">`)}</div>
      <div data-for="use">${field('Used for <span class="req">*</span>', `<input name="purpose" placeholder="machine cleaning, office…">`)}</div><div data-for="wastage adjust" class="hide">${field('Reason <span class="req">*</span>', `<input name="reason">`)}</div>${field('Remarks', `<input name="remarks">`)}</div>
    <div class="actions"><button class="btn" id="sms">Save</button></div>` });
  let t = 'use';
  $$('#smt button', m.el).forEach(b => b.onclick = () => { t = b.dataset.t; $$('#smt button', m.el).forEach(x => x.classList.toggle('on', x === b)); $$('[data-for]', m.el).forEach(x => x.classList.toggle('hide', !x.dataset.for.split(' ').includes(t))); });
  const key = uid();
  $('#sms', m.el).onclick = () => busy($('#sms', m.el), async () => { const r = await POST('/api/store/moves', { ...formData($('#smf', m.el)), item_id: it.id, type: t }, { idemKey: key }); m.close(); toast('Saved', `stock now ${qn(r.balance)} ${it.unit}`); done && done(); });
}
async function purchaseModal(done) {
  const [items, sups, ps] = await Promise.all([GET('/api/store/items'), GET('/api/press/suppliers'), pressSet()]);
  const lines = [{ item_id: '', qty: '', unit: '', rate: '' }];
  const m = modal({ title: 'Purchase entry', size: 'wide', body: `<div class="form f4" id="puf">${field('Purchase date', dateInput())}${field('Supplier', `<select name="supplier_id"><option value="">—</option>${sups.filter(s => s.active).map(s => opt(s.id, s.name)).join('')}</select>`)}
      ${field('Bill no. / reference', `<input name="bill_ref" placeholder="optional">`)}${field('Remarks', `<input name="remarks">`)}</div><div id="pul" class="mt"></div><button class="btn sm ghost" id="puadd">${ICON.plus} Add item</button>
    <div class="row mt" style="justify-content:space-between;align-items:flex-end"><div class="row"><label class="check"><input type="checkbox" id="pupaid" checked> Paid now — record as expense</label><select class="inp" id="pumeth" style="width:140px">${App.meta.payment_methods.map(x => opt(x, x)).join('')}</select></div><b style="font-size:20px" id="putot">৳ 0</b></div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn green" id="pus">${ICON.check} Save purchase</button></div>` });
  const draw = () => { $('#pul', m.el).innerHTML = lines.map((l, i) => { const it = items.find(s => s.id === +l.item_id), rs = it && /^(ream|sheet)$/i.test(it.unit);
    return `<div class="form f4" data-l="${i}" style="margin-bottom:6px">${field('Item', `<select data-k="item_id"><option value="">—</option>${items.filter(s => s.active).map(s => opt(s.id, `${s.name} (${s.unit})`, l.item_id)).join('')}</select>`)}
      ${field('Quantity', `<input type="number" min="0" step="any" data-k="qty" value="${esc(l.qty)}">`)}${field('Unit', `<select data-k="unit">${it ? (rs ? ['Ream', 'Sheet'] : [it.unit]).map(u => opt(u, u, l.unit || (rs ? 'Ream' : it.unit))).join('') : ''}</select>`, '', rs ? `1 ream = ${ps.ream_sheets} sheets` : '')}
      ${field('Rate per unit (৳)', `<span class="row"><input type="number" min="0" step="any" data-k="rate" value="${esc(l.rate)}">${lines.length > 1 ? `<button class="btn xs ghost" data-rm="${i}" style="color:var(--danger)">✕</button>` : ''}</span>`)}</div>`; }).join('');
    $('#putot', m.el).textContent = tk(lines.reduce((s, l) => s + (+l.qty || 0) * (+l.rate || 0), 0)); };
  m.el.addEventListener('input', e => { const b = e.target.closest('[data-l]'); if (b && e.target.dataset.k) { const l = lines[+b.dataset.l]; l[e.target.dataset.k] = e.target.value; if (e.target.dataset.k === 'item_id') { const it = items.find(s => s.id === +l.item_id); l.unit = it ? (/^(ream|sheet)$/i.test(it.unit) ? 'Ream' : it.unit) : ''; draw(); } else $('#putot', m.el).textContent = tk(lines.reduce((s, x) => s + (+x.qty || 0) * (+x.rate || 0), 0)); } });
  m.el.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(+b.dataset.rm, 1); draw(); } });
  $('#puadd', m.el).onclick = () => { lines.push({ item_id: '', qty: '', unit: '', rate: '' }); draw(); };
  $('[data-x]', m.el).onclick = m.close; draw();
  const key = uid();
  $('#pus', m.el).onclick = () => busy($('#pus', m.el), async () => {
    const ls = lines.filter(l => l.item_id && +l.qty > 0); if (!ls.length) { toast('Add items', '', 'warn'); return; }
    const r = await POST('/api/store/purchases', { ...formData($('#puf', m.el)), lines: ls, record_expense: $('#pupaid', m.el).checked, method: $('#pumeth', m.el).value }, { idemKey: key });
    m.close(); toast('Purchase saved', `${r.pur_no} · ${tk(r.total)}`); done && done();
  });
}

/* ======================= DELIVERY & INVOICES ======================= */
App.pages['press-delivery'] = {
  title: 'Delivery Challan',
  async render(v, id) {
    if (id) {
      const ch = await GET('/api/press/challans/' + id);
      $('#title').textContent = ch.dc_no;
      v.innerHTML = `<div class="head"><button class="btn ghost" onclick="history.back()">← Back</button><div class="row">${ch.status === 'active' && can('invoice.cancel') ? `<button class="btn ghost" id="cc" style="color:var(--danger)">Cancel challan</button>` : ''}<a class="btn ghost" href="#/press-orders/${ch.order_id}/delivery">Order ${esc(ch.order_no)}</a><button class="btn" id="prt">${ICON.print} Print (A5)</button></div></div><div style="overflow:auto;padding:4px;max-width:900px">${pressChallanDoc(ch)}</div>`;
      $('#prt', v).onclick = () => printHTML(pressChallanDoc(ch), { size: 'A5', orient: 'portrait' });
      if ($('#cc', v)) $('#cc', v).onclick = async () => { const r = await confirmBox('Cancel challan?', 'Delivered quantity goes back to "remaining".', { ok: 'Cancel challan', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/press/challans/${id}/cancel`, { reason: r }); App.refresh(); } catch (e) { fail(e); } } };
      return;
    }
    const f = this.f = this.f || { from: monthStart(App.today), to: App.today, q: '' };
    const rows = await GET('/api/press/challans', f);
    v.innerHTML = `<div class="head"><div class="row"><input type="date" class="inp" id="cf" value="${f.from}" style="width:150px"><input type="date" class="inp" id="ct" value="${f.to}" style="width:150px"><button class="btn sm" id="cgo">Apply</button></div><div class="sub">New challans are made from the order (Delivery tab)</div></div><div class="panel"><div id="ct1"></div></div>`;
    $('#cgo', v).onclick = () => { Object.assign(f, { from: $('#cf', v).value, to: $('#ct', v).value }); App.refresh(); };
    dataTable($('#ct1', v), rows.map(r => ({ ...r, _cls: r.status === 'cancelled' ? 'void' : '' })), [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'dc_no', label: 'Challan', f: r => `<b>${esc(r.dc_no)}</b>` }, { k: 'order_no', label: 'Order' },
      { k: 'customer', label: 'Customer' }, { k: 'items', label: 'Delivered', f: r => `<span class="small">${esc(r.items || '')}</span>` }, { k: 'receiver', label: 'Receiver' }, { k: 'prepared_by', label: 'Prepared by' }, { k: 'status', label: 'Status', f: r => statusTag(r.status) }],
      { onRow: r => App.go('press-delivery/' + r.id), empty: 'No challans' });
  },
};
App.pages['press-invoices'] = {
  title: 'Final Invoices', tab: 'final',
  async render(v, id) {
    if (id && /^\d+$/.test(id)) return this.view(v, +id);
    if (['final', 'void', 'void_requested'].includes(id)) this.tab = id;
    const f = this.f = this.f || { from: monthStart(App.today), to: App.today, q: '' };
    const rows = await GET('/api/press/invoices', { ...f, status: this.tab });
    v.innerHTML = `<div class="head"><div class="row"><input type="date" class="inp" id="if" value="${f.from}" style="width:150px"><input type="date" class="inp" id="it" value="${f.to}" style="width:150px"><button class="btn sm" id="igo">Apply</button></div><div class="sub">Invoices are made from a fully delivered order</div></div>
      ${sideTabs([['final', 'Invoice register'], ['void', 'Void / cancelled register'], ['void_requested', 'Void requests']], this.tab, 'press-invoices')}<div class="panel"><div id="ivt"></div></div>`;
    $('#igo', v).onclick = () => { Object.assign(f, { from: $('#if', v).value, to: $('#it', v).value }); App.refresh(); };
    const cols = this.tab === 'void'
      ? [{ k: 'voided_at', label: 'Voided', f: r => fdt(r.voided_at) }, { k: 'inv_no', label: 'Original invoice', f: r => `<b>${esc(r.inv_no)}</b><div class="sub">${fdate(r.date)}</div>` }, { k: 'order_no', label: 'Order' }, { k: 'customer', label: 'Customer' }, { k: 'grand_total', label: 'Amount', n: 1, f: r => tk(r.grand_total) },
        { k: 'void_category', label: 'Category' }, { k: 'void_reason', label: 'Reason' }, { k: 'voided_by_name', label: 'Voided by', f: r => `${esc(r.voided_by_name || '')}${r.void_approved_by_name ? `<div class="sub">approved ${esc(r.void_approved_by_name)}</div>` : ''}` }]
      : [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'inv_no', label: 'Invoice', f: r => `<b>${esc(r.inv_no)}</b>${r.closed_early ? ' <span class="tag orange">closed early</span>' : ''}` }, { k: 'order_no', label: 'Order' }, { k: 'customer', label: 'Customer', f: r => `${esc(r.customer)}<div class="sub">${esc(r.phone || '')}</div>` },
        { k: 'grand_total', label: 'Total', n: 1, f: r => tk(r.grand_total), total: d => tk(d.reduce((s, r) => s + +r.grand_total, 0)) }, { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid) },
        { k: 'due', label: 'Due', n: 1, f: r => { const d = r.grand_total - r.paid; return d > 0.004 ? `<b style="color:var(--danger)">${tk(d)}</b>` : tk(0); } }, ...(this.tab === 'void_requested' ? [{ k: 'void_req_reason', label: 'Void request', f: r => `${esc(r.void_requested_name)}: ${esc(r.void_req_reason)}` }] : [])];
    dataTable($('#ivt', v), rows, cols, { onRow: r => App.go('press-invoices/' + r.id), totals: this.tab === 'final', empty: 'Nothing here' });
  },
  async view(v, id) {
    const inv = await GET('/api/press/invoices/' + id);
    $('#title').textContent = inv.inv_no;
    const ps = await pressSet();
    v.innerHTML = `<div class="head"><div class="row"><button class="btn ghost" onclick="history.back()">← Back</button>${inv.status === 'void' ? '<span class="tag red">VOID</span>' : '<span class="tag green">Final</span>'}</div><div class="row">
        <a class="btn ghost" href="#/press-orders/${inv.order_id}">Order ${esc(inv.order_no)}</a>
        ${inv.status === 'final' && inv.due > 0.004 && can('payments') ? `<button class="btn green" id="ipay">${ICON.money} Receive payment</button>` : ''}
        ${inv.status === 'final' && can('press.invoice.void') && !inv.void_requested_at ? `<button class="btn ghost" id="ivoid" style="color:var(--danger)">Void invoice</button>` : ''}
        ${inv.status === 'final' && inv.void_requested_at && can('press.invoice.void') ? `<button class="btn danger" id="iva">Approve void</button><button class="btn ghost" id="ivr">Reject</button>` : ''}
        <button class="btn" id="iprt">${ICON.print} Print (A4)</button></div></div>
      ${inv.void_requested_at && inv.status === 'final' ? `<div class="note danger">Void requested by ${esc(inv.void_requested_name)} (${esc(inv.void_req_category)}): ${esc(inv.void_req_reason)} — a different person must approve.</div>` : ''}
      ${inv.status === 'void' ? `<div class="note danger">VOID · ${fdt(inv.voided_at)} by ${esc(inv.voided_by_name)} · ${esc(inv.void_category || '')}: ${esc(inv.void_reason)}. The number ${esc(inv.inv_no)} will never be reused; linked payments stayed with the order.</div>` : ''}
      <div class="grid g32"><div style="overflow:auto;padding:4px">${pressInvoiceDoc(inv)}</div>
        <div class="panel"><h2>Payments on this invoice</h2><div class="feed mt">${inv.payments.map(p => `<div class="feed-item"><div class="feed-ic" style="background:var(--ok)">৳</div><div class="t"><b>${tk(p.amount)}</b><small>${esc(p.receipt_no)} · ${fdate(p.date)} ${esc(p.time || '')} · ${esc(p.method)}</small></div></div>`).join('') || '<div class="empty">No payments</div>'}</div></div></div>`;
    $('#iprt', v).onclick = () => printHTML(pressInvoiceDoc(inv), { size: 'A4', orient: 'portrait' });
    if ($('#ipay', v)) $('#ipay', v).onclick = async () => { const o = await GET('/api/press/orders/' + inv.order_id); paymentModal({ customer: o.customer, order: o }, () => App.refresh()); };
    if ($('#ivoid', v)) $('#ivoid', v).onclick = () => {
      const m = modal({ title: 'Void ' + inv.inv_no, size: 'narrow', body: `<div class="note">The invoice is NOT deleted — it moves to the void register with your reason. Payments stay with the order (refund or re-invoice later).${ps.void_needs_approval ? ' <b>A second person must approve.</b>' : ''}</div>
        <div class="form" id="vf">${field('Reason category', `<select name="category">${ps.void_cats.map(c => opt(c, c)).join('')}</select>`)}${field('Reason <span class="req">*</span>', `<input name="reason">`)}</div><div class="actions"><button class="btn danger" id="vs">Void invoice</button></div>` });
      $('#vs', m.el).onclick = () => busy($('#vs', m.el), async () => { if (!requireFields(m.el, ['reason'])) return; const r = await POST(`/api/press/invoices/${id}/void`, formData($('#vf', m.el)), { idem: false }); m.close(); toast(r.pending_approval ? 'Void request sent for approval' : 'Invoice voided'); App.refresh(); });
    };
    if ($('#iva', v)) $('#iva', v).onclick = async () => { if (await confirmBox('Approve void?', inv.void_req_reason, { ok: 'Approve void', danger: true })) { try { await POST(`/api/press/invoices/${id}/void-approve`, {}, { idem: false }); toast('Voided'); App.refresh(); } catch (e) { fail(e); } } };
    if ($('#ivr', v)) $('#ivr', v).onclick = async () => { try { await POST(`/api/press/invoices/${id}/void-reject`, {}, { idem: false }); toast('Request rejected'); App.refresh(); } catch (e) { fail(e); } };
  },
};

/* ======================= OTHER PAGES ======================= */
App.pages['press-materials'] = {
  title: 'Customer Materials',
  async render(v) {
    const rows = await GET('/api/press/materials');
    v.innerHTML = `<div class="head"><div class="sub">Material customers bring for lamination, die cutting, cutting or binding — not part of our stock. No receiving challan.</div>${can('press.orders', 'press.store') ? `<button class="btn" id="rcv">${ICON.plus} Receive material</button>` : ''}</div><div class="panel"><div id="mt"></div></div>`;
    materialsTable($('#mt', v), rows);
    if ($('#rcv', v)) $('#rcv', v).onclick = () => receiveMaterialModal({}, () => App.refresh());
  },
};
App.pages['press-machines'] = {
  title: 'Machines',
  async render(v) {
    const rows = await GET('/api/press/machines');
    v.innerHTML = `<div class="head"><div class="sub">Machines and the jobs planned on them. Operators don't log in.</div>${can('press.machines') ? `<button class="btn" id="madd">${ICON.plus} Add machine</button>` : ''}</div>
      <div class="grid g3">${rows.map(m => `<div class="panel ${m.active ? '' : 'void'}"><div class="head"><div><h2>${esc(m.name)}</h2><div class="sub">${esc(m.type || '')}</div></div><span class="tag ${m.status === 'Active' ? 'green' : m.status === 'Maintenance' ? 'orange' : 'gray'}">${esc(m.status || '')}</span></div>
        ${m.specs ? `<div class="sub">${esc(m.specs)}</div>` : ''}${m.maintenance || m.next_service ? `<div class="note mt">${esc(m.maintenance || '')}${m.next_service ? ` · next service ${fdate(m.next_service)}` : ''}</div>` : ''}
        <h2 class="mt" style="font-size:12px">Assigned jobs (${(m.jobs || []).length})</h2><div class="feed">${(m.jobs || []).slice(0, 6).map(j => `<div class="feed-item" onclick="App.go('press-orders/${j.order_id}/production')"><div class="t"><b>${esc(j.product)}</b><small>${esc(j.order_no)} · ${esc(j.status)} · due ${fdate(j.due)}</small></div></div>`).join('') || '<div class="sub">No running jobs</div>'}</div>
        ${can('press.machines') ? `<div class="actions"><button class="btn xs ghost" data-md="${m.id}" style="color:var(--danger)">Delete</button><button class="btn xs ghost" data-me="${m.id}">Edit</button></div>` : ''}</div>`).join('') || '<div class="empty">Add your machines: two colour offset, lamination, cutting, die cutting, Wire-O…</div>'}</div>`;
    const edit = m => {
      const md = modal({ title: m ? 'Edit machine' : 'Add machine', body: `<div class="form f2" id="mf">${field('Machine name <span class="req">*</span>', `<input name="name" value="${esc(m?.name || '')}">`)}${field('Type', `<input name="type" list="mtl" value="${esc(m?.type || '')}"><datalist id="mtl">${['Offset (2 colour)', 'Offset (4 colour)', 'Lamination', 'Cutting', 'Binding', 'Diary punch', 'Wire-O binding', 'Die cutting'].map(x => `<option value="${x}">`).join('')}</datalist>`)}
        ${field('Status', `<select name="status">${['Active', 'Maintenance', 'Idle', 'Out of service'].map(x => opt(x, x, m?.status)).join('')}</select>`)}${field('Last service', `<input type="date" name="last_service" value="${m?.last_service || ''}">`)}${field('Next service', `<input type="date" name="next_service" value="${m?.next_service || ''}">`)}
        ${field('Specifications', `<input name="specs" value="${esc(m?.specs || '')}" placeholder="max sheet, colours, speed…">`)}${field('Maintenance information', `<input name="maintenance" value="${esc(m?.maintenance || '')}">`, 'span2')}${field('Remarks', `<input name="remarks" value="${esc(m?.remarks || '')}">`, 'span2')}
        <label class="check span2"><input type="checkbox" name="active" ${!m || m.active ? 'checked' : ''}> Active</label></div><div class="actions"><button class="btn" id="ms">Save</button></div>` });
      $('#ms', md.el).onclick = () => busy($('#ms', md.el), async () => { const b = formData($('#mf', md.el)); if (m) await PUT('/api/press/machines/' + m.id, b); else await POST('/api/press/machines', b, { idem: false }); md.close(); toast('Saved'); App.refresh(); });
    };
    if ($('#madd', v)) $('#madd', v).onclick = () => edit(null);
    v.onclick = e => { const b = e.target.closest('[data-me]'), d = e.target.closest('[data-md]'); if (b) edit(rows.find(m => m.id === +b.dataset.me)); if (d) masterDelete('/api/press/machines/' + d.dataset.md, rows.find(m => m.id === +d.dataset.md).name); };
  },
};
App.pages['press-suppliers'] = {
  title: 'Suppliers & Outsourcing', tab: 'suppliers',
  async render(v, sub) {
    if (['suppliers', 'outsourcing'].includes(sub)) this.tab = sub;
    v.innerHTML = `<div class="head"><div></div><div class="row">${can('press.suppliers', 'press.store') ? `<button class="btn ghost" id="sadd">${ICON.plus} Supplier</button>` : ''}${can('press.suppliers') ? `<button class="btn" id="oadd">${ICON.plus} Outsource work</button>` : ''}</div></div>
      ${sideTabs([['suppliers', 'Suppliers'], ['outsourcing', 'Outsourced work']], this.tab, 'press-suppliers')}<div class="panel"><div id="pane"></div></div>`;
    const edit = s => { const m = modal({ title: s ? 'Edit supplier' : 'Add supplier', body: `<div class="form f2" id="sf">${field('Name <span class="req">*</span>', `<input name="name" value="${esc(s?.name || '')}">`)}${field('Contact person', `<input name="contact_person" value="${esc(s?.contact_person || '')}">`)}${field('Phone', `<input name="phone" value="${esc(s?.phone || '')}">`)}${field('Supplies', `<input name="supplies" value="${esc(s?.supplies || '')}" placeholder="paper, ink, binding…">`)}${field('Address', `<input name="address" value="${esc(s?.address || '')}">`, 'span2')}${field('Remarks', `<input name="remarks" value="${esc(s?.remarks || '')}">`, 'span2')}<label class="check"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Active</label></div><div class="actions"><button class="btn" id="ss">Save</button></div>` });
      $('#ss', m.el).onclick = () => busy($('#ss', m.el), async () => { const b = formData($('#sf', m.el)); if (s) await PUT('/api/press/suppliers/' + s.id, b); else await POST('/api/press/suppliers', b, { idem: false }); m.close(); toast('Saved'); App.refresh(); }); };
    if ($('#sadd', v)) $('#sadd', v).onclick = () => edit(null);
    if ($('#oadd', v)) $('#oadd', v).onclick = () => outsourceModal({}, () => App.refresh());
    const pane = $('#pane', v);
    if (this.tab === 'outsourcing') return outsourcingTable(pane, await GET('/api/press/outsourcing'));
    const rows = await GET('/api/press/suppliers');
    dataTable(pane, rows.map(r => ({ ...r, _cls: r.active ? '' : 'void' })), [{ k: 'name', label: 'Supplier', f: r => `<b>${esc(r.name)}</b><div class="sub">${esc(r.supplies || '')}</div>` }, { k: 'phone', label: 'Contact', f: r => `${esc(r.contact_person || '')}<div class="sub">${esc(r.phone || '')}</div>` },
      { k: 'purchases', label: 'Purchases', n: 1, f: r => tk(r.purchases) }, { k: 'out_cost', label: 'Outsourcing', n: 1, f: r => tk(r.out_cost) }, { k: 'out_paid', label: 'Outsourcing unpaid', n: 1, f: r => +r.out_cost - +r.out_paid > 0.004 ? `<b style="color:var(--danger)">${tk(r.out_cost - r.out_paid)}</b>` : tk(0) },
      { k: 'x', label: '', sort: false, f: r => can('press.suppliers', 'press.store') ? `<button class="btn xs ghost" data-se="${r.id}">Edit</button> <button class="btn xs ghost" data-sd="${r.id}" style="color:var(--danger)">${ICON.trash.replace('<svg', '<svg width="13"')}</button>` : '' }], { empty: 'No suppliers' });
    pane.onclick = e => { const b = e.target.closest('[data-se]'), d = e.target.closest('[data-sd]'); if (b) edit(rows.find(r => r.id === +b.dataset.se)); if (d) masterDelete('/api/press/suppliers/' + d.dataset.sd, rows.find(r => r.id === +d.dataset.sd).name); };
  },
};
App.pages['press-calc'] = {
  title: 'Paper & Printing Calculator',
  async render(v) {
    const ps = await pressSet();
    const st = this.st = this.st || { size: 0 };
    v.innerHTML = `<div class="grid g2"><div class="panel"><h2>Job</h2><div class="form f2 mt" id="cf">
        ${field('Sheet size (inch)', `<select name="size">${ps.paper_sizes.map((p, i) => opt(i, `${p.w} × ${p.l}`, st.size)).join('')}<option value="c">Custom…</option></select>`)}
        ${field('GSM', `<select name="gsm"></select>`)}<div class="hide" id="cus">${field('Custom sheet W × L (inch)', `<span class="row"><input type="number" step="any" name="cw" placeholder="W"><input type="number" step="any" name="cl" placeholder="L"></span>`)}</div><div></div>
        ${field('Product width (inch)', `<input type="number" step="any" name="pw" value="${st.pw || 8.27}">`)}${field('Product length (inch)', `<input type="number" step="any" name="pl" value="${st.pl || 11.69}">`)}
        ${field('Order quantity', `<input type="number" name="qty" value="${st.qty || 1000}">`)}${field('Sides', `<select name="sides"><option value="1">One side</option><option value="2">Two side</option></select>`)}
        ${field('Make-ready sheets (per side)', `<input type="number" name="make_ready" value="${ps.make_ready_sheets}">`)}${field('Wastage %', `<input type="number" step="any" name="wastage_pct" value="${ps.wastage_pct}">`)}
        ${field('Gripper (inch)', `<input type="number" step="any" name="gripper" value="0">`)}${field('Margin each side (inch)', `<input type="number" step="any" name="margin" value="0">`)}
        ${field('Gap between pieces (inch)', `<input type="number" step="any" name="gap" value="0">`)}${field('Sheets per ream', `<input type="number" name="ream_sheets" value="${ps.ream_sheets}">`)}
        ${field('Paper price', `<span class="row"><input type="number" step="any" name="price" placeholder="৳"><select name="price_unit"><option value="ream">per ream</option><option value="sheet">per sheet</option><option value="kg">per kg</option></select></span>`, 'span2')}</div></div>
      <div class="panel"><h2>Result</h2><div id="cr" class="mt"></div><div class="note mt">Simple calculation. Machine-wise gripper, margin, imposition and front/back settings should be checked before buying paper.</div></div></div>`;
    const gsm = () => { const i = $('[name=size]', v).value, p = ps.paper_sizes[+i]; $('#cus', v).classList.toggle('hide', i !== 'c'); $('[name=gsm]', v).innerHTML = (p ? p.gsm : [60, 70, 80, 100, 120, 150, 210, 250, 300]).map(g => opt(g, g + ' GSM', st.gsm || 80)).join(''); };
    let t;
    const run = () => { clearTimeout(t); t = setTimeout(async () => {
      const d = formData($('#cf', v)); const p = ps.paper_sizes[+d.size]; Object.assign(st, { size: d.size, pw: d.pw, pl: d.pl, qty: d.qty, gsm: d.gsm });
      const body = { ...d, sheet_w: p ? p.w : d.cw, sheet_l: p ? p.l : d.cl, piece_w: d.pw, piece_l: d.pl };
      try { const r = await POST('/api/press/calculate', body, { idem: false });
        $('#cr', v).innerHTML = `<div class="stats" style="grid-template-columns:repeat(2,1fr)"><div class="stat"><small>Pieces per sheet</small><b>${r.ups}</b><div class="foot">${r.best} · normal ${r.normal} · rotated ${r.rotated}${r.mixed > Math.max(r.normal, r.rotated) ? ' · mixed ' + r.mixed : ''}</div></div>
          <div class="stat" style="--c:var(--ok)"><small>Total sheets</small><b>${n0(r.total_sheets)}</b><div class="foot">${qn(r.reams)} ream</div></div></div>
          <div class="kv"><span>Printing sheets</span><b>${n0(r.run_sheets)}</b><span>Make-ready</span><b>${n0(r.make_ready)}</b><span>Wastage (${r.wastage_pct}%)</span><b>${n0(r.wastage)}</b><span>Extra pieces</span><b>${n0(r.extra_pieces)}</b>
            <span>Weight per sheet</span><b>${r.sheet_kg} kg</b><span>Total weight</span><b>${qn(r.weight_kg)} kg</b>${r.cost != null ? `<span>Paper cost</span><b style="font-size:18px">${tk(r.cost)}</b>` : ''}</div>`; }
      catch (e) { $('#cr', v).innerHTML = `<div class="note danger">${esc(e.message)}</div>`; } }, 250); };
    $('[name=size]', v).onchange = () => { gsm(); run(); };
    $('#cf', v).oninput = run; gsm(); run();
  },
};
App.pages['press-settings'] = {
  title: 'Printing Press Settings',
  async render(v) {
    const ps = await pressSet(true);
    v.innerHTML = `<div class="grid g2"><div class="panel"><div class="head"><div><h2>Product types & production steps</h2><div class="sub">One step per line. Steps with "print" or "plate" need an approved design.</div></div><button class="btn sm ghost" id="tadd">${ICON.plus} Add</button></div><div id="tl"></div></div>
      <div><div class="panel"><h2>Rules</h2><div class="form f2 mt" id="rf">${field('Back-dated entry allowed (days)', `<input type="number" min="0" name="backdate_days" value="${ps.backdate_days}">`, 'span2', 'staff can enter work from the paper register after a power / internet cut; older needs the "Back-date entries" permission')}
          ${field('Sheets per ream', `<input type="number" min="1" name="ream_sheets" value="${ps.ream_sheets}">`)}${field('Make-ready sheets (default)', `<input type="number" min="0" name="make_ready_sheets" value="${ps.make_ready_sheets}">`)}${field('Wastage % (default)', `<input type="number" min="0" step="any" name="wastage_pct" value="${ps.wastage_pct}">`)}
          <label class="check span2"><input type="checkbox" name="void_needs_approval" ${ps.void_needs_approval ? 'checked' : ''}> Invoice void needs a second person's approval</label>
          ${field('Order types (comma separated)', `<input name="order_types" value="${esc(ps.order_types.join(', '))}">`, 'span2')}</div></div>
        <div class="panel"><div class="head"><div><h2>Paper size database</h2><div class="sub">inch · GSM list comma separated</div></div><button class="btn sm ghost" id="padd">${ICON.plus} Add size</button></div><div id="pl"></div></div></div></div>
      <div class="actions"><button class="btn" id="psave">${ICON.check} Save settings</button></div>`;
    const T = ps.templates.map(t => ({ name: t.name, steps: t.steps.join('\n') })), P = ps.paper_sizes.map(p => ({ ...p, gsm: p.gsm.join(', ') }));
    const drawT = () => { $('#tl', v).innerHTML = T.map((t, i) => `<div class="kpi" style="margin-bottom:8px" data-t="${i}"><div class="row"><input class="inp" data-k="name" value="${esc(t.name)}" style="flex:1;font-weight:700"><button class="btn xs ghost" data-trm="${i}" style="color:var(--danger)">✕</button></div><textarea class="inp mt" data-k="steps" rows="3" style="width:100%">${esc(t.steps)}</textarea></div>`).join(''); };
    const drawP = () => { $('#pl', v).innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>W</th><th>L</th><th>GSM</th><th></th></tr></thead><tbody>${P.map((p, i) => `<tr data-p="${i}"><td><input class="inp" type="number" step="any" data-k="w" value="${p.w}" style="width:80px"></td><td><input class="inp" type="number" step="any" data-k="l" value="${p.l}" style="width:80px"></td><td><input class="inp" data-k="gsm" value="${esc(p.gsm)}"></td><td><button class="btn xs ghost" data-prm="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>`; };
    v.addEventListener('input', e => { const t = e.target.closest('[data-t]'), p = e.target.closest('[data-p]'); if (t && e.target.dataset.k) T[+t.dataset.t][e.target.dataset.k] = e.target.value; if (p && e.target.dataset.k) P[+p.dataset.p][e.target.dataset.k] = e.target.value; });
    v.addEventListener('click', e => { const a = e.target.closest('[data-trm]'), b = e.target.closest('[data-prm]'); if (a) { T.splice(+a.dataset.trm, 1); drawT(); } if (b) { P.splice(+b.dataset.prm, 1); drawP(); } });
    $('#tadd', v).onclick = () => { T.push({ name: 'New product type', steps: 'Design\nDesign approval\nPrinting\nSubmit to office' }); drawT(); };
    $('#padd', v).onclick = () => { P.push({ w: '', l: '', gsm: '80, 100' }); drawP(); };
    $('#psave', v).onclick = () => busy($('#psave', v), async () => {
      const r = formData($('#rf', v));
      await PUT('/api/press/settings', { ...r, void_needs_approval: $('[name=void_needs_approval]', v).checked, order_types: String(r.order_types).split(',').map(x => x.trim()).filter(Boolean), templates: T, paper_sizes: P });
      await pressSet(true); await App.loadMeta(); toast('Settings saved');
    });
    drawT(); drawP();
  },
};
