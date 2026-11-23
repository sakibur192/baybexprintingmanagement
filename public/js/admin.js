/* Users, roles & permissions, settings, backup/restore, audit */
'use strict';
App.pages.admin = {
  title: 'Users & Settings', tab: null,
  async render(v, sub) {
    const tabs = [['users', 'Users', 'users'], ['roles', 'Roles & Permissions', 'users'], ['settings', 'Settings', 'settings'], ['sections', 'Sections (on / off & order)', 'settings'], ['backup', 'Backup & Restore', 'backup'], ['audit', 'Audit Log', 'audit']].filter(t => can(t[2]));
    if (sub) this.tab = sub;
    if (!this.tab || !tabs.find(t => t[0] === this.tab)) this.tab = tabs[0][0];
    v.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="pane" class="tabpane"></div>`;
    $$('[data-t]', v).forEach(b => b.onclick = () => { this.tab = b.dataset.t; App.go('admin/' + b.dataset.t); });   // keep the address in step, or #/admin/<tab> would pin the old tab
    await this[this.tab]($('#pane', v));
  },
  async users(el) {
    const [users, { roles }] = await Promise.all([GET('/api/users'), GET('/api/roles')]);
    el.innerHTML = `<div class="panel"><div class="head"><div><h2>Employee accounts</h2><div class="sub">Each employee logs in separately — every entry is signed with their name automatically</div></div><button class="btn" id="nu">${ICON.plus} Add employee</button></div><div id="ut"></div></div>`;
    const form = u => {
      const m = modal({
        title: u ? 'Edit ' + u.full_name : 'Add employee', body: `<div class="form f2" id="uf">
        ${field('Full name <span class="req">*</span>', `<input name="full_name" value="${esc(u?.full_name || '')}">`)}${field('Username <span class="req">*</span>', `<input name="username" value="${esc(u?.username || '')}" ${u ? 'readonly' : ''}>`)}
        ${field('Nickname', `<input name="nickname" value="${esc(u?.nickname || '')}" placeholder="optional · shown on challans">`)}
        ${field('Mobile', `<input name="phone" value="${esc(u?.phone || '')}">`)}${field('Role', `<select name="role_id">${roles.map(r => opt(r.id, r.name, u?.role_id)).join('')}</select>`)}
        ${field(u ? 'New password' : 'Password <span class="req">*</span>', `<input type="password" name="password" placeholder="${u ? 'leave blank to keep' : 'min 6 characters'}">`)}
        ${u ? `<label class="check" style="align-self:end"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active (can log in)</label>` : ''}</div>
        <div class="actions"><button class="btn" id="us">Save</button></div>`,
      });
      $('#us', m.el).onclick = () => busy($('#us', m.el), async () => {
        const b = formData($('#uf', m.el));
        if (u) await PUT('/api/users/' + u.id, b); else { if (!requireFields(m.el, ['full_name', 'username', 'password'])) return; await POST('/api/users', b, { idem: false }); }
        toast('Employee saved'); m.close(); await App.loadMeta(); App.refresh();
      });
    };
    $('#nu', el).onclick = () => form(null);
    dataTable($('#ut', el), users, [
      { k: 'full_name', label: 'Name', f: r => `<div class="row" style="gap:10px;flex-wrap:nowrap"><div class="avatar">${esc(r.full_name.split(' ').map(x => x[0]).join('').slice(0, 2))}</div><div><b>${esc(r.full_name)}</b>${r.nickname ? ` <span class="tag gray">${esc(r.nickname)}</span>` : ''}<div class="sub">@${esc(r.username)}</div></div></div>` },
      { k: 'role', label: 'Role', f: r => `<span class="tag">${esc(r.role || '')}</span>` }, { k: 'phone', label: 'Mobile' },
      { k: 'last_login', label: 'Last login', f: r => r.last_login ? fdt(r.last_login) : '<span class="muted">never</span>' },
      { k: 'active', label: 'Status', f: r => r.active ? '<span class="tag green">Active</span>' : '<span class="tag gray">Disabled</span>' },
    ], { onRow: form });
  },
  async roles(el) {
    const { roles, perms } = await GET('/api/roles');
    let sel = this.role || roles.find(r => r.name !== 'Admin')?.id || roles[0].id;
    const draw = () => {
      const r = roles.find(x => x.id === +sel);
      const groups = {};
      Object.entries(perms).forEach(([k, l]) => { const g = k.split('.')[0]; (groups[g] = groups[g] || []).push([k, l]); });
      el.innerHTML = `<div class="grid" style="grid-template-columns:260px 1fr"><div class="panel"><div class="head"><h2>Roles</h2><button class="btn xs" id="nr">${ICON.plus} New</button></div>
        <div class="feed">${roles.map(x => `<div class="feed-item" data-r="${x.id}" style="${x.id === +sel ? 'background:var(--blue-soft)' : ''}"><div class="feed-ic" style="background:${x.name === 'Admin' ? '#172b43' : 'var(--blue)'}">${esc(x.name.slice(0, 2).toUpperCase())}</div><div class="t"><b>${esc(x.name)}</b><small>${x.users} user(s) · ${x.permissions.length} permissions</small></div></div>`).join('')}</div></div>
        <div class="panel"><div class="head"><div><h2>${esc(r.name)} — permissions</h2><div class="sub">${r.name === 'Admin' ? 'Admin always has full access' : 'Tick what this role may do. Enforced on the server for every request.'}</div></div>${r.name !== 'Admin' ? '<button class="btn" id="sp">Save permissions</button>' : ''}</div>
        ${Object.entries(groups).map(([g, ps]) => `<div class="mb"><div class="cap" style="color:var(--muted);padding-left:0">${esc(g.toUpperCase())}</div><div class="perm-grid">${ps.map(([k, l]) => `<label class="check"><input type="checkbox" value="${k}" ${r.permissions.includes(k) ? 'checked' : ''} ${r.name === 'Admin' ? 'disabled' : ''}> ${esc(l)}</label>`).join('')}</div></div>`).join('')}</div></div>`;
      $$('[data-r]', el).forEach(x => x.onclick = () => { sel = this.role = +x.dataset.r; draw(); });
      if ($('#sp', el)) $('#sp', el).onclick = () => busy($('#sp', el), async () => { const p = $$('.perm-grid input:checked', el).map(i => i.value); await PUT('/api/roles/' + r.id, { permissions: p }); r.permissions = p; toast('Permissions saved', r.name); draw(); });
      $('#nr', el).onclick = async () => { const name = await confirmBox('New role', 'Create a custom role, then tick its permissions.', { ok: 'Create', input: 'Role name' }); if (name) { try { const nr = await POST('/api/roles', { name, permissions: ['dashboard'] }, { idem: false }); this.role = nr.id; App.refresh(); } catch (e) { fail(e); } } };
    };
    draw();
  },
  async settings(el) {
    const d = await GET('/api/settings'); const c = d.settings.company || {}, p = d.settings.pvc || {}, ct = d.settings.ctp || {};
    const L = { ...{ payment_methods: [], wastage_reasons: [], expense_categories: [], ink_colors: [] }, ...(d.settings.lists || {}) };
    const SEQ = { ctp_inv: 'CTP invoice', pvc_inv: 'PVC invoice', ctp_dc: 'CTP challan', pvc_dc: 'PVC challan', receipt: 'Money receipt' };
    let logo = c.logo || '';
    el.innerHTML = `<div class="grid g23 mb"><div class="panel"><div class="head"><div><h2>Logo & colour</h2><div class="sub">Used on the app, invoices, challans and reports</div></div></div>
        <div class="row" style="gap:16px"><div class="logo-prev" id="lp">${logo ? `<img src="${esc(logo)}">` : '<span class="muted small">No logo</span>'}</div>
        <div style="display:grid;gap:8px"><input type="file" id="lf" accept="image/*" class="inp"><div class="row"><button class="btn xs ghost" id="lrm">Remove logo</button></div></div></div>
        <div class="mt"><div class="row" style="justify-content:space-between"><b class="small">Logo size on memo / invoice / challan</b><b id="lsv">${logoSize(c)} px</b></div>
          <div class="row" style="gap:10px;align-items:center"><button type="button" class="btn xs ghost" id="lsm">−</button><input type="range" id="ls" min="30" max="220" step="2" value="${logoSize(c)}" style="flex:1"><button type="button" class="btn xs ghost" id="lsp">+</button><button type="button" class="btn xs ghost" id="lsr">Reset</button></div>
          <div class="sub">Live preview of the top of your printed memo:</div>
          <div class="memo-prev"><div class="doc" id="lprev"></div></div></div>
        <div class="form f2 mt">${field('Brand colour', `<input type="color" id="col" value="${/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#2a7fd0'}" style="height:44px;padding:4px">`)}
        <label class="check" style="align-self:end"><input type="checkbox" id="coldef" ${c.color ? '' : 'checked'}> Use default blue</label></div></div>
      <div class="panel"><div class="head"><h2>Business details</h2><span class="sub">Shown on invoices, challans and reports</span></div><div class="form" id="cf">
      ${['name:Business name', 'tagline:Tagline', 'address:Invoice address', 'challan_address:Challan address', 'phone_ctp:Mobile (CTP)', 'phone_manager:Mobile (Manager)', 'email:Email', 'email2:Email 2'].map(x => { const [k, l] = x.split(':'); return field(l, `<input name="${k}" value="${esc(c[k] || '')}">`); }).join('')}</div></div></div>
      <div class="panel"><div class="head"><h2>Documents</h2><span class="sub">Titles and footer text on printed documents</span></div><div class="form" id="df">
        ${field('CTP invoice title', `<input name="ctp_invoice_title" value="${esc(c.ctp_invoice_title || 'BILL / ORDER SHEET')}">`)}${field('PVC invoice title', `<input name="pvc_invoice_title" value="${esc(c.pvc_invoice_title || 'PVC / DIGITAL PRINT INVOICE')}">`)}${field('Challan title', `<input name="challan_title" value="${esc(c.challan_title || 'DELIVERY CHALLAN')}">`)}<label class="check span2"><input type="checkbox" name="ctp_invoice_all_sizes" ${c.ctp_invoice_all_sizes ? 'checked' : ''}> CTP invoice: list every plate size (like the paper order sheet). Off = only plates on the bill, shorter print.</label>
        ${field('Invoice footer note', `<textarea name="invoice_note">${esc(c.invoice_note || '')}</textarea>`, 'span3')}${field('Challan footer note', `<textarea name="challan_note">${esc(c.challan_note || '')}</textarea>`, 'span3')}</div></div>
      <div class="panel"><div class="head"><div><h2>Dropdown lists</h2><div class="sub">Type and press Enter to add · × to remove</div></div></div><div class="form f2">
        ${[['payment_methods', 'Payment methods'], ['expense_categories', 'Expense categories'], ['wastage_reasons', 'PVC wastage reasons'], ['ink_colors', 'Ink colours']].map(([k, l]) => `<div class="field">${l}<div class="list-ed" data-list="${k}"></div></div>`).join('')}</div></div>
      <div class="grid g2"><div class="panel"><div class="head"><div><h2>Number sequences</h2><div class="sub">“Last issued” — set it to continue from your paper books (e.g. 1541 → next is 1542). Cannot be lowered once numbers are used.</div></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Series</th><th>Prefix</th><th class="n">Last issued</th><th>Next number</th></tr></thead><tbody>${d.sequences.map(s => `<tr data-seq="${s.key}"><td>${SEQ[s.key] || s.key}</td><td><input class="inp" style="width:120px" data-k="prefix" value="${esc(s.prefix)}"></td><td class="n"><input class="inp" style="width:110px;text-align:right" type="number" data-k="last_no" value="${s.last_no}"></td><td class="sub" data-next>${esc(s.prefix + String(s.last_no + 1).padStart(s.pad, '0'))}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="panel"><div class="head"><h2>Stock settings</h2></div><div class="form f2" id="pf">
        ${field('Default PVC roll length (ft)', `<input type="number" name="default_roll_length" value="${p.default_roll_length || 164}">`)}${field('Default PVC low-stock alert (ft)', `<input type="number" name="default_low_stock" value="${p.default_low_stock || 20}">`)}
        <label class="check span2"><input type="checkbox" name="allow_nesting" ${p.allow_nesting !== false ? 'checked' : ''}> Allow placing several artworks side-by-side across the roll width (nesting)</label>
        <label class="check span2"><input type="checkbox" id="neg" ${ct.allow_negative_stock ? 'checked' : ''}> Allow CTP sales when plate stock is not enough (not recommended)</label></div>
        <div class="note"><span>Plate sizes & rates: <a href="#/ctp/rates">CTP Inventory → Plate Master</a> · Media & widths: <a href="#/pvc/media">PVC Inventory → Media Master</a></span></div></div></div>
      <div class="actions" style="position:sticky;bottom:12px"><button class="btn" id="ss">${ICON.check} Save all settings</button></div>`;
    $$('[data-list]', el).forEach(box => {
      const k = box.dataset.list; let items = [...(L[k] || [])];
      const draw = () => { box.innerHTML = items.map((x, i) => `<span class="chip">${esc(x)}<button type="button" data-rm="${i}">×</button></span>`).join('') + `<input placeholder="Add…">`;
        $$('[data-rm]', box).forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); });
        const inp = $('input', box); inp.onkeydown = e => { if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); if (!items.includes(inp.value.trim())) items.push(inp.value.trim()); draw(); $('input', box).focus(); } }; };
      box._get = () => { const v = $('input', box).value.trim(); return v && !items.includes(v) ? [...items, v] : items; };
      draw();
    });
    $('#lf', el).onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image(), rd = new FileReader();
      rd.onload = () => { img.onload = () => { const m = 320, sc = Math.min(1, m / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = img.width * sc; cv.height = img.height * sc; cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); logo = cv.toDataURL('image/png'); $('#lp', el).innerHTML = `<img src="${logo}">`;  preview(); }; img.src = rd.result; };
      rd.readAsDataURL(f);
    };
    $('#lrm', el).onclick = () => { logo = ''; $('#lp', el).innerHTML = '<span class="muted small">No logo</span>'; preview(); };
    const preview = () => { const z = +$('#ls', el).value; $('#lsv', el).textContent = z + ' px';
      $('#lprev', el).innerHTML = companyHeader(`<div style="text-align:right"><div class="doc-title">${esc(formData($('#df', el)).ctp_invoice_title || 'INVOICE')}</div><div style="font-size:18px;font-weight:800;margin-top:8px">INV-00001</div></div>`, { ...c, ...formData($('#cf', el)), logo, logo_size: z }); };
    $('#ls', el).oninput = preview;
    $('#lsm', el).onclick = () => { $('#ls', el).value = +$('#ls', el).value - 4; preview(); };
    $('#lsp', el).onclick = () => { $('#ls', el).value = +$('#ls', el).value + 4; preview(); };
    $('#lsr', el).onclick = () => { $('#ls', el).value = LOGO_DEFAULT; preview(); };
    $('#cf', el).addEventListener('input', preview); $('#df', el).addEventListener('input', preview);
    preview();
    $$('[data-seq] input', el).forEach(i => i.oninput = () => { const tr = i.closest('tr'); const s = d.sequences.find(x => x.key === tr.dataset.seq); $('[data-next]', tr).textContent = $('[data-k=prefix]', tr).value + String((+$('[data-k=last_no]', tr).value || 0) + 1).padStart(s.pad, '0'); });
    $('#ss', el).onclick = () => busy($('#ss', el), async () => {
      const pv = formData($('#pf', el));
      await PUT('/api/settings', { settings: {
          company: { ...formData($('#cf', el)), ...formData($('#df', el)), logo, logo_size: +$('#ls', el).value, color: $('#coldef', el).checked ? '' : $('#col', el).value },
          pvc: { default_roll_length: +pv.default_roll_length, default_low_stock: +pv.default_low_stock, allow_nesting: pv.allow_nesting }, ctp: { allow_negative_stock: $('#neg', el).checked },
          lists: Object.fromEntries($$('[data-list]', el).map(b => [b.dataset.list, b._get()])) },
        sequences: $$('[data-seq]', el).map(tr => ({ key: tr.dataset.seq, prefix: $('[data-k=prefix]', tr).value, last_no: $('[data-k=last_no]', tr).value })) });
      await App.loadMeta(); App.applyBranding(); App.renderShell(); App.route(); toast('Settings saved');
    });
  },
  /* Sections: tenant decides which business sections exist for them and in which order they appear (menu, dashboard, reports) */
  async sections(el) {
    let { order, off } = secCfg(); off = [...off];
    const draw = () => {
      el.innerHTML = `${helpTip('sections', '<b>সেকশন:</b> আপনার ব্যবসায় যে বিভাগ নেই তা বন্ধ করুন — মেনু, ড্যাশবোর্ড ও রিপোর্ট থেকে সরে যাবে। পরে চালু করলে সব ডাটা আগের মতোই পাবেন। ▲▼ দিয়ে কোন সেকশন উপরে থাকবে ঠিক করুন।')}
        <div class="panel"><div class="head"><div><h2>Business sections</h2><div class="sub">Switch off what this business does not have · ▲ ▼ to choose which shows on top. Nothing is deleted — switching back on brings everything back.</div></div></div>
        <div class="seclist">${order.map((k, i) => { const S = SECTIONS.find(x => x.key === k), on = !off.includes(k); return `<div class="secrow ${on ? '' : 'off'}" data-k="${k}">
          <div class="secmove"><button class="btn xs ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button><button class="btn xs ghost" data-dn="${i}" ${i === order.length - 1 ? 'disabled' : ''} title="Move down">▼</button></div>
          <div class="secno">${i + 1}</div>
          <div style="flex:1"><b>${esc(S.label)}</b><div class="sub">${esc(S.bn)}</div></div>
          ${S.fixed ? '<span class="tag gray">Always on</span>' : `<label class="switch"><input type="checkbox" data-on="${k}" ${on ? 'checked' : ''}><span></span></label><b class="small" style="width:34px">${on ? 'ON' : 'OFF'}</b>`}</div>`; }).join('')}</div>
        <div class="actions"><button class="btn ghost" id="secreset">Default order</button><button class="btn" id="secsave">${ICON.check} Save sections</button></div></div>`;
      $$('[data-up]', el).forEach(b => b.onclick = () => { const i = +b.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); });
      $$('[data-dn]', el).forEach(b => b.onclick = () => { const i = +b.dataset.dn; [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); });
      $$('[data-on]', el).forEach(c => c.onchange = () => { const k = c.dataset.on; off = c.checked ? off.filter(x => x !== k) : [...off, k];
        if (['press', 'pvc', 'ctp'].every(x => off.includes(x))) { off = off.filter(x => x !== k); toast('Keep at least one of Press, PVC or CTP on', '', 'warn'); } draw(); });
      $('#secreset', el).onclick = () => { order = SECTIONS.map(x => x.key); draw(); };
      $('#secsave', el).onclick = () => busy($('#secsave', el), async () => {
        await PUT('/api/settings', { settings: { sections: { order, off } } });
        await App.loadMeta(); const me = await GET('/api/me'); App.user = me.user;   // permissions of switched-off sections are removed by the server
        App.renderShell(); App.route(); toast('Sections saved', off.length ? 'Switched off: ' + off.map(k => SECTIONS.find(x => x.key === k).label).join(', ') : 'All sections on');
      });
    };
    draw();
  },
  async backup(el) {
    el.innerHTML = `<div class="grid g2"><div class="panel"><div class="head"><div><h2>Download backup</h2><div class="sub">Complete copy of all business data as one file</div></div></div>
      <p class="small">Keep the backup file somewhere safe (USB drive, Google Drive). Take one at the end of every working day.</p><div class="actions" style="justify-content:flex-start"><button class="btn" id="bk">${ICON.backup} Download backup now</button></div></div>
      <div class="panel" style="border-color:#d9475a55"><div class="head"><div><h2>Restore from backup</h2><div class="sub">Replaces ALL current data with the backup file</div></div><span class="tag red">Danger</span></div>
      <input type="file" id="rf" accept=".json,application/json" class="inp"><div class="actions"><button class="btn danger" id="rs">Restore…</button></div></div></div>`;
    $('#bk', el).onclick = () => busy($('#bk', el), async () => {
      const r = await api('GET', '/api/backup', null, { raw: true }); saveBlob(await r.blob(), `${App.tenant?.slug || 'business'}-backup-${App.today}.json`); toast('Backup downloaded');
    });
    $('#rs', el).onclick = async () => {
      const f = $('#rf', el).files[0]; if (!f) return toast('Choose a backup file first', '', 'warn');
      let data; try { data = JSON.parse(await f.text()); } catch (e) { return toast('Not a valid backup file', '', 'err'); }
      const word = await confirmBox('Restore backup?', `Backup from <b>${esc(data.created_at || '?')}</b> by ${esc(data.created_by || '?')}. All current data will be replaced and everyone will be logged out. Type <b>RESTORE</b> to continue.`, { ok: 'Restore now', danger: true, input: 'Type RESTORE' });
      if (word !== 'RESTORE') return word && toast('Restore cancelled', 'You must type RESTORE', 'warn');
      try { await POST('/api/restore', { ...data, confirm: 'RESTORE' }, { idem: false }); toast('Restore complete', 'Please log in again'); setTimeout(() => location.reload(), 1200); } catch (e) { fail(e); }
    };
  },
  async audit(el) {
    const f = this.af || { from: addDays(App.today, -7), to: App.today, user: '' };
    el.innerHTML = `<div class="panel"><div class="row mb"><input type="date" class="inp" id="af" value="${f.from}" style="width:150px"><input type="date" class="inp" id="at" value="${f.to}" style="width:150px"><select class="inp" id="au" style="width:200px"><option value="">All users</option>${App.meta.users.map(u => opt(u.id, u.full_name, f.user)).join('')}</select><button class="btn sm" id="ago">Apply</button></div><div id="atbl"></div></div>`;
    $('#ago', el).onclick = () => { this.af = { from: $('#af', el).value, to: $('#at', el).value, user: $('#au', el).value }; App.refresh(); };
    const rows = await GET('/api/audit', f);
    dataTable($('#atbl', el), rows, [{ k: 'created_at', label: 'Time', f: r => fdt(r.created_at) }, { k: 'user_name', label: 'User' }, { k: 'role_name', label: 'Role' }, { k: 'action', label: 'Action', f: r => `<span class="tag ${['cancel', 'void', 'restore', 'delete_draft'].includes(r.action) ? 'red' : r.action === 'create' ? 'green' : 'gray'}">${esc(r.action)}</span>` }, { k: 'entity', label: 'Record', f: r => `${esc(r.entity || '')} ${r.entity_id ? '#' + esc(r.entity_id) : ''}` }, { k: 'details', label: 'Details', f: r => `<span class="sub">${esc(JSON.stringify(r.details || '')).slice(0, 180)}</span>` }], { pageSize: 100 });
  },
};
