# UI check: the same invoice / order can take partial payments again and again (CTP, press order). Needs: pip install playwright; demo business sks-demo.
import asyncio,sys
from playwright.async_api import async_playwright
async def pay(pg, amt, label):
    await pg.wait_for_selector('#pmf'); await pg.wait_for_timeout(700)
    await pg.fill('#pmf [name=amount]', str(amt)); await pg.wait_for_timeout(200)
    await pg.click('#pms'); await pg.wait_for_timeout(1200)
    t=await pg.evaluate("[...document.querySelectorAll('.toast')].map(x=>x.innerText).join(' | ')")
    still=await pg.query_selector('#pmf')
    print(label, 'modal still open' if still else 'closed', '::', t.replace('\n',' ')[-160:])
    if still:
        print('  note:', await pg.inner_text('#pnote'))
        await pg.click('[data-x]'); await pg.wait_for_timeout(300)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1366,'height':900})
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('http://localhost:3000/app'); await pg.wait_for_timeout(800)
        await pg.fill('input[name=business]','sks-demo'); await pg.fill('input[name=username]','admin'); await pg.fill('input[name=password]','admin123'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1500)
        # CTP invoice page
        inv=await pg.evaluate("fetch('/api/ctp/invoices?from=2000-01-01&to=2099-01-01').then(r=>r.json())")
        rows=inv.get('rows',inv) if isinstance(inv,dict) else inv
        i=[x for x in rows if float(x.get('due',0) or 0)>100][0]
        print('ctp invoice', i['inv_no'], i.get('due'))
        for k in range(3):
            await pg.evaluate(f"location.hash='#/ctp-invoices/{i['id']}'"); await pg.wait_for_timeout(1200)
            if not await pg.query_selector('#pay'): print('no pay button', await pg.evaluate('location.hash')); break
            await pg.click('#pay'); await pay(pg, 50, f'ctp partial {k+1}')
        # press order
        ords=await pg.evaluate("fetch('/api/press/orders?from=2000-01-01&to=2099-01-01').then(r=>r.json())")
        print('orders', [(o['id'],o['order_no'],o.get('inv_no'),o['status']) for o in ords][:8])
        for o in ords[:3]:
            for k in range(2):
                await pg.evaluate(f"location.hash='#/press-orders/{o['id']}'"); await pg.wait_for_timeout(1500)
                if not await pg.query_selector('#opay'): print('no opay', o['order_no']); break
                await pg.click('#opay'); await pay(pg, 20, f"order {o['order_no']} partial {k+1}")
        print('errors', errs); await b.close()
asyncio.run(main())
