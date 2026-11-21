/* Reports Centre: daily / monthly / annual business summary, registers, employee reports */
'use strict';
App.pages.reports = {
  title: 'Detailed Sales & Audit Reports',
  st: null,
  state() {
    if (!this.st) { const [f, t] = periodRange('month'); this.st = { period: 'month', from: f, to: t, division: 'all', customer: null, product: '', media: '', width: '', view: (can('press.view', 'press.orders') ? 'press' : 'summary'), register: 'sales', user: '' }; }
    return this.st;
  },
  async render(v) {
    const s = this.state();
    const cats = [...new Set(App.meta.media.map(m => m.category))];
    v.innerHTML = `<div class="panel"><div class="head"><div><h2>Report filters</h2><div class="sub">Only confirmed transactions count as sales · drafts and cancelled invoices are excluded · plates and sq ft are never added together</div></div><span class="tag">Audit ready</span></div>
      <div class="row mb">${periodChips(s.period)}<span class="muted small">or</span>
        <input type="month" class="inp" id="rm" style="width:160px" title="Pick a month"><select class="inp" id="ry" style="width:110px"><option value="">Year…</option>${Array.from({ length: 6 }, (_, i) => +App.today.slice(0, 4) - i).map(y => opt(y, y)).join('')}</select></div>
      <div class="form f4" id="rf">
        ${field('From', `<input type="date" name="from" value="${s.from}">`)}${field('To', `<input type="date" name="to" value="${s.to}">`)}
        ${field('Division', `<select name="division">${[['all', 'All divisions'], ['ctp', 'CTP'], ['pvc', 'PVC'], ['own', 'Own Use']].map(([k, l]) => opt(k, l, s.division)).join('')}</select>`)}
        <div class="field">Customer<div id="rc"></div></div>
        ${field('CTP plate size', `<select name="product"><option value="">All plates</option>${productOptions(s.product)}</select>`)}
        ${field('PVC media', `<select name="media"><option value="">All media</option>${cats.map(c => opt(c, c, s.media)).join('')}</select>`)}
        ${field('Roll width', `<select name="width"><option value="">All widths</option>${[3, 4, 5, 6, 8, 10].map(w => opt(w, w + ' ft', s.width)).join('')}</select>`)}
        <div class="field" style="align-self:end"><button class="btn" id="rgo">${ICON.chart} Run report</button></div></div></div>
      <div class="tabs">${[...(can('press.view', 'press.orders', 'reports') ? [['press', 'Printing Press']] : []), ['summary', 'PVC & CTP Summary'], ['registers', 'Registers & Audit'], ...(can('reports.employee') ? [['employee', 'Employee Reports']] : [])].map(([k, l]) => `<button data-t="${k}" class="${k === s.view ? 'on' : ''}">${l}</button>`).join('')}
        <span class="right row" style="padding:4px"><button class="btn sm ghost" id="rx">${ICON.excel} Export Excel</button><button class="btn sm ghost" id="rcsv">CSV</button><button class="btn sm ghost" id="rpdf">${ICON.doc} PDF</button><button class="btn sm" id="rpr">${ICON.print} Print</button></span></div>
      <div id="rpt" class="tabpane"></div>`;
    const cp = custPicker($('#rc', v), { value: s.customer, allowAdd: false, placeholder: 'All customers', onPick: c => (s.customer = c) });
    const read = () => { const f = formData($('#rf', v)); Object.assign(s, { from: f.from, to: f.to, division: f.division, product: f.product, media: f.media, width: f.width }); };
    $$('[data-period]', v).forEach(b => b.onclick = () => {
      const p = b.dataset.period; s.period = p; $$('[data-period]', v).forEach(x => x.classList.toggle('on', x === b));
      if (p !== 'custom') { [s.from, s.to] = periodRange(p); $('[name=from]', v).value = s.from; $('[name=to]', v).value = s.to; this.run(); }
    });
    $('#rm', v).onchange = e => { if (!e.target.value) return; s.period = 'custom'; s.from = e.target.value + '-01'; s.to = monthEnd(s.from); App.refresh(); };
    $('#ry', v).onchange = e => { if (!e.target.value) return; s.period = 'custom'; s.from = e.target.value + '-01-01'; s.to = e.target.value + '-12-31'; App.refresh(); };
    $('[name=from]', v).onchange = $('[name=to]', v).onchange = () => { s.period = 'custom'; $$('[data-period]', v).forEach(x => x.classList.toggle('on', x.dataset.period === 'custom')); };
    $('#rgo', v).onclick = () => { read(); this.run(); };
    $$('[data-t]', v).forEach(b => b.onclick = () => { read(); s.view = b.dataset.t; $$('[data-t]', v).forEach(x => x.classList.toggle('on', x === b)); this.run(); });
    $('#rx', v).onclick = () => this.exportExcel();
    if ($('#rcsv', v)) $('#rcsv', v).onclick = () => this.exportCsv();
    $('#rpr', v).onclick = () => this.print();
    $('#rpdf', v).onclick = () => { toast('Choose “Save as PDF” in the print dialog', '', 'info'); this.print(); };
    this.v = v; await this.run();
  },
  meta() {
    const s = this.st, c = App.meta.settings.company || {};
    return [`${c.name} · ${c.address}`, `Period: ${fdate(s.from)} to ${fdate(s.to)}`, `Division: ${({ all: 'All', ctp: 'CTP', pvc: 'PVC', own: 'Own Use' })[s.division]}${s.customer ? ' · Customer: ' + s.customer.name : ''}${s.product ? ' · Plate: ' + App.meta.products.find(p => p.id === +s.product)?.name : ''}${s.media ? ' · Media: ' + s.media : ''}${s.width ? ' · Width: ' + s.width + ' ft' : ''}`,
      `Generated: ${new Date().toLocaleString('en-GB')} by ${App.user.full_name}`];
  },
  exportExcel() {
    const sheets = $$('#rpt table[data-sheet]').map(t => tableToSheet(t.dataset.sheet, t));
    if (!sheets.length) return toast('Nothing to export', '', 'warn');
    exportXlsx(`${App.meta.settings.company?.name || 'Business'} Report ${this.st.from} to ${this.st.to}`, this.meta(), sheets);
  },
  exportCsv() {
    const t = $('#rpt table[data-sheet]'); if (!t) return toast('Nothing to export', '', 'warn');
    const cell = x => `"${String(x.innerText || '').replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`;
    const csv = $$('tr', t).map(r => $$('th,td', r).map(cell).join(',')).join('\r\n');
    saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `${t.dataset.sheet} ${this.st.from} to ${this.st.to}.csv`);
  },
  async press(el) {
    const s = this.st;
    const list = this.pressList = this.pressList || await GET('/api/press/reports');
    s.preport = s.preport || 'orders-date';
    const groups = [['Orders', /^order/], ['Production', /^prod/], ['Delivery', /challan|delivery/], ['Stock', /stock|purchases|issues|returns|adjust|movement|wastage/], ['Accounts', /invoice|void|payment|refund|income|expense/], ['Job costing', /cost|profit/]];
    const r = await GET('/api/press/reports/' + s.preport, { from: s.from, to: s.to, customer: s.customer?.id || '' });
    const cols = r.rows.length ? Object.keys(r.rows[0]) : [];
    const isNum = k => r.rows.some(x => typeof x[k] === 'number') && !/(^|_)(no|id)$/.test(k);
    const isDate = k => /date|^completed$|^started$|^due$|^deadline$|planned_start|void_date/.test(k);
    const fmt = (k, v) => v == null ? '' : k === 'status' && typeof OSTAT !== 'undefined' && OSTAT[v] ? OSTAT[v][0] : isDate(k) && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fdate(v) : /entered|voided_at/.test(k) ? fdt(v) : isNum(k) ? (Object.values(r.totals || {}).includes(k) || /amount|total|cost|value|price|paid|due|income|expense|net|profit|refund|selling|rate|paper|plate|printing|design|lamination|finishing|labour|outsourcing|other/.test(k) ? nf2.format(v) : qn(v)) : esc(v);
    const head = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    el.innerHTML = `<div class="grid" style="grid-template-columns:260px 1fr;align-items:start"><div class="panel" style="padding:10px">${groups.map(([g, re]) => `<div class="sub" style="font-weight:800;margin:10px 6px 4px">${g}</div>${list.filter(x => re.test(x.key)).map(x => `<button class="btn sm ${x.key === s.preport ? '' : 'ghost'}" data-pr="${x.key}" style="display:block;width:100%;text-align:left;margin-bottom:3px">${esc(x.title)}</button>`).join('')}`).join('')}</div>
      <div class="panel"><div class="head"><div><h2>${esc(r.title)}</h2><div class="sub">${fdate(s.from)} → ${fdate(s.to)}${s.customer ? ' · ' + esc(s.customer.name) : ''} · ${r.rows.length} rows</div></div></div>
        <div class="tbl-wrap"><table data-sheet="${esc(r.title.slice(0, 30))}"><thead><tr>${cols.map(k => `<th class="${isNum(k) ? 'n' : ''}">${head(k)}</th>`).join('')}</tr></thead><tbody>
        ${r.rows.map(x => `<tr>${cols.map(k => `<td class="${isNum(k) ? 'n' : ''}" style="${isDate(k) || /_no$|^code$/.test(k) ? 'white-space:nowrap' : ''}">${fmt(k, x[k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length || 1}" class="empty">No data for this period</td></tr>`}</tbody>
        ${Object.keys(r.totals || {}).length && r.rows.length ? `<tfoot><tr>${cols.map((k, i) => `<th class="${isNum(k) ? 'n' : ''}">${Object.values(r.totals).includes(k) ? nf2.format(r.rows.reduce((a, x) => a + (+x[k] || 0), 0)) : i === 0 ? 'Total' : ''}</th>`).join('')}</tr></tfoot>` : ''}</table></div></div></div>`;
    $$('[data-pr]', el).forEach(b => b.onclick = () => { s.preport = b.dataset.pr; this.run(); });
  },
  print() {
    const c = App.meta.settings.company || {};
    const clone = $('#rpt').cloneNode(true);
    $$('.chart,.no-print,button', clone).forEach(e => e.remove());
    printHTML(`<div class="doc rpt-print" style="max-width:none">${companyHeader(`<div style="text-align:right"><div class="doc-title">BUSINESS REPORT</div><div class="mt"><b>${fdate(this.st.from)} – ${fdate(this.st.to)}</b></div><div class="muted small">Generated ${new Date().toLocaleString('en-GB')}<br>by ${esc(App.user.full_name)}</div></div>`)}<div class="muted small mb">${esc(this.meta()[2])}</div>${clone.innerHTML}</div>`);
  },
  async run() {
    const s = this.st, el = $('#rpt'); if (!el) return;
    el.innerHTML = `<div class="grid g3">${'<div class="sk sk-card"></div>'.repeat(3)}</div><div class="sk" style="height:300px;margin-top:16px"></div>`;
    el.classList.remove('tabpane'); void el.offsetWidth; el.classList.add('tabpane');
    try {
      if (s.view === 'press') await this.press(el);
      else if (s.view === 'summary') await this.summary(el);
      else if (s.view === 'registers') await this.registers(el);
      else await this.employee(el);
      animateIn(el); bindTips(el);
    } catch (e) { fail(e); el.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; }
  },
  params() { const s = this.st; return { from: s.from, to: s.to, customer: s.customer?.id || '', product: s.product, media: s.media, width: s.width }; },

  async summary(el) {
    const s = this.st, P = this.params();
    const days = (new Date(s.to) - new Date(s.from)) / 864e5 + 1;
    const group = days > 62 ? 'month' : 'day';
    const [r, trend] = await Promise.all([GET('/api/reports/business', P), GET('/api/reports/trend', { from: s.from, to: s.to, group })]);
    const F = r.financial, show = d => s.division === 'all' || s.division === d;
    const kind = days <= 1 ? 'Daily' : group === 'day' ? 'Monthly' : 'Annual';
    const sizeCols = App.meta.products.map(p => p.name);
    let h = `<div class="ribbon"><b>${kind} Business Summary</b><span class="muted">${fdate(s.from)}${s.from !== s.to ? ' – ' + fdate(s.to) : ''}</span><span class="right muted small">Generated ${new Date().toLocaleTimeString()} by ${esc(App.user.full_name)}</span></div>
      <div class="stats stagger" style="grid-template-columns:repeat(${s.division === 'all' ? 6 : 4},1fr)">
        ${show('ctp') ? `<div class="stat"><small>CTP plates sold</small><b data-count-to="${r.ctp.total_qty}">0</b><div class="foot">${tk(F.ctp_net)} net</div></div>` : ''}
        ${show('pvc') ? `<div class="stat" style="--c:var(--pvc)"><small>PVC area sold</small><b>${n0(r.pvc.total_sqft)}</b><div class="foot">sq ft · ${tk(F.pvc_net)} net</div></div>` : ''}
        ${s.division !== 'own' ? `<div class="stat" style="--c:#172b43"><small>External sales</small><b data-count-to="${s.division === 'ctp' ? F.ctp_net : s.division === 'pvc' ? F.pvc_net : F.combined_net}" data-fmt="tk">0</b><div class="foot">${F.ctp_n + F.pvc_n} invoices · discount ${tk(F.combined_discount)}</div></div>
        <div class="stat" style="--c:var(--ok)"><small>Collection</small><b data-count-to="${s.division === 'ctp' ? F.collection.ctp : s.division === 'pvc' ? F.collection.pvc : F.collection.total}" data-fmt="tk">0</b><div class="foot">in period</div></div>
        <div class="stat" style="--c:var(--danger)"><small>Due on period invoices</small><b data-count-to="${s.division === 'ctp' ? F.due_period.ctp : s.division === 'pvc' ? F.due_period.pvc : F.due_period.combined}" data-fmt="tk">0</b><div class="foot">still unpaid</div></div>` : ''}
        ${show('own') || s.division === 'ctp' ? `<div class="stat" style="--c:var(--own)"><small>SKS own use</small><b data-count-to="${r.own_use.total}">0</b><div class="foot">plates · not sales</div></div>` : ''}
      </div>`;
    h += `<div class="panel no-print"><div class="head"><div><h2>${group === 'day' ? 'Daily' : 'Monthly'} trend</h2><div class="sub">Click a bar to open that ${group}</div></div><div class="legend"><span><i style="background:var(--ctp)"></i>CTP</span><span><i style="background:var(--pvc)"></i>PVC</span><span><i style="background:#e08a2e;height:3px"></i>Collection</span></div></div><div id="tchart"></div></div>`;
    if (show('ctp')) {
      h += `<div class="grid g2 mb"><div class="panel"><div class="head"><div><h2>CTP ${kind} Sales — Plate-size breakdown</h2><div class="sub">Click a size to drill down to invoices</div></div><span class="tag">Pcs</span></div>
        <div class="tbl-wrap"><table data-sheet="CTP Size-wise"><thead><tr><th>Plate size</th><th class="n">Quantity sold</th><th class="n">Sales amount</th></tr></thead><tbody>
        ${r.ctp.size.map(p => `<tr><td><span class="drill" data-drill="${p.id}">${esc(p.name)}</span></td><td class="n">${p.qty} pcs</td><td class="n">${tk(p.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td>TOTAL</td><td class="n">${r.ctp.total_qty} pcs</td><td class="n">${tk(r.ctp.total_amount)}</td></tr></tfoot></table></div>
        ${F.ctp_discount ? `<div class="sub mt">Gross ${tk(F.ctp_gross)} − discount ${tk(F.ctp_discount)} = net ${tk(F.ctp_net)}</div>` : ''}</div>
        <div class="panel"><div class="head"><h2>CTP production & stock in</h2><span class="tag green">Stock +</span></div><div class="tbl-wrap"><table data-sheet="CTP Production"><thead><tr><th>Plate</th><th class="n">Production</th><th class="n">Stock in / opening</th><th class="n">Adj +</th><th class="n">Adj −</th></tr></thead><tbody>
        ${r.ctp.production.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${p.production}</td><td class="n">${p.stock_in}</td><td class="n">${p.adj_in}</td><td class="n">${p.adj_out}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td>TOTAL</td>${['production', 'stock_in', 'adj_in', 'adj_out'].map(k => `<td class="n">${r.ctp.production.reduce((a, p) => a + p[k], 0)}</td>`).join('')}</tr></tfoot></table></div></div></div>
        <div class="panel"><div class="head"><div><h2>Customer-wise CTP sales</h2><div class="sub">Quantity by plate size per customer</div></div></div><div class="tbl-wrap"><table data-sheet="CTP Customer-wise"><thead><tr><th>Customer</th>${sizeCols.map(c => `<th class="n">${esc(c.replace(' Plate', ''))}</th>`).join('')}<th class="n">Total pcs</th><th class="n">Amount</th></tr></thead><tbody>
        ${r.ctp.customers.map(c => `<tr><td>${esc(c.name)}</td>${sizeCols.map(sz => `<td class="n">${c.sizes[sz] || ''}</td>`).join('')}<td class="n"><b>${c.qty}</b></td><td class="n">${tk(c.gross)}</td></tr>`).join('') || `<tr><td colspan="${sizeCols.length + 3}"><div class="empty">No CTP sales</div></td></tr>`}</tbody>
        ${r.ctp.customers.length ? `<tfoot><tr class="total"><td>TOTAL</td>${sizeCols.map(sz => `<td class="n">${r.ctp.customers.reduce((a, c) => a + (c.sizes[sz] || 0), 0)}</td>`).join('')}<td class="n">${r.ctp.total_qty}</td><td class="n">${tk(r.ctp.total_amount)}</td></tr></tfoot>` : ''}</table></div></div>
        <div class="panel"><div class="head"><h2>Customer-wise CTP invoice details</h2></div><div class="tbl-wrap" style="max-height:420px"><table data-sheet="CTP Invoice Details"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Plate size</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th><th>Created by</th></tr></thead><tbody>
        ${r.ctp.lines.map(l => `<tr><td>${fdate(l.date)}</td><td><a href="#/ctp-invoices/${l.invoice_id}">${esc(l.inv_no)}</a></td><td>${esc(l.customer)}</td><td>${esc(l.product)}</td><td class="n">${l.qty}</td><td class="n">${tk(l.rate)}</td><td class="n">${tk(l.line_total)}</td><td class="sub">${esc(l.created_by_name)}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">No CTP invoice lines</div></td></tr>'}</tbody></table></div></div>`;
    }
    if (show('own') || show('ctp')) {
      h += `<div class="panel" style="border-color:#8b5cf655"><div class="head"><div><h2>${esc(App.meta.settings.company?.name || 'Business')} – Own Use</h2><div class="sub">Internal CTP plate consumption · reduces stock · excluded from sales, revenue and dues</div></div><span class="tag purple">${r.own_use.total} pcs</span></div>
        <div class="grid" style="grid-template-columns:280px 1fr"><div class="tbl-wrap"><table data-sheet="Own Use by Size"><thead><tr><th>Plate size</th><th class="n">Own use</th></tr></thead><tbody>${r.own_use.size.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${p.qty} pcs</td></tr>`).join('')}</tbody><tfoot><tr class="total"><td>TOTAL</td><td class="n">${r.own_use.total} pcs</td></tr></tfoot></table></div>
        <div class="tbl-wrap" style="max-height:360px"><table data-sheet="Own Use Register"><thead><tr><th>Date</th><th>Plate size</th><th class="n">Qty</th><th>Remarks / purpose</th><th>Job / dept</th><th>Entered by</th></tr></thead><tbody>
        ${r.own_use.rows.map(o => `<tr class="${o.voided ? 'void' : ''}"><td>${fdate(o.date)}</td><td>${esc(o.product)}</td><td class="n">${o.qty}</td><td><b>${esc(o.purpose)}</b>${o.voided ? ` <span class="tag red">voided</span>` : ''}</td><td>${esc(o.job_ref || '')}</td><td class="sub">${esc(o.created_by_name)} (${esc(o.created_role || '')})</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No own-use entries</div></td></tr>'}</tbody></table></div></div></div>`;
    }
    if (show('pvc')) {
      const P2 = r.pvc;
      h += `<div class="grid g2 mb"><div class="panel"><div class="head"><div><h2>PVC ${kind} Sales — Customer-wise</h2><div class="sub">All confirmed PVC invoice items</div></div><span class="tag teal">Sq ft</span></div>
        <div class="tbl-wrap"><table data-sheet="PVC Customer-wise"><thead><tr><th>Customer</th><th class="n">Invoices</th><th class="n">Area (sq ft)</th><th class="n">Sales</th></tr></thead><tbody>
        ${P2.customers.map(c => `<tr><td>${esc(c.name)}</td><td class="n">${c.invoices}</td><td class="n">${n0(c.sqft)}</td><td class="n">${tk(c.gross)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">No PVC sales</div></td></tr>'}</tbody>
        ${P2.customers.length ? `<tfoot><tr class="total"><td>TOTAL</td><td class="n">${P2.customers.reduce((a, c) => a + c.invoices, 0)}</td><td class="n">${n0(P2.total_sqft)}</td><td class="n">${tk(P2.customers.reduce((a, c) => a + c.gross, 0))}</td></tr></tfoot>` : ''}</table></div></div>
        <div class="panel"><div class="head"><h2>Media-wise area</h2><span class="tag teal">By media & roll width</span></div><div class="tbl-wrap"><table data-sheet="PVC Media-wise"><thead><tr><th>Media</th><th>Width</th><th class="n">Pieces</th><th class="n">Sq ft</th><th class="n">Sales</th></tr></thead><tbody>
        ${P2.media.map(m => `<tr><td>${esc(m.category)}</td><td>${m.width_ft ? +m.width_ft + ' ft' : '—'}</td><td class="n">${m.pieces}</td><td class="n">${n0(m.sqft)}</td><td class="n">${tk(m.gross)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No PVC sales</div></td></tr>'}</tbody>
        ${P2.media.length ? `<tfoot><tr class="total"><td>TOTAL</td><td></td><td class="n">${P2.media.reduce((a, m) => a + m.pieces, 0)}</td><td class="n">${n0(P2.total_sqft)}</td><td class="n">${tk(P2.total_amount)}</td></tr></tfoot>` : ''}</table></div>
        ${F.pvc_discount ? `<div class="sub mt">Gross ${tk(F.pvc_gross)} − discount ${tk(F.pvc_discount)} = net ${tk(F.pvc_net)}</div>` : ''}</div></div>
        <div class="panel"><div class="head"><div><h2>Printed length & wastage</h2><div class="sub">Physical consumption from roll stock (includes unbilled print entries)</div></div></div><div class="tbl-wrap"><table data-sheet="PVC Usage & Wastage"><thead><tr><th>Media</th><th>Width</th><th class="n">Stock in ft</th><th class="n">Printed ft</th><th class="n">Printed area</th><th class="n">Wastage ft</th><th class="n">Wastage area</th></tr></thead><tbody>
        ${P2.usage.map(u => `<tr><td>${esc(u.category)}</td><td>${+u.width_ft} ft</td><td class="n">${n0(u.stock_in_ft)}</td><td class="n">${n0(u.printed_ft)}</td><td class="n">${n0(u.printed_area)}</td><td class="n">${n0(u.wastage_ft)}</td><td class="n">${n0(u.wastage_area)}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No PVC usage</div></td></tr>'}</tbody>
        ${P2.usage.length ? `<tfoot><tr class="total"><td>TOTAL</td><td></td><td class="n">${n0(P2.usage.reduce((a, u) => a + u.stock_in_ft, 0))}</td><td class="n">${n0(P2.printed_ft)}</td><td class="n">${n0(P2.usage.reduce((a, u) => a + u.printed_area, 0))}</td><td class="n">${n0(P2.wastage_ft)}</td><td class="n">${n0(P2.wastage_area)}</td></tr></tfoot>` : ''}</table></div></div>
        <div class="panel"><div class="head"><h2>PVC customer details</h2></div><div class="tbl-wrap" style="max-height:420px"><table data-sheet="PVC Invoice Details"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Media</th><th>Artwork (W×L)</th><th class="n">Qty</th><th class="n">Billable sq ft</th><th class="n">Rate/sq ft</th><th class="n">Amount</th></tr></thead><tbody>
        ${P2.lines.map(l => `<tr><td>${fdate(l.date)}</td><td><a href="#/pvc-invoices/${l.invoice_id}">${esc(l.inv_no)}</a></td><td>${esc(l.customer)}</td><td>${esc(l.category)}${l.width_ft ? ' ' + +l.width_ft + ' ft' : ''}</td><td>${l.kind === 'piece' ? esc(l.description || 'Piece item') : `${+l.art_w} × ${+l.art_l}`}</td><td class="n">${l.qty}</td><td class="n">${n0(l.sqft)}</td><td class="n">${l.kind === 'piece' ? tk(l.rate) + '/pc' : tk(l.rate)}</td><td class="n">${tk(l.line_total)}</td></tr>`).join('') || '<tr><td colspan="9"><div class="empty">No PVC invoice lines</div></td></tr>'}</tbody></table></div></div>`;
    }
    if (s.division !== 'own') {
      const ctpU = r.ctp.total_qty, pvcU = r.pvc.total_sqft;
      h += `<div class="panel" style="border-color:#172b4355"><div class="head"><div><h2>Combined Audit Summary</h2><div class="sub">Only BDT values are combined — plates and sq ft are never added together</div></div></div>
        <div class="tbl-wrap"><table data-sheet="Combined Audit Summary"><thead><tr><th>Metric</th><th class="n">CTP</th><th class="n">PVC</th><th class="n">Combined</th></tr></thead><tbody>
        <tr><td>Gross sales</td><td class="n">${tk(F.ctp_gross)}</td><td class="n">${tk(F.pvc_gross)}</td><td class="n">${tk(F.ctp_gross + F.pvc_gross)}</td></tr>
        <tr><td>Discount</td><td class="n">${tk(F.ctp_discount)}</td><td class="n">${tk(F.pvc_discount)}</td><td class="n">${tk(F.combined_discount)}</td></tr>
        <tr><td><b>External sales (net)</b></td><td class="n"><b>${tk(F.ctp_net)}</b></td><td class="n"><b>${tk(F.pvc_net)}</b></td><td class="n"><b>${tk(F.combined_net)}</b></td></tr>
        <tr><td>Invoices</td><td class="n">${F.ctp_n}</td><td class="n">${F.pvc_n}</td><td class="n">${F.ctp_n + F.pvc_n}</td></tr>
        <tr><td>Physical quantity</td><td class="n">${ctpU} plates</td><td class="n">${n0(pvcU)} sq ft</td><td class="n muted">Not combined</td></tr>
        <tr><td>Own use</td><td class="n">${r.own_use.total} plates</td><td class="n muted">—</td><td class="n muted">Not sales</td></tr>
        <tr><td>Collection</td><td class="n">${tk(F.collection.ctp)}</td><td class="n">${tk(F.collection.pvc)}</td><td class="n">${tk(F.collection.total)}${F.collection.total - F.collection.ctp - F.collection.pvc > 0.004 ? `<div class="sub">incl. ${tk(F.collection.total - F.collection.ctp - F.collection.pvc)} advance/opening</div>` : ''}</td></tr>
        <tr><td>Outstanding due (period invoices)</td><td class="n">${tk(F.due_period.ctp)}</td><td class="n">${tk(F.due_period.pvc)}</td><td class="n">${tk(F.due_period.combined)}</td></tr>
        <tr><td>Outstanding due (all time, now)</td><td class="n">${tk(F.outstanding_now.ctp_due)}</td><td class="n">${tk(F.outstanding_now.pvc_due)}</td><td class="n">${tk(F.outstanding_now.combined_due)}</td></tr>
        <tr><td>Expenses</td><td class="n">${tk(F.expenses.ctp)}</td><td class="n">${tk(F.expenses.pvc)}</td><td class="n">${tk(F.expenses.total)}${F.expenses.common ? `<div class="sub">incl. common ${tk(F.expenses.common)}</div>` : ''}</td></tr>
        <tr><td>Cancelled invoices (excluded)</td><td class="n">${F.ctp_cancelled}</td><td class="n">${F.pvc_cancelled}</td><td class="n">${F.ctp_cancelled + F.pvc_cancelled}</td></tr>
        </tbody></table></div></div>`;
    }
    h += `<div class="panel"><div class="head"><div><h2>${group === 'day' ? 'Day' : 'Month'}-by-${group} register</h2><div class="sub">Click a row to open that ${group}</div></div></div><div class="tbl-wrap" style="max-height:440px"><table data-sheet="${group === 'day' ? 'Daily' : 'Monthly'} Trend"><thead><tr><th>${group === 'day' ? 'Date' : 'Month'}</th><th class="n">CTP sales</th><th class="n">PVC sales</th><th class="n">CTP qty</th><th class="n">PVC sq ft</th><th class="n">Own use</th><th class="n">Printed ft</th><th class="n">Wastage ft</th><th class="n">Collection</th><th class="n">Expenses</th></tr></thead><tbody>
      ${trend.map(t => `<tr class="click" data-open="${t.period}"><td><b>${group === 'day' ? fdate(t.period) : new Date(t.period + '-01').toLocaleString('en', { month: 'long', year: 'numeric' })}</b></td><td class="n">${tk(t.ctp_sales)}</td><td class="n">${tk(t.pvc_sales)}</td><td class="n">${t.ctp_qty} pcs</td><td class="n">${n0(t.pvc_sqft)}</td><td class="n">${t.own_use}</td><td class="n">${n0(t.printed_ft)}</td><td class="n">${n0(t.wastage_ft)}</td><td class="n">${tk(t.collection)}</td><td class="n">${tk(t.expenses)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="total"><td>TOTAL</td><td class="n">${tk(trend.reduce((a, t) => a + t.ctp_sales, 0))}</td><td class="n">${tk(trend.reduce((a, t) => a + t.pvc_sales, 0))}</td><td class="n">${trend.reduce((a, t) => a + t.ctp_qty, 0)} pcs</td><td class="n">${n0(trend.reduce((a, t) => a + t.pvc_sqft, 0))}</td><td class="n">${trend.reduce((a, t) => a + t.own_use, 0)}</td><td class="n">${n0(trend.reduce((a, t) => a + t.printed_ft, 0))}</td><td class="n">${n0(trend.reduce((a, t) => a + t.wastage_ft, 0))}</td><td class="n">${tk(trend.reduce((a, t) => a + t.collection, 0))}</td><td class="n">${tk(trend.reduce((a, t) => a + t.expenses, 0))}</td></tr></tfoot></table></div></div>`;
    el.innerHTML = h;
    const tc = $('#tchart', el);
    if (tc) barChart(tc, trend.map(t => ({ ...t, label: group === 'day' ? t.period.slice(5) : new Date(t.period + '-01').toLocaleString('en', { month: 'short' }) })), { x: 'label', series: [...(show('ctp') ? [{ key: 'ctp_sales', label: 'CTP', color: 'var(--ctp)' }] : []), ...(show('pvc') ? [{ key: 'pvc_sales', label: 'PVC', color: 'var(--pvc)' }] : [])].concat(s.division === 'own' ? [{ key: 'own_use', label: 'Own use', color: 'var(--own)' }] : []), line: s.division === 'own' ? null : { key: 'collection', label: 'Collection', color: '#e08a2e' }, money: s.division !== 'own', height: 220 });
    $$('rect.b', el).forEach((b, i) => b.style.cursor = 'pointer');
    if (tc) tc.onclick = e => { const b = e.target.closest('rect.b'); if (!b) return; const idx = [...new Set($$('rect.b', tc).map(x => x.getAttribute('x')))].indexOf(b.getAttribute('x')); const t = trend[idx]; if (t) this.openPeriod(t.period, group); };
    $$('[data-open]', el).forEach(tr => tr.onclick = () => this.openPeriod(tr.dataset.open, group));
    $$('[data-drill]', el).forEach(d => d.onclick = () => {
      const pid = +d.dataset.drill, lines = r.ctp.lines.filter(l => l.product_id === pid);
      const m = modal({ title: `${d.textContent} — invoice details`, size: 'wide', body: `<div id="dd"></div>` });
      dataTable($('#dd', m.el), lines, [{ k: 'date', label: 'Date', f: l => fdate(l.date) }, { k: 'inv_no', label: 'Invoice' }, { k: 'customer', label: 'Customer' }, { k: 'qty', label: 'Qty', n: 1, total: 1 }, { k: 'rate', label: 'Rate', n: 1, f: l => tk(l.rate) }, { k: 'line_total', label: 'Amount', n: 1, f: l => tk(l.line_total), money: 1, total: 1 }, { k: 'created_by_name', label: 'By' }], { onRow: l => { m.close(); App.go('ctp-invoices/' + l.invoice_id); }, totals: true });
    });
  },
  openPeriod(p, group) {
    const s = this.st; s.period = 'custom';
    if (group === 'day') { s.from = s.to = p; } else { s.from = p + '-01'; s.to = monthEnd(s.from); }
    App.refresh();
  },

  async registers(el) {
    const s = this.st;
    const REG = { sales: 'Detailed sales register', ctp_stock: 'CTP stock movement', pvc_stock: 'PVC stock movement', prints: 'PVC print register', wastage: 'Wastage register', collection: 'Daily collection', expenses: 'Expenses', adjustments: 'Stock adjustments', ink: 'Ink stock-in' };
    el.innerHTML = `<div class="panel"><div class="head"><div class="chip-row">${Object.entries(REG).map(([k, l]) => `<button class="chip ${k === s.register ? 'on' : ''}" data-reg="${k}">${l}</button>`).join('')}</div></div><div id="regt"></div></div>`;
    $$('[data-reg]', el).forEach(b => b.onclick = () => { s.register = b.dataset.reg; this.registers(el); });
    const rows = await GET('/api/reports/register', { type: s.register, from: s.from, to: s.to });
    const C = {
      sales: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'division', label: 'Div', f: r => divTag(r.division) }, { k: 'inv_no', label: 'Invoice' }, { k: 'status', label: 'Status', f: r => statusTag(r.status) }, { k: 'customer', label: 'Customer' }, { k: 'subtotal', label: 'Gross', n: 1, f: r => tk(r.subtotal) }, { k: 'discount', label: 'Disc', n: 1, f: r => tk(r.discount) }, { k: 'grand_total', label: 'Net', n: 1, f: r => tk(r.grand_total), total: d => tk(d.filter(r => r.status === 'confirmed').reduce((a, r) => a + r.grand_total, 0)) }, { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid) }, { k: 'created_by_name', label: 'Created by' }, { k: 'confirmed_by_name', label: 'Confirmed by' }, { k: 'cancel_reason', label: 'Cancel reason' }],
      ctp_stock: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'product', label: 'Plate' }, { k: 'type', label: 'Type', f: r => TYPE_LABEL[r.type] + (r.is_reversal ? ' (reversal)' : '') }, { k: 'qty', label: 'Qty', n: 1 }, { k: 'ref_no', label: 'Ref' }, { k: 'party', label: 'Party' }, { k: 'purpose', label: 'Purpose / reason' }, { k: 'job_ref', label: 'Job' }, { k: 'remarks', label: 'Remarks' }, { k: 'created_by_name', label: 'By' }],
      pvc_stock: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'media', label: 'Media' }, { k: 'type', label: 'Type', f: r => TYPE_LABEL[r.type] + (r.is_reversal ? ' (reversal)' : '') }, { k: 'length_ft', label: 'Length ft', n: 1, f: r => n0(r.length_ft) }, { k: 'area_sqft', label: 'Area', n: 1, f: r => n0(r.area_sqft) }, { k: 'roll_qty', label: 'Rolls', f: r => r.roll_qty ? `${+r.roll_qty}×${n0(r.roll_length)}` : '' }, { k: 'reason', label: 'Reason' }, { k: 'ref_no', label: 'Ref' }, { k: 'party', label: 'Party / supplier', f: r => esc(r.party || r.supplier || '') }, { k: 'created_by_name', label: 'By' }],
      prints: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'ref', label: 'Ref' }, { k: 'customer', label: 'Customer / job' }, { k: 'media', label: 'Media' }, { k: 'sz', label: 'Artwork', f: r => `${+r.art_w}×${+r.art_l}×${r.qty} ${r.orientation}` }, { k: 'printed_sqft', label: 'Sq ft', n: 1, f: r => n0(r.printed_sqft), total: 1 }, { k: 'used_length', label: 'Used ft', n: 1, f: r => n0(r.used_length), total: 1 }, { k: 'wastage_length', label: 'Waste ft', n: 1, f: r => n0(r.wastage_length), total: 1 }, { k: 'wastage_reason', label: 'Reason' }, { k: 'fit_status', label: 'Fit' }, { k: 'inv_no', label: 'Invoice', f: r => r.voided ? 'VOIDED' : esc(r.inv_no || 'Unbilled') }, { k: 'created_by_name', label: 'By' }],
      wastage: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'media', label: 'Media' }, { k: 'length_ft', label: 'Length ft', n: 1, f: r => n0(r.length_ft), total: 1 }, { k: 'area_sqft', label: 'Area sq ft', n: 1, f: r => n0(r.area_sqft), total: 1 }, { k: 'reason', label: 'Reason' }, { k: 'ref_no', label: 'Ref' }, { k: 'party', label: 'Job' }, { k: 'remarks', label: 'Remarks' }, { k: 'created_by_name', label: 'By' }],
      collection: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'receipt_no', label: 'Receipt' }, { k: 'customer', label: 'Customer' }, { k: 'amount', label: 'Amount', n: 1, f: r => tk(r.amount), total: d => tk(d.filter(r => !r.voided).reduce((a, r) => a + r.amount, 0)) }, { k: 'method', label: 'Method' }, { k: 'reference', label: 'Reference' }, { k: 'division', label: 'Division' }, { k: 'voided', label: 'Void', f: r => r.voided ? 'VOID' : '' }, { k: 'created_by_name', label: 'Recorded by' }],
      expenses: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'category', label: 'Category' }, { k: 'division', label: 'Division' }, { k: 'amount', label: 'Amount', n: 1, f: r => tk(r.amount), total: d => tk(d.filter(r => !r.voided).reduce((a, r) => a + r.amount, 0)) }, { k: 'method', label: 'Method' }, { k: 'description', label: 'Description' }, { k: 'voided', label: 'Void', f: r => r.voided ? 'VOID' : '' }, { k: 'created_by_name', label: 'By' }],
      adjustments: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'division', label: 'Div' }, { k: 'item', label: 'Item' }, { k: 'type', label: 'Type', f: r => TYPE_LABEL[r.type] }, { k: 'amount', label: 'Qty / ft', n: 1, f: r => n0(r.amount) }, { k: 'reason', label: 'Reason' }, { k: 'created_by_name', label: 'By' }, { k: 'created_at', label: 'Time', f: r => fdt(r.created_at) }],
      ink: [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'color', label: 'Colour' }, { k: 'pcs', label: 'Pcs', n: 1, total: 1 }, { k: 'liters', label: 'Litres', n: 1, total: 1 }, { k: 'remarks', label: 'Remarks' }, { k: 'created_by_name', label: 'By' }],
    }[s.register];
    rows.forEach(r => { if (r.voided || r.status === 'cancelled') r._cls = 'void'; });
    dataTable($('#regt', el), rows, C, { totals: true, pageSize: 500, id: 'regtable' });
    $('#regtable', el).dataset.sheet = REG[s.register];
  },

  async employee(el) {
    const s = this.st;
    const d = await GET('/api/reports/employee', { from: s.from, to: s.to, user: s.user });
    el.innerHTML = `<div class="panel"><div class="row"><label class="field" style="width:260px">Employee<select class="inp" id="eu"><option value="">All employees</option>${App.meta.users.map(u => opt(u.id, u.full_name, s.user)).join('')}</select></label>
      <div class="note" style="flex:1;margin:0">The invoice creator and the employee who later records a payment can be different — both are tracked separately. Outstanding stays linked to the invoice and its creator; it does not mean that person caused the non-payment.</div></div></div>
      <div class="panel"><div class="head"><h2>Employee summary</h2></div><div class="tbl-wrap"><table data-sheet="Employee Summary"><thead><tr><th>Employee</th><th>Role</th><th class="n">Invoices</th><th class="n">Sales created</th><th class="n">Payments recorded</th><th class="n">Actions logged</th></tr></thead><tbody>
        ${d.summary.map(u => `<tr><td><b>${esc(u.full_name)}</b></td><td>${esc(u.role || '')}</td><td class="n">${u.invoices}</td><td class="n">${tk(u.sales)}</td><td class="n">${tk(u.collected)}</td><td class="n">${u.actions}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="panel"><div class="head"><h2>Employee-wise sales</h2></div><div id="e1"></div></div>
      <div class="panel"><div class="head"><div><h2>Employee-wise outstanding</h2><div class="sub">Unpaid / partial invoices grouped by invoice creator (all time)</div></div></div><div id="e2"></div></div>
      <div class="panel"><div class="head"><h2>Payment activity</h2></div><div id="e3"></div></div>
      <div class="panel"><div class="head"><h2>Employee activity log</h2></div><div id="e4"></div></div>`;
    $('#eu', el).onchange = e => { s.user = e.target.value; this.run(); };
    const t1 = dataTable($('#e1', el), d.sales, [{ k: 'inv_no', label: 'Invoice' }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'customer', label: 'Customer' }, { k: 'division', label: 'Div', f: r => divTag(r.division) }, { k: 'total', label: 'Total', n: 1, f: r => tk(r.total), money: 1, total: 1 }, { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid), money: 1, total: 1 }, { k: 'due', label: 'Due', n: 1, f: r => tk(r.due), money: 1, total: 1 }, { k: 'created_by_name', label: 'Created by', f: r => `<b>${esc(r.created_by_name)}</b> <span class="sub">${esc(r.created_role || '')}</span>` }], { totals: true, id: 'e1t' });
    dataTable($('#e2', el), d.outstanding, [{ k: 'created_by_name', label: 'Invoice creator', f: r => `<b>${esc(r.created_by_name)}</b>` }, { k: 'inv_no', label: 'Invoice' }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'customer', label: 'Customer' }, { k: 'phone', label: 'Mobile' }, { k: 'division', label: 'Div', f: r => divTag(r.division) }, { k: 'total', label: 'Total', n: 1, f: r => tk(r.total) }, { k: 'due', label: 'Remaining due', n: 1, f: r => `<b style="color:var(--danger)">${tk(r.due)}</b>`, money: 1, total: 1 }], { totals: true, id: 'e2t' });
    dataTable($('#e3', el), d.payments, [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'receipt_no', label: 'Receipt' }, { k: 'customer', label: 'Customer' }, { k: 'amount', label: 'Amount', n: 1, f: r => tk(r.amount), money: 1, total: 1 }, { k: 'method', label: 'Method' }, { k: 'created_by_name', label: 'Recorded by', f: r => `<b>${esc(r.created_by_name)}</b>` }, { k: 'invoices', label: 'Invoices (creator)', f: r => `<span class="sub">${esc(r.invoices || 'advance')}</span>` }], { totals: true, id: 'e3t' });
    dataTable($('#e4', el), d.activity, [{ k: 'created_at', label: 'Time', f: r => fdt(r.created_at) }, { k: 'user_name', label: 'Employee' }, { k: 'role_name', label: 'Role' }, { k: 'action', label: 'Action', f: r => `<span class="tag ${r.action === 'create' ? 'green' : r.action === 'confirm' ? '' : r.action === 'cancel' || r.action === 'void' ? 'red' : 'gray'}">${esc(r.action)}</span>` }, { k: 'entity', label: 'Record', f: r => `${esc(r.entity)} #${esc(r.entity_id || '')}` }, { k: 'details', label: 'Details', f: r => `<span class="sub">${esc(JSON.stringify(r.details || {})).slice(0, 140)}</span>` }], { pageSize: 100, id: 'e4t' });
    ['e1t:Employee Sales', 'e2t:Employee Outstanding', 'e3t:Payment Activity', 'e4t:Activity Log'].forEach(x => { const [id, n] = x.split(':'); const t = $('#' + id, el); if (t) t.dataset.sheet = n; });
  },
};
