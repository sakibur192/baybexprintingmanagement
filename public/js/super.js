/* Baybex super admin — manages every business (tenant), plans, subscription payments and platform settings */
'use strict';
const STATE_TAG = { trial: ['Trial', 'teal'], active: ['Active', 'green'], expired: ['Expired', 'red'], suspended: ['Suspended', 'gray'] };
const stTag = s => `<span class="tag ${STATE_TAG[s]?.[1] || 'gray'}">${STATE_TAG[s]?.[0] || s}</span>`;
const d10 = v => v ? fdate(String(v).slice(0, 10)) : '—';
const toLocalInput = v => { if (!v) return ''; const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
window.onAuthLost = () => SA.renderLogin();

const SA = {
  admin: null, plans: [],
  pages: {},
  async start() {
    try { const r = await GET('/api/super/me'); this.admin = r.admin; this.brand = r.brand; App.today = r.today; this.plans = await GET('/api/super/plans'); this.shell(); this.route(); }
    catch (e) { this.renderLogin(); }
    window.onhashchange = () => this.admin && this.route();
  },
  renderLogin() {
    this.admin = null;
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-art" style="background:linear-gradient(160deg,#0b1a2a,#16466e 60%,#13838f)"><div><img src="/brand/wordmark-white.png" alt="Baybex" style="height:36px"><div class="small mt" style="color:#9fd0dc;letter-spacing:2px">DIGITAL · SUPER ADMIN</div></div>
      <div><h1>Every business. One control room.</h1><p>Trials, subscriptions, payments, plans and full access to each business account.</p></div><div></div></div>
      <div class="login-card"><form class="login-form" id="lf"><h2>Super admin</h2><div class="sub">Restricted area</div>
        <label class="field">Username<input name="username" required></label><label class="field">Password<input name="password" type="password" required></label>
        <button class="btn teal" type="submit">Sign in ${ICON.arrow}</button><div class="sub mt" id="lerr"></div></form></div></div>`;
    $('#lf').onsubmit = e => { e.preventDefault(); busy($('#lf .btn'), async () => {
      try { await POST('/api/super/login', formData($('#lf')), { idem: false }); await this.start(); } catch (er) { $('#lerr').innerHTML = `<span style="color:var(--danger)">${esc(er.message)}</span>`; }
    }); };
  },
  shell() {
    const NAVS = [['dash', 'Dashboard', 'dash'], ['tenants', 'Businesses', 'users'], ['payments', 'Subscription Payments', 'money'], ['plans', 'Plans & Pricing', 'invoice'], ['settings', 'Platform Settings', 'gear'], ['android', 'Android App', 'phone'], ['brochure', 'Brochure', 'doc'], ['admins', 'Super Admins', 'shield'], ['audit', 'Audit Log', 'register']];
    $('#app').innerHTML = `<aside class="side" id="side"><div class="brand"><span style="background:#fff;border-radius:12px;padding:5px;display:grid;flex:none"><img src="/brand/mark.png" alt="" style="height:32px"></span><div><strong>${esc(this.brand?.company || 'Baybex Digital')}</strong><small>SUPER ADMIN · ${esc((this.brand?.product || '').toUpperCase())}</small></div></div>
      <nav>${NAVS.map(([id, l, i]) => `<button class="nav" data-p="${id}">${ICON[i]}<span>${l}</span>${id === 'payments' ? '<span class="pill hide" id="pend"></span>' : ''}</button>`).join('')}</nav>
      <div class="side-foot"><a href="/" style="color:#9fd0ff">Open public website →</a></div></aside><div class="overlay" id="ovl"></div>
      <main><header class="top" id="top"><button class="iconbtn menu-btn" id="mbtn">${ICON.menu}</button><div><div class="kicker">BAYBEX DIGITAL / SUPER ADMIN</div><h1 id="title"></h1></div><div class="grow"></div>
        <button class="iconbtn" id="theme">${document.documentElement.dataset.theme === 'dark' ? ICON.sun : ICON.moon}</button>
        <div class="me" id="me"><div class="avatar" style="background:linear-gradient(135deg,#13a389,#172b43)">${esc(initials(this.admin.full_name))}</div><div class="who"><b>${esc(this.admin.full_name)}</b><small>Super admin</small></div>
        <div class="dropdown" id="dd"><button data-a="pw">${ICON.key} Change password</button><button data-a="out">${ICON.logout} Sign out</button></div></div></header><div id="view"></div></main>`;
    $$('.nav').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.p; $('#side').classList.remove('open'); $('#ovl').classList.remove('on'); });
    $('#mbtn').onclick = () => { $('#side').classList.add('open'); $('#ovl').classList.add('on'); };
    $('#ovl').onclick = () => { $('#side').classList.remove('open'); $('#ovl').classList.remove('on'); };
    $('#theme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('sks_theme', t); } catch (e) {} $('#theme').innerHTML = t === 'dark' ? ICON.sun : ICON.moon; };
    $('#me').onclick = e => { e.stopPropagation(); $('#dd').classList.toggle('open'); };
    document.addEventListener('click', () => $('#dd')?.classList.remove('open'));
    $('#dd').onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'out') { await POST('/api/super/logout', {}, { idem: false }).catch(() => {}); this.renderLogin(); }
      if (a === 'pw') { const m = modal({ title: 'Change password', size: 'narrow', body: `<div class="form f1" id="pf">${field('Current password', '<input type="password" name="current">')}${field('New password', '<input type="password" name="password">', '', 'min 8 characters')}</div><div class="actions"><button class="btn" id="ps">Update</button></div>` });
        $('#ps', m.el).onclick = () => busy($('#ps', m.el), async () => { await POST('/api/super/me/password', formData($('#pf', m.el)), { idem: false }); toast('Password changed'); m.close(); }); }
    };
    window.onscroll = () => $('#top')?.classList.toggle('scrolled', scrollY > 4);
  },
  route() {
    const [p = 'dash', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    const page = this.pages[p] ? p : 'dash';
    $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.p === page));
    $('#title').textContent = this.pages[page].title;
    const v = $('#view'); v.classList.remove('page-enter'); void v.offsetWidth; v.classList.add('page-enter');
    v.innerHTML = `<div class="grid g4">${'<div class="sk sk-card"></div>'.repeat(4)}</div>`;
    Promise.resolve(this.pages[page].render(v, ...args)).then(() => { animateIn(v); bindTips(v); }).catch(e => { fail(e); v.innerHTML = `<div class="panel"><div class="empty">${esc(e.message)}</div></div>`; });
    GET('/api/super/payments', { status: 'pending' }).then(r => { const el = $('#pend'); if (el) { el.textContent = r.length; el.classList.toggle('hide', !r.length); } }).catch(() => {});
  },
  refresh() { this.route(); },
  go(h) { if (location.hash === '#/' + h) this.route(); else location.hash = '#/' + h; },
  planOptions(sel, empty = '— none —') { return `<option value="">${empty}</option>` + this.plans.map(p => opt(p.id, `${p.name} · ৳${n0(p.final_price ?? p.price)}${p.discount_active ? ' (' + p.discount_text + ')' : ''}${p.active ? '' : ' (inactive)'}`, sel)).join(''); },
};

/* ---------- dashboard ---------- */
SA.pages.dash = {
  title: 'Platform Dashboard',
  async render(v) {
    const d = await GET('/api/super/dashboard');
    const months = d.monthly.map(m => ({ ...m, label: new Date(m.month + '-01').toLocaleString('en', { month: 'short' }) }));
    v.innerHTML = `<div class="stats stagger" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat"><small>Businesses</small><b data-count-to="${d.counts.total}">0</b><div class="foot">all accounts</div></div>
      <div class="stat" style="--c:var(--pvc)"><small>On trial</small><b data-count-to="${d.counts.trial}">0</b></div>
      <div class="stat" style="--c:var(--ok)"><small>Paying</small><b data-count-to="${d.counts.active}">0</b></div>
      <div class="stat" style="--c:var(--danger)"><small>Expired</small><b data-count-to="${d.counts.expired}">0</b><div class="foot">${d.counts.suspended} suspended</div></div>
      <div class="stat" style="--c:var(--own)"><small>MRR</small><b data-count-to="${d.revenue.mrr}" data-fmt="tk">0</b><div class="foot">This month ${tk(d.revenue.this_month)} · total ${tk(d.revenue.total)}</div></div></div>
      ${d.pending.length ? `<div class="ribbon" style="background:linear-gradient(90deg,#fdf0e1,transparent)"><span class="dot pulse" style="color:var(--warn)"></span><b>${d.pending.length} payment(s) waiting for verification</b><a class="right" href="#/payments">Review →</a></div>` : ''}
      <div class="grid g32 mb"><div class="panel"><div class="head"><div><h2>Revenue & signups</h2><div class="sub">Last 12 months</div></div><div class="legend"><span><i style="background:var(--ok)"></i>Revenue</span><span><i style="background:#2a7fd0;height:3px"></i>Signups ×100</span></div></div><div id="ch"></div></div>
        <div class="panel"><div class="head"><div><h2>Ending soon</h2><div class="sub">Trials & subscriptions ending within 5 days — call them</div></div></div>
        <div class="feed">${d.expiring.length ? d.expiring.map(t => `<div class="feed-item" data-h="tenants/${t.id}"><div class="avatar">${esc(initials(t.business_name))}</div><div class="t"><b>${esc(t.business_name)}</b><small>${esc(t.phone || '')} · ${stTag(t.state)}</small></div><b style="color:var(--danger)">${t.days_left}d</b></div>`).join('') : '<div class="empty">Nothing ending soon</div>'}</div></div></div>
      <div class="panel"><div class="head"><h2>Newest businesses</h2><a href="#/tenants" class="small">All businesses →</a></div><div id="rt"></div></div>`;
    barChart($('#ch', v), months.map(m => ({ ...m, s100: m.signups * 100 })), { x: 'label', series: [{ key: 'revenue', label: 'Revenue', color: 'var(--ok)' }], line: { key: 's100', label: 'Signups ×100', color: '#2a7fd0' } });
    $$('[data-h]', v).forEach(b => b.onclick = () => SA.go(b.dataset.h));
    tenantTable($('#rt', v), d.recent, false);
  },
};
function tenantTable(el, rows, withStats) {
  return dataTable(el, rows, [
    { k: 'business_name', label: 'Business', f: r => `<div class="row" style="gap:10px;flex-wrap:nowrap"><div class="avatar">${esc(initials(r.business_name))}</div><div><b>${esc(r.business_name)}</b><div class="sub">ID: ${esc(r.slug)} · ${esc(r.owner_name || '')}</div></div></div>` },
    { k: 'phone', label: 'Mobile', f: r => `${esc(r.phone || '')}<div class="sub">${esc(r.district || '')}</div>` },
    { k: 'state', label: 'Status', f: r => stTag(r.state) + (r.plan_name ? `<div class="sub">${esc(r.plan_name)}</div>` : '') },
    { k: 'ends_at', label: 'Ends', f: r => `${d10(r.ends_at)}<div class="sub">${r.blocked ? '' : r.days_left + ' days left'}</div>` },
    ...(withStats ? [{ k: 'users', label: 'Users', n: 1 }, { k: 'inv', label: 'Invoices', n: 1, v: r => (r.ctp_invoices || 0) + (r.pvc_invoices || 0), f: r => (r.ctp_invoices || 0) + (r.pvc_invoices || 0) },
      { k: 'last_activity', label: 'Last activity', f: r => r.last_activity ? `<span class="sub">${fdt(r.last_activity)}</span>` : '<span class="muted">never</span>' }] : []),
    { k: 'created_at', label: 'Joined', f: r => `<span class="sub">${d10(r.created_at)}</span>` },
  ], { onRow: r => SA.go('tenants/' + r.id), pageSize: 50 });
}

/* ---------- tenants ---------- */
SA.pages.tenants = {
  title: 'Businesses',
  async render(v, id) {
    if (id) return this.detail(v, +id);
    const rows = await GET('/api/super/tenants', { stats: 1 });
    const filt = this.f || 'all';
    v.innerHTML = `<div class="head"><div class="chip-row">${['all', 'trial', 'active', 'expired', 'suspended'].map(s => `<button class="chip ${s === filt ? 'on' : ''}" data-f="${s}">${s === 'all' ? 'All' : STATE_TAG[s][0]} (${s === 'all' ? rows.length : rows.filter(r => r.state === s).length})</button>`).join('')}</div>
      <button class="btn teal" id="nt">${ICON.plus} Create business</button></div><div class="panel"><div id="tt"></div></div>`;
    $$('[data-f]', v).forEach(b => b.onclick = () => { this.f = b.dataset.f; SA.refresh(); });
    tenantTable($('#tt', v), filt === 'all' ? rows : rows.filter(r => r.state === filt), true);
    $('#nt', v).onclick = () => {
      const m = modal({ title: 'Create business account', size: 'wide', body: `<div class="form" id="nf">
        ${field('Business name <span class="req">*</span>', '<input name="business_name">')}${field('Business ID <span class="req">*</span>', '<input name="slug" placeholder="sks-printers">')}${field('Owner name <span class="req">*</span>', '<input name="owner_name">')}
        ${field('Mobile <span class="req">*</span>', '<input name="phone" placeholder="01XXXXXXXXX">')}${field('Email', '<input name="email">')}${field('District', '<input name="district">')}
        ${field('Address', '<input name="address">', 'span2')}${field('Trial days', '<input type="number" name="trial_days" value="7">')}
        ${field('Admin username', '<input name="username" value="admin">')}${field('Admin password <span class="req">*</span>', '<input name="password" type="text">')}${field('Notes', '<input name="notes">')}</div>
        <div class="actions"><button class="btn teal" id="ns">Create</button></div>` });
      $('[name=business_name]', m.el).oninput = e => ($('[name=slug]', m.el).value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30));
      $('#ns', m.el).onclick = () => busy($('#ns', m.el), async () => { const t = await POST('/api/super/tenants', formData($('#nf', m.el)), { idem: false }); toast('Business created', t.slug); m.close(); SA.go('tenants/' + t.id); });
    };
  },
  async detail(v, id) {
    const d = await GET('/api/super/tenants/' + id); const t = d.tenant, s = d.stats || {};
    $('#title').textContent = t.business_name;
    v.innerHTML = `<div class="head"><button class="btn ghost" onclick="SA.go('tenants')">← Businesses</button><div class="row">
        <button class="btn" id="imp">${ICON.eye} Open as business admin</button><button class="btn green" id="sub">${ICON.money} Add subscription</button><button class="btn light" id="days">+ Free days</button>
        <button class="btn ghost" id="bk">${ICON.backup} Backup</button>${t.status === 'suspended' ? `<button class="btn ghost" id="act">Re-activate</button>` : `<button class="btn ghost" id="sus" style="color:var(--danger)">Suspend</button>`}</div></div>
      <div class="panel"><div class="cust-head"><div class="cust-av">${esc(initials(t.business_name))}</div><div style="flex:1"><h2 style="font-size:20px">${esc(t.business_name)}</h2>
        <div class="sub">Business ID <b>${esc(t.slug)}</b> · schema ${esc(t.schema_name)} · ${esc(t.source)} · joined ${d10(t.created_at)}</div></div>
        <div class="tr">${stTag(t.state)}<div class="big-num">${t.blocked ? 'Locked' : t.days_left + ' days'}</div><div class="sub">${t.state === 'trial' ? 'Trial ends' : 'Ends'} ${d10(t.ends_at)}</div></div></div></div>
      <div class="stats stagger"><div class="stat"><small>Users</small><b>${s.users ?? '—'}</b></div><div class="stat" style="--c:var(--pvc)"><small>Customers</small><b>${s.customers ?? '—'}</b></div>
        <div class="stat" style="--c:var(--own)"><small>Invoices</small><b>${(s.ctp_invoices || 0) + (s.pvc_invoices || 0)}</b><div class="foot">CTP ${s.ctp_invoices || 0} · PVC ${s.pvc_invoices || 0}</div></div>
        <div class="stat" style="--c:var(--ok)"><small>Their sales recorded</small><b>${tk(s.sales || 0)}</b><div class="foot">Last activity ${s.last_activity ? fdt(s.last_activity) : 'never'}</div></div></div>
      <div class="grid g2"><div class="panel"><div class="head"><h2>Account details</h2></div><div class="form f2" id="tf">
        ${field('Business name', `<input name="business_name" value="${esc(t.business_name)}">`)}${field('Business ID (login)', `<input name="slug" value="${esc(t.slug)}">`)}
        ${field('Owner name', `<input name="owner_name" value="${esc(t.owner_name || '')}">`)}${field('Mobile', `<input name="phone" value="${esc(t.phone || '')}">`)}
        ${field('Email', `<input name="email" value="${esc(t.email || '')}">`)}${field('District', `<input name="district" value="${esc(t.district || '')}">`)}
        ${field('Address', `<input name="address" value="${esc(t.address || '')}">`, 'span2')}
        ${field('Status', `<select name="status">${['trial', 'active', 'suspended'].map(x => opt(x, x[0].toUpperCase() + x.slice(1), t.status)).join('')}</select>`)}${field('Plan', `<select name="plan_id">${SA.planOptions(t.plan_id)}</select>`)}
        ${field('Trial ends', `<input type="datetime-local" name="trial_ends_at" value="${toLocalInput(t.trial_ends_at)}">`)}${field('Paid until', `<input type="datetime-local" name="expires_at" value="${toLocalInput(t.expires_at)}">`)}
        ${field('Internal notes', `<textarea name="notes">${esc(t.notes || '')}</textarea>`, 'span2')}</div>
        <div class="actions"><button class="btn ghost" id="del" style="color:var(--danger)">Delete business…</button><button class="btn" id="save">Save changes</button></div></div>
      <div><div class="panel"><div class="head"><div><h2>Users</h2><div class="sub">Reset a password if the owner forgets it</div></div></div><div id="ut"></div></div>
        <div class="panel"><div class="head"><h2>Subscription payments</h2></div><div id="pt"></div></div></div></div>
      <div class="panel"><div class="head"><h2>Activity by Baybex</h2></div><div id="at"></div></div>`;
    dataTable($('#ut', v), d.users, [{ k: 'full_name', label: 'Name', f: r => `<b>${esc(r.full_name)}</b><div class="sub">@${esc(r.username)}</div>` }, { k: 'role', label: 'Role' }, { k: 'last_login', label: 'Last login', f: r => r.last_login ? `<span class="sub">${fdt(r.last_login)}</span>` : '<span class="muted">never</span>' }, { k: 'active', label: '', f: r => r.active ? '' : '<span class="tag gray">disabled</span>' },
      { k: 'x', label: '', sort: false, f: r => `<button class="btn xs ghost" data-pw="${r.id}">Reset password</button>` }], { search: false });
    dataTable($('#pt', v), d.payments, [{ k: 'created_at', label: 'Date', f: r => d10(r.created_at) }, { k: 'plan_name', label: 'Plan' }, { k: 'amount', label: 'Amount', n: 1, f: r => tk(r.amount) }, { k: 'txn_id', label: 'Txn', f: r => `${esc(r.method || '')} ${esc(r.txn_id || '')}` }, { k: 'status', label: 'Status', f: r => `<span class="tag ${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'orange'}">${r.status}</span>` }, { k: 'period_to', label: 'Until', f: r => d10(r.period_to) }], { search: false, empty: 'No payments' });
    dataTable($('#at', v), d.audit, [{ k: 'created_at', label: 'When', f: r => fdt(r.created_at) }, { k: 'admin_name', label: 'By' }, { k: 'action', label: 'Action', f: r => `<span class="tag gray">${esc(r.action)}</span>` }, { k: 'details', label: 'Details', f: r => `<span class="sub">${esc(JSON.stringify(r.details || '')).slice(0, 160)}</span>` }], { search: false, empty: 'No activity' });
    const put = async extra => { const b = { ...formData($('#tf', v)), ...extra }; ['trial_ends_at', 'expires_at'].forEach(k => b[k] = b[k] ? new Date(b[k]).toISOString() : null); await PUT('/api/super/tenants/' + id, b); };
    $('#save', v).onclick = () => busy($('#save', v), async () => { await put(); toast('Saved'); SA.refresh(); });
    if ($('#sus', v)) $('#sus', v).onclick = async () => { if (await confirmBox('Suspend business?', 'Their users are logged out and cannot log in until re-activated. Data is kept.', { ok: 'Suspend', danger: true })) { await put({ status: 'suspended' }).catch(fail); SA.refresh(); } };
    if ($('#act', v)) $('#act', v).onclick = async () => { await put({ status: t.expires_at && new Date(t.expires_at) > new Date() ? 'active' : 'trial' }).catch(fail); toast('Re-activated'); SA.refresh(); };
    $('#imp', v).onclick = () => busy($('#imp', v), async () => { const r = await POST(`/api/super/tenants/${id}/impersonate`, {}, { idem: false }); window.open(r.url, '_blank'); });
    $('#bk', v).onclick = () => busy($('#bk', v), async () => { const r = await api('GET', `/api/super/tenants/${id}/backup`, null, { raw: true }); saveBlob(await r.blob(), `${t.slug}-backup-${App.today}.json`); });
    $('#sub', v).onclick = () => {
      const m = modal({ title: 'Add subscription — ' + t.business_name, body: `<div class="form f2" id="sf">${field('Plan', `<select name="plan_id">${SA.planOptions(t.plan_id || SA.plans[0]?.id, '— choose —')}</select>`)}${field('Amount received (৳)', '<input type="number" name="amount" placeholder="plan price">')}
        ${field('Method', `<select name="method">${['Cash', 'bKash', 'Nagad', 'Rocket', 'Bank', 'Free / complimentary'].map(x => opt(x, x)).join('')}</select>`)}${field('Transaction ID', '<input name="txn_id">')}${field('Note', '<input name="note">', 'span2')}</div>
        <div class="note">The new period starts after the current trial / paid period ends, so no days are lost.</div><div class="actions"><button class="btn green" id="ss">Activate</button></div>` });
      $('#ss', m.el).onclick = () => busy($('#ss', m.el), async () => { const r = await POST(`/api/super/tenants/${id}/extend`, formData($('#sf', m.el)), { idem: false }); toast('Subscription active', 'until ' + d10(r.to)); m.close(); SA.refresh(); });
    };
    $('#days', v).onclick = async () => { const n = await confirmBox('Give free days', `Adds days to the ${t.status === 'trial' ? 'trial' : 'paid period'} without a payment.`, { ok: 'Add days', input: 'Number of days' }); if (n) { try { const r = await POST(`/api/super/tenants/${id}/extend`, { days: +n }, { idem: false }); toast('Extended', 'until ' + d10(r.to)); SA.refresh(); } catch (e) { fail(e); } } };
    v.addEventListener('click', async e => { const b = e.target.closest('[data-pw]'); if (!b) return; const pw = await confirmBox('Reset password', 'Set a new password for this user. Tell them to change it after logging in.', { ok: 'Reset', input: 'New password (min 6)' }); if (pw) { try { await POST(`/api/super/tenants/${id}/reset-password`, { user_id: +b.dataset.pw, password: pw }, { idem: false }); toast('Password reset'); } catch (er) { fail(er); } } });
    $('#del', v).onclick = async () => { const c = await confirmBox('Delete business permanently?', `All data of <b>${esc(t.business_name)}</b> is destroyed and cannot be recovered. Download a backup first. Type the Business ID <b>${esc(t.slug)}</b> to confirm.`, { ok: 'Delete forever', danger: true, input: 'Business ID' }); if (c) { try { await api('DELETE', '/api/super/tenants/' + id, { confirm: c }); toast('Business deleted'); SA.go('tenants'); } catch (er) { fail(er); } } };
  },
};

/* ---------- payments ---------- */
SA.pages.payments = {
  title: 'Subscription Payments',
  async render(v) {
    const st = this.st ?? 'pending';
    const rows = await GET('/api/super/payments', { status: st });
    v.innerHTML = `<div class="head"><div class="chip-row">${[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([k, l]) => `<button class="chip ${k === st ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <div class="sub">Check the transaction in your bKash / Nagad account before approving</div></div><div class="panel"><div id="pt"></div></div>`;
    $$('[data-s]', v).forEach(b => b.onclick = () => { this.st = b.dataset.s; SA.refresh(); });
    dataTable($('#pt', v), rows, [
      { k: 'created_at', label: 'Submitted', f: r => fdt(r.created_at) }, { k: 'business_name', label: 'Business', f: r => `<a href="#/tenants/${r.tenant_id}"><b>${esc(r.business_name)}</b></a><div class="sub">${esc(r.slug)} · by ${esc(r.submitted_by || '')}</div>` },
      { k: 'plan_name', label: 'Plan', f: r => `${esc(r.plan_name)}<div class="sub">${r.months} month(s)</div>` }, { k: 'amount', label: 'Amount', n: 1, f: r => `<b>${tk(r.amount)}</b>${r.original_amount && r.original_amount > r.amount ? `<div class="sub"><span class="strike">${tk(r.original_amount)}</span>${r.coupon_code ? ' · ' + esc(r.coupon_code) : ''}</div>` : ''}`, total: d => tk(d.reduce((a, r) => a + r.amount, 0)) },
      { k: 'txn_id', label: 'Transaction', f: r => `${esc(r.method || '')} <b>${esc(r.txn_id || '')}</b><div class="sub">from ${esc(r.sender || '—')}</div>` },
      { k: 'status', label: 'Status', f: r => `<span class="tag ${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'orange'}">${r.status}</span>${r.reviewed_by ? `<div class="sub">${esc(r.reviewed_by)}</div>` : ''}${r.reject_reason ? `<div class="sub">${esc(r.reject_reason)}</div>` : ''}` },
      { k: 'period_to', label: 'Period', f: r => r.period_from ? `${d10(r.period_from)} → ${d10(r.period_to)}` : '' },
      { k: 'x', label: '', sort: false, f: r => r.status === 'pending' ? `<button class="btn xs green" data-ok="${r.id}">Approve</button> <button class="btn xs ghost" data-no="${r.id}">Reject</button>` : '' },
    ], { totals: true, empty: 'Nothing here' });
    v.onclick = async e => {
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
      if (ok) { const r = rows.find(x => x.id === +ok.dataset.ok); if (await confirmBox('Approve payment?', `${esc(r.business_name)} — ${esc(r.plan_name)} · ${tk(r.amount)} · ${esc(r.method)} ${esc(r.txn_id)}. Their subscription is extended immediately.`, { ok: 'Approve' })) { try { const p = await POST(`/api/super/payments/${r.id}/approve`, {}, { idem: false }); toast('Approved', 'active until ' + d10(p.to)); SA.refresh(); } catch (er) { fail(er); } } }
      if (no) { const reason = await confirmBox('Reject payment?', 'The business will see this reason.', { ok: 'Reject', danger: true, input: 'Reason' }); if (reason) { try { await POST(`/api/super/payments/${no.dataset.no}/reject`, { reason }, { idem: false }); toast('Rejected'); SA.refresh(); } catch (er) { fail(er); } } }
    };
  },
};

/* ---------- plans, discounts & coupons ---------- */
const priceHTML = (p, big = true) => `${p.discount_active ? `<span class="strike">৳${n0(p.original_price)}</span> ` : ''}<span class="${big ? 'big-num' : 'bold'}">৳${n0(p.final_price)}</span>`;
const discTag = p => p.discount_active ? `<span class="tag red">${esc(p.discount_text)}</span>${p.discount_ends ? `<span class="sub"> until ${d10(p.discount_ends)}</span>` : ''}` : '';
SA.pages.plans = {
  title: 'Plans & Pricing',
  async render(v) {
    const [plans, coupons] = await Promise.all([GET('/api/super/plans'), GET('/api/super/coupons')]);
    SA.plans = plans;
    v.innerHTML = `<div class="head"><div class="sub">Everything here is shown live on the website, the brochure and every business's Subscription page</div>
        <div class="row"><button class="btn ghost" id="bulk">% Discount offer on many plans</button><button class="btn teal" id="np">${ICON.plus} New plan</button></div></div>
      <div class="quick" style="grid-template-columns:repeat(${Math.min(4, Math.max(1, plans.length))},1fr)">${plans.map(p => `<button class="plan-card ${p.highlight ? 'on' : ''}" data-e="${p.id}" style="${p.active ? '' : 'opacity:.5'}">
        <div class="row" style="gap:6px">${p.badge ? `<span class="tag orange">${esc(p.badge)}</span>` : ''}${discTag(p)}${p.active ? '' : '<span class="tag gray">Hidden</span>'}</div>
        <b>${esc(p.name)}</b><div>${priceHTML(p)}</div><small>${p.months} month(s) · ≈ ৳${n0(Math.round(p.per_month))}/mo</small>
        <small>${p.tenants} business(es) · revenue ৳${n0(p.revenue)}</small><small style="color:var(--blue)">Click to edit</small></button>`).join('')}</div>
      <div class="panel"><div class="head"><div><h2>Coupon codes</h2><div class="sub">Businesses type the code on their Subscription page · applied after the plan discount · counted when you approve the payment</div></div><button class="btn sm teal" id="nc">${ICON.plus} New coupon</button></div><div id="ct"></div></div>`;
    $('#np', v).onclick = () => this.edit(null);
    $$('[data-e]', v).forEach(b => b.onclick = () => this.edit(plans.find(p => p.id === +b.dataset.e)));
    $('#bulk', v).onclick = () => this.bulk(plans);
    $('#nc', v).onclick = () => this.coupon(null, plans);
    dataTable($('#ct', v), coupons, [
      { k: 'code', label: 'Code', f: r => `<b style="font-family:monospace;font-size:13px">${esc(r.code)}</b>${r.note ? `<div class="sub">${esc(r.note)}</div>` : ''}` },
      { k: 'value', label: 'Discount', f: r => `<span class="tag red">${r.type === 'percent' ? +r.value + '% OFF' : '৳' + n0(r.value) + ' OFF'}</span>` },
      { k: 'plan_ids', label: 'Plans', f: r => (r.plan_ids || []).length ? r.plan_ids.map(id => esc(plans.find(p => p.id === +id)?.name || '#' + id)).join(', ') : 'All plans' },
      { k: 'used', label: 'Used', n: 1, f: r => `${r.used}${r.max_uses ? ' / ' + r.max_uses : ''}` }, { k: 'given', label: 'Discount given', n: 1, f: r => tk(r.given) },
      { k: 'ends_at', label: 'Valid', f: r => `<span class="sub">${r.starts_at ? d10(r.starts_at) : 'now'} → ${r.ends_at ? d10(r.ends_at) : 'no end'}</span>` },
      { k: 'active', label: 'Status', f: r => { const exp = r.ends_at && new Date(r.ends_at) < new Date(), full = r.max_uses && r.used >= r.max_uses; return !r.active ? '<span class="tag gray">Off</span>' : exp ? '<span class="tag gray">Expired</span>' : full ? '<span class="tag gray">Used up</span>' : '<span class="tag green">Active</span>'; } },
    ], { search: false, onRow: r => this.coupon(r, plans), empty: 'No coupons yet' });
  },
  edit(p) {
    const dt = p?.discount_type || 'none';
    const m = modal({ title: p ? 'Edit plan — ' + p.name : 'New plan', size: 'xwide', body: `<div class="grid" style="grid-template-columns:1.6fr 1fr;align-items:start">
      <div><div class="form f2" id="pf">
        ${field('Plan name <span class="req">*</span>', `<input name="name" value="${esc(p?.name || '')}" placeholder="e.g. 6 Months">`)}${field('Duration (months) <span class="req">*</span>', `<input type="number" min="1" name="months" value="${p?.months || 1}">`)}
        ${field('Regular price (৳) <span class="req">*</span>', `<input type="number" min="0" step="1" name="price" value="${p?.price ?? 500}">`)}${field('Badge', `<input name="badge" value="${esc(p?.badge || '')}" placeholder="e.g. Popular / Best value">`)}
        ${field('Short description', `<input name="description" value="${esc(p?.description || '')}">`, 'span2')}
        ${field('Features (one per line)', `<textarea name="features" rows="6">${esc((p?.features || []).join('\n'))}</textarea>`, 'span2', 'shown on the website and Subscription page')}
        ${field('Button text', `<input name="button_text" value="${esc(p?.button_text || '')}" placeholder="Start free trial">`)}${field('Display order', `<input type="number" name="sort" value="${p?.sort ?? (SA.plans.length + 1)}">`)}
        <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Visible for purchase</label><label class="check"><input type="checkbox" name="highlight" ${p?.highlight ? 'checked' : ''}> Highlight this plan</label></div>
        <div class="divider"></div><h2 style="font-size:14px">Discount</h2>
        <div class="seg mt" id="dt">${[['none', 'No discount'], ['percent', '% Percentage'], ['flat', '৳ Flat amount']].map(([k, l]) => `<button type="button" data-d="${k}" class="${k === dt ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="form f2 mt" id="df">${field('Discount value', `<input type="number" min="0" step="0.01" name="discount_value" value="${p?.discount_value || ''}" placeholder="e.g. 20">`, '', '<span id="dvh"></span>')}
          ${field('Label on price', `<input name="discount_label" value="${esc(p?.discount_label || '')}" placeholder="auto: 20% OFF · e.g. Eid Offer">`)}
          ${field('Starts (optional)', `<input type="datetime-local" name="discount_starts" value="${toLocalInput(p?.discount_starts)}">`)}${field('Ends (optional)', `<input type="datetime-local" name="discount_ends" value="${toLocalInput(p?.discount_ends)}">`, '', 'price goes back to normal automatically')}</div>
        <div class="note">Price changes affect new payments only. Running subscriptions are never changed.</div></div>
      <div style="position:sticky;top:0"><div class="sub mb">Live preview</div><div id="pv"></div></div></div>
      <div class="actions">${p ? '<button class="btn ghost" id="pdel" style="color:var(--danger)">Delete</button>' : ''}<button class="btn" id="ps">${ICON.check} Save plan</button></div>` });
    let type = dt;
    const read = () => ({ ...formData($('#pf', m.el)), ...formData($('#df', m.el)), discount_type: type, features: $('[name=features]', m.el).value.split('\n').map(x => x.trim()).filter(Boolean) });
    const preview = () => {
      const b = read(), price = +b.price || 0, val = +b.discount_value || 0; const now = Date.now();
      const live = type !== 'none' && val > 0 && (!b.discount_starts || new Date(b.discount_starts) <= now) && (!b.discount_ends || new Date(b.discount_ends) >= now);
      const off = live ? (type === 'percent' ? Math.round(price * Math.min(100, val)) / 100 : Math.min(price, val)) : 0, fin = Math.max(0, price - off);
      $('#dvh', m.el).textContent = type === 'percent' ? `= ৳${n0(price * Math.min(100, val) / 100)} off` : type === 'flat' ? `= ${price ? Math.round(val / price * 100) : 0}% off` : '';
      $$('#df input', m.el).forEach(i => (i.disabled = type === 'none'));
      const label = b.discount_label || (type === 'percent' ? `${val}% OFF` : `৳${n0(off)} OFF`);
      $('#pv', m.el).innerHTML = `<div class="plan-card ${b.highlight ? 'on' : ''}" style="cursor:default"><div class="row" style="gap:6px">${b.badge ? `<span class="tag orange">${esc(b.badge)}</span>` : ''}${off ? `<span class="tag red">${esc(label)}</span>` : ''}</div>
        <b>${esc(b.name || 'Plan name')}</b><div>${off ? `<span class="strike">৳${n0(price)}</span> ` : ''}<span class="big-num">৳${n0(fin)}</span></div>
        <small>${(+b.months || 1) > 1 ? `≈ ৳${n0(fin / (+b.months || 1))} / month` : 'per month'}${off ? ` · save ৳${n0(off)}` : ''}</small><small>${esc(b.description || '')}</small>
        <ul style="margin:6px 0 0;padding-left:16px;font-size:12px;color:var(--ink2)">${(b.features.length ? b.features : ['All features']).map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <span class="btn sm" style="margin-top:8px">${esc(b.button_text || 'Start free trial')}</span></div>
        ${type !== 'none' && val > 0 && !live ? '<div class="note warn mt">Discount is scheduled / expired — not live right now.</div>' : ''}`;
    };
    $$('#dt button', m.el).forEach(x => x.onclick = () => { type = x.dataset.d; $$('#dt button', m.el).forEach(y => y.classList.toggle('on', y === x)); preview(); });
    m.el.addEventListener('input', preview); m.el.addEventListener('change', preview); preview();
    $('#ps', m.el).onclick = () => busy($('#ps', m.el), async () => { if (!requireFields(m.el, ['name', 'months', 'price'])) return; const b = read(); ['discount_starts', 'discount_ends'].forEach(k => (b[k] = b[k] ? new Date(b[k]).toISOString() : null));
      if (p) await PUT('/api/super/plans/' + p.id, b); else await POST('/api/super/plans', b, { idem: false }); toast('Plan saved'); m.close(); SA.refresh(); });
    if ($('#pdel', m.el)) $('#pdel', m.el).onclick = async () => { if (await confirmBox('Delete plan?', 'Only plans never used by a business can be deleted. Otherwise untick “Visible”.', { ok: 'Delete', danger: true })) { try { await api('DELETE', '/api/super/plans/' + p.id); toast('Plan deleted'); m.close(); SA.refresh(); } catch (e) { fail(e); } } };
  },
  bulk(plans) {
    const m = modal({ title: 'Discount offer on several plans', size: 'wide', body: `<div class="sub mb">Example: Eid offer 20% off on all plans until a date. Choose “No discount” to remove offers.</div>
      <div class="chip-row mb" id="bp">${plans.map(p => `<label class="check chip"><input type="checkbox" value="${p.id}" checked> ${esc(p.name)} · ৳${n0(p.price)}</label>`).join('')}</div>
      <div class="seg" id="bt"><button type="button" data-d="percent" class="on">% Percentage</button><button type="button" data-d="flat">৳ Flat amount</button><button type="button" data-d="none">No discount</button></div>
      <div class="form f4 mt" id="bf">${field('Value', '<input type="number" name="discount_value" placeholder="20">')}${field('Label', '<input name="discount_label" placeholder="Eid Offer">')}${field('Starts', '<input type="datetime-local" name="discount_starts">')}${field('Ends', '<input type="datetime-local" name="discount_ends">')}</div>
      <div class="actions"><button class="btn teal" id="bs">Apply to selected plans</button></div>` });
    let type = 'percent';
    $$('#bt button', m.el).forEach(x => x.onclick = () => { type = x.dataset.d; $$('#bt button', m.el).forEach(y => y.classList.toggle('on', y === x)); });
    $('#bs', m.el).onclick = () => busy($('#bs', m.el), async () => { const b = formData($('#bf', m.el)); ['discount_starts', 'discount_ends'].forEach(k => (b[k] = b[k] ? new Date(b[k]).toISOString() : null));
      await POST('/api/super/plans/bulk-discount', { ...b, discount_type: type, plan_ids: $$('#bp input:checked', m.el).map(i => +i.value) }, { idem: false }); toast('Discount applied'); m.close(); SA.refresh(); });
  },
  coupon(c, plans) {
    const m = modal({ title: c ? 'Edit coupon ' + c.code : 'New coupon code', body: `<div class="form f2" id="cf">
      ${field('Code <span class="req">*</span>', `<input name="code" value="${esc(c?.code || '')}" placeholder="EID25" style="text-transform:uppercase;font-family:monospace">`)}
      <div class="field">Type<div class="seg" id="ctp"><button type="button" data-d="percent" class="${!c || c.type === 'percent' ? 'on' : ''}">% Percentage</button><button type="button" data-d="flat" class="${c?.type === 'flat' ? 'on' : ''}">৳ Flat</button></div></div>
      ${field('Discount value <span class="req">*</span>', `<input type="number" step="0.01" min="0" name="value" value="${c?.value || ''}">`)}${field('Max uses', `<input type="number" min="0" name="max_uses" value="${c?.max_uses || 0}">`, '', '0 = unlimited')}
      ${field('Starts', `<input type="datetime-local" name="starts_at" value="${toLocalInput(c?.starts_at)}">`)}${field('Ends', `<input type="datetime-local" name="ends_at" value="${toLocalInput(c?.ends_at)}">`)}
      <div class="field span2">Valid for plans <span class="hint">none ticked = all plans</span><div class="chip-row" id="cpl" style="margin-top:6px">${plans.map(p => `<label class="check chip"><input type="checkbox" value="${p.id}" ${(c?.plan_ids || []).map(Number).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div></div>
      ${field('Internal note', `<input name="note" value="${esc(c?.note || '')}" placeholder="e.g. Facebook campaign Nov">`, 'span2')}<label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Active</label></div>
      <div class="actions">${c ? '<button class="btn ghost" id="cdel" style="color:var(--danger)">Delete</button>' : ''}<button class="btn" id="cs">Save coupon</button></div>` });
    let type = c?.type || 'percent';
    $$('#ctp button', m.el).forEach(x => x.onclick = () => { type = x.dataset.d; $$('#ctp button', m.el).forEach(y => y.classList.toggle('on', y === x)); });
    $('#cs', m.el).onclick = () => busy($('#cs', m.el), async () => { if (!requireFields(m.el, ['code', 'value'])) return; const b = { ...formData($('#cf', m.el)), type, plan_ids: $$('#cpl input:checked', m.el).map(i => +i.value) };
      ['starts_at', 'ends_at'].forEach(k => (b[k] = b[k] ? new Date(b[k]).toISOString() : null));
      if (c) await PUT('/api/super/coupons/' + c.id, b); else await POST('/api/super/coupons', b, { idem: false }); toast('Coupon saved'); m.close(); SA.refresh(); });
    if ($('#cdel', m.el)) $('#cdel', m.el).onclick = async () => { if (await confirmBox('Delete coupon?', 'Past payments keep their record.', { ok: 'Delete', danger: true })) { await api('DELETE', '/api/super/coupons/' + c.id).catch(fail); m.close(); SA.refresh(); } };
  },
};

/* ---------- platform settings ---------- */
SA.pages.settings = {
  title: 'Platform Settings',
  async render(v) {
    const s = await GET('/api/super/settings'); const b = s.brand || {}, pay = s.payment || { numbers: [] };
    let nums = [...(pay.numbers || [])];
    v.innerHTML = `<div class="grid g2"><div class="panel"><div class="head"><h2>Brand</h2></div><div class="form f2" id="bf">
        ${field('Company', `<input name="company" value="${esc(b.company || '')}">`)}${field('Product name', `<input name="product" value="${esc(b.product || '')}">`)}${field('Tagline', `<input name="tagline" value="${esc(b.tagline || '')}">`, 'span2')}
        ${field('Support phone', `<input name="phone" value="${esc(b.phone || '')}">`)}${field('Support email', `<input name="email" value="${esc(b.email || '')}">`)}${field('Website', `<input name="website" value="${esc(b.website || '')}">`)}</div></div>
      <div class="panel"><div class="head"><h2>Signup & trial</h2></div><div class="form f2">${field('Public base URL', `<input id="au" value="${esc(s.app_url || '')}" placeholder="https://print.baybexai.com">`, 'span2', 'used in brochure, QR codes and app links · empty = current address')}${field('Free trial days', `<input type="number" id="td" value="${s.trial_days}">`)}<label class="check" style="align-self:end"><input type="checkbox" id="so" ${s.signup_open ? 'checked' : ''}> Allow self signup on the website</label>
        ${field('Announcement to all businesses', `<input id="ann" value="${esc(s.announcement || '')}" placeholder="shown as a banner inside every business app">`, 'span2')}</div></div></div>
      <div class="panel"><div class="head"><div><h2>Payment receiving numbers</h2><div class="sub">Shown to businesses on their Subscription page</div></div><button class="btn sm light" id="an">${ICON.plus} Add number</button></div>
        <div id="nl"></div>${field('Payment instructions', `<textarea id="pi">${esc(pay.instructions || '')}</textarea>`)}</div>
      <div class="actions"><button class="btn" id="ss">${ICON.check} Save platform settings</button></div>`;
    const draw = () => $('#nl', v).innerHTML = `<div class="tbl-wrap mb"><table><thead><tr><th>Method</th><th>Number</th><th>Type</th><th></th></tr></thead><tbody>${nums.map((n, i) => `<tr data-i="${i}"><td><input class="inp" data-k="method" value="${esc(n.method)}"></td><td><input class="inp" data-k="number" value="${esc(n.number)}"></td><td><input class="inp" data-k="type" value="${esc(n.type || '')}" placeholder="Personal / Merchant / Agent"></td><td><button class="btn xs ghost" data-rm="${i}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">No numbers yet</div></td></tr>'}</tbody></table></div>`;
    draw();
    $('#nl', v).oninput = e => { const tr = e.target.closest('tr[data-i]'); if (tr) nums[+tr.dataset.i][e.target.dataset.k] = e.target.value; };
    $('#nl', v).onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { nums.splice(+b.dataset.rm, 1); draw(); } };
    $('#an', v).onclick = () => { nums.push({ method: 'bKash', number: '', type: 'Personal' }); draw(); };
    $('#ss', v).onclick = () => busy($('#ss', v), async () => {
      await PUT('/api/super/settings', { app_url: $('#au', v).value.trim().replace(/\/+$/, ''), brand: formData($('#bf', v)), trial_days: +$('#td', v).value || 7, signup_open: $('#so', v).checked, announcement: $('#ann', v).value.trim(),
        payment: { instructions: $('#pi', v).value, numbers: nums.filter(n => n.number.trim()) } });
      toast('Platform settings saved');
    });
  },
};

/* ---------- Android app releases ---------- */
SA.pages.android = {
  title: 'Android App Releases',
  async render(v) {
    const rows = await GET('/api/super/app/releases'); const latest = rows.find(r => r.active);
    const next = (rows[0]?.version_code || 0) + 1;
    v.innerHTML = `<div class="grid g23 mb"><div class="panel"><div class="head"><div><h2>Upload new version</h2><div class="sub">Build the APK in Android Studio (Build → Generate Signed APK), then upload it here</div></div></div>
        <div class="form f2" id="uf"><div class="field span2">APK file <span class="req">*</span><input type="file" id="apk" accept=".apk,application/vnd.android.package-archive"></div>
        ${field('Version code <span class="req">*</span>', `<input type="number" name="version_code" value="${next}">`, '', 'must equal versionCode in app/build.gradle.kts')}
        ${field('Version name <span class="req">*</span>', `<input name="version_name" placeholder="1.0.${next - 1}">`, '', 'versionName, e.g. 1.0.1')}
        ${field("What's new", '<textarea name="notes" placeholder="• Faster invoice screen&#10;• Bug fixes"></textarea>', 'span2')}
        <label class="check"><input type="checkbox" name="force_update"> Force update (users cannot skip)</label>
        ${field('Minimum supported version code', '<input type="number" name="min_version_code" value="0">', '', 'older apps are forced to update')}</div>
        <div class="bar mt hide" id="upb" style="height:8px;--c:var(--pvc)"><i style="width:0;transition:width .2s"></i></div>
        <div class="actions"><button class="btn teal" id="up">${ICON.backup} Upload & publish</button></div></div>
      <div class="panel"><div class="head"><h2>Live version</h2></div>${latest ? `<div class="row" style="gap:14px"><img src="/brand/app-icon-512.png" style="width:64px;border-radius:16px"><div><div class="big-num">v${esc(latest.version_name)}</div><div class="sub">code ${latest.version_code} · ${(latest.size / 1048576).toFixed(1)} MB · ${latest.downloads} downloads</div></div></div>
        <div class="note mt">Every installed app older than code ${latest.version_code} shows an update popup on next launch${latest.force_update ? ' — <b>forced</b>' : ''}.</div>
        <div class="actions" style="justify-content:flex-start"><a class="btn sm light" href="/api/public/app/download">Download latest</a></div>` : '<div class="empty">No version uploaded yet</div>'}</div></div>
      <div class="panel"><div class="head"><h2>All versions</h2></div><div id="rt"></div></div>`;
    const upload = async () => {
      const f = $('#apk', v).files[0]; if (!f) return toast('Choose the APK file', '', 'warn');
      const b = formData($('#uf', v)); if (!b.version_code || !b.version_name.trim()) return toast('Enter version code and name', '', 'warn');
      const qs = new URLSearchParams({ ...b, force_update: String(!!b.force_update), file_name: f.name });
      const bar = $('#upb', v); bar.classList.remove('hide');
      await new Promise((res, rej) => {
        const x = new XMLHttpRequest(); x.open('POST', '/api/super/app/releases?' + qs); x.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
        x.upload.onprogress = e => e.lengthComputable && ($('i', bar).style.width = (e.loaded / e.total * 100) + '%');
        x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} x.status < 300 ? res(d) : rej(new Error(d.error || 'Upload failed')); };
        x.onerror = () => rej(new Error('Network error')); x.send(f);
      });
      toast('Version published', 'Apps will prompt users to update'); SA.refresh();
    };
    $('#up', v).onclick = () => busy($('#up', v), upload);
    dataTable($('#rt', v), rows, [
      { k: 'version_name', label: 'Version', f: r => `<b>v${esc(r.version_name)}</b><div class="sub">code ${r.version_code}</div>` }, { k: 'created_at', label: 'Uploaded', f: r => `${fdt(r.created_at)}<div class="sub">by ${esc(r.uploaded_by || '')}</div>` },
      { k: 'size', label: 'Size', n: 1, f: r => (r.size / 1048576).toFixed(1) + ' MB' }, { k: 'downloads', label: 'Downloads', n: 1 },
      { k: 'force_update', label: 'Update type', f: r => r.force_update ? '<span class="tag red">Forced</span>' : '<span class="tag">Optional</span>' + (r.min_version_code ? `<div class="sub">min code ${r.min_version_code}</div>` : '') },
      { k: 'active', label: 'Status', f: r => r.active ? (r === latest ? '<span class="tag green">Live</span>' : '<span class="tag gray">Older</span>') : '<span class="tag gray">Withdrawn</span>' },
      { k: 'notes', label: "What's new", f: r => `<span class="sub" style="white-space:pre-line">${esc(r.notes || '')}</span>` },
      { k: 'x', label: '', sort: false, f: r => `<button class="btn xs ghost" data-ed="${r.id}">Edit</button> <a class="btn xs ghost" href="/api/public/app/download/${r.version_code}">APK</a>` },
    ], { search: false, empty: 'Upload your first APK above' });
    v.addEventListener('click', e => {
      const b = e.target.closest('[data-ed]'); if (!b) return; const r = rows.find(x => x.id === +b.dataset.ed);
      const m = modal({ title: `v${r.version_name} (code ${r.version_code})`, body: `<div class="form f2" id="ef">${field("What's new", `<textarea name="notes">${esc(r.notes || '')}</textarea>`, 'span2')}
        <label class="check"><input type="checkbox" name="force_update" ${r.force_update ? 'checked' : ''}> Force update</label>${field('Minimum supported version code', `<input type="number" name="min_version_code" value="${r.min_version_code || 0}">`)}
        <label class="check"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Published (uncheck to withdraw a bad release — apps fall back to the previous version)</label></div>
        <div class="actions"><button class="btn ghost" id="dl" style="color:var(--danger)">Delete</button><button class="btn" id="es">Save</button></div>` });
      $('#es', m.el).onclick = () => busy($('#es', m.el), async () => { await PUT('/api/super/app/releases/' + r.id, formData($('#ef', m.el))); toast('Saved'); m.close(); SA.refresh(); });
      $('#dl', m.el).onclick = async () => { if (await confirmBox('Delete this version?', 'The APK file is removed permanently.', { ok: 'Delete', danger: true })) { await api('DELETE', '/api/super/app/releases/' + r.id).catch(fail); m.close(); SA.refresh(); } };
    });
  },
};

/* ---------- brochure ---------- */
SA.pages.brochure = {
  title: 'Brochure',
  async render(v) {
    const [files, cfg] = await Promise.all([GET('/api/super/files'), GET('/api/public/config')]);
    const f = files.find(x => x.key === 'brochure') || {};
    v.innerHTML = `<div class="grid g23 mb"><div class="panel"><div class="head"><div><h2>Sales brochure (PDF)</h2><div class="sub">Shown on the website, in every business's “App & Downloads” page, and on the QR code</div></div>${f.file_name ? '<span class="tag green">Custom upload</span>' : '<span class="tag">Built-in</span>'}</div>
        <div class="kv"><span>File</span><b>${esc(f.file_name || 'Built-in brochure (8 pages, Bangla)')}</b>${f.size ? `<span>Size</span><b>${(f.size / 1048576).toFixed(1)} MB</b><span>Uploaded</span><b>${fdt(f.updated_at)} by ${esc(f.updated_by)}</b><span>Downloads</span><b>${f.downloads}</b>` : ''}
          <span>Public link</span><b>${esc(cfg.base_url)}/api/public/brochure.pdf</b></div>
        <div class="actions" style="justify-content:flex-start"><a class="btn" href="/api/public/brochure.pdf">${ICON.backup} Download</a><a class="btn ghost" href="/brochure" target="_blank">${ICON.eye} Open live brochure</a>${f.file_name ? '<button class="btn ghost" id="rst">Use built-in again</button>' : ''}</div>
        <div class="divider"></div><h2>Replace with a new PDF</h2>
        <div class="row mt"><input type="file" id="pf" accept="application/pdf,.pdf" class="inp" style="max-width:320px"><button class="btn teal" id="up">${ICON.backup} Upload PDF</button></div></div>
      <div class="panel"><div class="head"><h2>Update phone, links or trial days</h2></div><ol class="small" style="padding-left:18px;display:grid;gap:6px">
        <li>Change phone, email, base URL or trial days in <a href="#/settings">Platform Settings</a>. (The brochure shows no prices.)</li>
        <li>Open the <a href="/brochure" target="_blank">live brochure</a> — it already shows the new values and QR codes.</li>
        <li>Press <b>Print / Save as PDF</b> → Destination “Save as PDF”, paper A4, margins None, ✓ Background graphics.</li>
        <li>Upload the saved PDF here.</li></ol></div></div>
      <div class="panel" style="padding:0;overflow:hidden"><iframe src="/api/public/brochure.pdf?view=1" style="width:100%;height:80vh;border:0;display:block"></iframe></div>`;
    $('#up', v).onclick = () => busy($('#up', v), async () => {
      const file = $('#pf', v).files[0]; if (!file) return toast('Choose a PDF file', '', 'warn');
      const r = await fetch('/api/super/files/brochure?file_name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed'); toast('Brochure updated'); SA.refresh();
    });
    if ($('#rst', v)) $('#rst', v).onclick = async () => { await api('DELETE', '/api/super/files/brochure').catch(fail); toast('Using built-in brochure'); SA.refresh(); };
  },
};

/* ---------- super admins & audit ---------- */
SA.pages.admins = {
  title: 'Super Admins',
  async render(v) {
    const rows = await GET('/api/super/admins');
    v.innerHTML = `<div class="head"><div class="sub">Baybex team members who can manage every business</div><button class="btn teal" id="na">${ICON.plus} Add super admin</button></div><div class="panel"><div id="at"></div></div>`;
    const form = a => { const m = modal({ title: a ? 'Edit ' + a.full_name : 'Add super admin', body: `<div class="form f2" id="af">${field('Full name', `<input name="full_name" value="${esc(a?.full_name || '')}">`)}${field('Username', `<input name="username" value="${esc(a?.username || '')}" ${a ? 'readonly' : ''}>`)}${field(a ? 'New password' : 'Password', '<input type="password" name="password" placeholder="min 8 characters">')}${a ? `<label class="check" style="align-self:end"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Active</label>` : ''}</div><div class="actions"><button class="btn" id="as">Save</button></div>` });
      $('#as', m.el).onclick = () => busy($('#as', m.el), async () => { const b = formData($('#af', m.el)); if (a) await PUT('/api/super/admins/' + a.id, b); else await POST('/api/super/admins', b, { idem: false }); toast('Saved'); m.close(); SA.refresh(); }); };
    $('#na', v).onclick = () => form(null);
    dataTable($('#at', v), rows, [{ k: 'full_name', label: 'Name', f: r => `<b>${esc(r.full_name)}</b><div class="sub">@${esc(r.username)}</div>` }, { k: 'last_login', label: 'Last login', f: r => r.last_login ? fdt(r.last_login) : 'never' }, { k: 'active', label: 'Status', f: r => r.active ? '<span class="tag green">Active</span>' : '<span class="tag gray">Disabled</span>' }], { onRow: form, search: false });
  },
};
SA.pages.audit = {
  title: 'Audit Log',
  async render(v) {
    const rows = await GET('/api/super/audit');
    v.innerHTML = '<div class="panel"><div id="at"></div></div>';
    dataTable($('#at', v), rows, [{ k: 'created_at', label: 'When', f: r => fdt(r.created_at) }, { k: 'admin_name', label: 'By' }, { k: 'action', label: 'Action', f: r => `<span class="tag ${/delete|reject|suspend/.test(r.action) ? 'red' : /approved|created|added/.test(r.action) ? 'green' : 'gray'}">${esc(r.action)}</span>` }, { k: 'business_name', label: 'Business', f: r => r.tenant_id ? `<a href="#/tenants/${r.tenant_id}">${esc(r.business_name || '#' + r.tenant_id)}</a>` : '' }, { k: 'details', label: 'Details', f: r => `<span class="sub">${esc(JSON.stringify(r.details || '')).slice(0, 200)}</span>` }], { pageSize: 100 });
  },
};
SA.start();
