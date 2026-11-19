/* Subscription & billing (tenant side) */
'use strict';
App.pages.billing = {
  title: 'Subscription & Billing',
  async render(v) {
    const d = await GET('/api/subscription');
    const t = d.tenant, nums = d.payment?.numbers || [];
    const stLabel = { trial: ['Free trial', 'teal'], active: ['Active', 'green'], expired: ['Expired', 'red'], suspended: ['Suspended', 'red'] }[t.state];
    let plan = d.plans.find(p => p.months === 12) || d.plans[0];
    v.innerHTML = `<div class="grid g32 mb">
      <div class="panel"><div class="head"><div><h2>${esc(t.business_name)}</h2><div class="sub">Business ID: <b>${esc(t.slug)}</b> · member since ${fdate(String(t.created_at).slice(0, 10))}</div></div><span class="tag ${stLabel[1]}">${stLabel[0]}</span></div>
        <div class="row" style="gap:30px"><div><div class="sub">${t.state === 'trial' ? 'Trial ends' : t.state === 'active' ? 'Paid until' : 'Ended on'}</div><div class="big-num">${t.ends_at ? fdate(String(t.ends_at).slice(0, 10)) : '—'}</div></div>
          <div><div class="sub">Days left</div><div class="big-num" style="color:${t.days_left <= 5 ? 'var(--danger)' : 'var(--ok)'}" data-count-to="${t.days_left}">0</div></div></div>
        <div class="note mt">Paying early never loses days — the new period starts after your current trial or subscription ends.</div></div>
      <div class="panel"><div class="head"><h2>Need help?</h2></div><div class="kv"><span>Company</span><b>${esc(d.brand?.company || '')}</b><span>Phone</span><b>${esc(d.brand?.phone || '')}</b><span>Email</span><b>${esc(d.brand?.email || '')}</b><span>Website</span><b>${esc(d.brand?.website || '')}</b></div></div></div>
      <div class="panel"><div class="head"><div><h2>Choose a plan</h2><div class="sub">All features included in every plan · price in BDT</div></div></div>
        <div class="quick" style="grid-template-columns:repeat(${Math.min(4, d.plans.length)},1fr)" id="plans">${d.plans.map(p => `<button class="plan-card ${p.id === plan?.id ? 'on' : ''}" data-plan="${p.id}">
          <div class="row" style="gap:6px">${p.badge ? `<span class="tag orange">${esc(p.badge)}</span>` : ''}${p.discount_active ? `<span class="tag red">${esc(p.discount_text)}</span>` : ''}${!p.badge && !p.discount_active ? '<span class="tag gray">&nbsp;</span>' : ''}</div>
          <b>${esc(p.name)}</b><div>${p.discount_active ? `<span class="strike">৳${n0(p.original_price)}</span> ` : ''}<span class="big-num">৳${n0(p.final_price)}</span></div>
          <small>${p.months > 1 ? `≈ ৳${n0(Math.round(p.per_month))} / month` : 'per month'}${p.discount_active ? ` · save ৳${n0(p.discount_amount)}` : ''}</small>
          ${p.discount_active && p.discount_ends ? `<small style="color:var(--danger)">Offer ends ${fdate(String(p.discount_ends).slice(0, 10))}</small>` : ''}<small>${esc(p.description || '')}</small></button>`).join('')}</div></div>
      ${can('billing') ? `<div class="panel"><div class="head"><div><h2>Pay & submit</h2><div class="sub">${esc(d.payment?.instructions || '')}</div></div></div>
        ${nums.length ? `<div class="chip-row mb">${nums.map(n => `<div class="kpi" style="min-width:200px"><small>${esc(n.method)} ${esc(n.type || '')}</small><b>${esc(n.number)}</b></div>`).join('')}</div>` : `<div class="note warn mb">Payment numbers are not set yet — please call ${esc(d.brand?.phone || 'Baybex Digital')}.</div>`}
        <div class="grid g32"><div><div class="form f4" id="pf">${field('Plan', `<input id="plan-name" readonly>`)}
          <div class="field">Coupon code<div class="row" style="flex-wrap:nowrap;gap:6px;margin-top:6px"><input name="coupon" id="cpn" class="inp" placeholder="optional" style="text-transform:uppercase"><button type="button" class="btn sm light" id="cpa">Apply</button></div></div>
          ${field('Paid with <span class="req">*</span>', `<select name="method">${[...new Set([...nums.map(n => n.method), 'bKash', 'Nagad', 'Rocket', 'Bank'])].map(m => opt(m, m)).join('')}</select>`)}
          ${field('Transaction ID <span class="req">*</span>', `<input name="txn_id" placeholder="e.g. 9BX7K2LM1P">`)}${field('Sender number', `<input name="sender" placeholder="01XXXXXXXXX">`)}
          ${field('Note', `<input name="note">`, 'span2')}</div></div>
          <div class="kpi" id="qb"></div></div><div class="actions"><button class="btn green" id="pay">${ICON.check} Submit payment</button></div></div>` : ''}
      <div class="panel"><div class="head"><h2>Payment history</h2></div><div id="ph"></div></div>`;
    let qt = null;
    const requote = async (showErr) => {
      if (!$('#qb', v) || !plan) return;
      const code = $('#cpn', v).value.trim();
      try { qt = await GET('/api/subscription/quote', { plan_id: plan.id, coupon: code }); }
      catch (e) { if (showErr) toast('Coupon not applied', e.message, 'warn'); $('#cpn', v).value = ''; qt = await GET('/api/subscription/quote', { plan_id: plan.id }); }
      $('#plan-name', v).value = `${plan.name} — ৳${n0(qt.total)}`;
      $('#qb', v).innerHTML = `<small>Amount to pay</small><div class="kv mt"><span>Regular price</span><b>${tk(qt.original)}</b>
        ${qt.plan_discount ? `<span>${esc(plan.discount_text || 'Discount')}</span><b style="color:var(--danger)">− ${tk(qt.plan_discount)}</b>` : ''}
        ${qt.coupon ? `<span>Coupon ${esc(qt.coupon.code)}</span><b style="color:var(--danger)">− ${tk(qt.coupon_discount)}</b>` : ''}</div>
        <div class="big-num mt" style="color:var(--ok)">${tk(qt.total)}</div><div class="sub">Send exactly this amount</div>`;
      if (showErr && qt.coupon) toast('Coupon applied', `You save ${tk(qt.coupon_discount)}`);
    };
    $$('[data-plan]', v).forEach(b => b.onclick = () => { plan = d.plans.find(p => p.id === +b.dataset.plan); $$('[data-plan]', v).forEach(x => x.classList.toggle('on', x === b)); requote(false); });
    if ($('#cpa', v)) { $('#cpa', v).onclick = () => requote(true); $('#cpn', v).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); requote(true); } }; requote(false); }
    if ($('#pay', v)) $('#pay', v).onclick = () => busy($('#pay', v), async () => {
      if (!plan) return toast('Choose a plan', '', 'warn');
      if (!requireFields(v, ['txn_id'])) return;
      if (!(await confirmBox('Submit payment?', `${esc(plan.name)} — <b>${tk(qt?.total ?? plan.final_price)}</b> by ${esc($('[name=method]', v).value)}, Transaction ID <b>${esc($('[name=txn_id]', v).value)}</b>.`, { ok: 'Submit' }))) return;
      await POST('/api/subscription/pay', { ...formData($('#pf', v)), coupon: $('#cpn', v).value.trim(), plan_id: plan.id }, { idem: false });
      toast('Payment submitted', 'We will verify it and activate your subscription shortly.'); App.refresh();
    });
    dataTable($('#ph', v), d.history, [{ k: 'created_at', label: 'Submitted', f: r => fdt(r.created_at) }, { k: 'plan_name', label: 'Plan' }, { k: 'amount', label: 'Amount', n: 1, f: r => `${tk(r.amount)}${r.original_amount > r.amount ? `<div class="sub"><span class="strike">${tk(r.original_amount)}</span>${r.coupon_code ? ' · ' + esc(r.coupon_code) : ''}</div>` : ''}` },
      { k: 'method', label: 'Method' }, { k: 'txn_id', label: 'Transaction ID' }, { k: 'status', label: 'Status', f: r => `<span class="tag ${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'orange'}">${esc(r.status)}</span>${r.reject_reason ? `<div class="sub">${esc(r.reject_reason)}</div>` : ''}` },
      { k: 'period_to', label: 'Period', f: r => r.period_from ? `${fdate(String(r.period_from).slice(0, 10))} → ${fdate(String(r.period_to).slice(0, 10))}` : '' }], { search: false, empty: 'No payments yet' });
  },
};
