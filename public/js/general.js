/* Old "General" job bills (before the Printing Press module) — view, print, cancel with refund. New jobs are Press orders / counter jobs. */
'use strict';
const PU = { pc: 'per piece', sqin: 'per sq inch', sqft: 'per sq ft', book: 'per book', set: 'per set', h100: 'per 100 pcs', k1000: 'per 1000 pcs', job: 'per job' };
const PU_SHORT = { pc: '/pc', sqin: '/sq in', sqft: '/sq ft', book: '/book', set: '/set', h100: '/100', k1000: '/1000', job: '/job' };
const GKIND = {
  lamination: { title: 'Lamination Film', one: 'film roll', unit: 'ft', perm: 'general.stock', edit: 'general.items', icon: 'roll' },
  paper: { title: 'Paper Stock', one: 'paper', unit: '', perm: 'general.stock', edit: 'general.items', icon: 'doc' },
  internal: { title: 'Internal Inventory', one: 'item', unit: '', perm: 'internal', edit: 'internal', icon: 'box' },
};
const MV = { opening: ['Opening', 'gray'], stock_in: ['Stock in', 'green'], use: ['Own use', 'orange'], job: ['Used in job', 'teal'], wastage: ['Wastage', 'red'], adj_in: ['Adjust +', 'gray'], adj_out: ['Adjust −', 'gray'] };
const qf = n => nf0.format(Math.round((+n || 0) * 1000) / 1000);
let GEN_SET = null;
async function genSet(force) { if (!GEN_SET || force) GEN_SET = await GET('/api/general/settings'); return GEN_SET; }

/** line amount — mirrors the server calculation exactly */
function genLineCalc(l, t) {
  const unit = l.price_unit || t?.unit || 'pc', qty = +l.qty || 0, rate = +l.rate || 0, w = +l.w || 0, len = +l.l || 0;
  const billed = Math.max(qty, +(t?.min_qty) || 0), area = w * len;
  const amt = { pc: billed * rate, book: billed * rate, set: billed * rate, job: billed * rate, h100: billed / 100 * rate, k1000: billed / 1000 * rate, sqin: area * billed * rate, sqft: area / 144 * billed * rate }[unit] || 0;
  return { billed, amount: Math.round(amt * 100) / 100, area };
}
function filmUse(l, film) {
  if (!film) return null;
  const w = +l.w || 0, len = +l.l || 0, fw = +film.width_in; if (!(w > 0 && len > 0)) return null;
  const run = w <= fw ? len : len <= fw ? w : null;
  return run == null ? 'nofit' : Math.round(run * (+l.qty || 0) / 12 * 1000) / 1000;
}

/* ---------------- print template ---------------- */
function genInvoiceDoc(inv) {
  const c = App.meta.settings.company || {};
  const rows = inv.items.map((i, k) => `<tr><td>${k + 1}</td><td><b>${esc(i.job_type)}</b>${i.description ? `<div class="muted">${esc(i.description)}</div>` : ''}${i.colours ? `<div class="muted">${i.colours} colour</div>` : ''}</td>
    <td class="n">${i.w && i.l ? `${+i.w}" × ${+i.l}"` : '—'}</td><td class="n">${qf(i.qty)}${+i.billed_qty > +i.qty ? `<div class="muted">min ${qf(i.billed_qty)}</div>` : ''}</td>
    <td class="n">${nf2.format(i.rate)}<span class="muted">${PU_SHORT[i.price_unit] || ''}</span></td><td class="n">${nf2.format(i.line_total)}</td></tr>`).join('');
  return `<div class="doc" style="position:relative">${inv.status === 'cancelled' ? '<div class="watermark">CANCELLED</div>' : ''}
    ${companyHeader(`<div style="text-align:right"><div class="doc-title">${esc(c.gen_invoice_title || 'BILL / CASH MEMO')}</div><div style="font-size:20px;font-weight:800;margin-top:8px">${esc(inv.inv_no)}</div></div>`)}
    <div class="meta"><div><b>Date:</b> ${fdate(inv.date)}</div><div><b>Job no:</b> ${esc(inv.job_no || '')}</div>
      <div><b>Customer:</b> ${esc(inv.customer)}${inv.company ? ' — ' + esc(inv.company) : ''}</div><div><b>Phone:</b> ${esc(inv.phone || '')}</div>
      <div style="grid-column:1/-1"><b>Address:</b> ${esc(inv.address || '')}</div></div>
    <table><thead><tr><th>SL</th><th>Job / description</th><th class="n">Size</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row" style="align-items:flex-start;margin-top:10px">
      <div style="flex:1;font-size:12px"><div><b>Delivery date:</b> ${fdate(inv.delivery_date)}</div><div><b>Previous due:</b> ${tk(Math.max(0, inv.prev_due))}</div>
        <div><b>In word:</b> ${inWords(inv.grand_total)}</div><div class="muted">Payment: ${esc(inv.payment_method || '')} · Status: ${esc(inv.pay_status)}</div>${inv.remarks ? `<div><b>Remarks:</b> ${esc(inv.remarks)}</div>` : ''}</div>
      <div class="sum">${inv.discount ? `<div><span>Subtotal</span><span>${nf2.format(inv.subtotal)}</span></div><div><span>Discount</span><span>− ${nf2.format(inv.discount)}</span></div>` : ''}
        <div class="k"><span>TOTAL</span><span>${nf2.format(inv.grand_total)}</span></div><div><span>PAID</span><span>${nf2.format(inv.paid)}</span></div><div class="k"><span>BALANCE</span><span>${nf2.format(inv.due)}</span></div></div></div>
    <div class="fine">N.B: ${esc(c.invoice_note || '')}</div>
    <div class="sign"><div>Customer's signature</div><div>Authorize signature<br><span class="muted">${esc(inv.created_by_name || '')}</span></div></div></div>`;
}


App.pages['gen-invoices'] = {
  title: 'Old job bill',
  async render(v, id) {
    if (!id) { App.go('press-orders'); return; }
    const inv = await GET('/api/gen/invoices/' + id);
    $('#title').textContent = inv.inv_no;
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="history.back()">← Back</button><div class="row">
        ${inv.status === 'confirmed' && can('invoice.cancel') ? `<button class="btn ghost" id="gcan" style="color:var(--danger)">Cancel bill</button>` : ''}<button class="btn" id="gprt">${ICON.print} Print / PDF</button></div></div>
      <div class="note">This is a bill from the old "General" section. New ID card / lamination / binding jobs are made as Printing Press orders or counter jobs.</div>
      <div style="overflow:auto;padding:4px;max-width:900px">${genInvoiceDoc(inv)}</div>`;
    $('#gprt', v).onclick = () => printHTML(genInvoiceDoc(inv));
    if ($('#gcan', v)) $('#gcan', v).onclick = async () => {
      const r = await cancelWithRefund({ title: 'Cancel ' + inv.inv_no + '?', text: 'Film and paper used are returned to stock.', paid: inv.paid, ok: 'Cancel bill' });
      if (r) { try { await POST(`/api/gen/invoices/${id}/cancel`, r); toast('Bill cancelled'); App.refresh(); } catch (e) { fail(e); } }
    };
  },
};

/* ---------------- Internal Inventory (own-use items: PVC solvent, CTP wash / developer, filter paper, anything the business adds) ---------------- */
const IUNITS = () => (App.meta.settings.lists?.internal_units?.length ? App.meta.settings.lists.internal_units : ['Ltr', 'Pcs', 'Kg', 'Box', 'Roll', 'Packet', 'Bottle', 'Set']);
function internalItemModal(it, done) {
  const m = modal({ title: it ? 'Edit ' + it.name : 'Add internal item', icon: ICON.box, body: `<div class="form" id="iif">
    ${field('Item name <span class="req">*</span>', `<input name="name" value="${esc(it?.name || '')}" placeholder="e.g. PVC Solvent, CTP Wash, Filter Paper, A4 Paper">`, 'span2')}
    ${field('Unit', `<input name="unit" list="iunits" value="${esc(it?.unit || 'Ltr')}"><datalist id="iunits">${IUNITS().map(u => `<option value="${esc(u)}">`).join('')}</datalist>`, '', it ? 'cannot change after stock entries' : '')}
    ${field('Low-stock alert at', `<input name="low_stock" type="number" step="any" min="0" value="${it ? +it.low_stock : ''}">`)}
    ${it ? '' : field('Opening stock', `<input name="opening" type="number" step="any" min="0" placeholder="0">`)}
    ${field('Remarks', `<input name="remarks" value="${esc(it?.remarks || '')}">`, it ? 'span2' : '')}</div>
    <div class="row mt right"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="iis">Save</button></div>`, size: 'narrow' });
  $('[data-x]', m.el).onclick = m.close;
  $('#iis', m.el).onclick = () => busy($('#iis', m.el), async () => {
    const d = formData($('#iif', m.el)); if (!requireFields($('#iif', m.el), ['name'])) return;
    try { it ? await PUT('/api/gen/internal/items/' + it.id, d) : await POST('/api/gen/internal/items', d); toast('Saved'); m.close(); done && done(); } catch (er) { fail(er); }
  });
}
function internalMoveModal(items, it, type, done) {
  const T = { stock_in: 'Stock in (bought / received)', use: 'Own use (stock out)', wastage: 'Wastage / spilled', adj_in: 'Adjust + (count found more)', adj_out: 'Adjust − (count found less)' };
  const m = modal({ title: T[type], icon: ICON.box, body: `<div class="form" id="imf">
    ${field('Item <span class="req">*</span>', `<select name="item_id">${items.map(i => opt(i.id, `${i.name} — ${qf(i.balance)} ${i.unit} in stock`, it?.id)).join('')}</select>`, 'span2')}
    ${field('Date', dateInput())}${field('Quantity <span class="req">*</span>', `<input name="qty" type="number" step="any" min="0">`)}
    ${type === 'stock_in' ? field('Supplier / from', `<input name="party">`) : ''}
    ${type === 'use' ? field('Used for <span class="req">*</span>', `<input name="purpose" list="iup" placeholder="e.g. PVC machine cleaning, CTP processor"><datalist id="iup">${['PVC machine cleaning', 'CTP processor', 'Plate washing', 'Office use'].map(p => `<option value="${esc(p)}">`).join('')}</datalist>`) : ''}
    ${['wastage', 'adj_in', 'adj_out'].includes(type) ? field('Reason <span class="req">*</span>', `<input name="reason">`) : ''}
    ${field('Remarks', `<input name="remarks">`, 'span2')}</div>
    <div class="note">Entering an old paper slip? Just pick its date — it goes into the correct day.</div>
    <div class="row mt right"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="ims">Save</button></div>`, size: 'narrow' });
  $('[data-x]', m.el).onclick = m.close;
  $('#ims', m.el).onclick = () => busy($('#ims', m.el), async () => {
    const d = { ...formData($('#imf', m.el)), type };
    try { const r = await POST('/api/gen/internal/moves', d); toast('Saved', `Balance now ${qf(r.balance)}`); m.close(); done && done(); } catch (er) { fail(er); }
  });
}
App.pages['internal'] = {
  title: 'Internal Inventory',
  async render(v, tab = 'items') {
    const items = await GET('/api/gen/internal/items');
    const low = items.filter(i => +i.low_stock > 0 && +i.balance <= +i.low_stock);
    v.innerHTML = `<div class="head"><div><div class="sub">Things the business uses itself — not sold. PVC solvent, CTP wash & developer, filter paper, and anything you add.</div></div>
      <div class="row">${['stock_in', 'use', 'wastage'].map(t => `<button class="btn ${t === 'stock_in' ? 'green' : t === 'use' ? '' : 'ghost'}" data-mt="${t}">${{ stock_in: ICON.plus + ' Stock in', use: 'Use / stock out', wastage: 'Wastage' }[t]}</button>`).join('')}
      ${can('stock.adjust') ? `<button class="btn ghost" data-mt="adj_in">Adjust +</button><button class="btn ghost" data-mt="adj_out">Adjust −</button>` : ''}<button class="btn ghost" id="iadd">${ICON.plus} Item</button></div></div>
      ${low.length ? `<div class="note" style="border-color:var(--danger)"><b>Low stock:</b> ${low.map(i => `${esc(i.name)} (${qf(i.balance)} ${esc(i.unit)})`).join(', ')}</div>` : ''}
      <div class="tabs"><button class="${tab === 'items' ? 'on' : ''}" onclick="App.go('internal/items')">Items & stock</button><button class="${tab === 'moves' ? 'on' : ''}" onclick="App.go('internal/moves')">Stock in / out history</button></div>
      <div class="panel" id="ib"></div>`;
    $$('[data-mt]', v).forEach(b => b.onclick = () => items.length ? internalMoveModal(items, null, b.dataset.mt, () => App.refresh()) : toast('Add an item first', '', 'err'));
    $('#iadd', v).onclick = () => internalItemModal(null, () => App.refresh());
    const body = $('#ib', v);
    if (tab === 'moves') {
      const mv = await GET('/api/gen/internal/moves');
      dataTable(body, mv, [
        { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'item', label: 'Item' },
        { k: 'type', label: 'Type', f: r => `<span class="tag ${(MV[r.type] || [r.type, 'gray'])[1]}">${esc((MV[r.type] || [r.type])[0])}</span>${r.is_reversal ? ' <span class="tag red">VOID</span>' : r.voided ? ' <span class="tag gray">voided</span>' : ''}` },
        { k: 'qty', label: 'Qty', n: true, f: r => `<b style="color:${+r.qty < 0 ? 'var(--danger)' : 'var(--ok,#16a34a)'}">${+r.qty > 0 ? '+' : ''}${qf(r.qty)}</b> ${esc(r.unit)}` },
        { k: 'purpose', label: 'Purpose / reason / from', f: r => esc(r.purpose || r.party || r.remarks || '') },
        { k: 'created_by_name', label: 'By' },
        { k: 'x', label: '', sort: false, f: r => !r.voided && !r.is_reversal && can('stock.adjust') ? `<button class="btn xs ghost" data-void="${r.id}">Void</button>` : '' },
      ]);
      body.addEventListener('click', async e => {
        const b = e.target.closest('[data-void]'); if (!b) return;
        const reason = await confirmBox('Void this entry?', 'A reverse entry is added; history is kept.', { ok: 'Void', danger: true, input: 'Reason' });
        if (reason) { try { await POST(`/api/gen/moves/${b.dataset.void}/void`, { reason }); toast('Voided'); App.refresh(); } catch (er) { fail(er); } }
      });
      return;
    }
    dataTable(body, items, [
      { k: 'name', label: 'Item', f: r => `<b>${esc(r.name)}</b>${r.remarks ? `<div class="sub">${esc(r.remarks)}</div>` : ''}` },
      { k: 'balance', label: 'In stock', n: true, v: r => +r.balance, f: r => `<b style="${+r.low_stock > 0 && +r.balance <= +r.low_stock ? 'color:var(--danger)' : ''}">${qf(r.balance)}</b> ${esc(r.unit)}` },
      { k: 'low_stock', label: 'Alert at', n: true, f: r => +r.low_stock ? qf(r.low_stock) : '—' },
      { k: 'x', label: '', sort: false, f: r => `<button class="btn xs" data-in="${r.id}">+ In</button> <button class="btn xs ghost" data-use="${r.id}">Use</button> <button class="btn xs ghost" data-ed="${r.id}">Edit</button> <button class="btn xs ghost" data-del="${r.id}" style="color:var(--danger)">${ICON.trash.replace('<svg', '<svg width="13"')}</button>` },
    ], { empty: 'No internal items yet — add PVC solvent, CTP wash, developer, filter paper…' });
    body.addEventListener('click', e => {
      const b = e.target.closest('button[data-in],button[data-use],button[data-ed],button[data-del]'); if (!b) return;
      const it = items.find(i => i.id === +(b.dataset.in || b.dataset.use || b.dataset.ed || b.dataset.del));
      if (b.dataset.in) internalMoveModal(items, it, 'stock_in', () => App.refresh());
      else if (b.dataset.use) internalMoveModal(items, it, 'use', () => App.refresh());
      else if (b.dataset.ed) internalItemModal(it, () => App.refresh());
      else masterDelete('/api/gen/internal/items/' + it.id, it.name, () => App.refresh());
    });
  },
};
