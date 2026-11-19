/* Sales: CTP & PVC invoices, delivery challans, print templates */
'use strict';
function inWords(amount) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = n => n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
  const three = n => (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  const conv = n => { if (!n) return 'Zero'; let s = ''; const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
    if (cr) s += conv(cr) + ' Crore '; if (lk) s += two(lk) + ' Lakh '; if (th) s += two(th) + ' Thousand '; if (n) s += three(n); return s.trim(); };
  const t = Math.floor(Math.abs(amount)), p = Math.round((Math.abs(amount) - t) * 100);
  return 'Taka ' + conv(t) + (p ? ' and ' + two(p) + ' Paisa' : '') + ' Only';
}
const DIVN = { ctp: 'CTP', pvc: 'PVC', gen: 'General' };

/* -------- print templates -------- */
function invoiceDoc(inv) {
  const c = App.meta.settings.company || {};
  const isCtp = inv.division === 'ctp';
  const title = isCtp ? (c.ctp_invoice_title || 'BILL / ORDER SHEET') : (c.pvc_invoice_title || 'PVC / DIGITAL PRINT INVOICE');
  let rows;
  if (isCtp) {
    // paper-style: all plate sizes listed, filled where invoiced
    rows = App.meta.products.map(p => {
      const its = inv.items.filter(i => i.product_id === p.id);
      const q = its.reduce((s, i) => s + i.qty, 0), amt = its.reduce((s, i) => s + i.line_total, 0);
      const rate = its.length ? [...new Set(its.map(i => i.rate))].map(r => n0(r)).join(' / ') : '';
      return `<tr><td><b>${esc(p.name)}</b>${p.alias ? ` <span class="muted">(${esc(p.alias)})</span>` : ''}</td><td class="muted">${esc(p.size_mm || '')}${p.size_in ? ' or, ' + esc(p.size_in) : ''}</td><td class="n">${q || ''}</td><td class="n">${rate}</td><td class="n">${amt ? nf2.format(amt) : ''}</td></tr>`;
    }).join('');
  } else {
    rows = inv.items.map((i, k) => i.kind === 'piece' ? `<tr><td>${k + 1}</td><td><b>${esc(i.description)}</b> <span class="muted">per piece</span></td><td class="n">—</td><td class="n">${i.qty}</td><td class="n">—</td><td class="n">${nf2.format(i.rate)}/pc</td><td class="n">${nf2.format(i.line_total)}</td></tr>`
      : `<tr><td>${k + 1}</td><td><b>${esc(i.category)}</b> <span class="muted">${+i.width_ft} ft roll</span>${i.description ? `<div class="muted">${esc(i.description)}</div>` : ''}</td><td class="n">${+i.art_w} × ${+i.art_l}</td><td class="n">${i.qty}</td><td class="n">${n0(i.sqft)}</td><td class="n">${nf2.format(i.rate)}</td><td class="n">${nf2.format(i.line_total)}</td></tr>`).join('');
  }
  const head = isCtp ? '<tr><th>Particulars</th><th>Plate size</th><th class="n">Qty of plate</th><th class="n">Rate</th><th class="n">Amount</th></tr>'
    : '<tr><th>SL</th><th>Media / description</th><th class="n">Size (W × L ft)</th><th class="n">Qty</th><th class="n">Sq ft</th><th class="n">Rate/sq ft</th><th class="n">Amount</th></tr>';
  return `<div class="doc" style="position:relative">${inv.status === 'cancelled' ? '<div class="watermark">CANCELLED</div>' : inv.status === 'draft' ? '<div class="watermark" style="color:#7b8a9b22">DRAFT</div>' : ''}
    ${companyHeader(`<div style="text-align:right"><div class="doc-title">${title}</div><div style="font-size:20px;font-weight:800;margin-top:8px">${esc(inv.inv_no || 'DRAFT #' + inv.id)}</div></div>`)}
    <div class="meta"><div><b>Receiving date:</b> ${fdate(inv.date)}</div><div><b>Job no:</b> ${esc(inv.job_no || '')}</div>
      <div><b>Customer name:</b> ${esc(inv.customer)}${inv.company ? ' — ' + esc(inv.company) : ''}</div><div><b>Phone:</b> ${esc(inv.phone || '')}</div>
      <div style="grid-column:1/-1"><b>Address:</b> ${esc(inv.address || '')}</div></div>
    <table><thead>${head}</thead><tbody>${rows}</tbody></table>
    <div class="row" style="align-items:flex-start;margin-top:10px">
      <div style="flex:1;font-size:12px"><div><b>App. delivery date:</b> ${fdate(inv.delivery_date)}</div><div><b>Up to date due balance:</b> ${tk(Math.max(0, inv.prev_due))}</div>
        <div><b>In word:</b> ${inWords(inv.grand_total)}</div><div class="muted">Payment: ${esc(inv.payment_method || '')} · Status: ${esc(inv.pay_status)}</div>${inv.remarks ? `<div><b>Remarks:</b> ${esc(inv.remarks)}</div>` : ''}</div>
      <div class="sum">${inv.discount ? `<div><span>Subtotal</span><span>${nf2.format(inv.subtotal)}</span></div><div><span>Discount</span><span>− ${nf2.format(inv.discount)}</span></div>` : ''}
        <div class="k"><span>TOTAL</span><span>${nf2.format(inv.grand_total)}</span></div><div><span>ADVANCE / PAID</span><span>${nf2.format(inv.paid)}</span></div><div class="k"><span>BALANCE</span><span>${nf2.format(inv.due)}</span></div></div></div>
    <div class="fine">N.B: ${esc(c.invoice_note || '')}</div>
    <div class="sign"><div>Customer's signature</div><div>Authorize signature<br><span class="muted">${esc(inv.created_by_name || '')}</span></div></div></div>`;
}
function challanDoc(ch, div) {
  const c = App.meta.settings.company || {};
  const lines = ch.items.map((i, k) => `<tr><td>${k + 1}</td><td class="n">${div === 'ctp' ? n0(i.qty) + ' pcs' : n0(i.qty) + ' pcs' + (i.sqft ? `<div class="muted">${n0(i.sqft)} sq ft</div>` : '') + (i.length_ft ? `<div class="muted">${n0(i.length_ft)} ft</div>` : '')}</td>
    <td>${esc(i.description || i.product || i.category || '')}${div === 'ctp' && i.size_mm ? ` <span class="muted">${esc(i.size_mm)}</span>` : ''}</td><td class="n">${i.cost ? nf2.format(i.cost) : ''}</td><td>${esc(ch.inv_no || (ch.standalone ? 'Standalone' : ''))}</td></tr>`).join('');
  const pad = Math.max(0, 8 - ch.items.length);
  return `<div class="doc" style="position:relative">${ch.status === 'cancelled' ? '<div class="watermark">CANCELLED</div>' : ''}
    <div class="doc-head"><div class="doc-logo">${logoMark(c)}<div><h1>${esc(c.name)}</h1><div class="muted">${esc(c.challan_address || c.address)}</div></div></div>
      <div style="text-align:right"><div class="doc-title">${esc(c.challan_title || 'DELIVERY CHALLAN')}</div><div class="mt">${divTag(div)}</div></div></div>
    <div class="meta"><div><b>Challan No.</b> <span style="font-size:18px;font-weight:800">${esc(ch.dc_no)}</span></div><div><b>Delivery date:</b> ${fdate(ch.date)}</div>
      <div><b>Name of institution:</b> ${esc(ch.customer || '')}${ch.company ? ' — ' + esc(ch.company) : ''}</div><div><b>From:</b> ${esc(c.name)}</div>
      <div><b>Address:</b> ${esc(ch.address || '')}</div><div><b>Carried by:</b> ${esc(ch.carried_by || '')}</div>
      <div><b>Issuing authority:</b> ${esc(ch.issuing_authority || ch.created_by_name || '')}</div><div><b>Related invoice:</b> ${esc(ch.inv_no || '—')}</div>
      <div><b>Prepared by:</b> ${esc(ch.prepared_by || ch.created_by_name || '')}${ch.prepared_nick ? ` <span class="muted">(${esc(ch.prepared_nick)})</span>` : ''}</div></div>
    <table><thead><tr><th style="width:44px">SL</th><th class="n" style="width:110px">Quantity</th><th>Description</th><th class="n" style="width:110px">Cost</th><th style="width:150px">Source / Remarks</th></tr></thead>
      <tbody>${lines}${'<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>'.repeat(pad)}</tbody></table>
    ${ch.remarks ? `<div class="fine"><b>Remarks:</b> ${esc(ch.remarks)}</div>` : ''}
    <div class="sign"><div>Materials delivered by<br><span class="muted">${esc(ch.prepared_by || 'Name & Designation')}</span></div><div>Materials received<br><span class="muted">${esc(ch.receiver || 'Name & Designation')}</span></div></div>
    <div class="fine">${esc(c.challan_note || '')}</div></div>`;
}

/* -------- invoice list -------- */
function invoiceListPage(div) {
  return {
    title: DIVN[div] + ' Sales & Invoices', filters: null, prefill: null,
    async render(v, id) {
      if (id === 'new') return this.form(v, null);
      if (id && id.startsWith('edit-')) return this.form(v, +id.slice(5));
      if (id) return this.view(v, +id);
      const f = this.filters || { from: addDays(App.today, -30), to: App.today, status: '', pay: '', created_by: '' };
      v.innerHTML = `<div class="head"><div class="row">${periodChips('', ['today', 'week', 'month', 'year'])}</div>
        <div class="row">${can(div + '.challan') ? `<button class="btn ghost" onclick="App.go('${div}-challans')">${ICON.truck} Challans</button>` : ''}${can(div + '.invoice') ? `<button class="btn ${div === 'pvc' ? 'teal' : ''}" onclick="App.go('${div}-invoices/new')">${ICON.plus} New ${DIVN[div]} invoice</button>` : ''}</div></div>
        <div class="panel"><div class="row mb"><input type="date" class="inp" id="ff" value="${f.from}" style="width:150px"><input type="date" class="inp" id="ft" value="${f.to}" style="width:150px">
          <select class="inp" id="fs" style="width:140px"><option value="">All status</option>${['draft', 'confirmed', 'cancelled'].map(s => opt(s, s[0].toUpperCase() + s.slice(1), f.status)).join('')}</select>
          <select class="inp" id="fp" style="width:150px"><option value="">Any payment</option>${['Paid', 'Partially Paid', 'Due'].map(s => opt(s, s, f.pay)).join('')}</select>
          ${can('reports.employee') ? `<select class="inp" id="fu" style="width:170px"><option value="">Any employee</option>${App.meta.users.map(u => opt(u.id, u.full_name, f.created_by)).join('')}</select>` : ''}
          <button class="btn sm" id="fgo">Apply</button><button class="btn sm ghost right" id="fx">${ICON.excel} Excel</button></div><div id="itbl"></div></div>`;
      $$('[data-period]', v).forEach(b => b.onclick = () => { const [a, z] = periodRange(b.dataset.period); this.filters = { ...f, from: a, to: z }; App.refresh(); });
      $('#fgo', v).onclick = () => { this.filters = { from: $('#ff', v).value, to: $('#ft', v).value, status: $('#fs', v).value, pay: $('#fp', v).value, created_by: $('#fu', v)?.value || '' }; App.refresh(); };
      const rows = await GET(`/api/${div}/invoices`, f);
      rows.forEach(r => { if (r.status === 'cancelled') r._cls = 'void'; });
      const t = dataTable($('#itbl', v), rows, [
        { k: 'inv_no', label: 'Invoice', f: r => `<b>${esc(r.inv_no || 'Draft #' + r.id)}</b>` }, { k: 'date', label: 'Date', f: r => fdate(r.date) },
        { k: 'customer', label: 'Customer', f: r => `${esc(r.customer)}<div class="sub">${esc(r.phone || '')}</div>` },
        ...(div === 'ctp' ? [{ k: 'item_qty', label: 'Plates', n: 1, total: 1 }] : [{ k: 'sqft', label: 'Sq ft', n: 1, f: r => n0(r.sqft), total: 1 }]),
        { k: 'grand_total', label: 'Total', n: 1, f: r => tk(r.grand_total), total: d => tk(d.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.grand_total, 0)) },
        { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid), total: d => tk(d.reduce((s, r) => s + r.paid, 0)) },
        { k: 'due', label: 'Due', n: 1, f: r => r.due > 0 ? `<b style="color:var(--danger)">${tk(r.due)}</b>` : tk(0), total: d => tk(d.reduce((s, r) => s + r.due, 0)) },
        { k: 'status', label: 'Status', f: r => statusTag(r.status) + ' ' + (r.status === 'confirmed' ? statusTag(r.pay_status) : '') },
        { k: 'delivery_status', label: 'Delivery', f: r => statusTag(r.delivery_status) },
        { k: 'created_by_name', label: 'Created by', f: r => `<span class="sub">${esc(r.created_by_name)}</span>` },
      ], { onRow: r => App.go(`${div}-invoices/${r.id}`), totals: true, id: 'inv-t' });
      $('#fx', v).onclick = () => exportXlsx(`${DIVN[div]} Invoices`, [`${fdate(f.from)} to ${fdate(f.to)}`], [tableToSheet('Invoices', $('#inv-t', v))]);
    },

    /* ---- invoice form ---- */
    async form(v, id) {
      const inv = id ? await GET(`/api/${div}/invoices/${id}`) : null;
      if (inv && inv.status !== 'draft') { App.go(`${div}-invoices/${id}`); return; }
      const stock = div === 'ctp' ? await GET('/api/ctp/stock') : await GET('/api/pvc/stock');
      const pre = this.prefill; this.prefill = null;
      let cust = inv ? { id: inv.customer_id, name: inv.customer, phone: inv.phone, company: inv.company } : pre?.customer || null;
      let lines = inv ? inv.items.map(i => ({ ...i })) : pre?.prints ? pre.prints.map(p => ({ print_entry_id: p.id, media_id: p.media_id, art_w: +p.art_w, art_l: +p.art_l, qty: p.qty, orientation: p.orientation, rate: +(App.meta.media.find(m => m.id === p.media_id)?.default_rate || 0), wastage_length: +p.wastage_length, used_length: +p.used_length, across: p.across })) : [];
      if (!lines.length) lines.push(div === 'ctp' ? { product_id: App.meta.products[0]?.id, qty: '', rate: App.meta.products[0]?.current_rate } : { media_id: App.meta.media.find(m => m.active)?.id, art_w: '', art_l: '', qty: 1, orientation: 'Normal', rate: '', wastage_length: 0, nest: App.meta.settings.pvc?.allow_nesting !== false });
      const key = { k: uid() };
      v.innerHTML = `<div class="panel"><div class="head"><div><h2>${inv ? 'Edit draft ' : 'Create '}${DIVN[div]} invoice</h2><div class="sub">${div === 'ctp' ? 'CTP-INV series · confirmed invoice deducts plate stock' : 'PVC-INV series · billed by sq ft · confirmed invoice deducts linear ft + wastage'} · number is assigned on confirmation</div></div><span class="tag ${div === 'pvc' ? 'teal' : ''}">${div === 'ctp' ? 'CTP / Pcs' : 'PVC / Sq ft'}</span></div>
        <div class="form f4" id="hf">
          <div class="field span2">Customer <span class="req">*</span><div id="cp"></div></div>
          ${field('Invoice date', dateInput('date', inv?.date))}
          ${field('Job no.', `<input name="job_no" value="${esc(inv?.job_no || '')}" placeholder="optional">`)}
        </div>
        <div class="row mt mb" style="justify-content:space-between"><h2 style="font-size:13px">Items</h2>${div === 'pvc' ? `<button class="btn sm light" id="imp">${ICON.print} Add unbilled print entries</button>` : ''}</div>
        <div class="lines"><table><thead>${div === 'ctp' ? '<tr><th>Plate size</th><th class="n" style="width:130px">Quantity (pcs)</th><th class="n" style="width:150px">Rate / plate (৳)</th><th class="n" style="width:150px">Amount</th><th style="width:40px"></th></tr>'
          : '<tr><th style="min-width:200px">Media / roll</th><th style="width:90px">W (ft)</th><th style="width:90px">L (ft)</th><th style="width:80px">Qty</th><th style="width:120px">Orientation</th><th class="n" style="width:90px">Sq ft</th><th style="width:110px">Rate/sq ft</th><th class="n" style="width:120px">Amount</th><th style="width:100px">Waste ft</th><th style="width:40px"></th></tr>'}</thead><tbody id="lb"></tbody></table></div>
        <div class="row mt"><button class="btn sm ghost" id="addl">${ICON.plus} Add line</button>${div === 'pvc' ? `<button class="btn sm ghost" id="addp">${ICON.plus} Piece item (ID card etc.)</button>` : ''}</div>
        <div class="grid g2 mt"><div class="form f2" id="ef">
          ${field('Payment method', `<select name="payment_method">${App.meta.payment_methods.map(p => opt(p, p, inv?.payment_method || 'Cash')).join('')}</select>`)}
          ${field('Approx. delivery date', `<input type="date" name="delivery_date" value="${inv?.delivery_date || ''}">`)}
          ${field('Remarks', `<textarea name="remarks">${esc(inv?.remarks || '')}</textarea>`, 'span2')}
          <div class="note span2" id="stocknote" style="grid-column:span 2"></div></div>
          <div class="totals"><div class="r"><span>Subtotal</span><b id="sub">৳ 0.00</b></div>
            <div class="r"><span>Discount</span><input type="number" step="0.01" min="0" id="disc" value="${inv?.discount || 0}"></div>
            <div class="r g"><span>Grand total</span><span id="gt">৳ 0.00</span></div>
            <div class="r"><span>Paid now</span><input type="number" step="0.01" min="0" id="paid" value="0"></div>
            <div class="r due"><span>Due</span><span id="due">৳ 0.00</span></div><div class="sub tr" id="words"></div></div></div>
        <div class="actions"><button class="btn ghost" onclick="history.back()">Cancel</button><button class="btn light" id="draft">Save draft</button><button class="btn ${div === 'pvc' ? 'teal' : 'green'}" id="conf">${ICON.check} Confirm invoice</button></div></div>`;
      custPicker($('#cp', v), { value: cust, onPick: c => { cust = c; } });
      const lb = $('#lb', v);
      const stockOf = l => div === 'ctp' ? stock.find(s => s.id === +l.product_id)?.balance : stock.find(s => s.id === +l.media_id)?.balance;
      const calcLine = l => {
        if (div === 'ctp' || l.kind === 'piece') { l.line_total = r2((+l.qty || 0) * (+l.rate || 0)); l.sqft = 0; l._fit = true; l.used_length = 0; return; }
        const md = App.meta.media.find(m => m.id === +l.media_id);
        if (l.print_entry_id) { l.sqft = r2(l.art_w * l.art_l * l.qty); l.line_total = r2(l.sqft * (+l.rate || 0)); l._fit = true; return; }
        const c = md ? pvcCalc({ roll_width: md.width_ft, art_w: l.art_w, art_l: l.art_l, qty: l.qty, orientation: l.orientation, nest: l.nest }) : null;
        l.sqft = r2((+l.art_w || 0) * (+l.art_l || 0) * (+l.qty || 0)); l.line_total = r2(l.sqft * (+l.rate || 0));
        l._fit = c ? c.fits : true; l.used_length = c ? c.used_length : 0; l._alt = c?.alt_fits;
      };
      const drawLines = () => {
        lb.innerHTML = lines.map((l, i) => {
          calcLine(l);
          if (div === 'ctp') {
            const bal = stockOf(l);
            return `<tr class="rowin" data-i="${i}"><td><select data-k="product_id">${productOptions(l.product_id)}</select><span class="stock-chip ${bal < (+l.qty || 0) ? 'low' : ''}">In stock: ${bal ?? '—'} pcs</span></td>
              <td><input type="number" min="1" step="1" data-k="qty" value="${l.qty}" style="text-align:right"></td><td><input type="number" step="0.01" min="0" data-k="rate" value="${l.rate}" style="text-align:right"></td>
              <td class="n"><b data-amt>${tk(l.line_total)}</b></td><td><button class="x" data-del="${i}" title="Remove">×</button></td></tr>`;
          }
          if (l.kind === 'piece') return `<tr class="rowin" data-i="${i}"><td colspan="3"><input data-k="description" value="${esc(l.description || '')}" placeholder="Piece item, e.g. PVC ID Card"><span class="stock-chip">Per-piece item · no roll stock deducted</span></td>
            <td><input type="number" step="1" min="1" data-k="qty" value="${l.qty}"></td><td class="muted">—</td><td class="n muted">—</td><td><input type="number" step="0.01" min="0" data-k="rate" value="${l.rate}" title="Rate per piece"></td>
            <td class="n"><b data-amt>${tk(l.line_total)}</b></td><td class="muted">—</td><td><button class="x" data-del="${i}" title="Remove">×</button></td></tr>`;
          const ro = l.print_entry_id ? 'disabled' : '';
          return `<tr class="rowin" data-i="${i}"><td><select data-k="media_id" ${ro}>${mediaOptions(l.media_id)}</select>${l.print_entry_id ? `<span class="stock-chip">Linked print entry PE-${l.print_entry_id} · already deducted</span>` : `<span class="stock-chip ${!l._fit ? 'low' : ''}" data-fit>${!l._fit ? `⚠ Does not fit${l._alt ? ' — try Rotate' : ''}` : `Uses ${n0(l.used_length)} ft · stock ${n0(stockOf(l) ?? 0)} ft`}</span>`}</td>
            <td><input type="number" step="any" data-k="art_w" value="${l.art_w}" ${ro}></td><td><input type="number" step="any" data-k="art_l" value="${l.art_l}" ${ro}></td><td><input type="number" step="1" min="1" data-k="qty" value="${l.qty}" ${ro}></td>
            <td><select data-k="orientation" ${ro}>${['Normal', 'Rotate'].map(o => opt(o, o, l.orientation)).join('')}</select></td><td class="n" data-sq>${n0(l.sqft)}</td>
            <td><input type="number" step="0.01" min="0" data-k="rate" value="${l.rate}"></td><td class="n"><b data-amt>${tk(l.line_total)}</b></td>
            <td>${l.print_entry_id ? `<span class="sub">${n0(l.wastage_length)}</span>` : `<input type="number" step="any" min="0" data-k="wastage_length" value="${l.wastage_length || 0}" title="Wastage linear ft">`}${!l.print_entry_id && +l.wastage_length > 0 ? `<select data-k="wastage_reason" style="margin-top:4px">${App.meta.wastage_reasons.map(r => opt(r, r, l.wastage_reason)).join('')}</select>` : ''}</td>
            <td><button class="x" data-del="${i}" title="Remove">×</button></td></tr>`;
        }).join('');
        totals();
      };
      const totals = () => {
        lines.forEach(calcLine);
        const sub = r2(lines.reduce((s, l) => s + l.line_total, 0)), disc = +$('#disc', v).value || 0, gt = r2(sub - disc), paid = +$('#paid', v).value || 0;
        $('#sub', v).textContent = tk(sub); $('#gt', v).textContent = tk(gt); $('#due', v).textContent = tk(Math.max(0, gt - paid)); $('#words', v).textContent = gt > 0 ? inWords(gt) : '';
        $$('tr[data-i]', lb).forEach(tr => { const l = lines[+tr.dataset.i]; $('[data-amt]', tr).textContent = tk(l.line_total); const sq = $('[data-sq]', tr); if (sq) sq.textContent = n0(l.sqft); });
        if (div === 'ctp') {
          const need = {}; lines.forEach(l => (need[l.product_id] = (need[l.product_id] || 0) + (+l.qty || 0)));
          const short = Object.entries(need).filter(([p, q]) => q > (stockOf({ product_id: p }) ?? 0));
          $('#stocknote', v).className = 'note ' + (short.length ? 'danger' : '');
          $('#stocknote', v).innerHTML = short.length ? `Not enough stock: ${short.map(([p, q]) => `${esc(App.meta.products.find(x => x.id === +p)?.name)} needs ${q}, have ${stockOf({ product_id: p })}`).join('; ')}` : `On confirmation ${Object.values(need).reduce((s, q) => s + q, 0)} plates will be deducted from stock. Drafts do not affect stock.`;
        } else {
          const bad = lines.filter(l => !l._fit);
          const need = {}; lines.filter(l => !l.print_entry_id && l.kind !== 'piece').forEach(l => (need[l.media_id] = (need[l.media_id] || 0) + (l.used_length || 0) + (+l.wastage_length || 0)));
          const short = Object.entries(need).filter(([m, q]) => q > (stockOf({ media_id: m }) ?? 0));
          $('#stocknote', v).className = 'note ' + (bad.length || short.length ? 'danger' : '');
          $('#stocknote', v).innerHTML = bad.length ? `${bad.length} line(s) do not fit the roll width.${can('fit.override') ? ' You will be asked for an override reason.' : ''}`
            : short.length ? `Not enough stock for: ${short.map(([m, q]) => `${esc(mediaName(App.meta.media.find(x => x.id === +m)))} (needs ${n0(q)} ft)`).join(', ')}`
            : `Billable ${n0(lines.reduce((s, l) => s + (l.sqft || 0), 0))} sq ft. On confirmation ${n0(Object.values(need).reduce((s, q) => s + q, 0))} linear ft (incl. wastage) will be deducted. Linked print entries are not deducted again.`;
        }
      };
      lb.addEventListener('input', e => {
        const tr = e.target.closest('tr[data-i]'); const k = e.target.dataset.k; if (!tr || !k) return;
        const l = lines[+tr.dataset.i]; l[k] = e.target.value;
        if (k === 'product_id') { l.rate = App.meta.products.find(p => p.id === +l.product_id)?.current_rate || 0; drawLines(); return; }
        if (k === 'media_id') { const md = App.meta.media.find(m => m.id === +l.media_id); if (md && +md.default_rate && !+l.rate) l.rate = +md.default_rate; drawLines(); return; }
        if (['orientation', 'wastage_length'].includes(k) && e.type === 'input' && k === 'orientation') { drawLines(); return; }
        if (k === 'wastage_length' && ((+e.target.value > 0) !== !!$('[data-k=wastage_reason]', tr))) { drawLines(); $(`tr[data-i="${tr.dataset.i}"] [data-k=wastage_length]`, lb)?.focus(); return; }
        totals();
        if (div === 'pvc') { const chip = $('[data-fit]', tr); if (chip) { chip.className = 'stock-chip ' + (!l._fit ? 'low' : ''); chip.textContent = !l._fit ? `⚠ Does not fit${l._alt ? ' — try Rotate' : ''}` : `Uses ${n0(l.used_length)} ft · stock ${n0(stockOf(l) ?? 0)} ft`; } }
      });
      lb.addEventListener('change', e => { if (e.target.dataset.k === 'orientation') { lines[+e.target.closest('tr').dataset.i].orientation = e.target.value; drawLines(); } });
      lb.onclick = e => { const d = e.target.closest('[data-del]'); if (!d) return; lines.splice(+d.dataset.del, 1); if (!lines.length) $('#addl', v).click(); else drawLines(); };
      $('#addl', v).onclick = () => { const last = lines[lines.length - 1] || {}; lines.push(div === 'ctp' ? { product_id: App.meta.products[0]?.id, qty: '', rate: App.meta.products[0]?.current_rate } : { media_id: last.media_id || App.meta.media[0]?.id, art_w: '', art_l: '', qty: 1, orientation: 'Normal', rate: last.rate || '', wastage_length: 0, nest: App.meta.settings.pvc?.allow_nesting !== false }); drawLines(); };
      $('#disc', v).oninput = totals; $('#paid', v).oninput = totals;
      if ($('#addp', v)) $('#addp', v).onclick = () => { lines = lines.filter(l => l.kind === 'piece' || l.print_entry_id || +l.art_w); lines.push({ kind: 'piece', description: 'PVC ID Card', qty: 1, rate: '' }); drawLines(); };
      if ($('#imp', v)) $('#imp', v).onclick = async () => {
        if (!cust) return toast('Select the customer first', '', 'warn');
        const pe = (await GET('/api/pvc/prints', { customer: cust.id, unbilled: 1 })).filter(p => !lines.some(l => l.print_entry_id === p.id));
        const m = modal({ title: 'Unbilled print entries — ' + cust.name, size: 'wide', body: pe.length ? `<div class="tbl-wrap"><table><thead><tr><th></th><th>Ref</th><th>Date</th><th>Media</th><th>Size</th><th class="n">Sq ft</th></tr></thead><tbody>${pe.map(p => `<tr><td><input type="checkbox" value="${p.id}" checked></td><td>PE-${p.id}</td><td>${fdate(p.date)}</td><td>${esc(p.category)} ${+p.width_ft} ft</td><td>${+p.art_w}×${+p.art_l}×${p.qty}</td><td class="n">${n0(p.printed_sqft)}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="btn teal" id="addpe">Add selected</button></div>` : `<div class="empty">No unbilled print entries for this customer.</div>` });
        if (pe.length) $('#addpe', m.el).onclick = () => {
          const ids = $$('input:checked', m.el).map(i => +i.value);
          lines = lines.filter(l => l.print_entry_id || +l.art_w);
          pe.filter(p => ids.includes(p.id)).forEach(p => lines.push({ print_entry_id: p.id, media_id: p.media_id, art_w: +p.art_w, art_l: +p.art_l, qty: p.qty, orientation: p.orientation, rate: +(App.meta.media.find(x => x.id === p.media_id)?.default_rate || 0), wastage_length: +p.wastage_length, used_length: +p.used_length }));
          if (!lines.length) $('#addl', v).click(); m.close(); drawLines();
        };
      };
      drawLines();
      const payload = async confirm => {
        if (!cust) { toast('Select a customer from the list', 'Type the first letters of the name', 'warn'); return null; }
        const items = lines.filter(l => div === 'ctp' ? +l.qty : l.kind === 'piece' ? (+l.qty && String(l.description || '').trim()) : (l.print_entry_id || (+l.art_w && +l.art_l)));
        if (!items.length) { toast('Add at least one item', '', 'warn'); return null; }
        const ovr = {};
        if (div === 'pvc' && confirm) for (const [i, l] of items.entries()) if (!l._fit && !l.print_entry_id) {
          if (!can('fit.override')) { toast(`Line ${i + 1} does not fit the roll`, 'Change orientation or media width', 'err'); return null; }
          const r = await confirmBox('Fit override', `Line ${i + 1} (${l.art_w} × ${l.art_l} ft) does not fit the selected roll width. Enter a reason to override.`, { ok: 'Override', input: 'Override reason' });
          if (!r) return null; ovr[i] = r;
        }
        return { ...formData($('#hf', v)), ...formData($('#ef', v)), customer_id: cust.id, discount: +$('#disc', v).value || 0, paid_amount: confirm ? +$('#paid', v).value || 0 : 0, confirm,
          items: items.map((l, i) => ({ ...l, override_reason: ovr[i] || l.override_reason })) };
      };
      const submit = async confirm => {
        const b = await payload(confirm); if (!b) return;
        if (confirm) {
          const ok = await confirmBox('Confirm invoice?', `Grand total <b>${$('#gt', v).textContent}</b>. Stock will be deducted now and a ${div.toUpperCase()}-INV number assigned. Confirmed invoices cannot be edited.`, { ok: 'Confirm & deduct stock' });
          if (!ok) return;
        }
        const r = inv ? await PUT(`/api/${div}/invoices/${inv.id}`, b) : await POST(`/api/${div}/invoices`, b, { idemKey: key.k });
        toast(confirm ? 'Invoice confirmed' : 'Draft saved', confirm ? `${r.inv_no} · ${tk(r.grand_total)}` : '');
        App.go(`${div}-invoices/${r.id}`);
      };
      $('#draft', v).onclick = () => busy($('#draft', v), () => submit(false));
      $('#conf', v).onclick = () => busy($('#conf', v), () => submit(true));
    },

    /* ---- invoice view ---- */
    async view(v, id) {
      const inv = await GET(`/api/${div}/invoices/${id}`);
      $('#title').textContent = inv.inv_no || 'Draft invoice #' + inv.id;
      const remainingQty = inv.items.reduce((s, i) => s + (+i.qty - +i.delivered), 0);
      v.innerHTML = `<div class="head"><button class="btn ghost" onclick="App.go('${div}-invoices')">← All invoices</button>
        <div class="row">
          ${inv.status === 'draft' && can(div + '.invoice') ? `<button class="btn ghost" id="del">Delete draft</button><button class="btn light" onclick="App.go('${div}-invoices/edit-${inv.id}')">Edit</button><button class="btn green" id="conf">${ICON.check} Confirm</button>` : ''}
          ${inv.status === 'confirmed' && inv.due > 0 && can('payments') ? `<button class="btn green" id="pay">${ICON.money} Receive payment</button>` : ''}
          ${inv.status === 'confirmed' && remainingQty > 0 && can(div + '.challan') ? `<button class="btn light" id="dc">${ICON.truck} Create challan</button>` : ''}
          ${inv.status === 'confirmed' && can('invoice.cancel') ? `<button class="btn ghost" id="cancel" style="color:var(--danger)">Cancel invoice</button>` : ''}
          <button class="btn" id="prt">${ICON.print} Print / PDF</button></div></div>
        <div class="grid" style="grid-template-columns:1fr 340px;align-items:start"><div style="overflow:auto;padding:4px">${invoiceDoc(inv)}</div>
        <div><div class="panel"><h2>Summary</h2><div class="kv mt"><span>Status</span><span>${statusTag(inv.status)} ${statusTag(inv.pay_status)}</span><span>Delivery</span><span>${statusTag(inv.delivery_status)}</span>
          <span>Total</span><b>${tk(inv.grand_total)}</b><span>Paid</span><b style="color:var(--ok)">${tk(inv.paid)}</b><span>Due</span><b style="color:var(--danger)">${tk(inv.due)}</b>
          <span>Customer balance</span><b>${tk(inv.prev_due)}</b></div><div class="divider"></div>
          <div class="kv small"><span>Created by</span><span>${esc(inv.created_by_name)} <span class="muted">(${esc(inv.created_role || '')})</span><br><span class="muted">${fdt(inv.created_at)}</span></span>
          ${inv.updated_by_name ? `<span>Edited by</span><span>${esc(inv.updated_by_name)}<br><span class="muted">${fdt(inv.updated_at)}</span></span>` : ''}
          ${inv.confirmed_by_name ? `<span>Confirmed by</span><span>${esc(inv.confirmed_by_name)}<br><span class="muted">${fdt(inv.confirmed_at)}</span></span>` : ''}
          ${inv.cancelled_by_name ? `<span>Cancelled by</span><span>${esc(inv.cancelled_by_name)}<br><span class="muted">${fdt(inv.cancelled_at)}</span><br><b>${esc(inv.cancel_reason)}</b></span>` : ''}</div>
          <div class="divider"></div><a href="#/customers/${inv.customer_id}" class="small">Open customer profile & ledger →</a></div>
        <div class="panel"><h2>Payments</h2>${inv.payments.length ? `<div class="feed mt">${inv.payments.map(p => `<div class="feed-item"><div class="feed-ic" style="background:var(--ok)">৳</div><div class="t"><b>${tk(p.amount)}</b><small>${esc(p.receipt_no)} · ${fdate(p.date)} · ${esc(p.method)}<br>recorded by ${esc(p.created_by_name)}</small></div></div>`).join('')}</div>` : '<div class="empty">No payments yet</div>'}</div>
        <div class="panel"><h2>Delivery challans</h2>${inv.challans.length ? `<div class="feed mt">${inv.challans.map(c => `<div class="feed-item" onclick="App.go('${div}-challans/${c.id}')"><div class="feed-ic" style="background:var(--blue)">DC</div><div class="t"><b>${esc(c.dc_no)}</b><small>${fdate(c.date)} · ${esc(c.receiver || '')} ${c.status === 'cancelled' ? '· cancelled' : ''}</small></div></div>`).join('')}</div>` : '<div class="empty">Not delivered yet</div>'}</div></div></div>`;
      $('#prt', v).onclick = () => printHTML(invoiceDoc(inv));
      if ($('#conf', v)) $('#conf', v).onclick = () => busy($('#conf', v), async () => {
        const ok = await confirmBox('Confirm invoice?', `Total ${tk(inv.grand_total)}. Stock will be deducted and a number assigned.`, { ok: 'Confirm' }); if (!ok) return;
        await POST(`/api/${div}/invoices/${id}/confirm`, { paid_amount: 0 }); toast('Invoice confirmed'); App.refresh();
      });
      if ($('#del', v)) $('#del', v).onclick = async () => { if (await confirmBox('Delete draft?', 'This draft will be removed. Drafts never affected stock.', { ok: 'Delete', danger: true })) { try { await DEL(`/api/${div}/invoices/${id}`); toast('Draft deleted'); App.go(div + '-invoices'); } catch (e) { fail(e); } } };
      if ($('#cancel', v)) $('#cancel', v).onclick = async () => {
        const reason = await confirmBox('Cancel confirmed invoice?', 'Stock will be returned through auditable reversal entries, the receivable is reversed, and any payment on it becomes customer credit. The invoice stays in history as CANCELLED.', { ok: 'Cancel invoice', danger: true, input: 'Cancellation reason' });
        if (reason) { try { await POST(`/api/${div}/invoices/${id}/cancel`, { reason }); toast('Invoice cancelled'); App.refresh(); } catch (e) { fail(e); } }
      };
      if ($('#pay', v)) $('#pay', v).onclick = () => paymentModal({ customer: { id: inv.customer_id, name: inv.customer }, invoice: { division: div, id: inv.id, due: inv.due, inv_no: inv.inv_no } }, () => App.refresh());
      if ($('#dc', v)) $('#dc', v).onclick = () => challanFromInvoice(div, inv);
    },
  };
}
App.pages['ctp-invoices'] = invoiceListPage('ctp');
App.pages['pvc-invoices'] = invoiceListPage('pvc');

/* -------- challans -------- */
/** who is making this challan — defaults to the logged-in employee, both editable; nickname may stay empty */
const preparedFields = () => field('Prepared by <span class="req">*</span>', `<input name="prepared_by" value="${esc(App.user.full_name)}">`) + field('Nickname', `<input name="prepared_nick" value="${esc(App.user.nickname || '')}" placeholder="optional">`);
function challanFromInvoice(div, inv) {
  const m = modal({
    title: `Delivery challan for ${inv.inv_no}`, size: 'wide', body: `<div class="form" id="chf">${field('Delivery date', dateInput())}${field('Received by', `<input name="receiver" placeholder="Receiver name">`)}${field('Carried by', `<input name="carried_by">`)}${preparedFields()}${field('Remarks', `<input name="remarks">`, 'span3')}</div>
    <div class="tbl-wrap mt"><table><thead><tr><th>Item</th><th class="n">Invoiced</th><th class="n">Delivered</th><th class="n">Remaining</th><th style="width:140px">Deliver now</th></tr></thead><tbody>
    ${inv.items.map(i => { const rem = +i.qty - +i.delivered; return `<tr><td>${div === 'ctp' ? esc(i.product) : i.kind === 'piece' ? esc(i.description) : `${esc(i.category)} ${+i.width_ft} ft · ${+i.art_w}×${+i.art_l}`}</td><td class="n">${i.qty}</td><td class="n">${n0(i.delivered)}</td><td class="n"><b>${rem}</b></td><td><input class="inp" type="number" min="0" max="${rem}" step="1" data-it="${i.id}" value="${rem}" ${rem <= 0 ? 'disabled' : ''}></td></tr>`; }).join('')}
    </tbody></table></div><div class="note">Creating a challan does <b>not</b> deduct stock again — stock was deducted when the invoice was confirmed. Partial deliveries are allowed.</div>
    <div class="actions"><button class="btn" id="chs">${ICON.truck} Create challan</button></div>`,
  });
  const key = uid();
  $('#chs', m.el).onclick = () => busy($('#chs', m.el), async () => {
    const items = $$('[data-it]', m.el).map(i => ({ invoice_item_id: +i.dataset.it, qty: +i.value || 0 })).filter(i => i.qty > 0);
    const r = await POST(`/api/${div}/challans`, { ...formData($('#chf', m.el)), invoice_id: inv.id, items }, { idemKey: key });
    toast('Challan created', r.dc_no); m.close(); App.go(`${div}-challans/${r.id}`);
  });
}
function standaloneChallan(div) {
  let cust = null; const lines = [{}];
  const m = modal({
    title: `Standalone ${DIVN[div]} challan (no invoice)`, size: 'wide', body: `<div class="note warn" style="margin:0 0 12px">Authorized only. A standalone delivery creates its own stock movement.</div>
    <div class="form" id="sf"><div class="field span2">Customer <span class="req">*</span><div id="scp"></div></div>${field('Delivery date', dateInput())}${field('Received by', `<input name="receiver">`)}${field('Carried by', `<input name="carried_by">`)}${preparedFields()}${field('Reason / remarks <span class="req">*</span>', `<input name="remarks">`)}</div>
    <div class="tbl-wrap mt"><table><thead><tr><th>${div === 'ctp' ? 'Plate' : 'Media'}</th>${div === 'pvc' ? '<th>Length (ft)</th>' : ''}<th>Qty</th><th>Description</th><th>Cost</th></tr></thead><tbody id="sl"></tbody></table></div>
    <div class="actions"><button class="btn ghost" id="sla">+ Line</button><button class="btn" id="sls">Create challan</button></div>`,
  });
  custPicker($('#scp', m.el), { onPick: c => (cust = c) });
  const draw = () => $('#sl', m.el).innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><select class="inp" data-k="${div === 'ctp' ? 'product_id' : 'media_id'}">${div === 'ctp' ? productOptions(l.product_id) : mediaOptions(l.media_id)}</select></td>${div === 'pvc' ? `<td><input class="inp" type="number" data-k="length_ft" value="${l.length_ft || ''}"></td>` : ''}<td><input class="inp" type="number" data-k="qty" value="${l.qty || ''}"></td><td><input class="inp" data-k="description" value="${esc(l.description || '')}"></td><td><input class="inp" type="number" data-k="cost" value="${l.cost || ''}"></td></tr>`).join('');
  draw();
  $('#sl', m.el).oninput = e => { const tr = e.target.closest('tr'); lines[+tr.dataset.i][e.target.dataset.k] = e.target.value; };
  $$('#sl select', m.el).forEach(s => s.dispatchEvent(new Event('input', { bubbles: true })));
  $('#sla', m.el).onclick = () => { lines.push({}); draw(); };
  const key = uid();
  $('#sls', m.el).onclick = () => busy($('#sls', m.el), async () => {
    if (!cust) return toast('Select a customer', '', 'warn');
    $$('#sl tr', m.el).forEach(tr => $$('[data-k]', tr).forEach(i => (lines[+tr.dataset.i][i.dataset.k] = i.value)));
    const r = await POST(`/api/${div}/challans`, { ...formData($('#sf', m.el)), customer_id: cust.id, items: lines }, { idemKey: key });
    toast('Challan created', r.dc_no); m.close(); App.go(`${div}-challans/${r.id}`);
  });
}
function challanPage(div) {
  return {
    title: DIVN[div] + ' Delivery Challans',
    async render(v, id) {
      if (id) {
        const ch = await GET(`/api/${div}/challans/${id}`);
        $('#title').textContent = ch.dc_no;
        v.innerHTML = `<div class="head"><button class="btn ghost" onclick="App.go('${div}-challans')">← All challans</button><div class="row">${ch.invoice_id ? `<button class="btn ghost" onclick="App.go('${div}-invoices/${ch.invoice_id}')">View invoice ${esc(ch.inv_no)}</button>` : ''}
          ${ch.status === 'active' && can('invoice.cancel') ? `<button class="btn ghost" id="cc" style="color:var(--danger)">Cancel challan</button>` : ''}<button class="btn" id="prt">${ICON.print} Print / PDF</button></div></div>
          <div style="overflow:auto;padding:4px">${challanDoc(ch, div)}</div><div class="sub mt" style="text-align:center">Created by ${esc(ch.created_by_name)} · ${fdt(ch.created_at)}</div>`;
        $('#prt', v).onclick = () => printHTML(challanDoc(ch, div));
        if ($('#cc', v)) $('#cc', v).onclick = async () => { const r = await confirmBox('Cancel challan?', ch.standalone ? 'Stock deducted by this standalone challan will be returned.' : 'Delivered quantity will be released back to pending.', { ok: 'Cancel challan', danger: true, input: 'Reason' }); if (r) { try { await POST(`/api/${div}/challans/${id}/cancel`, { reason: r }); toast('Challan cancelled'); App.refresh(); } catch (e) { fail(e); } } };
        return;
      }
      const f = this.f || { from: addDays(App.today, -60), to: App.today };
      v.innerHTML = `<div class="head"><div class="sub">${div.toUpperCase()}-DC series · delivery tracking only — never a second stock deduction</div><div class="row">
        ${can('challan.standalone') ? `<button class="btn ghost" id="sa">Standalone challan</button>` : ''}<button class="btn" id="nc">${ICON.truck} New challan from invoice</button></div></div>
        <div class="panel"><div class="row mb"><input type="date" class="inp" id="cf" value="${f.from}" style="width:150px"><input type="date" class="inp" id="ct" value="${f.to}" style="width:150px"><button class="btn sm" id="cgo">Apply</button></div><div id="ctbl"></div></div>`;
      $('#cgo', v).onclick = () => { this.f = { from: $('#cf', v).value, to: $('#ct', v).value }; App.refresh(); };
      if ($('#sa', v)) $('#sa', v).onclick = () => standaloneChallan(div);
      $('#nc', v).onclick = async () => {
        const invs = (await GET(`/api/${div}/invoices`, { status: 'confirmed', from: addDays(App.today, -365), to: App.today })).filter(i => i.delivery_status !== 'Delivered');
        const m = modal({ title: 'Select invoice to deliver', size: 'wide', body: `<div id="pi"></div>` });
        dataTable($('#pi', m.el), invs, [{ k: 'inv_no', label: 'Invoice' }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'customer', label: 'Customer' }, { k: 'delivery_status', label: 'Delivery', f: r => statusTag(r.delivery_status) }, { k: 'item_qty', label: 'Qty', n: 1, f: r => `${n0(r.delivered_qty)} / ${n0(r.item_qty)}` }],
          { onRow: async r => { m.close(); challanFromInvoice(div, await GET(`/api/${div}/invoices/${r.id}`)); }, empty: 'All confirmed invoices are fully delivered' });
      };
      const rows = await GET(`/api/${div}/challans`, f);
      rows.forEach(r => { if (r.status === 'cancelled') r._cls = 'void'; });
      dataTable($('#ctbl', v), rows, [
        { k: 'dc_no', label: 'Challan', f: r => `<b>${esc(r.dc_no)}</b>` }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'customer', label: 'Customer' },
        { k: 'inv_no', label: 'Invoice', f: r => r.inv_no ? esc(r.inv_no) : '<span class="tag orange">Standalone</span>' }, { k: 'qty', label: 'Qty', n: 1, f: r => n0(r.qty) },
        { k: 'receiver', label: 'Received by' }, { k: 'status', label: 'Status', f: r => statusTag(r.status) }, { k: 'prepared_by', label: 'Prepared by', f: r => `<span class="sub">${esc(r.prepared_by || r.created_by_name)}${r.prepared_nick ? ' (' + esc(r.prepared_nick) + ')' : ''}</span>` },
      ], { onRow: r => App.go(`${div}-challans/${r.id}`), empty: 'No challans yet' });
    },
  };
}
App.pages['ctp-challans'] = challanPage('ctp');
App.pages['pvc-challans'] = challanPage('pvc');
