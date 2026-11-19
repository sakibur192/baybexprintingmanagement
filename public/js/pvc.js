/* PVC / media division: inventory, stock in, print entry, wastage, media, ink */
'use strict';
/** mirrors server pvcCalc */
function pvcCalc({ roll_width, art_w, art_l, qty, orientation, nest }) {
  const W = +roll_width, aw = +art_w, al = +art_l, n = +qty;
  const across = orientation === 'Rotate' ? al : aw, along = orientation === 'Rotate' ? aw : al;
  const fits = across <= W + 1e-9;
  const per = fits && nest ? Math.max(1, Math.floor((W + 1e-9) / across)) : 1;
  const used = r2(Math.ceil(n / per) * along);
  return { fits, across: per, used_length: used, printed_sqft: r2(aw * al * n), consumed_sqft: r2(W * used), fill: used ? r2(aw * al * n / (W * used) * 100) : 0, alt_fits: (orientation === 'Rotate' ? aw : al) <= W + 1e-9, acrossDim: across, alongDim: along };
}
function rollSVG({ W, calc, qty, wastage = 0 }) {
  if (!W || !calc.alongDim || !qty) return `<div class="empty" style="padding:30px">${ICON.roll}Enter artwork size and quantity to preview the roll layout</div>`;
  const total = calc.used_length + (+wastage || 0);
  const vw = 760, pad = 26, h = 150, scale = Math.min((vw - pad * 2) / Math.max(total, W * 1.4), (h - 30) / W);
  const rw = W * scale, len = total * scale, y0 = 18;
  let pieces = '', placed = 0; const per = calc.across, rows = Math.ceil(qty / per);
  const maxRows = 120;
  for (let r = 0; r < Math.min(rows, maxRows); r++) for (let c = 0; c < per && placed < qty; c++, placed++) {
    const x = pad + r * calc.alongDim * scale, y = y0 + c * calc.acrossDim * scale;
    pieces += `<rect x="${x + .8}" y="${y + .8}" width="${Math.max(1, calc.alongDim * scale - 1.6)}" height="${Math.max(1, Math.min(calc.acrossDim, W) * scale - 1.6)}" rx="2" fill="${calc.fits ? 'url(#art)' : '#d9475a55'}" stroke="${calc.fits ? '#1f68ad' : '#d9475a'}" stroke-width="1"><animate attributeName="opacity" from="0" to="1" dur=".35s" begin="${Math.min(placed, 60) * 0.025}s" fill="freeze"/></rect>`;
  }
  const wx = pad + calc.used_length * scale;
  return `<svg viewBox="0 0 ${vw} ${h + 24}">
    <defs><linearGradient id="art" x1="0" x2="1"><stop offset="0" stop-color="#2a7fd0" stop-opacity=".85"/><stop offset="1" stop-color="#13a389" stop-opacity=".85"/></linearGradient>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#d9475a55"/></pattern></defs>
    <rect x="${pad}" y="${y0}" width="${Math.max(len, 4)}" height="${rw}" fill="#fff" stroke="#9fb3c6" stroke-dasharray="4 3" rx="3"/>
    ${pieces}
    ${wastage > 0 ? `<rect x="${wx}" y="${y0}" width="${wastage * scale}" height="${rw}" fill="url(#hatch)" stroke="#d9475a" stroke-width="1"/>` : ''}
    ${!calc.fits ? `<rect x="${pad}" y="${y0}" width="${Math.max(len, 4)}" height="${rw}" fill="none" stroke="#d9475a" stroke-width="2"/>` : ''}
    <text x="${pad - 6}" y="${y0 + rw / 2}" text-anchor="end" font-size="11" fill="#5b6b7c" transform="rotate(-90 ${pad - 8} ${y0 + rw / 2})">${W} ft roll</text>
    <line x1="${pad}" x2="${pad + len}" y1="${y0 + rw + 12}" y2="${y0 + rw + 12}" stroke="#7b8a9b"/><text x="${pad + len / 2}" y="${y0 + rw + 24}" text-anchor="middle" font-size="11" fill="#3a4a5c">${n0(calc.used_length)} ft printed${wastage > 0 ? ` + ${n0(wastage)} ft wastage` : ''}${rows > maxRows ? ` (first ${maxRows} rows shown)` : ''}</text>
  </svg>`;
}
function pvcRollModal(kind, done, presetMedia) {
  const s = App.meta.settings.pvc || {};
  const m = modal({
    title: kind === 'opening' ? 'PVC Opening / Initial Stock' : 'PVC Stock In — New Rolls', size: 'wide',
    icon: `<span class="feed-ic" style="background:var(--pvc)">${ICON.roll.replace('<svg', '<svg width="18"')}</span>`,
    body: `<div class="form" id="rf">
      ${field('Date', dateInput())}
      ${field('Media option <span class="req">*</span>', `<select name="media_id">${mediaOptions(presetMedia)}</select>`, 'span2')}
      ${field('Roll quantity <span class="req">*</span>', `<input type="number" min="0.01" step="any" name="roll_qty" value="1">`)}
      ${field('Roll length (ft) <span class="req">*</span>', `<input type="number" min="1" step="any" name="roll_length" value="${s.default_roll_length || 164}">`)}
      ${field('Added stock (ft)', `<input id="added" readonly>`, '', '= rolls × length')}
      ${kind === 'stock_in' ? field('Supplier', `<input name="supplier">`) + field('Memo / bill no.', `<input name="ref_no">`) : ''}
      ${field('Remarks', `<input name="remarks">`, kind === 'stock_in' ? '' : 'span3')}
    </div><div class="kpis"><div class="kpi"><small>Current stock</small><b id="cur">—</b></div><div class="kpi"><small>Adding</small><b id="add">—</b></div><div class="kpi ok"><small>New balance</small><b id="nb">—</b></div><div class="kpi"><small>Area added</small><b id="ar">—</b></div></div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn teal" id="rs">Save ${kind === 'opening' ? 'opening stock' : 'stock in'}</button></div>`,
  });
  const key = uid(); let stock = [];
  const upd = () => {
    const md = App.meta.media.find(x => x.id === +$('[name=media_id]', m.el).value);
    const st = stock.find(x => x.id === md?.id); const len = r2((+$('[name=roll_qty]', m.el).value || 0) * (+$('[name=roll_length]', m.el).value || 0));
    if (md && !$('[name=roll_length]', m.el).dataset.touched) $('[name=roll_length]', m.el).value = +md.roll_length_ft || s.default_roll_length || 164;
    const len2 = r2((+$('[name=roll_qty]', m.el).value || 0) * (+$('[name=roll_length]', m.el).value || 0));
    $('#added', m.el).value = n0(len2) + ' ft'; $('#cur', m.el).textContent = st ? n0(st.balance) + ' ft' : '—';
    $('#add', m.el).textContent = '+' + n0(len2) + ' ft'; $('#nb', m.el).textContent = st ? n0(st.balance + len2) + ' ft' : '—'; $('#ar', m.el).textContent = md ? n0(len2 * md.width_ft) + ' sq ft' : '—';
  };
  GET('/api/pvc/stock').then(r => { stock = r; upd(); });
  $('[name=roll_length]', m.el).addEventListener('input', e => (e.target.dataset.touched = 1));
  $$('input,select', m.el).forEach(e => e.addEventListener('input', upd));
  $('[data-x]', m.el).onclick = m.close;
  $('#rs', m.el).onclick = () => busy($('#rs', m.el), async () => {
    if (!requireFields(m.el, ['media_id', 'roll_qty', 'roll_length'])) return;
    const r = await POST('/api/pvc/' + (kind === 'opening' ? 'opening' : 'stockin'), formData($('#rf', m.el)), { idemKey: key });
    toast('Stock added', `${n0(r.length_ft)} ft added. Balance ${n0(r.balance)} ft`); m.close(); done && done();
  });
}
function pvcSimpleModal(kind, done) {
  const isW = kind === 'wastage';
  const m = modal({
    title: isW ? 'Record PVC Wastage' : 'PVC Stock Adjustment', body: `<div class="note ${isW ? 'warn' : ''}" style="margin:0 0 14px">${isW ? 'Wastage reduces stock but is never billed or counted as sales.' : 'Authorized correction with reason. Recorded with user and time.'}</div>
    <div class="form f2" id="wf">${field('Date', dateInput())}${field('Media option', `<select name="media_id">${mediaOptions()}</select>`)}
    ${!isW ? field('Direction', `<select name="direction"><option value="in">Increase (+)</option><option value="out">Decrease (−)</option></select>`) : ''}
    ${field('Length (linear ft) <span class="req">*</span>', `<input type="number" step="any" min="0.01" name="length_ft">`)}
    ${isW ? field('Reason <span class="req">*</span>', `<select name="reason">${App.meta.wastage_reasons.map(r => opt(r, r)).join('')}</select>`) : field('Reason <span class="req">*</span>', `<input name="reason">`)}
    ${field('Remarks', `<input name="remarks">`, 'span2')}</div>
    <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn ${isW ? 'danger' : ''}" id="ws">Save</button></div>`,
  });
  const key = uid();
  $('[data-x]', m.el).onclick = m.close;
  $('#ws', m.el).onclick = () => busy($('#ws', m.el), async () => {
    if (!requireFields(m.el, ['media_id', 'length_ft', 'reason'])) return;
    await POST('/api/pvc/' + (isW ? 'wastage' : 'adjust'), formData($('#wf', m.el)), { idemKey: key });
    toast(isW ? 'Wastage recorded' : 'Adjustment saved'); m.close(); done && done();
  });
}
function mediaModal(md, done) {
  const m = modal({
    title: md ? 'Edit media: ' + mediaName(md) : 'Add media option', body: `<div class="form f2" id="mmf">
    ${field('Media category', md ? `<input value="${esc(md.category)}" readonly>` : `<input name="category" list="cats" placeholder="e.g. PVC Banner"><datalist id="cats">${[...new Set(App.meta.media.map(x => x.category))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>`)}
    ${field('Roll width (ft)', md ? `<input value="${+md.width_ft}" readonly>` : `<select name="width_ft">${[3, 4, 5, 6, 8, 10].map(w => opt(w, w + ' ft')).join('')}</select>`)}
    ${field('Standard roll length (ft)', `<input type="number" name="roll_length_ft" value="${md ? +md.roll_length_ft : App.meta.settings.pvc?.default_roll_length || 164}">`)}
    ${field('Low-stock alert (ft)', `<input type="number" name="low_stock_ft" value="${md ? +md.low_stock_ft : App.meta.settings.pvc?.default_low_stock || 20}">`)}
    ${field('Default rate per sq ft (৳)', `<input type="number" step="0.01" name="default_rate" value="${md ? +md.default_rate : 0}">`)}
    <label class="check" style="align-self:end"><input type="checkbox" name="active" ${!md || md.active ? 'checked' : ''}> Active</label></div>
    <div class="actions"><button class="btn" id="mms">Save</button></div>`,
  });
  $('#mms', m.el).onclick = () => busy($('#mms', m.el), async () => {
    const b = formData($('#mmf', m.el));
    if (md) await PUT('/api/pvc/media/' + md.id, b); else { if (!requireFields(m.el, ['category'])) return; await POST('/api/pvc/media', b, { idem: false }); }
    await App.loadMeta(); toast('Media saved'); m.close(); done && done();
  });
}

App.pages.pvc = {
  title: 'PVC Media Inventory', tab: 'stock',
  async render(v, sub) {
    if (sub === 'stockin' || sub === 'opening') { setTimeout(() => pvcRollModal(sub === 'opening' ? 'opening' : 'stock_in', () => App.go('pvc')), 50); history.replaceState(null, '', '#/pvc'); }
    else if (sub) this.tab = sub;
    const t = this.tab;
    v.innerHTML = `<div class="head"><div class="sub">Stock is held in linear feet per media & roll width · Closing = Opening + Stock In + Adj In − Printed − Wastage − Adj Out</div>
      <div class="row">${can('pvc.stockin') ? `<button class="btn ghost" data-e="opening">${ICON.plus} Opening Stock</button><button class="btn teal" data-e="stock_in">${ICON.plus} Stock In</button>` : ''}
      ${can('pvc.wastage') ? `<button class="btn ghost" data-e="wastage">${ICON.waste} Wastage</button>` : ''}${can('stock.adjust') ? `<button class="btn ghost" data-e="adjust">± Adjust</button>` : ''}</div></div>
      <div class="tabs">${[['stock', 'Stock Summary'], ['prints', 'Print Entries'], ['moves', 'Movements'], ['media', 'Media Master']].map(([k, l]) => `<button data-t="${k}" class="${k === t ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pane" class="tabpane"></div>`;
    $$('[data-e]', v).forEach(b => b.onclick = () => { const e = b.dataset.e; if (e === 'opening' || e === 'stock_in') pvcRollModal(e, () => App.refresh()); else pvcSimpleModal(e, () => App.refresh()); });
    $$('[data-t]', v).forEach(b => b.onclick = () => { this.tab = b.dataset.t; App.go('pvc/' + b.dataset.t); });
    await this['tab_' + t]($('#pane', v));
  },
  async tab_stock(el) {
    const from = this.from || monthStart(App.today), to = this.to || App.today;
    const rows = (await GET('/api/pvc/stock', { from, to })).filter(r => r.active || r.balance);
    const showAll = this.showAll;
    const shown = showAll ? rows : rows.filter(r => r.balance || r.before || r.stock_in || r.opening || r.printed || r.wastage);
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Media stock</h2><div class="sub">Period movement · closing as of end date</div></div>
      <div class="row"><label class="check"><input type="checkbox" id="sa" ${showAll ? 'checked' : ''}> Show empty media</label><input type="date" class="inp" id="sf" value="${from}" style="width:150px"><input type="date" class="inp" id="st" value="${to}" style="width:150px"><button class="btn sm" id="sgo">Apply</button><button class="btn sm ghost" id="sx">${ICON.excel} Excel</button></div></div><div id="stbl"></div></div>`;
    const t = dataTable($('#stbl', el), shown, [
      { k: 'category', label: 'Media', f: r => `<b>${esc(r.category)}</b>${r.active ? '' : ' <span class="tag gray">inactive</span>'}` }, { k: 'width_ft', label: 'Width', f: r => `${+r.width_ft} ft` },
      { k: 'before', label: 'B/F ft', n: 1, f: r => n0(r.before), total: 1 }, { k: 'opening', label: 'Opening', n: 1, f: r => n0(r.opening), total: 1 }, { k: 'stock_in', label: 'Stock in', n: 1, f: r => n0(r.stock_in), total: 1 },
      { k: 'printed', label: 'Printed', n: 1, f: r => n0(r.printed), total: 1 }, { k: 'wastage', label: 'Wastage', n: 1, f: r => n0(r.wastage), total: 1 },
      { k: 'adj', label: 'Adj ±', n: 1, v: r => r.adj_in - r.adj_out, f: r => n0(r.adj_in - r.adj_out) },
      { k: 'closing', label: 'Closing ft', n: 1, total: 1, f: r => `<b>${n0(r.closing)}</b>` },
      { k: 'area', label: 'Closing sq ft', n: 1, v: r => r.closing * r.width_ft, f: r => n0(r.closing * r.width_ft) },
      { k: 'st', label: 'Status', v: r => r.balance <= r.low_stock_ft ? 0 : 1, f: r => r.balance <= 0 ? '<span class="tag gray">Empty</span>' : r.balance <= r.low_stock_ft ? '<span class="tag orange">Low</span>' : '<span class="tag green">OK</span>' },
    ], { totals: true, id: 'pvc-st', empty: 'No PVC stock recorded yet — use Opening Stock or Stock In' });
    $('#sgo', el).onclick = () => { this.from = $('#sf', el).value; this.to = $('#st', el).value; App.refresh(); };
    $('#sa', el).onchange = e => { this.showAll = e.target.checked; App.refresh(); };
    $('#sx', el).onclick = () => exportXlsx('PVC Media Stock', [`${fdate(from)} to ${fdate(to)}`], [tableToSheet('Stock', $('#pvc-st', el))]);
  },
  async tab_prints(el) {
    const from = this.pf || addDays(App.today, -30), to = this.pt || App.today;
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Print entries</h2><div class="sub">Each entry deducts printed length + wastage from stock</div></div>
      <div class="row"><input type="date" class="inp" id="pf" value="${from}" style="width:150px"><input type="date" class="inp" id="pt" value="${to}" style="width:150px"><button class="btn sm" id="pgo">Apply</button>${can('pvc.print') ? `<button class="btn sm teal" onclick="App.go('pvc-print')">${ICON.plus} New print entry</button>` : ''}</div></div><div id="ptbl"></div></div>`;
    const rows = await GET('/api/pvc/prints', { from, to });
    rows.forEach(r => { if (r.voided) r._cls = 'void'; });
    dataTable($('#ptbl', el), rows, [
      { k: 'date', label: 'Date', f: r => fdate(r.date) + `<div class="sub">PE-${r.id}</div>` }, { k: 'customer', label: 'Customer / job', f: r => esc(r.customer || r.job_name) },
      { k: 'category', label: 'Media', f: r => `${esc(r.category)} <span class="muted">${+r.width_ft} ft</span>` },
      { k: 'size', label: 'Artwork', f: r => `${+r.art_w} × ${+r.art_l} ft × ${r.qty}<div class="sub">${r.orientation}${r.across > 1 ? ` · ${r.across} across` : ''}</div>` },
      { k: 'printed_sqft', label: 'Billable sq ft', n: 1, f: r => n0(r.printed_sqft), total: 1 }, { k: 'used_length', label: 'Used ft', n: 1, f: r => n0(r.used_length), total: 1 },
      { k: 'wastage_length', label: 'Waste ft', n: 1, f: r => r.wastage_length ? `${n0(r.wastage_length)}<div class="sub">${esc(r.wastage_reason)}</div>` : '', total: 1 },
      { k: 'fit_status', label: 'Fit', f: r => statusTag(r.fit_status) + (r.override_reason ? `<div class="sub">${esc(r.override_reason)}</div>` : '') },
      { k: 'inv_no', label: 'Invoice', f: r => r.inv_no ? `<a href="#/pvc-invoices/${r.invoice_id}">${esc(r.inv_no)}</a>` : r.voided ? `<span class="tag red">Voided</span>` : '<span class="tag orange">Unbilled</span>' },
      { k: 'created_by_name', label: 'By', f: r => `<span class="sub">${esc(r.created_by_name)}</span>` },
      { k: 'x', label: '', sort: false, f: r => !r.voided && !r.invoice_id ? `${can('pvc.invoice') && r.customer_id ? `<button class="btn xs teal" data-bill="${r.id}">Bill</button> ` : ''}${can('stock.adjust') ? `<button class="btn xs ghost" data-void="${r.id}">Void</button>` : ''}` : '' },
    ], { totals: true });
    $('#pgo', el).onclick = () => { this.pf = $('#pf', el).value; this.pt = $('#pt', el).value; App.refresh(); };
    el.onclick = async e => {
      const vb = e.target.closest('[data-void]'), bb = e.target.closest('[data-bill]');
      if (bb) { const r = rows.find(x => x.id === +bb.dataset.bill); App.pages['pvc-invoices'].prefill = { customer: { id: r.customer_id, name: r.customer }, prints: [r] }; App.go('pvc-invoices/new'); }
      if (vb) { const reason = await confirmBox('Void print entry?', 'Printed length and wastage will be returned to stock via reversal entries.', { ok: 'Void', danger: true, input: 'Reason' }); if (reason) { try { await POST(`/api/pvc/prints/${vb.dataset.void}/void`, { reason }); toast('Print entry voided'); App.refresh(); } catch (er) { fail(er); } } }
    };
  },
  async tab_moves(el) {
    const f = this.mf || { from: monthStart(App.today), to: App.today, type: '', media: '' };
    el.innerHTML = `<div class="panel"><div class="row mb"><input type="date" class="inp" id="mf" value="${f.from}" style="width:150px"><input type="date" class="inp" id="mt" value="${f.to}" style="width:150px">
      <select class="inp" id="mty" style="width:160px"><option value="">All types</option>${['opening', 'stock_in', 'print', 'wastage', 'adj_in', 'adj_out', 'challan_out'].map(k => opt(k, TYPE_LABEL[k], f.type)).join('')}</select>
      <select class="inp" id="mm" style="width:220px"><option value="">All media</option>${mediaOptions(f.media, true)}</select><button class="btn sm" id="mgo">Apply</button><button class="btn sm ghost right" id="mx">${ICON.excel} Excel</button></div><div id="mtbl"></div></div>`;
    const rows = await GET('/api/pvc/movements', f);
    rows.forEach(r => { if (r.voided) r._cls = 'void'; });
    dataTable($('#mtbl', el), rows, [
      { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'category', label: 'Media', f: r => `${esc(r.category)} ${+r.width_ft} ft` },
      { k: 'type', label: 'Type', f: r => `<span class="tag ${r.length_ft > 0 ? 'green' : r.type === 'wastage' ? 'red' : 'teal'}">${TYPE_LABEL[r.type]}${r.is_reversal ? ' · reversal' : ''}</span>` },
      { k: 'length_ft', label: 'Length ft', n: 1, f: r => `<b style="color:${r.length_ft > 0 ? 'var(--ok)' : 'var(--danger)'}">${r.length_ft > 0 ? '+' : ''}${n0(r.length_ft)}</b>` },
      { k: 'area_sqft', label: 'Area sq ft', n: 1, f: r => r.area_sqft == null ? '' : n0(r.area_sqft) },
      { k: 'rolls', label: 'Rolls', f: r => r.roll_qty ? `${+r.roll_qty} × ${n0(r.roll_length)} ft` : '' },
      { k: 'ref_no', label: 'Ref / party', f: r => esc([r.ref_no, r.party, r.supplier].filter(Boolean).join(' · ')) },
      { k: 'reason', label: 'Reason / remarks', f: r => esc([r.reason, r.remarks].filter(Boolean).join(' — ')) },
      { k: 'created_by_name', label: 'By', f: r => `${esc(r.created_by_name)}<div class="sub">${fdt(r.created_at)}</div>` },
      { k: 'x', label: '', sort: false, f: r => can('stock.adjust') && !r.voided && !r.is_reversal && !r.ref_type ? `<button class="btn xs ghost" data-void="${r.id}">Void</button>` : '' },
    ], { id: 'pvc-mv' });
    $('#mgo', el).onclick = () => { this.mf = { from: $('#mf', el).value, to: $('#mt', el).value, type: $('#mty', el).value, media: $('#mm', el).value }; App.refresh(); };
    $('#mx', el).onclick = () => exportXlsx('PVC Stock Movements', [`${fdate(f.from)} to ${fdate(f.to)}`], [tableToSheet('Movements', $('#pvc-mv', el))]);
    el.onclick = async e => { const b = e.target.closest('[data-void]'); if (!b) return; const reason = await confirmBox('Void this movement?', 'A reversal entry will be recorded.', { ok: 'Void', danger: true, input: 'Reason' }); if (reason) { try { await POST(`/api/pvc/movements/${b.dataset.void}/void`, { reason }); toast('Voided'); App.refresh(); } catch (er) { fail(er); } } };
  },
  async tab_media(el) {
    await App.loadMeta();
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Media master</h2><div class="sub">Each media + width keeps its own stock balance</div></div>${can('pvc.media') ? `<button class="btn teal" id="addm">${ICON.plus} Add media / width</button>` : ''}</div><div id="mtbl"></div></div>`;
    dataTable($('#mtbl', el), App.meta.media, [
      { k: 'category', label: 'Media' }, { k: 'width_ft', label: 'Width', f: r => `${+r.width_ft} ft` }, { k: 'roll_length_ft', label: 'Roll length', n: 1, f: r => n0(r.roll_length_ft) + ' ft' },
      { k: 'low_stock_ft', label: 'Low-stock alert', n: 1, f: r => n0(r.low_stock_ft) + ' ft' }, { k: 'default_rate', label: 'Default rate / sq ft', n: 1, f: r => tk(r.default_rate) },
      { k: 'active', label: 'Status', f: r => r.active ? '<span class="tag green">Active</span>' : '<span class="tag gray">Inactive</span>' },
      { k: 'x', label: '', sort: false, f: r => can('pvc.media') ? `<button class="btn xs ghost" data-ed="${r.id}">Edit</button>` : '' },
    ]);
    if ($('#addm', el)) $('#addm', el).onclick = () => mediaModal(null, () => App.refresh());
    el.onclick = e => { const b = e.target.closest('[data-ed]'); if (b) mediaModal(App.meta.media.find(m => m.id === +b.dataset.ed), () => App.refresh()); };
  },
};

/* ---------------- PVC Print Entry ---------------- */
App.pages['pvc-print'] = {
  title: 'PVC Print Entry',
  async render(v) {
    const stock = await GET('/api/pvc/stock');
    const nestDefault = App.meta.settings.pvc?.allow_nesting !== false;
    v.innerHTML = `<div class="panel"><div class="head"><div><h2>Print entry</h2><div class="sub">Customer billing in sq ft · physical stock deducted in linear ft by roll width</div></div><span class="tag teal">Dual measurement</span></div>
      <div class="form f4" id="pf">
        ${field('Date', dateInput())}
        <div class="field span2">Customer <span class="hint">(or job name below)</span><div id="pc"></div></div>
        ${field('Job name / description', `<input name="job_name" placeholder="e.g. Election banner">`)}
        ${field('Media / roll width <span class="req">*</span>', `<select name="media_id">${mediaOptions()}</select>`, 'span2')}
        ${field('Artwork width (ft) <span class="req">*</span>', `<input type="number" step="any" min="0.01" name="art_w" value="4">`)}
        ${field('Artwork length (ft) <span class="req">*</span>', `<input type="number" step="any" min="0.01" name="art_l" value="10">`)}
        ${field('Quantity <span class="req">*</span>', `<input type="number" min="1" step="1" name="qty" value="1">`)}
        <div class="field">Orientation<div class="seg" id="ori"><button type="button" class="on" data-o="Normal">Normal</button><button type="button" data-o="Rotate">Rotate ⟲</button></div></div>
        ${field('Wastage (linear ft)', `<input type="number" step="any" min="0" name="wastage_length" value="0">`)}
        ${field('Wastage reason', `<select name="wastage_reason"><option value="">—</option>${App.meta.wastage_reasons.map(r => opt(r, r)).join('')}</select>`)}
        <label class="check" style="align-self:end"><input type="checkbox" name="nest" ${nestDefault ? 'checked' : ''}> Place multiple pieces across the roll</label>
        ${field('Remarks', `<input name="remarks">`, 'span3')}
      </div>
      <div class="kpis"><div class="kpi"><small>Billable area</small><b id="k1">—</b></div><div class="kpi"><small>Used length (stock out)</small><b id="k2">—</b></div><div class="kpi" id="kf"><small>Fit status</small><b id="k3">—</b></div><div class="kpi" id="ks"><small>Stock after</small><b id="k4">—</b></div></div>
      <div class="viz" id="viz"></div><div id="calcnote" class="note"></div>
      <div id="ovr" class="hide mt">${field('Override reason (authorized) <span class="req">*</span>', `<input name="override_reason" placeholder="Why print even though it does not fit?">`)}</div>
      <div class="actions"><button class="btn ghost" id="reset">Reset</button><button class="btn teal" id="save">Save print entry</button><button class="btn" id="savebill" ${can('pvc.invoice') ? '' : 'style="display:none"'}>Save & create invoice</button></div></div>
      <div class="panel"><div class="head"><div><h2>Today's print entries</h2></div><a href="#/pvc/prints" class="small">All print entries →</a></div><div id="today"></div></div>`;
    let orientation = 'Normal', cust = null; const key = { k: uid() };
    const picker = custPicker($('#pc', v), { onPick: c => (cust = c) });
    const upd = () => {
      const b = formData($('#pf', v)); const md = App.meta.media.find(m => m.id === +b.media_id);
      if (!md) return;
      const c = pvcCalc({ roll_width: md.width_ft, art_w: b.art_w, art_l: b.art_l, qty: b.qty, orientation, nest: b.nest });
      const st = stock.find(s => s.id === md.id); const bal = st ? st.balance : 0; const after = r2(bal - c.used_length - (+b.wastage_length || 0));
      $('#k1', v).textContent = n0(c.printed_sqft) + ' sq ft';
      $('#k2', v).textContent = n0(c.used_length) + ' ft';
      $('#k3', v).textContent = c.fits ? (c.across > 1 ? `OK · ${c.across} across` : 'OK') : 'Does not fit';
      $('#kf', v).className = 'kpi ' + (c.fits ? 'ok' : 'bad');
      $('#k4', v).textContent = n0(after) + ' ft'; $('#ks', v).className = 'kpi ' + (after < 0 ? 'bad' : after <= md.low_stock_ft ? '' : 'ok');
      $('#viz', v).innerHTML = rollSVG({ W: +md.width_ft, calc: c, qty: +b.qty, wastage: +b.wastage_length || 0 });
      const across = orientation === 'Rotate' ? 'length' : 'width';
      $('#calcnote', v).className = 'note ' + (!c.fits ? 'danger' : after < 0 ? 'warn' : '');
      $('#calcnote', v).innerHTML = !c.fits ? `Artwork ${across} (${c.acrossDim} ft) is wider than the ${+md.width_ft} ft roll.${c.alt_fits ? ' <b>Try Rotate.</b>' : ' Choose a wider roll.'}${can('fit.override') ? ' An authorized override with reason is possible.' : ''}`
        : `${+b.art_w} × ${+b.art_l} × ${b.qty} = <b>${n0(c.printed_sqft)} sq ft billed</b>; ${c.across > 1 ? `${c.across} pieces across · ${Math.ceil(b.qty / c.across)} rows × ${c.alongDim} ft` : `${c.alongDim} × ${b.qty}`} = <b>${n0(c.used_length)} linear ft</b> deducted from ${esc(mediaName(md))} (roll area used ${n0(c.consumed_sqft)} sq ft, ${c.fill}% filled). Available: ${n0(bal)} ft.${after < 0 ? ' <b>Not enough stock!</b>' : ''}`;
      $('#ovr', v).classList.toggle('hide', c.fits || !can('fit.override'));
    };
    $$('#ori button', v).forEach(b => b.onclick = () => { orientation = b.dataset.o; $$('#ori button', v).forEach(x => x.classList.toggle('on', x === b)); upd(); });
    $$('input,select', $('#pf', v)).forEach(e => e.addEventListener('input', upd)); upd();
    $('#reset', v).onclick = () => App.refresh();
    const save = async bill => {
      if (!requireFields(v, ['media_id', 'art_w', 'art_l', 'qty'])) return;
      const b = { ...formData($('#pf', v)), orientation, customer_id: cust?.id, override_reason: $('[name=override_reason]', v).value };
      if (!cust && !b.job_name.trim()) { toast('Select a customer or enter a job name', '', 'warn'); return; }
      if (+b.wastage_length > 0 && !b.wastage_reason) { toast('Select a wastage reason', '', 'warn'); return; }
      if (bill && !cust) { toast('Select a customer to create an invoice', '', 'warn'); return; }
      const r = await POST('/api/pvc/print', b, { idemKey: key.k });
      toast('Print entry saved', `PE-${r.id} · ${n0(r.printed_sqft)} sq ft · stock ${n0(r.balance)} ft left`);
      if (bill) { App.pages['pvc-invoices'].prefill = { customer: cust, prints: [{ ...r, category: '', width_ft: r.roll_width }] }; App.go('pvc-invoices/new'); }
      else App.refresh();
    };
    $('#save', v).onclick = () => busy($('#save', v), () => save(false));
    $('#savebill', v).onclick = () => busy($('#savebill', v), () => save(true));
    const rows = await GET('/api/pvc/prints', { from: App.today, to: App.today });
    dataTable($('#today', v), rows, [
      { k: 'id', label: 'Ref', f: r => 'PE-' + r.id }, { k: 'customer', label: 'Customer / job', f: r => esc(r.customer || r.job_name) }, { k: 'media', label: 'Media', f: r => `${esc(r.category)} ${+r.width_ft} ft` },
      { k: 'sz', label: 'Size', f: r => `${+r.art_w}×${+r.art_l}×${r.qty} · ${r.orientation}` }, { k: 'printed_sqft', label: 'Sq ft', n: 1, f: r => n0(r.printed_sqft), total: 1 },
      { k: 'used_length', label: 'Used ft', n: 1, f: r => n0(r.used_length), total: 1 }, { k: 'wastage_length', label: 'Waste ft', n: 1, f: r => n0(r.wastage_length), total: 1 },
      { k: 'inv', label: 'Status', f: r => r.voided ? '<span class="tag red">Voided</span>' : r.inv_no ? `<span class="tag green">${esc(r.inv_no)}</span>` : '<span class="tag orange">Unbilled</span>' },
    ], { search: false, totals: true, empty: 'No print entries today' });
  },
};

/* ---------------- Ink ---------------- */
App.pages.ink = {
  title: 'Ink Stock — CMYK',
  async render(v) {
    const d = await GET('/api/ink');
    const col = { Cyan: '#00aeef', Magenta: '#ec008c', Yellow: '#f5d800', Black: '#231f20' };
    v.innerHTML = `<div class="grid g23 mb"><div class="panel"><div class="head"><div><h2>Add ink</h2><div class="sub">One bottle = one litre · no consumption tracking</div></div></div>
      <div class="form f2" id="if">${field('Date', dateInput())}${field('Ink colour', `<select name="color">${App.meta.ink_colors.map(c => opt(c, c)).join('')}</select>`)}
      ${field('Pieces (bottles) <span class="req">*</span>', `<input type="number" step="1" name="pcs" value="1">`, '', 'use negative to correct')}${field('Litres', `<input id="lt" readonly value="1 L">`)}
      ${field('Remarks', `<input name="remarks">`, 'span2')}</div><div class="actions"><button class="btn" id="is">Save ink entry</button></div></div>
      <div class="panel"><div class="head"><h2>Balance</h2></div><div class="inks" style="grid-template-columns:1fr 1fr">${d.balance.map(i => `<div class="inkd"><div class="drop"><svg viewBox="0 0 40 50"><path d="M20 2C20 2 4 20 4 32a16 16 0 0 0 32 0C36 20 20 2 20 2z" fill="${col[i.color]}"/><ellipse cx="14" cy="30" rx="3" ry="6" fill="#fff5"/></svg></div><b data-count-to="${i.pcs}">0</b><small>${i.color} · ${n0(i.liters)} L</small></div>`).join('')}</div></div></div>
      <div class="panel"><div class="head"><h2>Ink entries</h2></div><div id="itbl"></div></div>`;
    $('[name=pcs]', v).oninput = e => ($('#lt', v).value = (+e.target.value || 0) + ' L');
    const key = uid();
    $('#is', v).onclick = () => busy($('#is', v), async () => { if (!requireFields(v, ['pcs'])) return; await POST('/api/ink', formData($('#if', v)), { idemKey: key }); toast('Ink stock saved'); App.refresh(); });
    dataTable($('#itbl', v), d.rows, [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'color', label: 'Colour', f: r => `<span class="dot" style="color:${col[r.color]}"></span> ${r.color}` }, { k: 'pcs', label: 'Pcs', n: 1 }, { k: 'liters', label: 'Litres', n: 1, f: r => n0(r.liters) }, { k: 'remarks', label: 'Remarks' }, { k: 'created_by_name', label: 'By' }]);
  },
};
