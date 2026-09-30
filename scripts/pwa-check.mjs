import {chromium, expect} from '@playwright/test';
import {createApp} from '../server/app.js';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

let app, server, dir;
let base=process.env.PWA_ORIGIN;
if (!base) {
  dir=await mkdtemp(tmpdir()+'/jeffreyys-pwa-');
  app=await createApp({dataFile:dir+'/state.json',demo:true,staticDir:resolve('dist')});
  server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
}
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('button',{name:'App installieren',exact:true})).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>navigator.serviceWorker.controller !== null);
  const cdp=await context.newCDPSession(page);
  const manifest=await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors,[]);
  const data=JSON.parse(manifest.data);
  assert.equal(data.display,'standalone');
  assert.equal(data.start_url,'/');
  for(const icon of data.icons) {
    const response=await context.request.get(base+icon.src);
    assert.equal(response.status(),200);
    assert.match(response.headers()['content-type'],/image\/png/);
    const bytes=await response.body();
    const [width,height]=icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);
  }
  const install=await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(install.installabilityErrors,[]);
  // Check manual instructions with a browser that has no native prompt event.
  await page.getByRole('button',{name:'App installieren',exact:true}).click();
  const dialog=page.getByRole('dialog');
  if (await dialog.isVisible()) {
    await expect(page.getByText('Jeffreyys als App',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>caches.keys().then(async keys=>{
    for(const key of keys) {
      const cache=await caches.open(key);
      for(const request of await cache.keys())
        if(new URL(request.url).pathname.startsWith('/api') || new URL(request.url).pathname==='/')
          throw Error('Private/API or application HTML cached');
    }
  }));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Wir sind gleich wieder verbunden.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Erneut verbinden'})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1),false);
  await context.setOffline(false);
  await page.getByRole('link',{name:'Erneut verbinden'}).click();
  await expect(page.getByText('Schön, dass du da bist.')).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('PASS PWA manifest, icons, Chromium installability, service worker, private-cache exclusion, offline fallback and reconnection');
} finally {
  await browser.close();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));await app.locals.close();await rm(dir,{recursive:true,force:true});}
}
