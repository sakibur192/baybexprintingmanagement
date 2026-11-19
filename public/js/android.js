/* Android app download page (business side) */
'use strict';
App.pages.android = {
  title: 'App & Downloads',
  async render(v) {
    const r = await GET('/api/public/app/version', { current: window.AndroidBridge?.versionCode?.() || 0 });
    const inApp = IN_APP(), installed = inApp ? window.AndroidBridge.versionName() : null;
    const cfg = await GET('/api/public/config').catch(() => ({}));
    if (!r.available) { v.innerHTML = `<div class="panel"><div class="head"><h2>Downloads</h2></div><div class="row"><a class="btn" href="/api/public/brochure.pdf">${ICON.backup} Product brochure (PDF)</a><a class="btn ghost" href="/brochure" target="_blank">View brochure</a></div><div class="empty">${ICON.phone}The Android app will be available here soon.</div></div>`; return; }
    v.innerHTML = `<div class="grid g32 mb">
      <div class="panel" style="background:linear-gradient(135deg,#16466e,#13838f);color:#fff;border:0">
        <div class="row" style="gap:18px"><img src="/brand/app-icon-512.png" alt="" style="width:84px;height:84px;border-radius:22px;box-shadow:0 12px 30px -10px #0008">
          <div><h2 style="font-size:22px;color:#fff">Baybex Printers Manager</h2><div style="color:#cfe6f0">Version ${esc(r.version_name)} · ${(r.size / 1048576).toFixed(1)} MB · released ${fdate(String(r.released_at).slice(0, 10))}</div></div></div>
        ${inApp ? `<div class="note mt" style="background:#ffffff1f;color:#fff">You are using the app — version ${esc(installed)}. ${r.update ? '<b>A new version is available.</b>' : 'It is up to date ✓'}</div>` : ''}
        <div class="actions" style="justify-content:flex-start">${!inApp || r.update ? `<a class="btn" style="background:#fff;color:#16466e;padding:12px 18px" href="${r.download_url}" ${inApp ? 'onclick="event.preventDefault();AndroidBridge.checkUpdate()"' : ''}>${ICON.backup} ${inApp ? 'Update now' : 'Download APK'}</a>` : ''}</div>
        ${r.notes ? `<div class="mt" style="color:#e3f1f7"><b>What's new</b><div style="white-space:pre-line;margin-top:4px">${esc(r.notes)}</div></div>` : ''}</div>
      <div class="panel" style="text-align:center"><h2>Scan with your phone</h2><div class="sub">Opens the download directly</div><img src="/api/public/app/qr.svg" alt="QR code" style="width:200px;margin:14px auto;display:block"></div></div>
      <div class="panel"><div class="head"><div><h2>Downloads</h2><div class="sub">Everything from Baybex Digital in one place</div></div></div>
        <div class="grid g3">
          <div class="kpi"><small>Product brochure</small><div class="sub mt">Full Bangla brochure (PDF) — features, pricing, how to start</div><div class="row mt"><a class="btn sm" href="/api/public/brochure.pdf" onclick="if(IN_APP()){event.preventDefault();fetch(this.href).then(r=>r.blob()).then(b=>saveBlob(b,'Baybex-Printers-Manager-Brochure.pdf'))}">${ICON.backup} Download PDF</a><a class="btn sm ghost" href="/brochure" target="_blank">View</a></div></div>
          <div class="kpi"><small>Android app</small><div class="sub mt">Version ${esc(r.version_name)} · ${(r.size / 1048576).toFixed(1)} MB</div><div class="row mt"><a class="btn sm" href="${r.download_url}">${ICON.backup} Download APK</a></div></div>
          <div class="kpi"><small>Links</small><div class="sub mt">Website: <b data-base></b><br>Business app: <b data-base-app></b><br>Your Business ID: <b>${esc(App.tenant?.slug || '')}</b></div></div></div></div>
      <div class="panel"><div class="head"><h2>How to install</h2></div><div class="steps" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
        ${['Download the APK on your Android phone (or scan the QR code).', 'Open the downloaded file. If asked, allow “Install unknown apps” for your browser.', 'Tap Install, then open Baybex Printers Manager.', `Log in with your Business ID <span class="bold" style="color:var(--blue)">${esc(App.tenant?.slug || '')}</span>, username and password.`]
          .map((t, i) => `<div class="kpi"><small>Step ${i + 1}</small><div style="margin-top:6px">${t}</div></div>`).join('')}</div>
        <div class="note mt">Website: ${esc(cfg.base_url || location.origin)} · App login: ${esc((cfg.base_url || location.origin) + '/app')}</div>
        <div class="note mt">The app checks for a new version every time it opens. When Baybex releases an update you'll see a popup to install it — your data stays on the server, nothing is lost.</div></div>`;
    $$('[data-base]', v).forEach(e => (e.textContent = cfg.base_url || location.origin)); $$('[data-base-app]', v).forEach(e => (e.textContent = (cfg.base_url || location.origin) + '/app'));
  },
};
