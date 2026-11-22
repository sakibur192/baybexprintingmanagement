/* Section daily / custom report — Printing Press, PVC, CTP, Internal Inventory, Daily Cash.
   Pick a section and a period (today, yesterday, this week, this month, last month or custom),
   then print it directly, save it as PDF, or download Excel / CSV. */
'use strict';
const SREP = [
  { key: 'press', label: 'Printing Press', perm: ['press.view', 'press.orders', 'press.store', 'press.invoice'] },
  { key: 'pvc', label: 'PVC / Media', perm: ['pvc.view', 'pvc.invoice', 'pvc.print'] },
  { key: 'ctp', label: 'CTP', perm: ['ctp.view', 'ctp.invoice'] },
  { key: 'internal', label: 'Internal Inventory', perm: ['internal'] },
  { key: 'accounts', label: 'Daily Cash (all sections)', perm: ['accounts.view', 'payments'], always: true },
];
const srepAllowed = () => {
  const { order } = secCfg(), pos = k => { const i = order.indexOf(k); return i < 0 ? 99 : i; };
  return SREP.filter(s => (s.always || secOn(s.key)) && can('reports') && can(...s.perm)).sort((a, b) => (a.always ? 98 : pos(a.key)) - (b.always ? 98 : pos(b.key)));
};
function srepRange(p) {
  const t = App.today, dow = new Date(t + 'T00:00:00Z').getUTCDay();   // 0 Sun … 6 Sat — Bangladesh week starts Saturday
  const mStart = t.slice(0, 8) + '01', lmEnd = addDays(mStart, -1), lmStart = lmEnd.slice(0, 8) + '01';
  return { today: [t, t], yesterday: [addDays(t, -1), addDays(t, -1)], week: [addDays(t, -((dow + 1) % 7)), t], month: [mStart, t], lastmonth: [lmStart, lmEnd] }[p];
}
const SREP_PERIODS = [['today', 'Today', 'আজ'], ['yesterday', 'Yesterday', 'গতকাল'], ['week', 'This week', 'এই সপ্তাহ'], ['month', 'This month', 'এই মাস'], ['lastmonth', 'Last month', 'গত মাস'], ['custom', 'Custom', 'তারিখ বাছুন']];
const srepStatus = v => ({ confirmed: 'Confirmed', cancelled: 'Cancelled', final: 'Final', void: 'Void', void_requested: 'Void requested', active: 'Active', pending: 'Pending', in_production: 'In production', ready: 'Ready', partial_delivery: 'Partly delivered', delivered: 'Delivered', invoiced: 'Invoiced', draft: 'Draft' }[v] || v);
function srepCell(col, v) {
  if (v == null || v === '') return '';
  if (col.money) return nf2.format(+v || 0);
  if (col.n) return (Math.round((+v || 0) * 1000) / 1000).toLocaleString('en-IN');
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v)) && /date|deadline/.test(col.k)) return fdate(String(v).slice(0, 10));
  if (col.k === 'status') return esc(srepStatus(v));
  return esc(v);
}
function srepTableHTML(t, forPrint) {
  const tot = t.columns.some(c => c.total) && t.rows.length > 1;
  return `<table data-sheet="${esc(t.title.slice(0, 30))}"><thead><tr>${t.columns.map(c => `<th class="${c.n ? 'n' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${t.rows.map(r => `<tr>${t.columns.map(c => `<td class="${c.n ? 'n' : ''}" style="${/date|_no$|^inv_no$|^dc_no$/.test(c.k) ? 'white-space:nowrap' : ''}${r.status === 'cancelled' || r.status === 'void' ? ';color:#999' : ''}">${srepCell(c, r[c.k])}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${t.columns.length}" class="${forPrint ? '' : 'empty'}" style="text-align:center;color:#888">No entries in this period</td></tr>`}</tbody>
    ${tot ? `<tfoot><tr>${t.columns.map((c, i) => `<th class="${c.n ? 'n' : ''}">${c.total ? srepCell(c, t.rows.reduce((a, r) => a + (+r[c.k] || 0), 0)) : i === 0 ? 'Total' : ''}</th>`).join('')}</tr></tfoot>` : ''}</table>`;
}
const srepSumHTML = r => `<div class="srep-sum">${r.summary.map(([l, v, kind]) => `<div><small>${esc(l)}</small><b>${kind === 'money' ? tk(v) : (+v || 0).toLocaleString('en-IN')}</b></div>`).join('')}</div>`;
const srepPeriodText = r => r.from === r.to ? fdate(r.from) : `${fdate(r.from)} – ${fdate(r.to)}`;

App.pages['section-report'] = {
  title: 'Section Report',
  st: null,
  async render(v, sec) {
    const allowed = srepAllowed();
    if (!allowed.length) { v.innerHTML = `<div class="panel"><div class="empty">${ICON.shield}You do not have access to any section report.</div></div>`; return; }
    const st = this.st = this.st || { period: 'today', from: App.today, to: App.today };
    const S = allowed.find(x => x.key === sec) || allowed[0];
    if (sec !== S.key) { history.replaceState(null, '', '#/section-report/' + S.key); }
    if (st.period !== 'custom') [st.from, st.to] = srepRange(st.period);
    $('#title').textContent = `${S.label} Report`;
    v.innerHTML = `${helpTip('srep', '<b>সেকশন রিপোর্ট:</b> উপরে সেকশন ও সময় বাছুন (আজ, গতকাল, এই মাস বা নিজের তারিখ)। তারপর <b>Print</b> চাপলে সরাসরি প্রিন্ট, <b>Excel</b> বা <b>CSV</b> চাপলে ফাইল সেভ হবে।')}
      <div class="panel" style="padding:12px 16px"><div class="row" style="flex-wrap:wrap;gap:6px">${allowed.map(x => `<button class="btn sm ${x.key === S.key ? '' : 'ghost'}" data-sec="${x.key}">${esc(x.label)}</button>`).join('')}</div>
        <div class="row mt" style="flex-wrap:wrap;gap:6px;align-items:center">${SREP_PERIODS.map(([k, l, bn]) => `<button class="btn sm ${st.period === k ? 'green' : 'ghost'}" data-p="${k}" title="${bn}">${l}</button>`).join('')}
          <span class="row ${st.period === 'custom' ? '' : 'hide'}" id="src" style="gap:6px"><input type="date" class="inp" id="srf" value="${st.from}" max="${App.today}"><span>→</span><input type="date" class="inp" id="srt" value="${st.to}" max="${App.today}"><button class="btn sm" id="srgo">Show</button></span>
          <span class="right row" style="gap:6px"><button class="btn sm" id="srprint">${ICON.print} Print</button><button class="btn sm ghost" id="srpdf">${ICON.doc} PDF</button><button class="btn sm ghost" id="srxl">${ICON.excel} Excel</button><button class="btn sm ghost" id="srcsv">CSV</button></span></div></div>
      <div id="srbody"><div class="sk" style="height:220px"></div></div>`;
    $$('[data-sec]', v).forEach(b => b.onclick = () => App.go('section-report/' + b.dataset.sec));
    $$('[data-p]', v).forEach(b => b.onclick = () => { st.period = b.dataset.p; if (st.period === 'custom') { $('#src', v).classList.remove('hide'); $$('[data-p]', v).forEach(x => x.className = `btn sm ${x === b ? 'green' : 'ghost'}`); return; } App.refresh(); });
    $('#srgo', v).onclick = () => { const f = $('#srf', v).value, t = $('#srt', v).value; if (!f || !t) return toast('Pick both dates', '', 'warn'); if (f > t) return toast('"From" is after "To"', '', 'warn'); Object.assign(st, { from: f, to: t }); App.refresh(); };
    let r;
    try { r = await GET('/api/section-report/' + S.key, { from: st.from, to: st.to }); } catch (e) { $('#srbody', v).innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; return; }
    if (!v.isConnected) return;
    this.r = r;
    $('#srbody', v).innerHTML = `<div class="panel"><div class="head"><div><h2>${esc(r.title)} — ${srepPeriodText(r)}</h2><div class="sub">${SREP_PERIODS.find(p => p[0] === st.period)?.[1] || ''} · prepared by ${esc(r.generated_by)}</div></div></div>${srepSumHTML(r)}</div>
      ${r.tables.map(t => `<div class="panel"><div class="head"><h2>${esc(t.title)}</h2><span class="sub">${t.rows.length} ${t.rows.length === 1 ? 'entry' : 'entries'}</span></div><div class="tbl-wrap">${srepTableHTML(t)}</div></div>`).join('')}`;
    $('#srprint', v).onclick = () => this.print();
    $('#srpdf', v).onclick = () => { toast('Choose “Save as PDF” in the print dialog', '', 'info'); this.print(); };
    $('#srxl', v).onclick = () => this.excel();
    $('#srcsv', v).onclick = () => this.csv();
  },
  fileName(r) { return `${r.title} report ${r.from === r.to ? r.from : r.from + ' to ' + r.to}`.replace(/[^\w\- ]+/g, ''); },
  print() {
    const r = this.r; if (!r) return;
    const used = r.tables.filter(t => t.rows.length), empty = r.tables.filter(t => !t.rows.length);
    printHTML(`<div class="doc rpt-print" style="max-width:none">${companyHeader(`<div style="text-align:right"><div class="doc-title">${esc(r.title.toUpperCase())} REPORT</div><div class="mt"><b>${srepPeriodText(r)}</b></div><div class="muted" style="font-size:11px">Printed ${fdt(new Date().toISOString())} · ${esc(r.generated_by)}</div></div>`)}
      ${srepSumHTML(r)}${used.map(t => `<h3 class="srep-h">${esc(t.title)}</h3>${srepTableHTML(t, true)}`).join('')}
      ${empty.length ? `<div class="muted" style="margin-top:10px;font-size:11px">No entries in this period: ${empty.map(t => esc(t.title)).join(', ')}</div>` : ''}
      <div class="sign" style="margin-top:40px"><div>Prepared by</div><div>Checked by</div><div>Authorized signature</div></div></div>`, { size: 'A4' });
  },
  excel() {
    const r = this.r; if (!r) return;
    const sheets = [{ name: 'Summary', columns: [{ key: 'label', label: 'Item' }, { key: 'value', label: 'Value' }], rows: r.summary.map(([l, v]) => ({ label: l, value: +v || 0 })) },
      ...r.tables.map(t => {
        const rows = t.rows.map(x => Object.fromEntries(t.columns.map(c => [c.k, c.n ? +x[c.k] || 0 : c.k === 'status' ? srepStatus(x[c.k]) : /date|deadline/.test(c.k) && x[c.k] ? fdate(String(x[c.k]).slice(0, 10)) : x[c.k] ?? ''])));
        if (rows.length > 1 && t.columns.some(c => c.total)) rows.push({ ...Object.fromEntries(t.columns.map((c, i) => [c.k, c.total ? Math.round(t.rows.reduce((a, x) => a + (+x[c.k] || 0), 0) * 1000) / 1000 : i === 0 ? 'Total' : ''])), _total: true });
        return { name: t.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), columns: t.columns.map(c => ({ key: c.k, label: c.label, num: !!c.money })), rows };
      })];
    exportXlsx(this.fileName(r), [`Section: ${r.title}`, `Period: ${srepPeriodText(r)}`, `Prepared by: ${r.generated_by}`], sheets);
  },
  csv() {
    const r = this.r; if (!r) return;
    const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`, lines = [];
    lines.push(q(App.meta.settings.company?.name || ''), q(`${r.title} report`), q(srepPeriodText(r)), '');
    lines.push(q('SUMMARY')); r.summary.forEach(([l, v]) => lines.push([q(l), +v || 0].join(','))); lines.push('');
    for (const t of r.tables) {
      lines.push(q(t.title.toUpperCase()));
      lines.push(t.columns.map(c => q(c.label)).join(','));
      t.rows.forEach(x => lines.push(t.columns.map(c => c.n ? (+x[c.k] || 0) : q(c.k === 'status' ? srepStatus(x[c.k]) : /date|deadline/.test(c.k) && x[c.k] ? String(x[c.k]).slice(0, 10) : x[c.k])).join(',')));
      if (!t.rows.length) lines.push(q('No entries'));
      else if (t.rows.length > 1 && t.columns.some(c => c.total)) lines.push(t.columns.map((c, i) => c.total ? Math.round(t.rows.reduce((a, x) => a + (+x[c.k] || 0), 0) * 1000) / 1000 : i === 0 ? q('Total') : '').join(','));
      lines.push('');
    }
    saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), this.fileName(r) + '.csv');
    toast('CSV saved', this.fileName(r));
  },
};
