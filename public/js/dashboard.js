/* Dashboard */
'use strict';
App.pages.dashboard = {
  title: 'Business Dashboard',
  period: 'month', range: null,
  async render(v) {
    const [from, to] = this.range || periodRange(this.period);
    const d = await GET('/api/dashboard', { from, to });
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const qa = [
      ['press-orders/new', 'New Press Order', 'Customer order · products · order sheet', 'c1', 'invoice', 'press.orders'],
      ['press-store/issues', 'Material Issue', 'Paper / ink / plate from store to a job', 'c2', 'box', 'press.store'],
      ['press-orders/counter', 'Counter Job', 'ID card · lamination · binding — bill now', 'c4', 'money', 'press.invoice'],
      ['pvc-print', 'PVC Print Entry', 'Bill in sq ft · deduct stock in linear ft', 'c3', 'print', 'pvc.print'],
      ['ctp-invoices/new', 'CTP Sales', 'Plate invoice · stock deducts on confirm', 'c1', 'plate', 'ctp.invoice'],
    ];
    const months = d.monthly.map(m => ({ ...m, label: new Date(m.month + '-01').toLocaleString('en', { month: 'short' }) }));
    const lowCount = d.low.ctp.length + d.low.pvc.length + (d.low.store || []).length, P = d.press || {};
    const maxPlate = Math.max(1, ...d.ctp.map(p => p.balance));
    const mediaShown = d.pvc.filter(m => m.balance !== 0 || m.printed || m.wastage);
    const inkColor = { Cyan: '#00aeef', Magenta: '#ec008c', Yellow: '#f5d800', Black: '#231f20' };
    v.innerHTML = `
      <div class="row mb" style="justify-content:space-between">
        <div><div class="sub">${greet}, ${esc(App.user.full_name.split(' ')[0])} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
        <div class="row">${periodChips(this.range ? 'custom' : this.period, ['today', 'month', 'lastmonth', 'year', 'custom'])}
          <span id="cust-range" class="row ${this.range ? '' : 'hide'}"><input type="date" class="inp" id="df" value="${from}" style="width:150px"><input type="date" class="inp" id="dt" value="${to}" style="width:150px"><button class="btn sm" id="dgo">Apply</button></span></div>
      </div>
      <div class="quick stagger" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${qa.filter(q => can(q[5])).map(q => `<button class="qa ${q[3]}" data-h="${q[0]}"><div class="ic">${ICON[q[4]]}</div><div><b>${q[1]}</b><small>${q[2]}</small></div><span class="go">${ICON.arrow.replace('<svg', '<svg width="18"')}</span></button>`).join('')}</div>
      <div class="stats stagger">
        <div class="stat" style="--c:var(--blue)"><small>Total Sales (all divisions)</small><b data-count-to="${d.sales.total}" data-fmt="tk">৳ 0</b><div class="foot">Press ${tk(d.sales.press)} · PVC ${tk(d.sales.pvc)} · CTP ${tk(d.sales.ctp)}</div>${sparkline(months.map(m => m.press + m.ctp + m.pvc))}</div>
        <div class="stat" style="--c:var(--ok)"><small>Net Collection</small><b data-count-to="${d.collection}" data-fmt="tk">৳ 0</b><div class="foot">Payments − refunds${d.refunds ? ` (refunded ${tk(d.refunds)})` : ''}</div>${sparkline(months.map(m => m.collection), '#1d9b6c')}</div>
        <div class="stat" style="--c:var(--danger)"><small>Total Outstanding</small><b data-count-to="${d.receivables.combined_due}" data-fmt="tk">৳ 0</b><div class="foot">Press ${tk(d.receivables.press_due)} · PVC ${tk(d.receivables.pvc_due)} · CTP ${tk(d.receivables.ctp_due)}</div></div>
        <div class="stat" style="--c:var(--warn)"><small>Monthly Expenses</small><b data-count-to="${d.expenses}" data-fmt="tk">৳ 0</b><div class="foot">${d.counts.customers} customers · ${d.sales.count} invoices</div>${sparkline(months.map(m => m.expenses || 0), '#e08a2e')}</div>
      </div>
      ${can('press.view', 'press.orders') ? `<div class="panel mb"><div class="head"><div><h2>Printing Press</h2><div class="sub">Orders · production · delivery — ${fdate(from)} → ${fdate(to)}</div></div><div class="row">${can('press.orders') ? '<button class="btn sm" data-h="press-orders/new">New order</button>' : ''}<button class="btn sm light" data-h="press-production">Production board</button></div></div>
        <div class="stats" style="grid-template-columns:repeat(4,1fr);margin:0">
          ${[['Total orders', P.orders, 'press-orders', 'var(--blue)', `${P.all_orders} all time`], ["Today's orders", P.today_orders, 'press-orders', 'var(--blue)', ''], ['Running production', P.running, 'press-production', 'var(--pvc)', `${P.jobs_running} jobs in progress`],
            ['Pending orders', P.pending, 'press-orders', 'var(--muted)', P.design_waiting ? `${P.design_waiting} designs await approval` : ''], ['Ready / part delivered', P.ready, 'press-orders', 'var(--teal)', ''], ['Completed', P.completed, 'press-orders', 'var(--ok)', `${P.to_invoice} to invoice`],
            ['Overdue jobs', P.overdue, 'press-orders', 'var(--danger)', 'past deadline'], ["Today's delivery", P.today_delivery, 'press-delivery', 'var(--ok)', 'challans today']].map(([l, n, h, c, f]) => `<div class="stat" style="--c:${c};cursor:pointer" data-h="${h}"><small>${l}</small><b data-count-to="${n || 0}">0</b><div class="foot">${f}</div></div>`).join('')}</div>
        ${P.void_requests ? `<div class="note danger mt"><a href="#/press-invoices/void_requested">${P.void_requests} invoice void request(s) waiting for approval</a></div>` : ''}
        <div class="grid g2 mt"><div><h2 style="font-size:13px">Overdue orders</h2><div class="feed mt">${(P.overdue_list || []).map(o => `<div class="feed-item" data-h="press-orders/${o.id}"><div class="feed-ic" style="background:var(--danger)">!</div><div class="t"><b>${esc(o.order_no)} · ${esc(o.customer)}</b><small>${esc(o.products || '')} · due ${fdate(o.deadline)}</small></div></div>`).join('') || '<div class="sub">None 🎉</div>'}</div></div>
          <div><h2 style="font-size:13px">Due in the next 2 days</h2><div class="feed mt">${(P.due_soon || []).map(o => `<div class="feed-item" data-h="press-orders/${o.id}"><div class="feed-ic" style="background:var(--warn)">⏱</div><div class="t"><b>${esc(o.order_no)} · ${esc(o.customer)}</b><small>${esc(o.products || '')} · ${fdate(o.deadline)}</small></div></div>`).join('') || '<div class="sub">Nothing due</div>'}</div></div></div></div>` : ''}
      ${lowCount ? `<div class="ribbon" style="background:linear-gradient(90deg,#fdf0e1,transparent)"><span class="dot pulse" style="color:var(--warn)"></span><b>Stock alerts:</b> ${[...(d.low.store || []).map(i => `<a href="#/press-store">${esc(i.name)} (${n0(i.balance)} ${esc(i.unit)})</a>`), ...d.low.pvc.map(m => `${esc(mediaName(m))} (${n0(m.balance)} ft)`), ...d.low.ctp.map(p => `${esc(p.name)} (${p.balance} pcs)`)].join(' · ')}</div>` : ''}
      <div class="grid g32 mb">
        <div class="panel"><div class="head"><div><h2>Monthly Sales & Collection</h2><div class="sub">Last 12 months · Press + PVC + CTP stacked, collection line</div></div>
          <div class="legend"><span><i style="background:#7b5cd6"></i>Press</span><span><i style="background:var(--pvc)"></i>PVC</span><span><i style="background:var(--ctp)"></i>CTP</span><span><i style="background:#e08a2e;height:3px"></i>Collection</span></div></div><div id="mchart"></div></div>
        <div class="panel"><div class="head"><div><h2>Period Snapshot</h2><div class="sub">${fdate(from)} → ${fdate(to)}</div></div></div>
          <div class="row" style="gap:18px;align-items:center"><div style="position:relative">${donut([{ v: d.sales.press, c: '#7b5cd6' }, { v: d.sales.pvc, c: 'var(--pvc)' }, { v: d.sales.ctp, c: 'var(--ctp)' }])}<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;font-size:10px;color:var(--muted)"><div><b style="font-size:15px;color:var(--ink)">${d.sales.total ? Math.round(d.sales.press / d.sales.total * 100) : 0}%</b><br>Press share</div></div></div>
          <div class="kv" style="flex:1"><span>Press invoices</span><b>${d.sales.press_n} · ${tk(d.sales.press)}</b><span>Plates sold</span><b>${n0(d.sales.plates)} pcs</b><span>PVC billed area</span><b>${n0(d.sales.sqft)} sq ft</b><span>Own use</span><b>${n0(d.own_use)} pcs</b><span>Print jobs</span><b>${d.prints.n} · ${n0(d.prints.sqft)} sq ft</b><span>Expenses</span><b>${tk(d.expenses)}</b><span>Customers</span><b>${d.counts.customers}</b></div></div>
          <div class="divider"></div>
          <div class="kv"><span>Advance / unallocated credit</span><b>${tk(d.receivables.unallocated)}</b><span>Opening dues (customers)</span><b>${tk(d.receivables.opening)}</b></div>
        </div>
      </div>
      <div class="grid g2 mb">
        <div class="panel"><div class="head"><div><h2>PVC / Media Division</h2><div class="sub">Roll stock (linear ft) · printed · wastage (period)</div></div><span class="tag teal">Sq ft billing</span></div>
          <div class="tbl-wrap" style="max-height:330px"><table><thead><tr><th>Media</th><th class="n">Printed ft</th><th class="n">Wastage ft</th><th class="n">Balance ft</th><th></th></tr></thead><tbody>
          ${mediaShown.length ? mediaShown.map(m => { const low = m.balance <= m.low_stock_ft; return `<tr><td>${esc(m.category)} <span class="muted">· ${+m.width_ft} ft</span></td><td class="n">${n0(m.printed)}</td><td class="n">${n0(m.wastage)}</td><td class="n bold">${n0(m.balance)}</td><td>${low ? '<span class="tag orange">Low</span>' : '<span class="tag green">OK</span>'}</td></tr>`; }).join('')
            : `<tr><td colspan="5"><div class="empty">${ICON.roll}No PVC stock yet. Record opening stock or a stock-in.</div></td></tr>`}</tbody></table></div>
          <div class="actions">${can('pvc.view') ? `<button class="btn light" data-h="pvc">Manage PVC</button>` : ''}${can('pvc.invoice') ? `<button class="btn teal" data-h="pvc-invoices/new">New PVC Invoice</button>` : ''}</div></div>
        <div class="panel"><div class="head"><div><h2>CTP Division</h2><div class="sub">Plate stock · production · sales · own use (period)</div></div><span class="tag">Per plate</span></div>
          <div class="plates">${d.ctp.map(p => `<div class="plate-tile ${p.balance <= p.low_stock ? 'low' : ''}" data-tip="<b>${esc(p.name)}</b><br>Rate ${tk(p.current_rate)}<br>Produced ${p.production} · Sold ${p.sales} · Own use ${p.own_use}"><b>${esc(p.name)}</b><small>${esc(p.alias || '')}</small>
            <div class="big" data-count-to="${p.balance}">0</div><small>pcs in stock</small><div class="sub">${tk(p.current_rate)} / plate</div><div class="bar" style="--c:${p.balance <= p.low_stock ? 'var(--warn)' : 'var(--ctp)'}"><i data-w="${Math.max(3, p.balance / maxPlate * 100)}"></i></div></div>`).join('')}</div>
          <div class="tbl-wrap mt"><table><thead><tr><th>Plate</th><th class="n">Production</th><th class="n">Sales</th><th class="n">Own use</th></tr></thead><tbody>${d.ctp.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${p.production}</td><td class="n">${p.sales}</td><td class="n">${p.own_use}</td></tr>`).join('')}</tbody></table></div>
          <div class="actions">${can('ctp.view') ? `<button class="btn light" data-h="ctp">Manage CTP</button>` : ''}${can('ctp.invoice') ? `<button class="btn" data-h="ctp-invoices/new">New CTP Invoice</button>` : ''}</div></div>
      </div>
      <div class="grid g3">
        <div class="panel"><div class="head"><div><h2>Recent Sales</h2><div class="sub">Press, PVC & CTP invoices</div></div></div>
          <div class="feed">${d.recent.length ? d.recent.map(r => `<div class="feed-item" data-h="${r.division}-invoices/${r.id}"><div class="feed-ic" style="background:${r.division === 'ctp' ? 'var(--ctp)' : r.division === 'press' ? '#7b5cd6' : 'var(--pvc)'};font-size:9px">${r.division === 'press' ? 'PRS' : r.division.toUpperCase()}</div><div class="t"><b>${esc(r.customer)}</b><small>${esc(r.inv_no)} · ${fdate(r.date)} · by ${esc(r.created_by_name || '')}</small></div><b class="num">${tk(r.grand_total)}</b></div>`).join('')
            : `<div class="empty">${ICON.invoice}Confirmed invoices will appear here.</div>`}</div></div>
        <div class="panel"><div class="head"><div><h2>Top Outstanding</h2><div class="sub">Customers with due balance</div></div>${can('accounts.view') ? '<a href="#/accounts" class="small">View all →</a>' : ''}</div><div id="topdue"><div class="sk" style="height:160px"></div></div></div>
        <div class="panel"><div class="head"><div><h2>Ink Stock</h2><div class="sub">CMYK · 1 bottle = 1 litre</div></div>${can('ink') ? '<a href="#/ink" class="small">Add ink →</a>' : ''}</div>
          <div class="inks">${d.ink.map(i => `<div class="inkd"><div class="drop"><svg viewBox="0 0 40 50"><path d="M20 2C20 2 4 20 4 32a16 16 0 0 0 32 0C36 20 20 2 20 2z" fill="${inkColor[i.color] || '#6b7a8f'}"/><ellipse cx="14" cy="30" rx="3" ry="6" fill="#fff5"/></svg></div><b data-count-to="${i.pcs}">0</b><small>${i.color} · ${n0(i.liters)} L</small></div>`).join('')}</div></div>
      </div>`;
    $$('[data-h]', v).forEach(b => b.onclick = () => App.go(b.dataset.h));
    $$('[data-period]', v).forEach(b => b.onclick = () => {
      if (b.dataset.period === 'custom') { $('#cust-range').classList.remove('hide'); $$('[data-period]', v).forEach(x => x.classList.toggle('on', x === b)); return; }
      this.period = b.dataset.period; this.range = null; App.refresh();
    });
    $('#dgo').onclick = () => { this.range = [$('#df').value, $('#dt').value]; App.refresh(); };
    requestAnimationFrame(() => barChart($('#mchart'), months, { x: 'label', series: [{ key: 'press', label: 'Press', color: '#7b5cd6' }, { key: 'pvc', label: 'PVC', color: 'var(--pvc)' }, { key: 'ctp', label: 'CTP', color: 'var(--ctp)' }], line: { key: 'collection', label: 'Collection', color: '#e08a2e' } }));
    if (can('accounts.view', 'payments')) GET('/api/accounts/summary').then(s => {
      const el = $('#topdue'); if (!el) return;
      el.innerHTML = s.customers.length ? `<div class="feed">${s.customers.slice(0, 6).map(c => `<div class="feed-item" data-h="customers/${c.id}"><div class="avatar">${esc(c.name[0])}</div><div class="t"><b>${esc(c.name)}</b><small>${esc(c.phone || '')}</small></div><b class="num" style="color:var(--danger)">${tk(c.balance)}</b></div>`).join('')}</div>` : `<div class="empty">${ICON.check}No outstanding dues 🎉</div>`;
      $$('[data-h]', el).forEach(b => b.onclick = () => App.go(b.dataset.h));
    }).catch(() => {}); else $('#topdue').innerHTML = '<div class="empty">Accounts access required.</div>';
  },
};
