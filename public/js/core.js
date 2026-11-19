/* Baybex Printers Manager — core: api, router, shell, components */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const tk = v => '৳ ' + nf2.format(+v || 0);
const n0 = v => nf0.format(+v || 0);
const r2 = n => Math.round((+n || 0) * 100) / 100;
const fdate = d => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}`; };
const fdt = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
const debounce = (fn, ms = 220) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const monthStart = d => d.slice(0, 8) + '01';
const monthEnd = d => { const x = new Date(d.slice(0, 7) + '-01T00:00:00'); x.setMonth(x.getMonth() + 1); x.setDate(0); return x.toISOString().slice(0, 10); };
const TYPE_LABEL = { opening: 'Opening Stock', production: 'Production', stock_in: 'Stock In', adj_in: 'Adjustment In', sale: 'Sale', own_use: 'Own Use', adj_out: 'Adjustment Out', challan_out: 'Standalone Delivery', print: 'Printed', wastage: 'Wastage' };

/* ---------------- icons ---------------- */
const I = (p, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;
const ICON = {
  layers: I('<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/><path d="m2 18 10 5 10-5" opacity=".5"/>'),
  box: I('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  trash: I('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  dash: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  plate: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>'),
  invoice: I('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
  truck: I('<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  own: I('<path d="M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.6 6.5 19.5l1-6.3L3 8.9 9 8z"/>'),
  roll: I('<ellipse cx="6" cy="12" rx="3" ry="7"/><path d="M6 5h12a3 7 0 0 1 0 14H6"/><path d="M18 12h3"/>'),
  print: I('<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  users: I('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
  money: I('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  chart: I('<path d="M3 3v18h18"/><path d="M7 15l4-5 4 3 5-7"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  menu: I('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  ink: I('<path d="M12 2.7S5 10 5 14.5a7 7 0 0 0 14 0C19 10 12 2.7 12 2.7z"/>'),
  waste: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  ledger: I('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/>'),
  shield: I('<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  key: I('<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>'),
  box: I('<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/>'),
  doc: I('<path d="M14 2H6v20h12V6z"/><path d="M14 2v4h4"/>'),
  excel: I('<path d="M14 2H6v20h12V6z"/><path d="M14 2v4h4M9 11l4 6M13 11l-4 6"/>'),
  backup: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>'),
  check: I('<path d="M20 6L9 17l-5-5"/>'),
  x: I('<path d="M18 6L6 18M6 6l12 12"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  expense: I('<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  phone: I('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  register: I('<path d="M4 3h16v18H4z"/><path d="M4 8h16M9 3v18"/>'),
};

/* ---------------- api ---------------- */
let pending = 0;
function loading(on) {
  pending += on ? 1 : -1;
  const l = $('#loader'); if (!l) return;
  if (pending > 0) { l.style.opacity = 1; l.style.width = '70%'; }
  else { l.style.width = '100%'; setTimeout(() => { if (pending <= 0) { l.style.opacity = 0; setTimeout(() => (l.style.width = 0), 400); } }, 200); }
}
async function api(method, url, body, opts = {}) {
  loading(true);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (method === 'POST' && opts.idem !== false) headers['X-Idempotency-Key'] = opts.idemKey || uid();
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    if (opts.raw) { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed'); return r; }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.includes('/login')) { if (window.onAuthLost) window.onAuthLost(); else { App.user = null; App.renderLogin(); } throw Object.assign(new Error('Session expired. Please log in again.'), { silent: true }); }
    if (r.status === 402 && data.code === 'SUBSCRIPTION_EXPIRED' && window.App && App.user) { App.locked(data.error); throw Object.assign(new Error(data.error), { silent: true }); }
    if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: r.status, data });
    return data;
  } finally { loading(false); }
}
const GET = (u, p) => api('GET', p ? u + '?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null)) : u);
const POST = (u, b, o) => api('POST', u, b, o);
const PUT = (u, b) => api('PUT', u, b);
const DEL = u => api('DELETE', u);

/* ---------------- toast / modal / dialogs ---------------- */
function toast(title, msg = '', type = 'ok') {
  const c = { ok: '#1d9b6c', err: '#d9475a', warn: '#e08a2e', info: '#2a7fd0' }[type];
  const ic = { ok: '✓', err: '!', warn: '!', info: 'i' }[type];
  const t = document.createElement('div');
  t.className = 'toast'; t.style.setProperty('--c', c);
  t.innerHTML = `<div class="ti">${ic}</div><div><b>${esc(title)}</b>${msg ? `<small>${esc(msg)}</small>` : ''}</div>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 6000 : 3500);
}
const fail = e => { if (!e.silent) toast('Could not complete', e.message, 'err'); };
function modal({ title, body = '', size = '', onOpen, icon = '' }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${size}" role="dialog"><div class="modal-h">${icon}<h3>${esc(title)}</h3><button class="x" aria-label="Close">×</button></div><div class="modal-b">${body}</div></div>`;
  document.body.appendChild(bg);
  const close = () => { bg.classList.add('closing'); setTimeout(() => bg.remove(), 180); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  $('.x', bg).onclick = close;
  const m = { el: $('.modal-b', bg), root: bg, close };
  if (onOpen) onOpen(m);
  setTimeout(() => { const f = $('input:not([type=hidden]):not([readonly]),select,textarea', m.el); f && f.focus(); }, 60);
  return m;
}
function confirmBox(title, text, { ok = 'Confirm', danger = false, input = null } = {}) {
  return new Promise(res => {
    const m = modal({
      title, size: 'narrow', body: `<p style="margin:0 0 14px;color:var(--ink2)">${text}</p>
      ${input ? `<label class="field">${esc(input)}<textarea id="cb-in" rows="3"></textarea></label>` : ''}
      <div class="actions"><button class="btn ghost" id="cb-no">Back</button><button class="btn ${danger ? 'danger' : ''}" id="cb-ok">${esc(ok)}</button></div>`,
    });
    let done = false;
    $('#cb-no', m.el).onclick = () => { done = true; m.close(); res(null); };
    $('#cb-ok', m.el).onclick = () => {
      const v = input ? $('#cb-in', m.el).value.trim() : true;
      if (input && !v) { $('#cb-in', m.el).closest('.field').classList.add('invalid'); return; }
      done = true; m.close(); res(v);
    };
    const obs = new MutationObserver(() => { if (!document.body.contains(m.root)) { obs.disconnect(); if (!done) res(null); } });
    obs.observe(document.body, { childList: true });
  });
}
/* button busy state + ripple */
async function busy(btn, fn) {
  if (btn.disabled) return;
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${btn.dataset.busy || 'Saving…'}`;
  try { return await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; btn.innerHTML = html; }
}
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn,.qa'); if (!b) return;
  const r = b.getBoundingClientRect(), s = document.createElement('span'), d = Math.max(r.width, r.height);
  s.className = 'ripple'; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s); setTimeout(() => s.remove(), 600);
});

/* ---------------- form helpers ---------------- */
function formData(root) {
  const o = {};
  $$('[name]', root).forEach(el => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  });
  return o;
}
function requireFields(root, names) {
  let ok = true;
  for (const n of names) {
    const el = $(`[name="${n}"]`, root); if (!el) continue;
    const f = el.closest('.field');
    if (!String(el.value).trim()) { ok = false; f && f.classList.remove('invalid'); void (f && f.offsetWidth); f && f.classList.add('invalid'); }
    else f && f.classList.remove('invalid');
  }
  if (!ok) toast('Please fill the required fields', '', 'warn');
  return ok;
}
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
const productOptions = sel => App.meta.products.filter(p => p.active || String(p.id) === String(sel)).map(p => opt(p.id, p.name + (p.active ? '' : ' (inactive)'), sel)).join('');
const mediaOptions = (sel, all = false) => {
  const groups = {};
  App.meta.media.filter(m => all || m.active).forEach(m => (groups[m.category] = groups[m.category] || []).push(m));
  return Object.entries(groups).map(([g, ms]) => `<optgroup label="${esc(g)}">${ms.map(m => opt(m.id, `${m.category} · ${+m.width_ft} ft`, sel)).join('')}</optgroup>`).join('');
};
const mediaName = m => m ? `${m.category} ${+m.width_ft} ft` : '';
const field = (label, inner, cls = '', hint = '') => `<label class="field ${cls}">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}${inner}</label>`;
const can = (...p) => p.some(x => App.user.perms.includes(x));
const dateInput = (name = 'date', val) => `<input type="date" name="${name}" value="${val || App.today}" ${can('date.edit') ? '' : 'readonly title="Back-dating requires permission"'}>`;

/** delete a master-list entry (plate, media, item, customer). Never used for transaction records. */
async function masterDelete(url, name, after) {
  const ok = await confirmBox('Delete ' + (name || 'this item') + '?', 'If it was never used it is removed completely. If it has past entries, those stay exactly as they are and it is only hidden from lists. Stock must be zero first.', { ok: 'Delete', danger: true });
  if (!ok) return;
  try { const r = await api('DELETE', url, null, { idem: false }); toast('Deleted', r.archived ? 'Hidden from lists · history kept' : name || ''); await App.loadMeta(); after ? after() : App.refresh(); } catch (e) { fail(e); }
}
/* ---------------- customer autocomplete ---------------- */
function custPicker(container, { onPick, value = null, allowAdd = true, placeholder = 'Type customer name, phone or company…' } = {}) {
  let picked = value, items = [], idx = -1, list = null;
  const render = () => {
    if (picked) {
      container.innerHTML = `<div class="ac-picked"><span class="avatar" style="width:26px;height:26px;font-size:11px">${esc(picked.name[0] || '?')}</span>
        <div><div>${esc(picked.name)}</div><small>${esc([picked.company, picked.phone].filter(Boolean).join(' · '))}</small></div><button type="button" title="Change">×</button></div>`;
      $('button', container).onclick = () => { picked = null; onPick && onPick(null); render(); $('input', container).focus(); };
      return;
    }
    container.innerHTML = `<div class="ac"><input class="inp" placeholder="${esc(placeholder)}" autocomplete="off"></div>`;
    const inp = $('input', container), ac = $('.ac', container);
    const close = () => { list && list.remove(); list = null; idx = -1; };
    const hl = (t, s) => { if (!s) return esc(t); const i = t.toLowerCase().indexOf(s.toLowerCase()); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + s.length)) + '</mark>' + esc(t.slice(i + s.length)); };
    const show = () => {
      close(); list = document.createElement('div'); list.className = 'ac-list';
      const s = inp.value.trim();
      list.innerHTML = items.length ? items.map((c, i) => `<div class="ac-item ${i === idx ? 'on' : ''}" data-i="${i}"><span>${hl(c.name, s)}${c.company ? ` <small>· ${hl(c.company, s)}</small>` : ''}</span><small>${hl(c.phone || '', s)}</small></div>`).join('')
        : `<div class="ac-empty"><span>No matching customer</span>${allowAdd && can('customers.edit') ? `<button type="button" class="btn xs" id="ac-add">+ Add New Customer</button>` : ''}</div>`;
      if (items.length && allowAdd && can('customers.edit') && s) list.insertAdjacentHTML('beforeend', `<div class="ac-empty" style="border-top:1px solid var(--line)"><small>Not in list?</small><button type="button" class="btn xs light" id="ac-add">+ Add “${esc(s)}”</button></div>`);
      ac.appendChild(list);
      $$('.ac-item', list).forEach(el => el.onmousedown = e => { e.preventDefault(); pick(items[+el.dataset.i]); });
      const add = $('#ac-add', list); if (add) add.onmousedown = e => { e.preventDefault(); close(); customerModal({ name: s }, c => pick(c)); };
    };
    const search = debounce(async () => { try { items = await GET('/api/customers/search', { q: inp.value.trim() }); idx = items.length ? 0 : -1; show(); } catch (e) { fail(e); } }, 160);
    inp.oninput = search; inp.onfocus = search;
    inp.onblur = () => setTimeout(close, 150);
    inp.onkeydown = e => {
      if (!list) return;
      if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); show(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); show(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (items[idx]) { pick(items[idx]); e.preventDefault(); } }
      else if (e.key === 'Escape') close();
    };
  };
  const pick = c => { picked = c; onPick && onPick(c); render(); };
  render();
  return { get: () => picked, set: c => pick(c) };
}
function customerModal(c = {}, done) {
  const m = modal({
    title: c.id ? 'Edit Customer' : 'Add New Customer', icon: `<span class="feed-ic" style="background:var(--blue)">${ICON.users.replace('<svg', '<svg width="18"')}</span>`,
    body: `<div class="form f2" id="cf">
      ${field('Customer / Press name <span class="req">*</span>', `<input name="name" value="${esc(c.name || '')}">`)}
      ${field('Company', `<input name="company" value="${esc(c.company || '')}">`)}
      ${field('Contact person', `<input name="contact_person" value="${esc(c.contact_person || '')}">`)}
      ${field('Mobile', `<input name="phone" value="${esc(c.phone || '')}" placeholder="01XXXXXXXXX">`)}
      ${field('Address', `<input name="address" value="${esc(c.address || '')}">`, 'span2')}
      ${field('Email', `<input name="email" type="email" value="${esc(c.email || '')}">`)}
      ${field('Opening balance (৳)', `<input name="opening_balance" type="number" step="0.01" value="${esc(c.opening_balance || 0)}">`, '', 'previous due')}
      ${field('Remarks', `<input name="remarks" value="${esc(c.remarks || '')}">`, 'span2')}
      ${c.id ? `<label class="check"><input type="checkbox" name="active" ${c.active !== false ? 'checked' : ''}> Active</label>` : ''}
    </div><div id="dup"></div><div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="csave">${c.id ? 'Save changes' : 'Add customer'}</button></div>`,
  });
  $('[data-x]', m.el).onclick = m.close;
  const save = force => busy($('#csave', m.el), async () => {
    if (!requireFields(m.el, ['name'])) return;
    const b = { ...formData($('#cf', m.el)), force };
    try {
      const r = c.id ? await PUT('/api/customers/' + c.id, b) : await POST('/api/customers', b);
      toast(c.id ? 'Customer updated' : 'Customer added', r.name); m.close(); done && done(r);
    } catch (e) {
      if (e.status === 409 && e.data?.existing) {
        const ex = e.data.existing;
        $('#dup', m.el).innerHTML = `<div class="note warn">⚠ ${esc(e.message)}. <div class="row" style="margin-top:8px"><button class="btn xs" id="use-ex">Use existing customer</button><button class="btn xs ghost" id="force">Create anyway</button></div></div>`;
        $('#use-ex', m.el).onclick = async () => { m.close(); done && done(await GET('/api/customers/' + ex.id).then(r => r.customer)); };
        $('#force', m.el).onclick = () => save(true);
      } else throw e;
    }
  });
  $('#csave', m.el).onclick = () => save(false);
}

/* ---------------- tables ---------------- */
/** cols: [{k,label,n(numeric),f(fmt fn(row)),cls,sort:true,total:true|fn}] */
function dataTable(el, rows, cols, { search = true, onRow, empty = 'No records found', pageSize = 50, totals = false, tools = '', id } = {}) {
  let q = '', sortK = null, sortD = 1, page = 1;
  el.innerHTML = `${search || tools ? `<div class="tbl-tools">${search ? `<input class="inp" placeholder="Search…">` : ''}${tools}<span class="right sub" data-count></span></div>` : ''}<div class="tbl-wrap"><table ${id ? `id="${id}"` : ''}><thead><tr>${cols.map((c, i) => `<th class="${c.n ? 'n' : ''} ${c.sort !== false ? 'sort' : ''}" data-i="${i}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody></tbody><tfoot></tfoot></table></div><div class="row mt" data-pager></div>`;
  const tb = $('tbody', el), tf = $('tfoot', el);
  const val = (r, c) => c.v ? c.v(r) : r[c.k];
  const draw = () => {
    let data = rows;
    if (q) { const s = q.toLowerCase(); data = data.filter(r => cols.some(c => String(c.f ? stripTags(c.f(r)) : val(r, c) ?? '').toLowerCase().includes(s))); }
    if (sortK != null) { const c = cols[sortK]; data = [...data].sort((a, b) => { const x = val(a, c), y = val(b, c); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sortD; }); }
    const pages = Math.max(1, Math.ceil(data.length / pageSize)); page = Math.min(page, pages);
    const view = data.slice((page - 1) * pageSize, page * pageSize);
    tb.innerHTML = view.length ? view.map((r, i) => `<tr class="rowin ${onRow ? 'click' : ''} ${r._cls || ''}" data-i="${rows.indexOf(r)}" style="animation-delay:${Math.min(i, 15) * 18}ms">${cols.map(c => `<td class="${c.n ? 'n' : ''} ${c.cls || ''}">${c.f ? c.f(r) : esc(val(r, c) ?? '')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}"><div class="empty">${ICON.box}${esc(empty)}</div></td></tr>`;
    if (totals && data.length) tf.innerHTML = `<tr class="total">${cols.map((c, i) => `<td class="${c.n ? 'n' : ''}">${i === 0 ? 'TOTAL' : c.total ? (typeof c.total === 'function' ? c.total(data) : (c.money ? tk : n0)(data.reduce((s, r) => s + (+val(r, c) || 0), 0))) : ''}</td>`).join('')}</tr>`;
    else tf.innerHTML = '';
    const cnt = $('[data-count]', el); if (cnt) cnt.textContent = `${data.length} record${data.length === 1 ? '' : 's'}`;
    const pg = $('[data-pager]', el);
    pg.innerHTML = pages > 1 ? `<button class="btn xs ghost" data-p="-1" ${page === 1 ? 'disabled' : ''}>‹ Prev</button><span class="sub">Page ${page} / ${pages}</span><button class="btn xs ghost" data-p="1" ${page === pages ? 'disabled' : ''}>Next ›</button>` : '';
    $$('[data-p]', pg).forEach(b => b.onclick = () => { page += +b.dataset.p; draw(); });
    el._data = data;
  };
  if (search) $('.tbl-tools input', el).oninput = debounce(e => { q = e.target.value; page = 1; draw(); }, 150);
  $$('th.sort', el).forEach(th => th.onclick = () => { const i = +th.dataset.i; sortD = sortK === i ? -sortD : 1; sortK = i; draw(); });
  if (onRow) tb.onclick = e => { if (e.target.closest('button,a,input')) return; const tr = e.target.closest('tr[data-i]'); if (tr) onRow(rows[+tr.dataset.i]); };
  draw();
  return { redraw: draw, get data() { return el._data; } };
}
const stripTags = h => String(h).replace(/<[^>]+>/g, '');
const tagFor = s => ({ Paid: 'green', 'Partially Paid': 'orange', Due: 'red', confirmed: 'green', draft: 'gray', cancelled: 'red', Pending: 'orange', Partial: 'purple', Delivered: 'green', active: 'green', OK: 'green', OVERRIDE: 'orange' }[s] || 'gray');
const statusTag = s => s && s !== '-' ? `<span class="tag ${tagFor(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</span>` : '<span class="muted">—</span>';
const divTag = d => { const k = String(d).toLowerCase(); return `<span class="tag ${k === 'ctp' ? '' : k === 'pvc' ? 'teal' : k === 'gen' ? 'orange' : 'gray'}">${esc(k === 'gen' ? 'GENERAL' : String(d).toUpperCase())}</span>`; };

/* ---------------- count-up & charts ---------------- */
function countUp(el, to, fmt = n0, ms = 900) {
  const from = 0, t0 = performance.now();
  const step = t => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function animateIn(root) {
  $$('[data-count-to]', root).forEach(el => countUp(el, +el.dataset.countTo, el.dataset.fmt === 'tk' ? tk : n0));
  requestAnimationFrame(() => setTimeout(() => $$('.bar i[data-w]', root).forEach(b => (b.style.width = b.dataset.w + '%')), 60));
}
const tip = $('#tip') || null;
function bindTips(root) {
  const t = $('#tip');
  $$('[data-tip]', root).forEach(el => {
    el.addEventListener('mousemove', e => { t.innerHTML = el.dataset.tip; t.style.left = e.clientX + 14 + 'px'; t.style.top = e.clientY - 10 + 'px'; t.classList.add('on'); });
    el.addEventListener('mouseleave', () => t.classList.remove('on'));
  });
}
/** grouped bar chart + optional line. series: [{key,label,color}] line: {key,label,color} */
function barChart(el, data, { x, series, line, height = 240, money = true } = {}) {
  const W = Math.max(el.clientWidth || 600, 320), H = height, pl = 54, pr = 12, pt = 14, pb = 28;
  const max = Math.max(1, ...data.map(d => Math.max(series.reduce((s, sr) => s + (+d[sr.key] || 0), 0), line ? +d[line.key] || 0 : 0)));
  const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
  const iw = W - pl - pr, ih = H - pt - pb, bw = iw / data.length, w = Math.max(6, Math.min(34, bw * .56));
  const y = v => pt + ih - (v / top) * ih;
  const fmt = v => money ? (v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v) : n0(v);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = top * i / 4; g += `<line class="gridl" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 8}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`; }
  data.forEach((d, i) => {
    const cx = pl + bw * i + bw / 2; let acc = 0;
    series.forEach((sr, si) => {
      const v = +d[sr.key] || 0; if (!v) return;
      const yy = y(acc + v), hh = y(acc) - yy;
      g += `<rect class="b" x="${cx - w / 2}" y="${yy}" width="${w}" height="${Math.max(0, hh)}" rx="${si === series.length - 1 ? 4 : 0}" fill="${sr.color}" style="animation-delay:${i * 40}ms" data-tip="<b>${esc(d[x])}</b><br>${series.map(s => `${s.label}: ${money ? tk(d[s.key]) : n0(d[s.key])}`).join('<br>')}${line ? `<br>${line.label}: ${money ? tk(d[line.key]) : n0(d[line.key])}` : ''}"/>`;
      acc += v;
    });
    if (!acc) g += `<rect x="${cx - w / 2}" y="${pt + ih - 2}" width="${w}" height="2" rx="1" fill="var(--line)"/>`;
    const lab = String(d[x]); const show = data.length <= 14 || i % Math.ceil(data.length / 14) === 0;
    if (show) g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(lab.length > 7 ? lab.slice(5) : lab)}</text>`;
  });
  if (line) {
    const pts = data.map((d, i) => `${pl + bw * i + bw / 2},${y(+d[line.key] || 0)}`).join(' ');
    g += `<polyline class="ln" points="${pts}" fill="none" stroke="${line.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    data.forEach((d, i) => g += `<circle cx="${pl + bw * i + bw / 2}" cy="${y(+d[line.key] || 0)}" r="3.2" fill="var(--card)" stroke="${line.color}" stroke-width="2"/>`);
  }
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${g}</svg>`;
  bindTips(el);
}
function sparkline(values, color = '#2a7fd0') {
  const max = Math.max(1, ...values), w = 84, h = 34;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}22" stroke="none"/><polyline class="ln" points="${pts}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
function donut(parts, size = 120) {
  const tot = parts.reduce((s, p) => s + p.v, 0) || 1, r = 46, C = 2 * Math.PI * r; let off = 0;
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}"><circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>
    ${parts.map(p => { const len = C * p.v / tot; const s = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${p.c}" stroke-width="14" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)" style="transition:stroke-dasharray 1s"/>`; off += len; return s; }).join('')}</svg>`;
}

/* ---------------- printing & export ---------------- */
/* inside the Android app (window.AndroidBridge) downloads and printing go through native code */
const IN_APP = () => !!window.AndroidBridge;
function saveBlob(blob, name) {
  if (IN_APP()) {
    const rd = new FileReader();
    rd.onload = () => { window.AndroidBridge.saveFile(name, blob.type || 'application/octet-stream', String(rd.result).split(',')[1]); };
    rd.readAsDataURL(blob); return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
/* ---------- print / PDF with paper size + orientation ---------- */
const PAPER = {
  A4: [210, 297], A5: [148, 210], A3: [297, 420], A6: [105, 148], Letter: [216, 279], Legal: [216, 356], 'F4 / Folio': [210, 330],
  '80mm receipt': [80, 0], '58mm receipt': [58, 0],
};
const printPrefs = () => { try { return JSON.parse(localStorage.getItem('bbx_print') || '{}'); } catch (e) { return {}; } };
/** opens a small dialog (size, orientation, margin) and then prints — "Save as PDF" in the print dialog gives a PDF of exactly that size */
function printHTML(html, opts = {}) {
  const pref = { size: 'A4', orient: 'portrait', margin: 10, ...printPrefs(), ...opts };
  const m = modal({
    title: 'Print / PDF', size: 'narrow', body: `<div class="form f1" id="ppf">
      ${field('Paper size', `<select name="size">${Object.keys(PAPER).map(k => opt(k, k + (PAPER[k][1] ? ` (${PAPER[k][0]}×${PAPER[k][1]} mm)` : ' (thermal roll)'), pref.size)).join('')}</select>`)}
      <div class="field">Orientation<div class="seg" id="ppo"><button type="button" data-o="portrait">Portrait</button><button type="button" data-o="landscape">Landscape</button></div></div>
      ${field('Margin (mm)', `<input type="number" name="margin" min="0" max="30" value="${+pref.margin}">`)}
      <div class="note" style="margin:0;display:block" id="pph"></div></div>
      <div class="actions"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="ppgo">${ICON.print} Print / Save PDF</button></div>`,
  });
  let orient = pref.orient;
  const sync = () => {
    const thermal = !PAPER[$('[name=size]', m.el).value][1];
    $$('#ppo button', m.el).forEach(b => { b.classList.toggle('on', b.dataset.o === orient); b.disabled = thermal; });
    $('#pph', m.el).innerHTML = thermal ? 'Thermal receipt: narrow layout, page length fits the content. Choose your receipt printer in the print dialog.' : 'In the print dialog choose your printer, or <b>Save as PDF</b> to download a PDF of this size.';
  };
  $$('#ppo button', m.el).forEach(b => b.onclick = () => { orient = b.dataset.o; sync(); });
  $('[name=size]', m.el).onchange = sync; sync();
  $('[data-x]', m.el).onclick = m.close;
  $('#ppgo', m.el).onclick = () => {
    const size = $('[name=size]', m.el).value, margin = Math.max(0, Math.min(30, +$('[name=margin]', m.el).value || 0));
    try { localStorage.setItem('bbx_print', JSON.stringify({ size, orient, margin })); } catch (e) {}
    m.close(); doPrint(html, { size, orient, margin });
  };
}
function doPrint(html, { size = 'A4', orient = 'portrait', margin = 10 } = {}) {
  const [pw, ph] = PAPER[size] || PAPER.A4, thermal = !ph;
  const root = $('#print-root');
  const W = thermal ? pw : (orient === 'landscape' ? ph : pw), contentW = W - 2 * (thermal ? Math.min(margin, 3) : margin);
  const mm = thermal ? Math.min(margin, 3) : margin;
  root.innerHTML = `<style id="pg-style">@page{size:${thermal ? `${pw}mm 300mm` : orient === 'landscape' ? `${ph}mm ${pw}mm` : `${pw}mm ${ph}mm`};margin:${mm}mm}
    #print-root{width:${contentW}mm}
    ${thermal ? `#print-root .doc{font-size:${pw < 70 ? 9 : 10.5}px;padding:0!important}#print-root .doc *{max-width:100%}#print-root .doc-head{display:block!important}#print-root .doc-head>*{text-align:left!important;margin-bottom:4px}
      #print-root .doc h1{font-size:${pw < 70 ? 13 : 15}px}#print-root .doc-logo img,#print-root .doc-logo .mark{width:30px!important;height:30px!important}#print-root .meta{display:block!important}#print-root .meta>div{margin:1px 0}
      #print-root .doc{width:100%!important;min-width:0!important;max-width:none!important}
      #print-root table{width:100%!important;table-layout:fixed;border-collapse:collapse}
      #print-root th,#print-root td{padding:1px 2px!important;font-size:${pw < 70 ? 7 : 8.5}px!important;white-space:normal!important;word-break:break-word;overflow-wrap:anywhere;letter-spacing:0!important}
      #print-root th{text-transform:none!important}#print-root .doc-title{font-size:${pw < 70 ? 9 : 11}px!important;padding:2px 6px!important}#print-root .sign{display:block!important}#print-root .sign>div{margin-top:18px}#print-root .watermark{font-size:28px}
      #print-root .row{display:block!important}#print-root .sum{width:100%!important;margin-top:6px}` : ''}</style><div class="print-body">${html}</div>`;
  document.body.classList.add('printing');
  if (thermal) {   // receipt rolls: make the page exactly as long as the content
    root.style.display = 'block'; root.style.position = 'absolute'; root.style.left = '-9999px';
    const hmm = Math.ceil(root.scrollHeight * 25.4 / 96) + 2 * mm + 4;
    root.removeAttribute('style');
    $('#pg-style', root).textContent = $('#pg-style', root).textContent.replace(`${pw}mm 300mm`, `${pw}mm ${Math.max(60, hmm)}mm`);
  }
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; };
  if (IN_APP()) { window.__afterPrint = done; setTimeout(() => window.AndroidBridge.printPage(document.title || 'Document'), 150); return; }
  setTimeout(() => { window.print(); setTimeout(done, 300); }, 120);
}
async function exportXlsx(title, meta, sheets) {
  try {
    const r = await api('POST', '/api/export/xlsx', { title, meta, sheets }, { raw: true, idem: false });
    saveBlob(await r.blob(), title.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') + '.xlsx');
    toast('Excel exported', title);
  } catch (e) { fail(e); }
}
/** turns a rendered <table> into an export sheet */
function tableToSheet(name, table) {
  const ths = $$('thead th', table).map(t => t.textContent.trim());
  const rows = $$('tbody tr, tfoot tr', table).filter(tr => !tr.querySelector('.empty')).map(tr => {
    const o = {}; $$('td,th', tr).forEach((td, i) => { const t = td.textContent.trim(); const n = t.replace(/[৳,\s]|pcs|sq ft|ft$/g, ''); o['c' + i] = n !== '' && !isNaN(n) && /^[৳\d\s,.\-]+(pcs|sq ft|ft)?$/.test(t) ? +n : t; });
    if (tr.classList.contains('total') || tr.closest('tfoot')) o._total = true; return o;
  });
  return { name, columns: ths.map((l, i) => ({ key: 'c' + i, label: l })), rows };
}
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 3).toUpperCase();
const logoMark = c => c.logo ? `<img src="${esc(c.logo)}" alt="" style="width:52px;height:52px;object-fit:contain">` : `<div class="mark">${esc(initials(c.name))}</div>`;
function companyHeader(sub = '') {
  const c = App.meta.settings.company || {};
  return `<div class="doc-head"><div class="doc-logo">${logoMark(c)}<div><h1>${esc(c.name)}</h1><div class="muted">${esc(c.address)}</div>
    <div class="muted">Mobile: ${esc(c.phone_ctp)} (CTP), ${esc(c.phone_manager)} (Manager)</div><div class="muted">${esc(c.email)}${c.email2 ? ', ' + esc(c.email2) : ''}</div></div></div>${sub}</div>`;
}

/* ---------------- app shell & router ---------------- */
const NAV = [
  { cap: 'OVERVIEW' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dash', perm: ['dashboard'] },
  { id: 'general', label: 'General', icon: 'layers', perm: ['general.view', 'general.invoice', 'general.stock', 'general.items'] },
  { cap: 'CTP DIVISION' },
  { id: 'ctp', label: 'CTP Inventory', icon: 'plate', perm: ['ctp.view'] },
  { id: 'ctp-invoices', label: 'CTP Sales / Invoice', icon: 'invoice', perm: ['ctp.invoice'] },
  { id: 'ctp-ownuse', label: 'CTP Own Use', icon: 'own', perm: ['ctp.ownuse'] },
  { id: 'ctp-challans', label: 'CTP Challan', icon: 'truck', perm: ['ctp.challan'] },
  { cap: 'PVC / MEDIA DIVISION' },
  { id: 'pvc', label: 'PVC Inventory', icon: 'roll', perm: ['pvc.view'] },
  { id: 'pvc-print', label: 'PVC Print Entry', icon: 'print', perm: ['pvc.print'] },
  { id: 'pvc-invoices', label: 'PVC Sales / Invoice', icon: 'invoice', perm: ['pvc.invoice'] },
  { id: 'pvc-challans', label: 'PVC Challan', icon: 'truck', perm: ['pvc.challan'] },
  { id: 'ink', label: 'Ink Stock', icon: 'ink', perm: ['ink'] },
  { cap: 'SHARED BUSINESS' },
  { id: 'customers', label: 'Customers', icon: 'users', perm: ['customers.view'] },
  { id: 'accounts', label: 'Accounts & Ledger', icon: 'money', perm: ['accounts.view', 'payments'] },
  { id: 'expenses', label: 'Expenses', icon: 'expense', perm: ['expenses'] },
  { id: 'reports', label: 'Reports Centre', icon: 'chart', perm: ['reports'] },
  { id: 'admin', label: 'Users & Settings', icon: 'gear', perm: ['users', 'settings', 'backup', 'audit'] },
  { id: 'android', label: 'App & Downloads', icon: 'phone', perm: ['dashboard'] },
  { id: 'billing', label: 'Subscription', icon: 'key', perm: ['billing'] },
  { cap: 'INTERNAL' },
  { id: 'internal', label: 'Internal Inventory', icon: 'box', perm: ['internal'] },
];
const App = {
  user: null, meta: null, today: null, pages: {}, current: null,
  async start() {
    try {
      const r = await GET('/api/me'); Object.assign(this, { user: r.user, today: r.today, tenant: r.tenant, brand: r.brand, impersonated: r.impersonated, announcement: r.announcement });
      await this.loadMeta(); this.applyBranding(); this.renderShell();
      if (r.tenant.blocked && !r.impersonated) this.locked(); else this.route();
    } catch (e) { if (!e.silent) this.renderLogin(); }
    window.addEventListener('hashchange', () => this.user && this.route());
  },
  async loadMeta() { this.meta = await GET('/api/meta'); this.today = this.meta.today; },
  applyBranding() {
    const c = this.meta.settings.company || {};
    document.title = `${c.name || 'Business'} · ${this.brand?.product || 'Baybex Printers Manager'}`;
    const col = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : null, r = document.documentElement.style;
    if (col) { r.setProperty('--blue', col); r.setProperty('--ctp', col); r.setProperty('--blue2', `color-mix(in srgb, ${col} 82%, #000)`); r.setProperty('--blue-soft', `color-mix(in srgb, ${col} 12%, #fff)`); }
    else ['--blue', '--ctp', '--blue2', '--blue-soft'].forEach(k => r.removeProperty(k));
  },
  /** shown when the trial / subscription is over: only billing stays usable */
  locked(msg) {
    if (!$('#view')) return;
    const t = this.tenant || {};
    $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === 'billing'));
    $('#title').textContent = 'Subscription required';
    $('#view').innerHTML = `<div class="panel" style="max-width:760px;margin:30px auto;text-align:center;padding:36px"><div style="font-size:46px">🔒</div>
      <h2 style="font-size:22px;margin:8px 0">${esc(msg || (t.state === 'trial' || t.state === 'expired' && !t.plan ? 'Your free trial has ended' : 'Your subscription has expired'))}</h2>
      <p class="muted">Your data is safe. Choose a plan and submit your payment to continue using ${esc(this.brand?.product || 'the software')}. You can still download a backup of your data.</p>
      <div class="actions" style="justify-content:center">${can('billing') ? `<button class="btn" onclick="location.hash='#/billing';App.route()">${ICON.money} Choose a plan & pay</button>` : '<span class="muted">Please ask your business admin to renew the subscription.</span>'}
      ${can('backup') ? `<button class="btn ghost" onclick="App.go('admin/backup')">${ICON.backup} Download my data</button>` : ''}</div></div>`;
  },
  renderLogin() {
    $('#app').innerHTML = `<div class="login-wrap">
      <div class="login-art"><div><div class="brand" style="padding:0"><span style="background:#fff;border-radius:12px;padding:5px;display:grid"><img src="/brand/mark.png" alt="Baybex" style="height:34px"></span><div><strong>Baybex Printers Manager</strong><small>BY BAYBEX DIGITAL</small></div></div></div>
        <div class="plates"><div class="plate"><i></i></div><div class="plate"><i></i></div><div class="plate"><i></i></div></div>
        <div><h1>CTP plates & PVC media, one clean ledger.</h1><p>Stock in pieces and linear feet, billing in square feet, one customer ledger across both divisions — with every entry signed by the employee who made it.</p><div class="cmyk"><span></span><span></span><span></span><span></span></div></div>
        <div class="sub" style="color:#6f89a3">Baybex Digital · ${new Date().getFullYear()}</div></div>
      <div class="login-card"><form class="login-form" id="lf"><h2>Welcome back</h2><div class="sub">Sign in with your employee account</div>
        <label class="field">Business ID<input name="business" autocomplete="organization" required placeholder="e.g. sks-printers" value="${esc(new URLSearchParams(location.search).get('b') || (() => { try { return localStorage.getItem('bbx_business') || ''; } catch (e) { return ''; } })())}"><span class="hint" id="bname"></span></label>
        <label class="field">Username<input name="username" autocomplete="username" required></label>
        <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Sign in ${ICON.arrow}</button><div class="sub mt" id="lerr"></div>
        <div class="sub mt">New business? <a href="/#signup">Start a free trial</a></div></form></div></div>`;
    const bi = $('[name=business]');
    const look = debounce(async () => { const v = bi.value.trim(); if (v.length < 3) return ($('#bname').textContent = ''); try { const r = await GET('/api/public/business/' + encodeURIComponent(v)); $('#bname').innerHTML = r.found ? `<span style="color:var(--ok)">✓ ${esc(r.business_name)}</span>` : '<span style="color:var(--danger)">Business ID not found</span>'; } catch (e) {} }, 300);
    bi.oninput = look; if (bi.value) look();
    $('#lf').onsubmit = e => {
      e.preventDefault();
      busy($('#lf .btn'), async () => {
        try { const r = await POST('/api/login', formData($('#lf')), { idem: false }); try { localStorage.setItem('bbx_business', r.business); } catch (e) {} await this.start(); toast('Signed in', 'Welcome, ' + this.user.full_name); }
        catch (err) { $('#lerr').innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`; $('#lf').animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 260 }); }
      });
    };
  },
  renderShell() {
    const u = this.user;
    const nav = NAV.filter((n, i) => {
      if (n.cap) { const next = NAV.slice(i + 1); const end = next.findIndex(x => x.cap); return (end < 0 ? next : next.slice(0, end)).some(x => x.perm.some(p => u.perms.includes(p))); }
      return n.perm.some(p => u.perms.includes(p));
    });
    const co = this.meta.settings.company || {}, t = this.tenant || {};
    const banner = this.impersonated ? `<div class="ribbon" style="background:#172b43;color:#fff;margin:0 28px 0">🛡 Baybex super admin view of <b>${esc(t.business_name)}</b> — changes are logged as the business admin.<a class="right" style="color:#9fd0ff" href="/super">Back to super admin →</a></div>`
      : t.state === 'trial' ? `<div class="ribbon" style="margin:0 28px 0"><b>Free trial</b> · ${t.days_left} day${t.days_left === 1 ? '' : 's'} left${can('billing') ? ` <a class="right" href="#/billing">Choose a plan →</a>` : ''}</div>`
      : t.state === 'active' && t.days_left <= 5 ? `<div class="ribbon" style="margin:0 28px 0;background:linear-gradient(90deg,#fdf0e1,transparent)"><b>Subscription ends in ${t.days_left} day${t.days_left === 1 ? '' : 's'}</b>${can('billing') ? ` <a class="right" href="#/billing">Renew now →</a>` : ''}</div>` : '';
    const ann = this.announcement ? `<div class="ribbon" style="margin:8px 28px 0">📢 ${esc(this.announcement)}</div>` : '';
    $('#app').innerHTML = `<aside class="side" id="side"><div class="brand">${co.logo ? `<img src="${esc(co.logo)}" alt="" style="width:42px;height:42px;border-radius:12px;object-fit:contain;background:#fff;padding:3px">` : `<div class="logo"><b>${esc(initials(co.name))}</b></div>`}<div><strong>${esc(co.name || t.business_name || 'Business')}</strong><small>${esc((this.brand?.product || 'BAYBEX PRINTERS MANAGER').toUpperCase())}</small></div></div>
      <nav>${nav.map(n => n.cap ? `<div class="cap">${n.cap}</div>` : `<button class="nav" data-page="${n.id}">${ICON[n.icon]}<span>${n.label}</span></button>`).join('')}</nav>
      <div class="side-foot"><div class="row"><span class="dot pulse" style="color:#3fd19a"></span> ${esc(u.role_name)} · ID: ${esc(t.slug || '')}</div><div class="mt row" style="color:#6f89a3;gap:8px"><span style="background:#fff;border-radius:6px;padding:2px;display:grid"><img src="/brand/mark.png" alt="" style="height:16px"></span> Powered by ${esc(this.brand?.company || 'Baybex Digital')}</div></div></aside>
      <div class="overlay" id="ovl"></div>
      <main><header class="top" id="top"><button class="iconbtn menu-btn" id="mbtn">${ICON.menu}</button>
        <div><div class="kicker" id="kick"></div><h1 id="title">Dashboard</h1></div><div class="grow"></div>
        <div class="gsearch">${ICON.search}<input id="gs" placeholder="Search customers, invoices…"><kbd>/</kbd></div>
        <button class="iconbtn" id="theme" title="Toggle theme">${document.documentElement.dataset.theme === 'dark' ? ICON.sun : ICON.moon}</button>
        <div class="me" id="me"><div class="avatar">${esc(u.full_name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase())}</div><div class="who"><b>${esc(u.full_name)}</b><small>${esc(u.role_name)}</small></div>
          <div class="dropdown" id="dd"><button data-act="pw">${ICON.key} Change password</button><button data-act="out">${ICON.logout} Sign out</button></div></div>
      </header>${banner}${ann}<div id="view"></div></main>
      <button class="fab" id="fab" title="Quick entry">${ICON.plus}</button>`;
    $$('.nav').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.page; this.closeSide(); });
    $('#mbtn').onclick = () => { $('#side').classList.add('open'); $('#ovl').classList.add('on'); };
    $('#ovl').onclick = () => this.closeSide();
    $('#theme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('sks_theme', t); } catch (e) {} $('#theme').innerHTML = t === 'dark' ? ICON.sun : ICON.moon; };
    $('#me').onclick = e => { e.stopPropagation(); $('#dd').classList.toggle('open'); };
    document.addEventListener('click', () => $('#dd') && $('#dd').classList.remove('open'));
    $('#dd').onclick = e => { const a = e.target.closest('[data-act]')?.dataset.act; if (a === 'out') this.logout(); if (a === 'pw') passwordModal(); };
    $('#fab').onclick = () => quickMenu();
    window.onscroll = () => $('#top') && $('#top').classList.toggle('scrolled', scrollY > 4);
    const gs = $('#gs');
    document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); gs.focus(); } });
    globalSearch(gs);
  },
  closeSide() { $('#side')?.classList.remove('open'); $('#ovl')?.classList.remove('on'); },
  async logout() { await POST('/api/logout', {}, { idem: false }).catch(() => {}); this.user = null; this.renderLogin(); location.hash = ''; },
  route() {
    const [page = 'dashboard', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    const def = NAV.find(n => n.id === page);
    const target = page && this.pages[page] ? page : 'dashboard';
    if (def && !def.perm.some(p => this.user.perms.includes(p))) { $('#view').innerHTML = `<div class="panel"><div class="empty">${ICON.shield}You do not have access to this page.</div></div>`; return; }
    $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === target || (target.startsWith(n.dataset.page + '-') && !$(`.nav[data-page="${target}"]`))));
    const pg = this.pages[target];
    $('#title').textContent = pg.title || def?.label || '';
    $('#kick').textContent = pg.kicker || String(App.meta.settings.company?.name || '').toUpperCase() + ' / ' + (def ? (NAV.slice(0, NAV.indexOf(def)).reverse().find(n => n.cap)?.cap || '') : '');
    const old = $('#view'), v = old.cloneNode(false); old.replaceWith(v);   // fresh node: no event handlers leak between pages
    v.classList.remove('page-enter'); void v.offsetWidth; v.classList.add('page-enter');
    v.innerHTML = `<div class="grid g4">${'<div class="sk sk-card"></div>'.repeat(4)}</div><div class="sk" style="height:280px;margin-top:16px;border-radius:14px"></div>`;
    this.current = target; scrollTo(0, 0);
    Promise.resolve(pg.render(v, ...args)).then(() => { animateIn(v); bindTips(v); }).catch(e => { fail(e); v.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; });
  },
  go(h) { if (location.hash === '#/' + h) this.route(); else location.hash = '#/' + h; },
  refresh() { this.route(); },
};
function passwordModal() {
  const m = modal({
    title: 'Change password', size: 'narrow', body: `<div class="form f1" id="pf">${field('Current password', '<input type="password" name="current">')}${field('New password', '<input type="password" name="password">', '', 'min 6 characters')}</div>
    <div class="actions"><button class="btn" id="ps">Update password</button></div>`,
  });
  $('#ps', m.el).onclick = () => busy($('#ps', m.el), async () => { await POST('/api/me/password', formData($('#pf', m.el)), { idem: false }); toast('Password changed'); m.close(); });
}
function quickMenu() {
  const items = [['ctp-invoices/new', 'CTP Sales', 'ctp.invoice', 'c1'], ['ctp-ownuse', 'CTP Own Use', 'ctp.ownuse', 'c2'], ['pvc/stockin', 'PVC Stock In', 'pvc.stockin', 'c3'], ['pvc-print', 'PVC Print Entry', 'pvc.print', 'c4'], ['accounts/pay', 'Receive Payment', 'payments', 'c1']].filter(i => can(i[2]));
  const m = modal({ title: 'Quick entry', size: 'narrow', body: `<div class="grid" style="gap:10px">${items.map(i => `<button class="qa ${i[3]}" style="min-height:64px;padding:14px" data-h="${i[0]}"><b style="margin:0">${i[1]}</b></button>`).join('')}</div>` });
  $$('[data-h]', m.el).forEach(b => b.onclick = () => { m.close(); App.go(b.dataset.h); });
}
function globalSearch(inp) {
  let box;
  const close = () => { box && box.remove(); box = null; };
  const run = debounce(async () => {
    const s = inp.value.trim(); close(); if (s.length < 2) return;
    const [cs, ci, pi] = await Promise.all([
      can('customers.view') ? GET('/api/customers/search', { q: s }).catch(() => []) : [],
      can('ctp.invoice', 'accounts.view') ? GET('/api/ctp/invoices', { q: s }).catch(() => []) : [],
      can('pvc.invoice', 'accounts.view') ? GET('/api/pvc/invoices', { q: s }).catch(() => []) : [],
    ]);
    box = document.createElement('div'); box.className = 'ac-list'; box.style.minWidth = '360px';
    const rows = [...cs.slice(0, 5).map(c => `<div class="ac-item" data-h="customers/${c.id}"><span>👤 ${esc(c.name)}</span><small>${esc(c.phone || '')}</small></div>`),
      ...ci.slice(0, 5).map(i => `<div class="ac-item" data-h="ctp-invoices/${i.id}"><span>${divTag('ctp')} ${esc(i.inv_no || 'Draft #' + i.id)} · ${esc(i.customer)}</span><small>${tk(i.grand_total)}</small></div>`),
      ...pi.slice(0, 5).map(i => `<div class="ac-item" data-h="pvc-invoices/${i.id}"><span>${divTag('pvc')} ${esc(i.inv_no || 'Draft #' + i.id)} · ${esc(i.customer)}</span><small>${tk(i.grand_total)}</small></div>`)];
    box.innerHTML = rows.join('') || '<div class="ac-empty">Nothing found</div>';
    inp.parentElement.appendChild(box);
    $$('[data-h]', box).forEach(el => el.onmousedown = e => { e.preventDefault(); App.go(el.dataset.h); inp.value = ''; close(); });
  }, 250);
  inp.oninput = run; inp.onblur = () => setTimeout(close, 150);
}
/** period picker used by dashboard & reports */
function periodChips(active, presets = ['today', 'yesterday', 'week', 'month', 'year', 'custom']) {
  const L = { today: 'Today', yesterday: 'Yesterday', week: 'This Week', month: 'This Month', lastmonth: 'Last Month', year: 'This Year', custom: 'Custom' };
  return `<div class="chip-row">${presets.map(p => `<button class="chip ${p === active ? 'on' : ''}" data-period="${p}">${L[p]}</button>`).join('')}</div>`;
}
function periodRange(p, t = App.today) {
  const d = new Date(t + 'T00:00:00');
  if (p === 'today') return [t, t];
  if (p === 'yesterday') { const y = addDays(t, -1); return [y, y]; }
  if (p === 'week') { const dow = (d.getDay() + 1) % 7; return [addDays(t, -dow), t]; } // week starts Saturday (Bangladesh)
  if (p === 'month') return [monthStart(t), t];
  if (p === 'lastmonth') { const s = addDays(monthStart(t), -1); return [monthStart(s), s]; }
  if (p === 'year') return [t.slice(0, 4) + '-01-01', t];
  return null;
}
