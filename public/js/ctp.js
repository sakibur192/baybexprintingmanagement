/* CTP division: inventory, entries, own use, stock register, rates */
'use strict';
function ctpEntryModal(type, done) {
  const T = {
    opening: ['Opening / Initial Stock', 'Opening quantity', 'btn', 'Initial stock for a plate size.'],
    production: ['CTP Production Entry', 'Production quantity', 'btn green', 'Confirmed production increases plate stock.'],
    stock_in: ['CTP Stock In (Purchase)', 'Quantity received', 'btn', 'Plates bought / received from supplier.'],
    adjust: ['Stock Adjustment', 'Quantity', 'btn danger', 'Authorized correction — recorded with reason, user and time. Stock is never overwritten.'],
  }[type];
  const m = modal({
    title: T[0], body: `<div class="note" style="margin:0 0 14px">${T[3]}</div><div class="form f2" id="ef">
      ${field('Date', dateInput())}
      ${field('Plate size <span class="req">*</span>', `<select name="product_id">${productOptions()}</select>`)}
      ${type === 'adjust' ? field('Direction', `<select name="direction"><option value="in">Increase (+)</option><option value="out">Decrease (−)</option></select>`) : ''}
      ${field(T[1] + ' (pcs) <span class="req">*</span>', `<input type="number" min="1" step="1" name="qty">`)}
      ${type === 'production' ? field('Machine / job reference', `<input name="job_ref">`) : ''}
      ${type === 'stock_in' ? field('Supplier', `<input name="supplier">`) + field('Memo / challan no.', `<input name="ref_no">`) : ''}
      ${type === 'adjust' ? field('Reason <span class="req">*</span>', `<input name="reason" placeholder="e.g. physical count correction">`, 'span2') : ''}
      ${field('Remarks', `<input name="remarks">`, 'span2')}
    </div><div id="bal" class="sub mt"></div><div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="${T[2]}" id="es">Save entry</button></div>`,
  });
  const key = uid();
  const showBal = async () => { const s = await GET('/api/ctp/stock'); const p = s.find(x => x.id === +$('[name=product_id]', m.el).value); $('#bal', m.el).innerHTML = p ? `Current stock: <b>${p.balance} pcs</b>` : ''; };
  $('[name=product_id]', m.el).onchange = showBal; showBal();
  $('[data-x]', m.el).onclick = m.close;
  $('#es', m.el).onclick = () => busy($('#es', m.el), async () => {
    if (!requireFields(m.el, ['product_id', 'qty', ...(type === 'adjust' ? ['reason'] : [])])) return;
    const url = { opening: 'opening', production: 'production', stock_in: 'stockin', adjust: 'adjust' }[type];
    const r = await POST('/api/ctp/' + url, formData($('#ef', m.el)), { idemKey: key });
    toast('Saved', `${T[0]} recorded. New balance: ${r.balance} pcs`); m.close(); done && done();
  });
}

App.pages.ctp = {
  title: 'CTP Plate Inventory', tab: 'stock',
  async render(v, sub) {
    if (sub && ['stock', 'moves', 'register', 'rates'].includes(sub)) this.tab = sub;
    const t = this.tab;
    v.innerHTML = `<div class="head"><div class="sub">Closing = Opening + Production + Stock In + Adjustments In − Sales − Own Use − Adjustments Out</div>
      <div class="row">${can('ctp.production') ? `<button class="btn ghost" data-e="opening">${ICON.plus} Opening Stock</button><button class="btn green" data-e="production">${ICON.plus} Production</button><button class="btn light" data-e="stock_in">${ICON.plus} Stock In</button>` : ''}
      ${can('stock.adjust') ? `<button class="btn ghost" data-e="adjust">± Adjust</button>` : ''}</div></div>
      <div class="tabs">${[['stock', 'Stock Summary'], ['moves', 'Movements'], ['register', 'Stock Register'], ['rates', 'Plate Master & Rates']].map(([k, l]) => `<button data-t="${k}" class="${k === t ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pane" class="tabpane"></div>`;
    $$('[data-e]', v).forEach(b => b.onclick = () => ctpEntryModal(b.dataset.e, () => App.refresh()));
    $$('[data-t]', v).forEach(b => b.onclick = () => { this.tab = b.dataset.t; App.refresh(); });
    await this['tab_' + t]($('#pane', v));
  },
  async tab_stock(el) {
    const now = App.today; let from = this.from || monthStart(now), to = this.to || now;
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Plate stock</h2><div class="sub">Movement for the selected period, closing as of end date</div></div>
      <div class="row"><input type="date" class="inp" id="sf" value="${from}" style="width:150px"><input type="date" class="inp" id="st" value="${to}" style="width:150px"><button class="btn sm" id="sgo">Apply</button></div></div><div id="stbl"></div></div>`;
    const rows = await GET('/api/ctp/stock', { from, to });
    dataTable($('#stbl', el), rows, [
      { k: 'name', label: 'Plate size', f: r => `<b>${esc(r.name)}</b><div class="sub">${esc(r.size_mm || '')}</div>` },
      { k: 'before', label: 'B/F', n: 1, total: 1 }, { k: 'opening', label: 'Opening', n: 1, total: 1 }, { k: 'production', label: 'Production', n: 1, total: 1 },
      { k: 'stock_in', label: 'Stock in', n: 1, total: 1 }, { k: 'adj_in', label: 'Adj +', n: 1, total: 1 }, { k: 'sales', label: 'Sales', n: 1, total: 1 },
      { k: 'own_use', label: 'Own use', n: 1, total: 1 }, { k: 'adj_out', label: 'Adj −', n: 1, total: 1 },
      { k: 'closing', label: 'Closing', n: 1, total: 1, f: r => `<b>${r.closing}</b> pcs ${r.balance <= r.low_stock ? '<span class="tag orange">Low</span>' : ''}` },
    ], { search: false, totals: true });
    $('#sgo', el).onclick = () => { this.from = $('#sf', el).value; this.to = $('#st', el).value; App.refresh(); };
  },
  async tab_moves(el) {
    const f = this.mf || { from: monthStart(App.today), to: App.today, type: '', product: '' };
    el.innerHTML = `<div class="panel"><div class="row mb"><input type="date" class="inp" id="mf" value="${f.from}" style="width:150px"><input type="date" class="inp" id="mt" value="${f.to}" style="width:150px">
      <select class="inp" id="mty" style="width:170px"><option value="">All types</option>${Object.entries(TYPE_LABEL).filter(([k]) => !['print', 'wastage'].includes(k)).map(([k, l]) => opt(k, l, f.type)).join('')}</select>
      <select class="inp" id="mp" style="width:190px"><option value="">All plate sizes</option>${productOptions(f.product)}</select><button class="btn sm" id="mgo">Apply</button>
      <button class="btn sm ghost right" id="mx">${ICON.excel} Excel</button></div><div id="mtbl"></div></div>`;
    const rows = await GET('/api/ctp/movements', f);
    rows.forEach(r => { if (r.voided) r._cls = 'void'; });
    dataTable($('#mtbl', el), rows, [
      { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'product', label: 'Plate' },
      { k: 'type', label: 'Type', f: r => `<span class="tag ${r.qty > 0 ? 'green' : r.type === 'own_use' ? 'purple' : 'orange'}">${TYPE_LABEL[r.type]}${r.is_reversal ? ' · reversal' : ''}</span>` },
      { k: 'qty', label: 'Qty', n: 1, f: r => `<b style="color:${r.qty > 0 ? 'var(--ok)' : 'var(--danger)'}">${r.qty > 0 ? '+' : ''}${r.qty}</b>` },
      { k: 'ref_no', label: 'Ref', f: r => esc(r.ref_no || r.job_ref || '') }, { k: 'party', label: 'Party / purpose', f: r => esc([r.party, r.purpose].filter(Boolean).join(' — ')) },
      { k: 'remarks', label: 'Remarks', f: r => esc(r.remarks || '') + (r.voided ? ` <span class="tag red">Voided: ${esc(r.void_reason)}</span>` : '') },
      { k: 'created_by_name', label: 'Entered by', f: r => `${esc(r.created_by_name)}<div class="sub">${fdt(r.created_at)}</div>` },
      { k: 'id', label: '', sort: false, f: r => can('stock.adjust') && !r.voided && !r.is_reversal && !['sale', 'challan_out'].includes(r.type) ? `<button class="btn xs ghost" data-void="${r.id}">Void</button>` : '' },
    ], { id: 'ctp-mv' });
    $('#mgo', el).onclick = () => { this.mf = { from: $('#mf', el).value, to: $('#mt', el).value, type: $('#mty', el).value, product: $('#mp', el).value }; App.refresh(); };
    $('#mx', el).onclick = () => exportXlsx('CTP Stock Movements', [`${fdate(f.from)} to ${fdate(f.to)}`], [tableToSheet('Movements', $('#ctp-mv', el))]);
    el.onclick = async e => {
      const b = e.target.closest('[data-void]'); if (!b) return;
      const reason = await confirmBox('Void this entry?', 'A reversal movement will be recorded. The original stays visible in the history.', { ok: 'Void entry', danger: true, input: 'Reason' });
      if (reason) { try { await POST(`/api/ctp/movements/${b.dataset.void}/void`, { reason }); toast('Entry voided'); App.refresh(); } catch (er) { fail(er); } }
    };
  },
  async tab_register(el) {
    const pid = this.rp || App.meta.products[0]?.id, from = this.rf || monthStart(App.today), to = this.rt || App.today;
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Stock Register</h2><div class="sub">Same layout as the paper register: Date · B.F. · Receipts · Total · Issue (party) · Qty · Balance</div></div>
      <div class="row"><select class="inp" id="rp" style="width:190px">${productOptions(pid)}</select><input type="date" class="inp" id="rf" value="${from}" style="width:150px"><input type="date" class="inp" id="rt" value="${to}" style="width:150px">
      <button class="btn sm" id="rgo">Show</button><button class="btn sm ghost" id="rpr">${ICON.print} Print</button><button class="btn sm ghost" id="rx">${ICON.excel} Excel</button></div></div><div id="reg"></div></div>`;
    const d = await GET('/api/ctp/register/' + pid, { from, to });
    const html = `<div class="tbl-wrap"><table id="regt"><thead><tr><th>Date</th><th class="n">B.F.</th><th class="n">Receipts</th><th>C.Memo / Ref</th><th class="n">Total</th><th>Issue — Party / Purpose</th><th class="n">Qty</th><th class="n">Balance</th><th>By</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr class="${r.voided ? 'void' : ''}"><td>${fdate(r.date)}</td><td class="n">${r.bf}</td><td class="n">${r.receipt || ''}</td><td>${esc(r.receipt ? (TYPE_LABEL[r.type] + (r.ref_no ? ' · ' + r.ref_no : '')) : (r.ref_no || ''))}</td>
        <td class="n">${r.bf + r.receipt}</td><td>${r.issue ? esc(r.party || TYPE_LABEL[r.type]) + (r.purpose ? ` <span class="muted">— ${esc(r.purpose)}</span>` : '') : (r.is_reversal ? '<span class="muted">reversal</span>' : '')}</td>
        <td class="n">${r.issue || ''}</td><td class="n"><b>${r.balance}</b></td><td class="sub">${esc(r.created_by_name)}</td></tr>`).join('') || `<tr><td colspan="9"><div class="empty">No movements in this period. B.F. ${d.bf}</div></td></tr>`}
      </tbody><tfoot><tr class="total"><td>Closing</td><td class="n">${d.bf}</td><td class="n">${d.rows.reduce((s, r) => s + r.receipt, 0)}</td><td></td><td></td><td></td><td class="n">${d.rows.reduce((s, r) => s + r.issue, 0)}</td><td class="n">${d.closing}</td><td></td></tr></tfoot></table></div>`;
    $('#reg', el).innerHTML = html;
    $('#rgo', el).onclick = () => { this.rp = $('#rp', el).value; this.rf = $('#rf', el).value; this.rt = $('#rt', el).value; App.refresh(); };
    $('#rpr', el).onclick = () => printHTML(`<div class="doc rpt-print">${companyHeader(`<div style="text-align:right"><div class="doc-title">STOCK REGISTER</div><div class="mt"><b>${esc(d.product.name)}</b></div><div class="muted">${fdate(from)} – ${fdate(to)}</div></div>`)}${html}</div>`);
    $('#rx', el).onclick = () => exportXlsx('CTP Stock Register ' + d.product.name, [`${fdate(from)} to ${fdate(to)}`], [tableToSheet(d.product.name, $('#regt', el))]);
  },
  async tab_rates(el) {
    const [hist] = await Promise.all([GET('/api/ctp/rates/history'), App.loadMeta()]);
    const prods = App.meta.products;
    el.innerHTML = `<div class="grid g32"><div class="panel"><div class="head"><div><h2>Plate master</h2><div class="sub">Add, rename or retire plate sizes · rate changes never alter existing invoices</div></div>${can('ctp.rates') ? `<button class="btn" id="addp">${ICON.plus} Add plate size</button>` : ''}</div><div id="pt"></div></div>
      <div class="panel"><div class="head"><h2>Rate change history</h2></div><div id="rh"></div></div></div>`;
    const edit = p => {
      const m = modal({ title: p ? 'Edit ' + p.name : 'Add plate size', body: `<div class="form f2" id="pmf">
        ${field('Plate name <span class="req">*</span>', `<input name="name" value="${esc(p?.name || '')}" placeholder="e.g. Demy Plate">`)}${field('Also known as', `<input name="alias" value="${esc(p?.alias || '')}" placeholder="e.g. Full Kord">`)}
        ${field('Size (mm)', `<input name="size_mm" value="${esc(p?.size_mm || '')}" placeholder="550 x 650 mm">`)}${field('Size (inch)', `<input name="size_in" value="${esc(p?.size_in || '')}" placeholder='21.65" x 25.59"'>`)}
        ${field('Current rate (৳)', `<input type="number" step="0.01" name="current_rate" value="${p ? p.current_rate : ''}">`)}${field('Unit', `<input name="unit" value="${esc(p?.unit || 'Pcs')}">`)}
        ${field('Low-stock alert', `<input type="number" name="low_stock" value="${p ? p.low_stock : 20}">`)}${field('Display order', `<input type="number" name="sort" value="${p ? p.sort : prods.length + 1}">`)}
        <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Active (shown in invoices & entries)</label></div>
        <div class="actions"><button class="btn" id="pms">Save</button></div>` });
      $('#pms', m.el).onclick = () => busy($('#pms', m.el), async () => {
        if (!requireFields(m.el, ['name'])) return;
        const b = formData($('#pmf', m.el));
        if (p) await PUT('/api/ctp/products/' + p.id, b); else await POST('/api/ctp/products', b, { idem: false });
        toast('Plate saved'); m.close(); await App.loadMeta(); App.refresh();
      });
    };
    dataTable($('#pt', el), prods, [
      { k: 'name', label: 'Plate', f: r => `<b>${esc(r.name)}</b><div class="sub">${esc(r.alias || '')}</div>` }, { k: 'size_mm', label: 'Size', f: r => `<span class="sub">${esc(r.size_mm || '')}<br>${esc(r.size_in || '')}</span>` },
      { k: 'current_rate', label: 'Rate', n: 1, f: r => `<b>${tk(r.current_rate)}</b>` }, { k: 'low_stock', label: 'Low alert', n: 1 },
      { k: 'active', label: 'Status', f: r => r.active ? '<span class="tag green">Active</span>' : '<span class="tag gray">Inactive</span>' },
      { k: 'x', label: '', sort: false, f: r => can('ctp.rates') ? `<button class="btn xs ghost" data-ed="${r.id}">Edit</button> <button class="btn xs ghost" data-del="${r.id}" style="color:var(--danger)" title="Delete">${ICON.trash.replace('<svg', '<svg width="13"')}</button>` : '' },
    ], { search: false });
    if ($('#addp', el)) $('#addp', el).onclick = () => edit(null);
    el.addEventListener('click', e => { const b = e.target.closest('[data-ed]'); if (b) edit(prods.find(p => p.id === +b.dataset.ed)); const d = e.target.closest('[data-del]'); if (d) masterDelete('/api/ctp/products/' + d.dataset.del, prods.find(p => p.id === +d.dataset.del)?.name); });
    dataTable($('#rh', el), hist, [{ k: 'created_at', label: 'When', f: r => fdt(r.created_at) }, { k: 'name', label: 'Plate' }, { k: 'old_rate', label: 'Old', n: 1, f: r => r.old_rate == null ? '—' : tk(r.old_rate) }, { k: 'rate', label: 'New', n: 1, f: r => `<b>${tk(r.rate)}</b>` }, { k: 'created_by_name', label: 'By' }], { search: false, empty: 'No rate changes yet' });
  },
};

/* ---------------- CTP Own Use ---------------- */
App.pages['ctp-ownuse'] = {
  title: 'CTP Own Use',
  async render(v) {
    const [stock, rows] = await Promise.all([GET('/api/ctp/stock'), GET('/api/ctp/movements', { type: 'own_use', from: addDays(App.today, -60), to: App.today })]);
    v.innerHTML = `<div class="grid g23">
      <div class="panel"><div class="head"><div><h2>Own Use Entry</h2><div class="sub">${esc(App.meta.settings.company?.name || 'Business')} internal plate consumption · reduces stock, not sales</div></div><span class="tag purple">Own Use</span></div>
        <div class="form f2" id="of">
          ${field('Entry date', dateInput(), '', can('date.edit') ? '' : 'today (locked)')}
          ${field('Entry type', `<input value="${esc(App.meta.settings.company?.name || 'Business')} – Own Use (নিজস্ব ব্যবহার)" readonly>`)}
          ${field('Plate size <span class="req">*</span>', `<select name="product_id">${productOptions()}</select>`)}
          ${field('Quantity (pcs) <span class="req">*</span>', `<input type="number" min="1" step="1" name="qty" placeholder="Enter quantity">`)}
          ${field('Remarks / Purpose <span class="req">*</span>', `<input name="purpose" placeholder="e.g. Calendar Printing / Internal Sample Job" list="purposes">`, 'span2', 'required — why is the plate used internally?')}
          ${field('Job / Department reference', `<input name="job_ref" placeholder="Optional internal reference">`)}
          ${field('Entered by', `<input value="${esc(App.user.full_name)} (${esc(App.user.role_name)})" readonly>`)}
        </div>
        <datalist id="purposes">${[...new Set(['Calendar Printing', 'Internal Sample Job', 'Office Diary Printing', 'Machine Test Plate', ...rows.map(r => r.purpose).filter(Boolean)])].map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <div class="note" id="obal"></div>
        <div class="actions"><button class="btn ghost" id="oclr">Clear</button><button class="btn purple" id="osave">Save Own Use Entry</button></div></div>
      <div class="panel"><div class="head"><div><h2>Plate stock</h2><div class="sub">Live balances</div></div></div>
        <div class="plates" style="grid-template-columns:1fr 1fr">${stock.map(p => `<div class="plate-tile" data-pid="${p.id}" style="cursor:pointer"><b>${esc(p.name)}</b><div class="big" data-count-to="${p.balance}">0</div><small>pcs available</small></div>`).join('')}</div></div></div>
      <div class="panel mt"><div class="head"><div><h2>Recent own-use entries</h2><div class="sub">Last 60 days · full register in Reports</div></div></div><div id="otbl"></div></div>`;
    const key = { k: uid() };
    const bal = () => { const p = stock.find(x => x.id === +$('[name=product_id]', v).value); const q = +$('[name=qty]', v).value || 0;
      $('#obal', v).innerHTML = p ? `Available <b>${p.name}</b>: <b>${p.balance} pcs</b>${q ? ` → after entry: <b style="color:${p.balance - q < 0 ? 'var(--danger)' : 'var(--ok)'}">${p.balance - q} pcs</b>` : ''}. Own use is excluded from customer sales, revenue and dues.` : ''; };
    $('[name=product_id]', v).onchange = bal; $('[name=qty]', v).oninput = bal; bal();
    $$('[data-pid]', v).forEach(t => t.onclick = () => { $('[name=product_id]', v).value = t.dataset.pid; bal(); $('[name=qty]', v).focus(); });
    $('#oclr', v).onclick = () => { $('[name=qty]', v).value = ''; $('[name=purpose]', v).value = ''; $('[name=job_ref]', v).value = ''; bal(); };
    $('#osave', v).onclick = () => busy($('#osave', v), async () => {
      if (!requireFields(v, ['product_id', 'qty', 'purpose'])) return;
      const r = await POST('/api/ctp/ownuse', formData($('#of', v)), { idemKey: key.k });
      toast('Own use saved', `New balance: ${r.balance} pcs`); App.refresh();
    });
    rows.forEach(r => { if (r.voided) r._cls = 'void'; });
    dataTable($('#otbl', v), rows.filter(r => !r.is_reversal), [
      { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'product', label: 'Plate size' }, { k: 'qty', label: 'Qty', n: 1, f: r => `${-r.qty} pcs` },
      { k: 'purpose', label: 'Remarks / Purpose', f: r => `<b>${esc(r.purpose)}</b>` }, { k: 'job_ref', label: 'Job / Dept' },
      { k: 'created_by_name', label: 'Entered by', f: r => `${esc(r.created_by_name)} <span class="sub">${esc(r.created_role || '')}</span>` },
      { k: 'created_at', label: 'Time', f: r => `<span class="sub">${fdt(r.created_at)}</span>` + (r.voided ? ` <span class="tag red">Voided</span>` : '') },
    ], { empty: 'No own-use entries yet' });
  },
};
