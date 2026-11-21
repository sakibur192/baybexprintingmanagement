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
