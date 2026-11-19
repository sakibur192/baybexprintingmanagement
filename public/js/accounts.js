/* Customers, accounts, payments, ledger, expenses */
'use strict';
function paymentModal({ customer = null, invoice = null } = {}, done) {
  let cust = customer, open = [];
  const m = modal({
    title: 'Receive payment', size: 'wide', icon: `<span class="feed-ic" style="background:var(--ok)">৳</span>`,
    body: `<div class="form" id="pmf"><div class="field span2">Customer <span class="req">*</span><div id="pmc"></div></div>${field('Date', dateInput())}
      ${field('Amount (৳) <span class="req">*</span>', `<input type="number" step="0.01" min="0.01" name="amount" value="${invoice ? invoice.due : ''}">`)}
      ${field('Method', `<select name="method">${App.meta.payment_methods.map(p => opt(p, p)).join('')}</select>`)}
      ${field('Reference', `<input name="reference" placeholder="Txn ID / cheque no.">`)}
      ${field('Remarks', `<input name="remarks">`, 'span3')}</div>
      <div class="row mt" style="justify-content:space-between"><h2 style="font-size:13px">Allocate to invoices</h2><div class="seg" id="amode"><button type="button" class="on" data-m="auto">Auto (oldest first)</button><button type="button" data-m="manual">Manual</button></div></div>
      <div id="alloc" class="mt"></div><div class="note" id="pnote"></div>
      <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn green" id="pms">${ICON.check} Save payment</button></div>`,
  });
  let mode = invoice ? 'manual' : 'auto';
  const key = uid();
  const drawAlloc = () => {
    const amt = +$('[name=amount]', m.el).value || 0;
    $$('#amode button', m.el).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    if (!cust) { $('#alloc', m.el).innerHTML = '<div class="empty">Select a customer to see open invoices</div>'; $('#pnote', m.el).textContent = ''; return; }
    if (!open.length) { $('#alloc', m.el).innerHTML = '<div class="empty">No open invoices — the full amount will be kept as advance / customer credit.</div>'; $('#pnote', m.el).innerHTML = `Advance: <b>${tk(amt)}</b>`; return; }
    let left = amt;
    $('#alloc', m.el).innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th class="n">Due</th><th class="n" style="width:160px">Allocate</th></tr></thead><tbody>${open.map((o, i) => {
      let a; if (mode === 'auto') { a = Math.min(left, o.due); left = r2(left - a); } else a = o._a ?? (invoice && o.division === invoice.division && o.id === invoice.id ? Math.min(amt, o.due) : 0);
      return `<tr><td>${divTag(o.division)} <b>${esc(o.inv_no)}</b></td><td>${fdate(o.date)}</td><td class="n">${tk(o.due)}</td><td class="n">${mode === 'auto' ? `<b>${tk(a)}</b>` : `<input class="inp" style="text-align:right" type="number" step="0.01" min="0" max="${o.due}" data-ai="${i}" value="${a || ''}">`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    $$('[data-ai]', m.el).forEach(inp => inp.oninput = () => { open[+inp.dataset.ai]._a = +inp.value || 0; note(); });
    if (mode === 'manual') open.forEach((o, i) => { const inp = $(`[data-ai="${i}"]`, m.el); o._a = +inp.value || 0; });
    note();
  };
  const note = () => {
    const amt = +$('[name=amount]', m.el).value || 0;
    const alloc = mode === 'auto' ? Math.min(amt, open.reduce((s, o) => s + o.due, 0)) : open.reduce((s, o) => s + (o._a || 0), 0);
    const left = r2(amt - alloc);
    $('#pnote', m.el).className = 'note ' + (left < -0.004 ? 'danger' : '');
    $('#pnote', m.el).innerHTML = left < -0.004 ? 'Allocations exceed the amount received.' : `Allocated <b>${tk(alloc)}</b>${left > 0.004 ? ` · <b>${tk(left)}</b> kept as advance / unallocated credit` : ''} · Total outstanding ${tk(open.reduce((s, o) => s + o.due, 0))}`;
  };
  const load = async () => { open = cust ? await GET(`/api/customers/${cust.id}/open-invoices`) : []; drawAlloc(); };
  custPicker($('#pmc', m.el), { value: cust, onPick: c => { cust = c; load(); } });
  $$('#amode button', m.el).forEach(b => b.onclick = () => { mode = b.dataset.m; open.forEach(o => delete o._a); drawAlloc(); });
  $('[name=amount]', m.el).oninput = () => (mode === 'auto' ? drawAlloc() : note());
  $('[data-x]', m.el).onclick = m.close;
  load();
  $('#pms', m.el).onclick = () => busy($('#pms', m.el), async () => {
    if (!cust) return toast('Select a customer', '', 'warn');
    if (!requireFields(m.el, ['amount'])) return;
    const b = { ...formData($('#pmf', m.el)), customer_id: cust.id, auto: mode === 'auto', allocations: mode === 'manual' ? open.filter(o => o._a > 0).map(o => ({ division: o.division, invoice_id: o.id, amount: o._a })) : [] };
    const r = await POST('/api/payments', b, { idemKey: key });
    toast('Payment recorded', `${r.receipt_no} · ${tk(r.amount)}${r.unallocated > 0 ? ' · ' + tk(r.unallocated) + ' advance' : ''}`); m.close(); done && done(r);
  });
}

/* ---------------- customers ---------------- */
App.pages.customers = {
  title: 'Shared Customer Database',
  async render(v, id) {
    if (id) return this.profile(v, +id);
    const rows = await GET('/api/customers');
    v.innerHTML = `<div class="head"><div class="sub">One customer profile for both CTP and PVC</div>${can('customers.edit') ? `<button class="btn" id="add">${ICON.plus} Add customer</button>` : ''}</div>
      <div class="stats stagger" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><small>Customers</small><b data-count-to="${rows.length}">0</b></div>
      <div class="stat" style="--c:var(--danger)"><small>With due</small><b data-count-to="${rows.filter(r => r.balance > 0.004).length}">0</b><div class="foot">${tk(rows.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0))}</div></div>
      <div class="stat" style="--c:var(--ok)"><small>With advance</small><b data-count-to="${rows.filter(r => r.balance < -0.004).length}">0</b><div class="foot">${tk(-rows.filter(r => r.balance < 0).reduce((s, r) => s + r.balance, 0))}</div></div></div>
      <div class="panel"><div id="ctbl"></div></div>`;
    if ($('#add', v)) $('#add', v).onclick = () => customerModal({}, c => App.go('customers/' + c.id));
    dataTable($('#ctbl', v), rows, [
      { k: 'name', label: 'Customer', f: r => `<div class="row" style="gap:10px;flex-wrap:nowrap"><div class="avatar">${esc(r.name[0])}</div><div><b>${esc(r.name)}</b><div class="sub">${esc(r.company || '')}</div></div></div>` },
      { k: 'phone', label: 'Mobile' }, { k: 'address', label: 'Address', f: r => `<span class="sub">${esc(r.address || '')}</span>` },
      { k: 'ctp_count', label: 'CTP inv', n: 1 }, { k: 'pvc_count', label: 'PVC inv', n: 1 },
      { k: 'balance', label: 'Balance', n: 1, f: r => r.balance > 0.004 ? `<b style="color:var(--danger)">${tk(r.balance)}</b>` : r.balance < -0.004 ? `<b style="color:var(--ok)">${tk(-r.balance)} adv</b>` : tk(0) },
      { k: 'active', label: '', f: r => r.active ? '' : '<span class="tag gray">Inactive</span>' },
    ], { onRow: r => App.go('customers/' + r.id), pageSize: 100 });
  },
  async profile(v, id) {
    const d = await GET('/api/customers/' + id);
    const c = d.customer; $('#title').textContent = c.name;
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="App.go('customers')">← Customers</button><div class="row">
      ${can('customers.edit') ? `<button class="btn ghost" id="cdel" style="color:var(--danger)">${ICON.trash.replace('<svg', '<svg width="14"')} Delete</button><button class="btn ghost" id="ed">Edit</button>` : ''}${can('payments') ? `<button class="btn green" id="pay">${ICON.money} Receive payment</button>` : ''}
      ${can('ctp.invoice') ? `<button class="btn light" id="nci">New CTP invoice</button>` : ''}${can('pvc.invoice') ? `<button class="btn teal" id="npi">New PVC invoice</button>` : ''}${can('general.invoice') ? `<button class="btn ghost" id="ngi">New General job</button>` : ''}</div></div>
      <div class="panel"><div class="cust-head"><div class="cust-av">${esc(c.name[0])}</div><div style="flex:1"><h2 style="font-size:20px">${esc(c.name)}</h2><div class="sub">${esc([c.company, c.contact_person, c.phone, c.address, c.email].filter(Boolean).join(' · '))}</div>${c.remarks ? `<div class="small mt">${esc(c.remarks)}</div>` : ''}</div>
        <div class="tr"><div class="sub">Current balance</div><div class="big-num" style="color:${c.balance > 0 ? 'var(--danger)' : 'var(--ok)'}">${c.balance < 0 ? tk(-c.balance) + ' adv' : tk(c.balance)}</div></div></div></div>
      <div class="stats stagger"><div class="stat"><small>CTP outstanding</small><b>${tk(d.ctp_due)}</b><div class="foot">${d.ctp.filter(i => i.status === 'confirmed').length} invoices</div></div>
        <div class="stat" style="--c:var(--pvc)"><small>PVC outstanding</small><b>${tk(d.pvc_due)}</b><div class="foot">${d.pvc.filter(i => i.status === 'confirmed').length} invoices</div></div>
        ${d.gen && d.gen.length ? `<div class="stat" style="--c:#e8833a"><small>General outstanding</small><b>${tk(d.gen_due)}</b><div class="foot">${d.gen.filter(i => i.status === 'confirmed').length} invoices</div></div>` : ''}
        <div class="stat" style="--c:var(--warn)"><small>Opening balance</small><b>${tk(c.opening_balance)}</b></div>
        <div class="stat" style="--c:var(--ok)"><small>Unallocated credit</small><b>${tk(d.unallocated)}</b><div class="foot">${d.payments.filter(p => !p.voided).length} payments</div></div></div>
      <div class="tabs">${[['ledger', 'Combined Ledger'], ['ctp', 'CTP History'], ['pvc', 'PVC History'], ...(d.gen && d.gen.length ? [['gen', 'General History']] : []), ['pay', 'Payments']].map(([k, l], i) => `<button data-t="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}</div><div id="pane"></div>`;
    const pane = $('#pane', v);
    const tabs = {
      ledger: async () => ledgerView(pane, c.id),
      ctp: () => { pane.innerHTML = `<div class="grid g32"><div class="panel"><div id="t1"></div></div><div class="panel"><h2>Plate-wise purchase</h2><div class="tbl-wrap mt"><table><thead><tr><th>Plate</th><th class="n">Qty</th><th class="n">Amount</th></tr></thead><tbody>${d.ctpItems.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td><td class="n">${tk(i.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No CTP purchases</td></tr>'}</tbody></table></div></div></div>`; invTable($('#t1', pane), d.ctp, 'ctp'); },
      pvc: () => { pane.innerHTML = `<div class="grid g32"><div class="panel"><div id="t1"></div></div><div class="panel"><h2>Media-wise purchase</h2><div class="tbl-wrap mt"><table><thead><tr><th>Media</th><th class="n">Sq ft</th><th class="n">Amount</th></tr></thead><tbody>${d.pvcItems.map(i => `<tr><td>${esc(i.category)} ${+i.width_ft} ft</td><td class="n">${n0(i.sqft)}</td><td class="n">${tk(i.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No PVC purchases</td></tr>'}</tbody></table></div></div></div>`; invTable($('#t1', pane), d.pvc, 'pvc'); },
      gen: () => { pane.innerHTML = '<div class="panel"><div id="t1"></div></div>'; invTable($('#t1', pane), d.gen, 'gen'); },
      pay: () => { pane.innerHTML = '<div class="panel"><div id="t1"></div></div>'; payTable($('#t1', pane), d.payments); },
    };
    const invTable = (el, rows, div) => dataTable(el, rows, [{ k: 'inv_no', label: 'Invoice', f: r => `<b>${esc(r.inv_no || 'Draft #' + r.id)}</b>` }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'grand_total', label: 'Total', n: 1, f: r => tk(r.grand_total) }, { k: 'paid', label: 'Paid', n: 1, f: r => tk(r.paid) }, { k: 'due', label: 'Due', n: 1, f: r => tk(r.due) }, { k: 'status', label: 'Status', f: r => statusTag(r.status) }, { k: 'created_by_name', label: 'Created by' }], { onRow: r => App.go(`${div}-invoices/${r.id}`) });
    $$('[data-t]', v).forEach(b => b.onclick = () => { $$('[data-t]', v).forEach(x => x.classList.toggle('on', x === b)); pane.classList.remove('tabpane'); void pane.offsetWidth; pane.classList.add('tabpane'); tabs[b.dataset.t](); });
    tabs.ledger();
    if ($('#ed', v)) $('#ed', v).onclick = () => customerModal(c, () => App.refresh());
    if ($('#cdel', v)) $('#cdel', v).onclick = () => masterDelete('/api/customers/' + c.id, c.name, () => App.go('customers'));
    if ($('#ngi', v)) $('#ngi', v).onclick = () => { App.pages.general.prefill = { customer: c }; App.go('general/new'); };
    if ($('#pay', v)) $('#pay', v).onclick = () => paymentModal({ customer: c }, () => App.refresh());
    if ($('#nci', v)) $('#nci', v).onclick = () => { App.pages['ctp-invoices'].prefill = { customer: c }; App.go('ctp-invoices/new'); };
    if ($('#npi', v)) $('#npi', v).onclick = () => { App.pages['pvc-invoices'].prefill = { customer: c }; App.go('pvc-invoices/new'); };
  },
};
function payTable(el, rows) {
  rows.forEach(r => { if (r.voided) r._cls = 'void'; });
  return dataTable(el, rows, [
    { k: 'receipt_no', label: 'Receipt', f: r => `<b>${esc(r.receipt_no)}</b>` }, { k: 'date', label: 'Date', f: r => fdate(r.date) }, ...(rows[0]?.customer ? [{ k: 'customer', label: 'Customer' }] : []),
    { k: 'amount', label: 'Amount', n: 1, f: r => `<b>${tk(r.amount)}</b>`, total: d => tk(d.filter(r => !r.voided).reduce((s, r) => s + r.amount, 0)) }, { k: 'method', label: 'Method', f: r => `${esc(r.method)}<div class="sub">${esc(r.reference || '')}</div>` },
    { k: 'invoices', label: 'Allocated to', f: r => `<span class="sub">${esc(r.invoices || '')}</span>${r.amount - r.allocated > 0.004 && !r.voided ? ` <span class="tag green">${tk(r.amount - r.allocated)} unallocated</span>` : ''}` },
    { k: 'created_by_name', label: 'Recorded by', f: r => `${esc(r.created_by_name)}<div class="sub">${fdt(r.created_at)}</div>` },
    { k: 'x', label: '', sort: false, f: r => r.voided ? `<span class="tag red">Voided</span>` : `${r.amount - r.allocated > 0.004 && can('payments') ? `<button class="btn xs light" data-alloc="${r.id}">Allocate</button> ` : ''}${can('invoice.cancel') ? `<button class="btn xs ghost" data-pvoid="${r.id}">Void</button>` : ''}` },
  ], { totals: true, id: 'pay-t' }) && (el.onclick = async e => {
    const a = e.target.closest('[data-alloc]'), vd = e.target.closest('[data-pvoid]');
    if (a) { try { const r = await POST(`/api/payments/${a.dataset.alloc}/allocate`, {}); toast('Allocated', r.allocated.length ? r.allocated.length + ' invoice(s)' : 'No open invoices'); App.refresh(); } catch (er) { fail(er); } }
    if (vd) { const reason = await confirmBox('Void payment?', 'The payment and its allocations will no longer count. The record stays in history.', { ok: 'Void payment', danger: true, input: 'Reason' }); if (reason) { try { await POST(`/api/payments/${vd.dataset.pvoid}/void`, { reason }); toast('Payment voided'); App.refresh(); } catch (er) { fail(er); } } }
  });
}
async function ledgerView(el, customerId, f = {}) {
  const from = f.from || '', to = f.to || '', division = f.division || 'all';
  const d = await GET(`/api/customers/${customerId}/ledger`, { from, to, division });
  el.innerHTML = `<div class="panel"><div class="head"><div><h2>Customer ledger — ${esc(d.customer.name)}</h2><div class="sub">Combined CTP + PVC · debit = invoice, credit = payment / cancellation</div></div>
    <div class="row"><div class="seg" id="ldv">${['all', 'ctp', 'pvc', 'gen'].map(x => `<button type="button" data-d="${x}" class="${x === division ? 'on' : ''}">${x === 'all' ? 'All' : x === 'gen' ? 'General' : x.toUpperCase()}</button>`).join('')}</div>
    <input type="date" class="inp" id="lf" value="${from}" style="width:150px"><input type="date" class="inp" id="lt" value="${to}" style="width:150px"><button class="btn sm" id="lgo">Apply</button><button class="btn sm ghost" id="lpr">${ICON.print}</button><button class="btn sm ghost" id="lx">${ICON.excel}</button></div></div>
    <div class="tbl-wrap"><table id="ledt"><thead><tr><th>Date</th><th>Division</th><th>Type</th><th>Ref</th><th>Narration</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>
    <tr><td colspan="7"><b>Opening balance</b></td><td class="n"><b>${tk(d.opening)}</b></td></tr>
    ${d.rows.map((r, i) => `<tr class="rowin" style="animation-delay:${Math.min(i, 20) * 15}ms"><td>${fdate(r.date)}</td><td>${divTag(r.division)}</td><td>${esc(r.type)}</td><td><a href="#/${r.type === 'Payment' ? 'accounts' : r.division + '-invoices/' + r.ref_id}">${esc(r.ref || '')}</a></td><td class="sub">${esc(r.narration)}</td>
      <td class="n">${r.debit ? tk(r.debit) : ''}</td><td class="n">${r.credit ? tk(r.credit) : ''}</td><td class="n"><b>${tk(r.balance)}</b></td></tr>`).join('')}
    </tbody><tfoot><tr class="total"><td colspan="5">Closing balance</td><td class="n">${tk(d.rows.reduce((s, r) => s + r.debit, 0))}</td><td class="n">${tk(d.rows.reduce((s, r) => s + r.credit, 0))}</td><td class="n">${tk(d.closing)}</td></tr></tfoot></table></div></div>`;
  let div = division;
  $$('#ldv button', el).forEach(b => b.onclick = () => { div = b.dataset.d; $$('#ldv button', el).forEach(x => x.classList.toggle('on', x === b)); });
  $('#lgo', el).onclick = () => ledgerView(el, customerId, { from: $('#lf', el).value, to: $('#lt', el).value, division: div });
  $('#lpr', el).onclick = () => printHTML(`<div class="doc rpt-print">${companyHeader(`<div style="text-align:right"><div class="doc-title">CUSTOMER LEDGER</div><div class="mt"><b>${esc(d.customer.name)}</b></div><div class="muted">${from ? fdate(from) : 'Beginning'} – ${to ? fdate(to) : fdate(App.today)} · ${division.toUpperCase()}</div></div>`)}${$('#ledt', el).outerHTML}</div>`);
  $('#lx', el).onclick = () => exportXlsx('Ledger ' + d.customer.name, [`Division: ${division}`, `Period: ${from || 'beginning'} to ${to || App.today}`], [tableToSheet('Ledger', $('#ledt', el))]);
}

/* ---------------- accounts ---------------- */
App.pages.accounts = {
  title: 'Accounts & Ledger', tab: 'overview',
  async render(v, sub) {
    if (sub === 'pay') { history.replaceState(null, '', '#/accounts'); setTimeout(() => paymentModal({}, () => App.refresh()), 60); }
    else if (sub) this.tab = sub;
    const [from, to] = this.range || periodRange('month');
    const s = await GET('/api/accounts/summary', { from, to });
    const R = s.receivables;
    v.innerHTML = `<div class="head"><div class="row">${periodChips(this.p || 'month', ['today', 'week', 'month', 'year'])}</div>${can('payments') ? `<button class="btn green" id="rp">${ICON.money} Receive payment</button>` : ''}</div>
      <div class="stats stagger"><div class="stat"><small>CTP outstanding</small><b data-count-to="${R.ctp_due}" data-fmt="tk">0</b><div class="foot">Unpaid CTP invoices</div></div>
        <div class="stat" style="--c:var(--pvc)"><small>PVC outstanding</small><b data-count-to="${R.pvc_due}" data-fmt="tk">0</b><div class="foot">Unpaid PVC invoices</div></div>
        <div class="stat" style="--c:var(--danger)"><small>Combined due</small><b data-count-to="${R.combined_due}" data-fmt="tk">0</b><div class="foot">incl. opening ${tk(R.opening)} − advances</div></div>
        <div class="stat" style="--c:var(--ok)"><small>Collected (period)</small><b data-count-to="${s.collection.total}" data-fmt="tk">0</b><div class="foot">CTP ${tk(s.collection.ctp)} · PVC ${tk(s.collection.pvc)}</div></div></div>
      <div class="tabs">${[['overview', 'Outstanding'], ['payments', 'Payments'], ['ledger', 'Customer Ledger']].map(([k, l]) => `<button data-t="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pane" class="tabpane"></div>`;
    $$('[data-period]', v).forEach(b => b.onclick = () => { this.p = b.dataset.period; this.range = periodRange(this.p); App.refresh(); });
    if ($('#rp', v)) $('#rp', v).onclick = () => paymentModal({}, () => App.refresh());
    $$('[data-t]', v).forEach(b => b.onclick = () => { this.tab = b.dataset.t; App.refresh(); });
    const pane = $('#pane', v);
    if (this.tab === 'overview') {
      pane.innerHTML = `<div class="grid g32"><div class="panel"><div class="head"><h2>Customers with due</h2></div><div id="t1"></div></div><div class="panel"><div class="head"><h2>Advance / credit holders</h2></div><div id="t2"></div></div></div>`;
      dataTable($('#t1', pane), s.customers, [{ k: 'name', label: 'Customer' }, { k: 'phone', label: 'Mobile' }, { k: 'balance', label: 'Due', n: 1, f: r => `<b style="color:var(--danger)">${tk(r.balance)}</b>`, total: d => tk(d.reduce((a, r) => a + r.balance, 0)) }, { k: 'x', label: '', sort: false, f: r => can('payments') ? `<button class="btn xs green" data-p="${r.id}">Receive</button>` : '' }], { onRow: r => App.go('customers/' + r.id), totals: true, empty: 'No dues 🎉' });
      dataTable($('#t2', pane), s.advances, [{ k: 'name', label: 'Customer' }, { k: 'balance', label: 'Credit', n: 1, f: r => `<b style="color:var(--ok)">${tk(-r.balance)}</b>` }], { search: false, onRow: r => App.go('customers/' + r.id), empty: 'No advances' });
      pane.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { e.stopPropagation(); const c = s.customers.find(x => x.id === +b.dataset.p); paymentModal({ customer: c }, () => App.refresh()); } }, true);
    } else if (this.tab === 'payments') {
      pane.innerHTML = `<div class="panel"><div class="head"><div class="sub">${fdate(from)} → ${fdate(to)}</div><button class="btn sm ghost" id="px">${ICON.excel} Excel</button></div><div id="t1"></div></div>`;
      payTable($('#t1', pane), await GET('/api/payments', { from, to }));
      $('#px', pane).onclick = () => exportXlsx('Payments', [`${fdate(from)} to ${fdate(to)}`], [tableToSheet('Payments', $('#pay-t', pane))]);
    } else {
      pane.innerHTML = `<div class="panel"><div class="field" style="max-width:420px">Customer<div id="lc"></div></div></div><div id="lv"></div>`;
      custPicker($('#lc', pane), { allowAdd: false, onPick: c => c ? ledgerView($('#lv', pane), c.id) : ($('#lv', pane).innerHTML = '') });
    }
  },
};

/* ---------------- expenses ---------------- */
App.pages.expenses = {
  title: 'Business Expenses',
  async render(v) {
    const [from, to] = this.range || periodRange('month');
    const rows = await GET('/api/expenses', { from, to });
    const live = rows.filter(r => !r.voided);
    const byDiv = d => live.filter(r => r.division === d).reduce((s, r) => s + r.amount, 0);
    v.innerHTML = `<div class="grid g23 mb"><div class="panel"><div class="head"><div><h2>Add expense</h2><div class="sub">Reported separately from sales revenue</div></div></div>
      <div class="form f2" id="xf">${field('Date', dateInput())}${field('Category <span class="req">*</span>', `<input name="category" list="xcats" placeholder="Choose or type">`)}
        ${field('Amount (৳) <span class="req">*</span>', `<input type="number" step="0.01" name="amount">`)}${field('Payment method', `<select name="method">${App.meta.payment_methods.map(p => opt(p, p)).join('')}</select>`)}
        ${field('Division', `<select name="division"><option value="common">Common</option><option value="ctp">CTP</option><option value="pvc">PVC</option></select>`)}${field('Description', `<input name="description">`)}</div>
      <datalist id="xcats">${App.meta.expense_categories.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="actions"><button class="btn" id="xs">Save expense</button></div></div>
      <div class="panel"><div class="head"><h2>Period total</h2>${periodChips(this.p || 'month', ['month', 'year'])}</div><div class="big-num" data-count-to="${live.reduce((s, r) => s + r.amount, 0)}" data-fmt="tk">0</div>
        <div class="kv mt"><span>CTP</span><b>${tk(byDiv('ctp'))}</b><span>PVC</span><b>${tk(byDiv('pvc'))}</b><span>Common</span><b>${tk(byDiv('common'))}</b></div></div></div>
      <div class="panel"><div id="xt"></div></div>`;
    const key = uid();
    $('#xs', v).onclick = () => busy($('#xs', v), async () => { if (!requireFields(v, ['category', 'amount'])) return; await POST('/api/expenses', formData($('#xf', v)), { idemKey: key }); toast('Expense saved'); App.refresh(); });
    $$('[data-period]', v).forEach(b => b.onclick = () => { this.p = b.dataset.period; this.range = periodRange(this.p); App.refresh(); });
    rows.forEach(r => { if (r.voided) r._cls = 'void'; });
    dataTable($('#xt', v), rows, [{ k: 'date', label: 'Date', f: r => fdate(r.date) }, { k: 'category', label: 'Category' }, { k: 'division', label: 'Division', f: r => divTag(r.division) }, { k: 'description', label: 'Description' }, { k: 'method', label: 'Method' },
      { k: 'amount', label: 'Amount', n: 1, f: r => tk(r.amount), total: d => tk(d.filter(r => !r.voided).reduce((s, r) => s + r.amount, 0)) }, { k: 'created_by_name', label: 'By' },
      { k: 'x', label: '', sort: false, f: r => !r.voided ? `<button class="btn xs ghost" data-xv="${r.id}">Void</button>` : '<span class="tag red">Voided</span>' }], { totals: true });
    v.onclick = async e => { const b = e.target.closest('[data-xv]'); if (!b) return; const reason = await confirmBox('Void expense?', 'It will be excluded from totals.', { ok: 'Void', danger: true, input: 'Reason' }); if (reason) { await POST(`/api/expenses/${b.dataset.xv}/void`, { reason }).catch(fail); App.refresh(); } };
  },
};
