/* Section reports, sections on/off + order, logo size. Run after seeding the demo business (BIZ=sks-demo). */
const B=process.env.BASE||'http://localhost:3000'; let jar='';
async function c(m,u,b){const h={'Content-Type':'application/json',Cookie:jar};if(m!=='GET')h['X-Idempotency-Key']=Math.random()+'';const r=await fetch(B+u,{method:m,headers:h,body:b?JSON.stringify(b):undefined});for(const s of r.headers.getSetCookie())jar=s.split(';')[0];const t=await r.text();try{return {s:r.status,d:JSON.parse(t)}}catch{return {s:r.status,d:t}}}
let pass=0,fail=0; const ok=(n,x,info='')=>{x?pass++:fail++;console.log((x?'✓ ':'✗ ')+n+(x?'':' '+info))};
(async()=>{
 await c('POST','/api/login',{business:process.env.BIZ||'sks-demo',username:'admin',password:'admin123'});
 const today=(await c('GET','/api/me')).d.today;
 for (const sec of ['press','pvc','ctp','internal','accounts']) {
   const r=await c('GET',`/api/section-report/${sec}?from=2026-01-01&to=${today}`);
   ok(`${sec} report: ${r.d.summary?.length} figures, ${r.d.tables?.length} tables, ${r.d.tables?.reduce((a,t)=>a+t.rows.length,0)} rows`, r.s===200 && r.d.tables.length>=2, JSON.stringify(r.d).slice(0,300));
 }
 const t=await c('GET',`/api/section-report/ctp?from=${today}&to=${today}`); ok('CTP today report works', t.s===200, t.d.error);
 const pr=await c('GET',`/api/section-report/press?from=2026-01-01&to=${today}`);
 ok('Press report has production steps with real dates', pr.d.tables.find(x=>x.title==='Production work done').rows.every(r=>/^\d{4}-/.test(r.date)));
 ok('Bad range rejected', (await c('GET',`/api/section-report/ctp?from=${today}&to=2020-01-01`)).s===400);
 ok('Unknown section 404', (await c('GET',`/api/section-report/xyz?from=${today}&to=${today}`)).s===404);
 // sections
 ok('Turn CTP off', (await c('PUT','/api/settings',{settings:{sections:{order:['pvc','press','ctp','shared','internal'],off:['ctp']}}})).s===200);
 const me=(await c('GET','/api/me')).d.user;
 ok('CTP permissions removed while off', !me.perms.some(p=>p.startsWith('ctp.')), me.perms.filter(p=>p.startsWith('ctp')).join());
 ok('CTP work blocked while off', (await c('GET','/api/ctp/movements')).s===403 && (await c('POST','/api/ctp/invoices',{customer_id:1,items:[]})).s===403);
 ok('CTP report blocked while off', (await c('GET',`/api/section-report/ctp?from=${today}&to=${today}`)).s===403);
 ok('PVC still works', (await c('GET',`/api/section-report/pvc?from=${today}&to=${today}`)).s===200);
 const meta=(await c('GET','/api/meta')).d;
 ok('Order saved (PVC first)', meta.settings.sections.order[0]==='pvc' && meta.settings.sections.off.includes('ctp'));
 ok('Cannot switch all business sections off', (await c('PUT','/api/settings',{settings:{sections:{off:['ctp','pvc','press']}}})).s===400);
 ok('Shared cannot be switched off', !(await c('PUT','/api/settings',{settings:{sections:{off:['shared','ctp']}}}), (await c('GET','/api/meta')).d.settings.sections.off.includes('shared')));
 await c('PUT','/api/settings',{settings:{sections:{order:['press','pvc','ctp','shared','internal'],off:[]}}});
 ok('CTP back on → data back', (await c('GET','/api/ctp/stock')).s===200 && (await c('GET','/api/me')).d.user.perms.includes('ctp.invoice'));
 // logo size
 ok('Logo size saved', (await c('PUT','/api/settings',{settings:{company:{logo_size:120}}})).s===200 && (await c('GET','/api/meta')).d.settings.company.logo_size===120);
 ok('Logo size out of range rejected', (await c('PUT','/api/settings',{settings:{company:{logo_size:999}}})).s===400);
 ok('Company name kept after logo change', !!(await c('GET','/api/meta')).d.settings.company.name);
 console.log(pass+' passed, '+fail+' failed');
})();
