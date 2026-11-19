/* General section (ID cards, lamination, memo / binding jobs, film & paper stock) + Internal inventory */
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

/* ---------------- shared stock module (lamination film, paper, internal) ---------------- */
function itemLabel(it) {
  if (it.kind === 'lamination') return [it.machine, it.finish, it.width_in ? +it.width_in + '" wide' : '', it.roll_length ? +it.roll_length + ' ft/roll' : ''].filter(Boolean).join(' · ');
  if (it.kind === 'paper') return [it.paper_type, it.gsm ? it.gsm + ' GSM' : '', it.size, it.color].filter(Boolean).join(' · ');
  return it.remarks || '';
}
function itemModal(kind, it, done) {
  const L = App.meta, K = GKIND[kind];
  const sel = (name, list, val, blank = true) => `<select name="${name}">${blank ? '<option value="">—</option>' : ''}${(list || []).map(x => opt(x, x, val)).join('')}${val && !(list || []).includes(val) ? opt(val, val, val) : ''}</select>`;
  const unitList = kind === 'paper' ? L.paper_units : L.internal_units;
  const body = kind === 'lamination' ? `
      ${field('Name', `<input name="name" value="${esc(it?.name || '')}" placeholder="auto: finish + width (e.g. Glossy 12&quot;)">`, 'span2')}
      ${field('Machine', sel('machine', L.lamination_machines, it?.machine))}${field('Finish', sel('finish', L.lamination_finishes, it?.finish))}
      ${field('Film width (inch) <span class="req">*</span>', `<input type="number" step="any" name="width_in" value="${it ? +it.width_in || '' : ''}" placeholder="e.g. 12">`)}${field('Roll length (ft)', `<input type="number" step="any" name="roll_length" value="${it ? +it.roll_length || '' : 300}">`)}
      ${field('Low-stock alert (ft)', `<input type="number" step="any" name="low_stock" value="${it ? +it.low_stock : 100}">`)}${field('Rate per sq inch (default)', `<input type="number" step="any" name="rate" value="${it ? +it.rate || '' : ''}">`)}`
    : kind === 'paper' ? `
      ${field('Paper type', sel('paper_type', L.paper_types, it?.paper_type))}${field('GSM', `<input name="gsm" value="${esc(it?.gsm || '')}" placeholder="e.g. 70">`)}
      ${field('Size', sel('size', L.paper_sizes, it?.size))}${field('Colour', sel('color', L.paper_colors, it?.color))}
      ${field('Stock unit', sel('unit', unitList, it?.unit || unitList[0], false))}${field('Low-stock alert', `<input type="number" step="any" name="low_stock" value="${it ? +it.low_stock : 2}">`)}
      ${field('Name', `<input name="name" value="${esc(it?.name || '')}" placeholder="auto: type + GSM + size + colour">`, 'span2')}`
    : `
      ${field('Item name <span class="req">*</span>', `<input name="name" value="${esc(it?.name || '')}" placeholder="e.g. PVC Solvent, CTP Developer, Filter Paper">`, 'span2')}
      ${field('Unit', `<input name="unit" list="iul" value="${esc(it?.unit || 'Ltr')}"><datalist id="iul">${unitList.map(u => `<option value="${esc(u)}">`).join('')}</datalist>`, '', 'Ltr, Pcs, Kg… or type your own')}
      ${field('Low-stock alert', `<input type="number" step="any" name="low_stock" value="${it ? +it.low_stock : 5}">`)}
      ${field('Notes', `<input name="remarks" value="${esc(it?.remarks || '')}" placeholder="e.g. used in CTP processor">`, 'span2')}`;
  const m = modal({
    title: it ? 'Edit ' + it.name : 'Add ' + K.one, body: `<div class="form f2" id="gif">${body}
      ${it ? '' : field(`Opening stock${kind === 'lamination' ? ' (ft)' : ''}`, `<input type="number" step="any" min="0" name="opening" value="0">`, '', kind === 'lamination' ? 'rolls × roll length' : 'quantity you have now')}
      ${field('Display order', `<input type="number" name="sort" value="${it ? it.sort : 0}">`)}
      <label class="check span2"><input type="checkbox" name="active" ${!it || it.active ? 'checked' : ''}> Active (shown in entries & billing)</label></div>
      <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="gis">Save</button></div>`,
  });
  $('[data-x]', m.el).onclick = m.close;
  $('#gis', m.el).onclick = () => busy($('#gis', m.el), async () => {
    if (kind === 'internal' && !requireFields(m.el, ['name'])) return;
    if (kind === 'lamination' && !requireFields(m.el, ['width_in'])) return;
    const b = formData($('#gif', m.el));
    if (it) await PUT(`/api/gen/${kind}/items/${it.id}`, b); else await POST(`/api/gen/${kind}/items`, b, { idem: false });
    toast(it ? 'Saved' : 'Added', b.name || ''); m.close(); done && done();
  });
}
function moveModal(kind, items, type, preItem, done) {
  const K = GKIND[kind], act = items.filter(i => i.active);
  if (!act.length) { toast('Add an item first', '', 'warn'); return; }
  const T = { stock_in: 'Stock in', use: 'Own use / internal use', wastage: 'Wastage', adj_in: 'Adjust + (add)', adj_out: 'Adjust − (remove)', opening: 'Opening stock' };
  const m = modal({
    title: T[type], body: `<div class="form f2" id="gmf">${field('Date', dateInput())}
      ${field('Item <span class="req">*</span>', `<select name="item_id">${act.map(i => opt(i.id, `${i.name} — ${qf(i.balance)} ${i.unit}`, preItem)).join('')}</select>`)}
      ${kind === 'lamination' && type === 'stock_in' ? field('Rolls', `<input type="number" step="any" min="0" id="rolls" value="1">`, '', 'auto-fills feet') : ''}
      ${field('Quantity <span class="req">*</span> <span class="hint" id="gu"></span>', `<input type="number" step="any" min="0" name="qty">`)}
      ${type === 'stock_in' ? field('Supplier', `<input name="party">`) : ''}
      ${type === 'use' ? field('Used for <span class="req">*</span>', `<input name="purpose" placeholder="${kind === 'internal' ? 'e.g. CTP processor, machine cleaning' : 'e.g. office use, sample, own job'}">`) : ''}
      ${['wastage', 'adj_in', 'adj_out'].includes(type) ? field('Reason <span class="req">*</span>', `<input name="reason">`) : ''}
      ${field('Remarks', `<input name="remarks">`, 'span2')}</div><div class="sub" id="gbal"></div>
      <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn ${['use', 'wastage', 'adj_out'].includes(type) ? 'danger' : 'green'}" id="gms">Save</button></div>`,
  });
  const it = () => items.find(i => i.id === +$('[name=item_id]', m.el).value);
  const sync = () => { const x = it(); $('#gu', m.el).textContent = x ? '(' + x.unit + ')' : ''; $('#gbal', m.el).textContent = x ? `Current balance: ${qf(x.balance)} ${x.unit}` : '';
    if ($('#rolls', m.el)) { $('#rolls', m.el).disabled = !+x.roll_length; if (+x.roll_length) $('[name=qty]', m.el).value = Math.round((+$('#rolls', m.el).value || 0) * x.roll_length * 1000) / 1000; } };
  $('[name=item_id]', m.el).onchange = sync; if ($('#rolls', m.el)) $('#rolls', m.el).oninput = sync; sync();
  $('[data-x]', m.el).onclick = m.close;
  const key = uid();
  $('#gms', m.el).onclick = () => busy($('#gms', m.el), async () => {
    if (!requireFields(m.el, ['qty', 'purpose', 'reason'])) return;
    const r = await POST(`/api/gen/${kind}/moves`, { ...formData($('#gmf', m.el)), type }, { idemKey: key });
    toast('Saved', `${T[type]} · new balance ${qf(r.balance)} ${it().unit}`); m.close(); done && done();
  });
}
async function stockModule(el, kind, st) {
  const K = GKIND[kind];
  const f = st.f = st.f || { from: monthStart(App.today), to: App.today, item: '' };
  const [items, moves] = await Promise.all([GET(`/api/gen/${kind}/items`, { from: f.from, to: f.to }), GET(`/api/gen/${kind}/moves`, f)]);
  const canMove = can(K.perm), canEdit = can(K.edit);
  el.innerHTML = `<div class="head"><div class="sub">${kind === 'lamination' ? 'Film is tracked in feet. Lamination jobs billed in General deduct the film they use automatically.' : kind === 'paper' ? 'Paper by type, GSM, size and colour. Own use and job use both leave stock with a record.' : 'Things the business uses itself — solvent, wash, developer, filter paper and anything else you add.'}</div>
    <div class="row">${canEdit ? `<button class="btn ghost" id="gadd">${ICON.plus} Add ${K.one}</button>` : ''}${canMove ? `<button class="btn green" data-mv="stock_in">${ICON.plus} Stock in</button><button class="btn light" data-mv="use">Own use</button><button class="btn ghost" data-mv="wastage">Wastage</button>` : ''}
      ${can('stock.adjust') ? `<button class="btn ghost" data-mv="adj">± Adjust</button>` : ''}</div></div>
    <div class="stats stagger" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><small>Items</small><b data-count-to="${items.length}">0</b></div>
      <div class="stat" style="--c:var(--danger)"><small>Low stock</small><b data-count-to="${items.filter(i => i.active && +i.balance <= +i.low_stock).length}">0</b></div>
      <div class="stat" style="--c:var(--ok)"><small>Entries (period)</small><b data-count-to="${moves.length}">0</b></div></div>
    <div class="panel"><div class="head"><h2>${K.title} — balance</h2><div class="row"><input type="date" class="inp" id="gf" value="${f.from}" style="width:150px"><input type="date" class="inp" id="gt" value="${f.to}" style="width:150px"><button class="btn sm" id="ggo">Apply</button><button class="btn sm ghost" id="gx">${ICON.excel}</button></div></div><div id="gitbl"></div></div>
    <div class="panel"><div class="head"><h2>Entries${f.item ? ' — ' + esc(items.find(i => i.id === +f.item)?.name || '') + ' <button class="btn xs ghost" id="gclr">show all</button>' : ''}</h2></div><div id="gmtbl"></div></div>`;
  dataTable($('#gitbl', el), items, [
    { k: 'name', label: 'Item', f: r => `<b>${esc(r.name)}</b>${r.active ? '' : ' <span class="tag gray">Inactive</span>'}<div class="sub">${esc(itemLabel({ ...r, kind }))}</div>` },
    { k: 'opening_bal', label: 'B/F', n: 1, f: r => qf(r.opening_bal) }, { k: 'qty_in', label: 'In', n: 1, f: r => qf(r.qty_in) }, { k: 'qty_out', label: 'Out', n: 1, f: r => qf(r.qty_out) },
    { k: 'balance', label: 'Balance', n: 1, f: r => `<b>${qf(r.balance)}</b> ${esc(r.unit)}${kind === 'lamination' && +r.roll_length ? `<div class="sub">≈ ${qf(r.balance / r.roll_length)} rolls</div>` : ''} ${r.active && +r.balance <= +r.low_stock ? '<span class="tag orange">Low</span>' : ''}` },
    { k: 'x', label: '', sort: false, f: r => `<button class="btn xs ghost" data-flt="${r.id}">Entries</button>${canEdit ? ` <button class="btn xs ghost" data-ied="${r.id}">Edit</button> <button class="btn xs ghost" data-idel="${r.id}" style="color:var(--danger)" title="Delete">${ICON.trash.replace('<svg', '<svg width="13"')}</button>` : ''}` },
  ], { empty: `No ${K.one}s yet — add one to start`, id: 'gi-' + kind });
  dataTable($('#gmtbl', el), moves.map(r => ({ ...r, _cls: r.voided ? 'void' : '' })), [
    { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'type', label: 'Type', f: r => `<span class="tag ${MV[r.type][1]}">${MV[r.type][0]}</span>${r.is_reversal ? ' <span class="tag gray">reversal</span>' : ''}` },
    { k: 'item', label: 'Item' }, { k: 'qty', label: 'Qty', n: 1, f: r => `<b style="color:${r.qty < 0 ? 'var(--danger)' : 'var(--ok)'}">${r.qty > 0 ? '+' : ''}${qf(r.qty)}</b> ${esc(r.unit)}` },
    { k: 'purpose', label: 'Purpose / ref', f: r => `${esc(r.purpose || r.party || '')}${r.ref_no ? ` <a href="#/general/invoices/${r.ref_id}">${esc(r.ref_no)}</a>` : ''}<div class="sub">${esc(r.remarks || '')}</div>` },
    { k: 'created_by_name', label: 'By', f: r => `${esc(r.created_by_name)}<div class="sub">${fdt(r.created_at)}</div>` },
    { k: 'x', label: '', sort: false, f: r => !r.voided && !r.is_reversal && r.ref_type !== 'gen_invoice' && can('stock.adjust') ? `<button class="btn xs ghost" data-void="${r.id}">Void</button>` : r.voided ? '<span class="tag red">Voided</span>' : '' },
  ], { empty: 'No entries in this period', id: 'gm-' + kind });
  const reload = () => App.refresh();
  $('#ggo', el).onclick = () => { f.from = $('#gf', el).value; f.to = $('#gt', el).value; reload(); };
  $('#gx', el).onclick = () => exportXlsx(K.title + ' Stock', [`${fdate(f.from)} to ${fdate(f.to)}`], [tableToSheet('Balance', $('#gitbl table', el)), tableToSheet('Entries', $('#gmtbl table', el))]);
  if ($('#gclr', el)) $('#gclr', el).onclick = () => { f.item = ''; reload(); };
  if ($('#gadd', el)) $('#gadd', el).onclick = () => itemModal(kind, null, reload);
  $$('[data-mv]', el).forEach(b => b.onclick = async () => {
    let t = b.dataset.mv;
    if (t === 'adj') { const r = await new Promise(res => { const m = modal({ title: 'Stock adjustment', size: 'narrow', body: `<div class="row" style="justify-content:center;gap:12px"><button class="btn green" data-a="adj_in">+ Add</button><button class="btn danger" data-a="adj_out">− Remove</button><button class="btn ghost" data-a="opening">Opening</button></div>` }); $$('[data-a]', m.el).forEach(x => x.onclick = () => { m.close(); res(x.dataset.a); }); }); if (!r) return; t = r; }
    moveModal(kind, items, t, f.item, reload);
  });
  el.onclick = async e => {
    const fl = e.target.closest('[data-flt]'), ed = e.target.closest('[data-ied]'), dl = e.target.closest('[data-idel]'), vd = e.target.closest('[data-void]');
    if (fl) { f.item = fl.dataset.flt; reload(); }
    if (ed) itemModal(kind, items.find(i => i.id === +ed.dataset.ied), reload);
    if (dl) { const it = items.find(i => i.id === +dl.dataset.idel); masterDelete(`/api/gen/${kind}/items/${it.id}`, it.name, reload); }
    if (vd) { const reason = await confirmBox('Void this entry?', 'A reversal entry is recorded; the original stays in history.', { ok: 'Void', danger: true, input: 'Reason' }); if (reason) { try { await POST(`/api/gen/moves/${vd.dataset.void}/void`, { reason }); toast('Voided'); reload(); } catch (er) { fail(er); } } }
  };
}
function listsPanel(keys) {
  return `<div class="panel"><div class="head"><div><h2>Dropdown lists</h2><div class="sub">Type and press Enter to add · × to remove</div></div><button class="btn sm" id="lsv">${ICON.check} Save lists</button></div>
    <div class="form f2">${keys.map(([k, l]) => `<div class="field">${l}<div class="list-ed" data-list="${k}"></div></div>`).join('')}</div></div>`;
}
function bindLists(el) {
  $$('[data-list]', el).forEach(box => {
    const k = box.dataset.list; let items = [...(App.meta[k] || [])];
    const draw = () => { box.innerHTML = items.map((x, i) => `<span class="chip">${esc(x)}<button type="button" data-rm="${i}">×</button></span>`).join('') + `<input placeholder="Add…">`;
      $$('[data-rm]', box).forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); });
      const inp = $('input', box); inp.onkeydown = e => { if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); if (!items.includes(inp.value.trim())) items.push(inp.value.trim()); draw(); $('input', box).focus(); } }; };
    box._get = () => { const v = $('input', box).value.trim(); return v && !items.includes(v) ? [...items, v] : items; };
    draw();
  });
  if ($('#lsv', el)) $('#lsv', el).onclick = () => busy($('#lsv', el), async () => { await PUT('/api/general/lists', Object.fromEntries($$('[data-list]', el).map(b => [b.dataset.list, b._get()]))); await App.loadMeta(); toast('Lists saved'); App.refresh(); });
}

/* ---------------- GENERAL page ---------------- */
App.pages.general = {
  title: 'General', tab: 'overview', st: {},
  async render(v, sub, id) {
    const tabs = [['overview', 'Overview'], ...(can('general.view', 'general.invoice') ? [['invoices', 'Jobs & Bills']] : []), ['lamination', 'Lamination Film'], ['paper', 'Paper Stock'], ...(can('general.items', 'settings') ? [['setup', 'Job Types & Lists']] : [])];
    if (sub === 'new') return this.newJob(v);
    if (sub === 'invoices' && id) return this.invoice(v, +id);
    if (sub && tabs.some(t => t[0] === sub)) this.tab = sub;
    if (!tabs.some(t => t[0] === this.tab)) this.tab = 'overview';
    const t = this.tab;
    v.innerHTML = `<div class="head"><div class="sub">ID cards · lamination · memo & receipt books · binding · paper — everything outside CTP plates and PVC media</div>
      <div class="row">${can('general.invoice') ? `<button class="btn" id="gnew">${ICON.plus} New job / bill</button>` : ''}</div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === t ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pane" class="tabpane"></div>`;
    if ($('#gnew', v)) $('#gnew', v).onclick = () => App.go('general/new');
    $$('[data-t]', v).forEach(b => b.onclick = () => App.go('general/' + b.dataset.t));
    const pane = $('#pane', v);
    if (t === 'lamination' || t === 'paper') return stockModule(pane, t, (this.st[t] = this.st[t] || {}));
    return this['tab_' + t](pane);
  },
  async tab_overview(el) {
    const [s, gs] = await Promise.all([GET('/api/gen/summary'), genSet()]);
    el.innerHTML = `<div class="stats stagger"><div class="stat"><small>Sales this month</small><b>${tk(s.sales)}</b><div class="foot">${s.invoices} bills</div></div>
        <div class="stat" style="--c:var(--danger)"><small>Due (this month's bills)</small><b>${tk(s.due)}</b></div>
        <div class="stat" style="--c:var(--warn)"><small>Low stock (film & paper)</small><b data-count-to="${s.low_stock.length}">0</b></div>
        <div class="stat" style="--c:var(--ok)"><small>Job types</small><b data-count-to="${gs.job_types.length}">0</b></div></div>
      <div class="grid g32"><div class="panel"><h2>Sales by job type — this month</h2><div class="tbl-wrap mt"><table><thead><tr><th>Job type</th><th class="n">Qty</th><th class="n">Amount</th></tr></thead><tbody>
          ${s.by_type.map(r => `<tr><td>${esc(r.job_type)}</td><td class="n">${qf(r.qty)}</td><td class="n">${tk(r.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No general jobs billed this month</td></tr>'}</tbody></table></div>
        <h2 style="margin-top:22px">Low stock</h2><div class="feed mt">${s.low_stock.map(i => `<div class="feed-item" onclick="App.go('general/${i.kind}')"><div class="feed-ic" style="background:var(--warn)">!</div><div class="t"><b>${esc(i.name)}</b><small>${qf(i.balance)} ${esc(i.unit)} left · alert at ${qf(i.low_stock)}</small></div></div>`).join('') || '<div class="empty">All film and paper above alert level</div>'}</div></div>
      <div><div class="panel"><h2>Plate calculator</h2><div class="sub">How many CTP plates a job needs on a 4-colour press</div>
          <div class="form f2 mt" id="pc">${field('Colours', `<input type="number" min="1" name="col" value="4">`)}${field('Sides', `<select name="sides"><option value="1">1 (one side)</option><option value="2">2 (both sides)</option></select>`)}${field('Forms / sets', `<input type="number" min="1" name="forms" value="1">`)}</div>
          <div class="big-num mt" id="pcr" style="font-size:26px"></div></div>
        <div class="panel"><h2>Cutting calculator</h2><div class="sub">Pieces from one sheet, and sheets needed</div>
          <div class="form f2 mt" id="cc">${field('Sheet W (inch)', `<input type="number" step="any" name="sw" value="23">`)}${field('Sheet L (inch)', `<input type="number" step="any" name="sl" value="36">`)}
            ${field('Piece W (inch)', `<input type="number" step="any" name="pw" value="3.5">`)}${field('Piece L (inch)', `<input type="number" step="any" name="pl" value="2">`)}${field('Pieces needed', `<input type="number" name="need" value="1000">`, 'span2')}</div>
          <div class="mt" id="ccr"></div></div></div></div>`;
    const pc = () => { const d = formData($('#pc', el)); $('#pcr', el).textContent = `${(+d.col || 0) * (+d.sides || 1) * (+d.forms || 1)} plates`; };
    const cc = () => {
      const d = formData($('#cc', el)); const sw = +d.sw, sl = +d.sl, pw = +d.pw, pl = +d.pl, need = +d.need || 0;
      if (!(sw > 0 && sl > 0 && pw > 0 && pl > 0)) { $('#ccr', el).innerHTML = ''; return; }
      const a = Math.floor(sw / pw) * Math.floor(sl / pl), b = Math.floor(sw / pl) * Math.floor(sl / pw), per = Math.max(a, b);
      $('#ccr', el).innerHTML = per ? `<div class="kv"><span>Pieces per sheet</span><b>${per}</b><span>Best way</span><b>${a >= b ? 'piece upright' : 'piece turned'}</b><span>Sheets needed</span><b>${Math.ceil(need / per)}</b><span>Extra pieces</span><b>${Math.ceil(need / per) * per - need}</b></div>` : '<span class="tag red">Piece is bigger than the sheet</span>';
    };
    $('#pc', el).oninput = pc; $('#cc', el).oninput = cc; pc(); cc();
  },
  async tab_invoices(el) {
    const f = this.inf = this.inf || { from: monthStart(App.today), to: App.today, q: '', status: '' };
    el.innerHTML = `<div class="panel"><div class="head"><h2>General jobs & bills</h2><div class="row"><input type="date" class="inp" id="if" value="${f.from}" style="width:150px"><input type="date" class="inp" id="it" value="${f.to}" style="width:150px">
      <select class="inp" id="is" style="width:140px"><option value="">All</option>${opt('confirmed', 'Confirmed', f.status)}${opt('cancelled', 'Cancelled', f.status)}</select><button class="btn sm" id="igo">Apply</button><button class="btn sm ghost" id="ix">${ICON.excel}</button></div></div><div id="itbl"></div></div>`;
    const rows = await GET('/api/gen/invoices', f);
    rows.forEach(r => { r.due = r.status === 'confirmed' ? r.grand_total - r.paid : 0; if (r.status === 'cancelled') r._cls = 'void'; });
    dataTable($('#itbl', el), rows, [
      { k: 'inv_no', label: 'Bill', f: r => `<b>${esc(r.inv_no)}</b>` }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'customer', label: 'Customer', f: r => `${esc(r.customer)}<div class="sub">${esc(r.phone || '')}</div>` },
      { k: 'jobs', label: 'Jobs', f: r => `<span class="sub">${esc(r.jobs || '')}</span>` },
      { k: 'grand_total', label: 'Total', n: 1, f: r => tk(r.grand_total), total: d => tk(d.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.grand_total, 0)) },
      { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid) }, { k: 'due', label: 'Due', n: 1, f: r => r.due > 0.004 ? `<b style="color:var(--danger)">${tk(r.due)}</b>` : tk(0), total: d => tk(d.reduce((s, r) => s + r.due, 0)) },
      { k: 'status', label: 'Status', f: r => statusTag(r.status) }, { k: 'created_by_name', label: 'By', f: r => `<span class="sub">${esc(r.created_by_name)}</span>` },
    ], { onRow: r => App.go('general/invoices/' + r.id), totals: true, empty: 'No general bills in this period' });
    $('#igo', el).onclick = () => { Object.assign(f, { from: $('#if', el).value, to: $('#it', el).value, status: $('#is', el).value }); App.refresh(); };
    $('#ix', el).onclick = () => exportXlsx('General Bills', [`${fdate(f.from)} to ${fdate(f.to)}`], [tableToSheet('Bills', $('#itbl table', el))]);
  },
  async tab_setup(el) {
    const gs = await genSet(true);
    let jt = gs.job_types.map(j => ({ ...j }));
    const draw = () => {
      el.innerHTML = `<div class="panel"><div class="head"><div><h2>Job types</h2><div class="sub">How each job is priced · minimum quantity is charged when an order is smaller · film / paper decides what stock the job can use</div></div>
          <div class="row"><button class="btn sm ghost" id="jadd">${ICON.plus} Add job type</button><button class="btn sm" id="jsv">${ICON.check} Save job types</button></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Priced</th><th class="n">Default rate</th><th class="n">Minimum qty</th><th>Uses film</th><th>Uses paper</th><th></th></tr></thead><tbody>
        ${jt.map((j, i) => `<tr><td><input class="inp" data-j="${i}" data-k="name" value="${esc(j.name)}"></td><td><select class="inp" data-j="${i}" data-k="unit">${Object.entries(PU).map(([k, l]) => opt(k, l, j.unit)).join('')}</select></td>
          <td><input class="inp" type="number" step="any" data-j="${i}" data-k="rate" value="${+j.rate || ''}" style="width:110px"></td><td><input class="inp" type="number" data-j="${i}" data-k="min_qty" value="${+j.min_qty || ''}" style="width:110px"></td>
          <td><input type="checkbox" data-j="${i}" data-k="film" ${j.film ? 'checked' : ''}></td><td><input type="checkbox" data-j="${i}" data-k="paper" ${j.paper ? 'checked' : ''}></td>
          <td><button class="btn xs ghost" data-jrm="${i}" style="color:var(--danger)">✕</button></td></tr>`).join('')}</tbody></table></div></div>
        ${listsPanel([['lamination_machines', 'Lamination machines'], ['lamination_finishes', 'Film finishes'], ['paper_types', 'Paper types'], ['paper_sizes', 'Paper sizes'], ['paper_colors', 'Paper colours'], ['paper_units', 'Paper stock units']])}`;
      bindLists(el);
      const collect = () => $$('[data-j]', el).forEach(x => { jt[+x.dataset.j][x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value; });
      $('#jadd', el).onclick = () => { collect(); jt.push({ name: '', unit: 'pc', rate: 0, min_qty: 0, film: false, paper: false }); draw(); };
      $$('[data-jrm]', el).forEach(b => b.onclick = () => { collect(); jt.splice(+b.dataset.jrm, 1); draw(); });
      $('#jsv', el).onclick = () => busy($('#jsv', el), async () => { collect(); await PUT('/api/general/settings', { job_types: jt }); await genSet(true); toast('Job types saved'); });
    };
    draw();
  },
  async newJob(v) {
    const [gs, films, papers] = await Promise.all([genSet(true), GET('/api/gen/lamination/items'), GET('/api/gen/paper/items')]);
    const F = films.filter(x => x.active), P = papers.filter(x => x.active), JT = gs.job_types;
    let cust = this.prefill?.customer || null; this.prefill = null;
    const lines = [];
    const blank = t => ({ job_type: t.name, price_unit: t.unit, rate: t.rate || '', qty: t.min_qty || 1, w: '', l: '', colours: '', description: '', film_item_id: '', paper_item_id: '', paper_qty: '' });
    lines.push(blank(JT[0]));
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="App.go('general/invoices')">← Bills</button><div class="sub">Bill is saved as confirmed · film and paper used are taken out of stock</div></div>
      <div class="panel"><div class="form f4" id="gh"><div class="field span2">Customer <span class="req">*</span><div id="gcp"></div></div>${field('Date', dateInput())}${field('Job no', `<input name="job_no">`)}
        ${field('Delivery date', `<input type="date" name="delivery_date">`)}${field('Remarks', `<input name="remarks">`, 'span3')}</div></div>
      <div class="panel"><div class="head"><h2>Job lines</h2><button class="btn sm ghost" id="gal">${ICON.plus} Add line</button></div><div id="gl"></div>
        <div class="row mt" style="justify-content:flex-end;align-items:flex-end;gap:14px">${field('Discount (৳)', `<input type="number" step="any" min="0" id="gdisc" value="0" style="width:130px">`)}
          ${field('Paid now (৳)', `<input type="number" step="any" min="0" id="gpaid" value="0" style="width:130px">`)}${field('Method', `<select id="gmeth">${App.meta.payment_methods.map(x => opt(x, x)).join('')}</select>`)}
          <div style="min-width:240px;border:1px solid var(--line);border-radius:12px;padding:10px 14px"><div class="row" style="justify-content:space-between"><span class="sub">Subtotal</span><span id="gsub">0</span></div><div class="row" style="justify-content:space-between;font-size:20px;font-weight:800;margin-top:4px"><span>Total</span><span>৳ <span id="gtot">0</span></span></div></div></div>
        <div class="actions"><button class="btn" id="gsave">${ICON.check} Save bill</button></div></div>`;
    custPicker($('#gcp', v), { value: cust, onPick: c => (cust = c) });
    const draw = () => {
      $('#gl', v).innerHTML = lines.map((l, i) => {
        const t = JT.find(x => x.name === l.job_type) || JT[0];
        const showFilm = t.film || l.price_unit === 'sqin', showPaper = t.paper, c = genLineCalc(l, t);
        const fu = l.film_item_id ? filmUse(l, F.find(f => f.id === +l.film_item_id)) : null;
        return `<div class="kpi" style="margin-bottom:10px" data-li="${i}"><div class="form f4">
          ${field('Job type', `<select data-k="job_type">${JT.map(x => opt(x.name, x.name, l.job_type)).join('')}</select>`)}
          ${field('Description', `<input data-k="description" value="${esc(l.description)}" placeholder="e.g. Student ID, 2-part memo">`, 'span2')}
          ${field('W (inch)', `<input type="number" step="any" data-k="w" value="${esc(l.w)}">`)}${field('L (inch)', `<input type="number" step="any" data-k="l" value="${esc(l.l)}">`)}
          ${field('Colours', `<input type="number" min="0" data-k="colours" value="${esc(l.colours)}" placeholder="—">`)}
          ${field('Qty <span class="req">*</span>', `<input type="number" step="any" min="0" data-k="qty" value="${esc(l.qty)}">`, '', t.min_qty ? 'min ' + qf(t.min_qty) : '')}
          ${field('Priced', `<select data-k="price_unit">${Object.entries(PU).map(([k, lb]) => opt(k, lb, l.price_unit)).join('')}</select>`)}
          ${field('Rate (৳)', `<input type="number" step="any" min="0" data-k="rate" value="${esc(l.rate)}">`)}
          ${showFilm ? field('Lamination film', `<select data-k="film_item_id"><option value="">No film deduction</option>${F.map(f => opt(f.id, `${f.name} (${qf(f.balance)} ft)`, l.film_item_id)).join('')}</select>`, 'span2', `<span data-fh>${filmHint(fu)}</span>`) : ''}
          ${showPaper ? field('Paper used', `<select data-k="paper_item_id"><option value="">No paper deduction</option>${P.map(p => opt(p.id, `${p.name} (${qf(p.balance)} ${p.unit})`, l.paper_item_id)).join('')}</select>`, 'span2') + field('Paper qty', `<input type="number" step="any" min="0" data-k="paper_qty" value="${esc(l.paper_qty)}" placeholder="${esc(P.find(p => p.id === +l.paper_item_id)?.unit || '')}">`) : ''}
          <div class="field span4" style="align-self:end;text-align:right;grid-column:1/-1;border-top:1px dashed var(--line);padding-top:8px"><span class="sub" data-note>${lineNote(l, c)}</span><b style="font-size:17px" data-amt>${tk(c.amount)}</b>
            ${lines.length > 1 ? ` <button class="btn xs ghost" data-rm="${i}" style="color:var(--danger)">✕</button>` : ''}</div></div></div>`;
      }).join('');
      totals();
    };
    const filmHint = fu => fu === 'nofit' ? '<span style="color:var(--danger)">size does not fit this film</span>' : fu != null ? `uses ${qf(fu)} ft` : '';
    const lineNote = (l, c) => (c.billed > (+l.qty || 0) ? `min ${qf(c.billed)} charged · ` : '') + (['sqin', 'sqft'].includes(l.price_unit) && c.area ? qf(l.price_unit === 'sqft' ? c.area / 144 : c.area) + (l.price_unit === 'sqft' ? ' sq ft' : ' sq in') + '/pc · ' : '');
    const totals = () => {
      const sub = lines.reduce((s, l) => s + genLineCalc(l, JT.find(x => x.name === l.job_type)).amount, 0), disc = +$('#gdisc', v).value || 0;
      $('#gsub', v).textContent = nf2.format(sub); $('#gtot', v).textContent = nf2.format(Math.max(0, sub - disc));
    };
    $('#gl', v).addEventListener('input', e => {
      const box = e.target.closest('[data-li]'), k = e.target.dataset.k; if (!box || !k) return;
      const l = lines[+box.dataset.li]; l[k] = e.target.value;
      if (k === 'job_type') { const t = JT.find(x => x.name === l.job_type); Object.assign(l, { price_unit: t.unit, rate: t.rate || l.rate, qty: Math.max(+l.qty || 0, t.min_qty || 0) || 1 }); if (!t.film && t.unit !== 'sqin') l.film_item_id = ''; if (!t.paper) { l.paper_item_id = ''; l.paper_qty = ''; } }
      if (k === 'film_item_id' && l.film_item_id && !+l.rate) { const f = F.find(x => x.id === +l.film_item_id); if (f && +f.rate) l.rate = +f.rate; }
      if (['job_type', 'price_unit', 'film_item_id', 'paper_item_id'].includes(k)) { draw(); return; }
      // typing: update this line's numbers in place (never redraw, so the cursor stays where it is)
      const t = JT.find(x => x.name === l.job_type), c = genLineCalc(l, t);
      $('[data-amt]', box).textContent = tk(c.amount); $('[data-note]', box).textContent = lineNote(l, c);
      const fh = $('[data-fh]', box); if (fh) fh.innerHTML = filmHint(l.film_item_id ? filmUse(l, F.find(f => f.id === +l.film_item_id)) : null);
      totals();
    });
    $('#gl', v).addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(+b.dataset.rm, 1); draw(); } });
    $('#gal', v).onclick = () => { lines.push(blank(JT[0])); draw(); };
    $('#gdisc', v).oninput = totals;
    const key = uid();
    $('#gsave', v).onclick = () => busy($('#gsave', v), async () => {
      if (!cust) { toast('Select a customer', '', 'warn'); return; }
      const b = { ...formData($('#gh', v)), customer_id: cust.id, items: lines, discount: $('#gdisc', v).value, paid_amount: $('#gpaid', v).value, payment_method: $('#gmeth', v).value };
      const r = await POST('/api/gen/invoices', b, { idemKey: key });
      toast('Bill saved', r.inv_no); App.go('general/invoices/' + r.id);
    });
    draw();
  },
  async invoice(v, id) {
    const inv = await GET('/api/gen/invoices/' + id);
    $('#title').textContent = inv.inv_no;
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="App.go('general/invoices')">← Bills</button><div class="row">
        ${inv.status === 'confirmed' && inv.due > 0.004 && can('payments') ? `<button class="btn green" id="gpay">${ICON.money} Receive payment</button>` : ''}
        ${inv.status === 'confirmed' && can('invoice.cancel') ? `<button class="btn ghost" id="gcan" style="color:var(--danger)">Cancel bill</button>` : ''}<button class="btn" id="gprt">${ICON.print} Print / PDF</button></div></div>
      <div class="grid g32"><div style="overflow:auto;padding:4px">${genInvoiceDoc(inv)}</div>
      <div><div class="panel"><h2>Stock used</h2><div class="feed mt">${inv.items.filter(i => i.film_item_id || i.paper_item_id).map(i => `${i.film_item_id ? `<div class="feed-item"><div class="feed-ic" style="background:var(--pvc)">F</div><div class="t"><b>${esc(i.film)}</b><small>${qf(i.film_used)} ft · ${esc(i.job_type)}</small></div></div>` : ''}${i.paper_item_id ? `<div class="feed-item"><div class="feed-ic" style="background:var(--warn)">P</div><div class="t"><b>${esc(i.paper)}</b><small>${qf(i.paper_qty)} ${esc(i.paper_unit)} · ${esc(i.job_type)}</small></div></div>` : ''}`).join('') || '<div class="empty">No film or paper taken from stock</div>'}</div></div>
        <div class="panel"><h2>Details</h2><div class="kv mt"><span>Created by</span><b>${esc(inv.created_by_name)}</b><span>At</span><b>${fdt(inv.created_at)}</b>${inv.status === 'cancelled' ? `<span>Cancelled by</span><b>${esc(inv.cancelled_by_name)}</b><span>Reason</span><b>${esc(inv.cancel_reason)}</b>` : ''}</div></div></div></div>`;
    $('#gprt', v).onclick = () => printHTML(genInvoiceDoc(inv));
    if ($('#gpay', v)) $('#gpay', v).onclick = () => paymentModal({ customer: { id: inv.customer_id, name: inv.customer } }, () => App.refresh());
    if ($('#gcan', v)) $('#gcan', v).onclick = async () => { const r = await confirmBox('Cancel ' + inv.inv_no + '?', 'Film and paper used are returned to stock. Payments on this bill become customer credit.', { ok: 'Cancel bill', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/gen/invoices/${id}/cancel`, { reason: r }); toast('Bill cancelled'); App.refresh(); } catch (e) { fail(e); } } };
  },
};
/* links from the ledger / customer page use "gen-invoices/<id>" */
App.pages['gen-invoices'] = { title: 'General bill', render(v, id) { App.go(id ? 'general/invoices/' + id : 'general/invoices'); } };

/* ---------------- INTERNAL INVENTORY page ---------------- */
App.pages.internal = {
  title: 'Internal Inventory', st: {}, tab: 'stock',
  async render(v, sub) {
    if (sub === 'setup' || sub === 'stock') this.tab = sub;
    const tabs = [['stock', 'Items & Stock'], ...(can('internal', 'settings') ? [['setup', 'Units']] : [])];
    v.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pane" class="tabpane"></div>`;
    $$('[data-t]', v).forEach(b => b.onclick = () => App.go('internal/' + b.dataset.t));
    const pane = $('#pane', v);
    if (this.tab === 'setup') { pane.innerHTML = listsPanel([['internal_units', 'Units for internal items']]); bindLists(pane); return; }
    return stockModule(pane, 'internal', this.st);
  },
};
