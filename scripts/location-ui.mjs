import {chromium, webkit, devices, expect} from '@playwright/test';
import {mkdtemp, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import express from 'express';
import {createApp} from '../server/app.js';

const dir = await mkdtemp(tmpdir() + '/jeffreyys-location-');
const evidence = tmpdir() + '/jeffreyys-evidence';
await mkdir(evidence,{recursive:true});
const app = await createApp({dataFile:dir + '/state.json',demo:true});
app.use(express.static(resolve('dist')));
const server = app.listen(0,'127.0.0.1');
await new Promise(r => server.once('listening',r));
const base = 'http://127.0.0.1:' + server.address().port;
const safari = process.env.LOCATION_BROWSER === 'webkit';
const browser = await (safari ? webkit : chromium).launch({headless:true});
const errors = [];
const sessions = [];
const responses = [];
const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6GOcAAAAASUVORK5CYII=','base64');
async function session(name,pin,options = {}) {
  const context = await browser.newContext({...(safari ? devices['iPhone 13'] : {viewport:{width:1440,height:1000}}),...options});
  await context.route('https://tile.openstreetmap.org/**',route => route.fulfill({contentType:'image/png',body:pixels}));
  const page = await context.newPage();
  sessions.push({page,name});
  page.on('pageerror',e => errors.push(e.message));
  page.on('response',async response => {
    if (response.url().endsWith('/api/action') && response.status() >= 400) responses.push({name,status:response.status(),request:response.request().postDataJSON(),body:await response.json().catch(() => null)});
  });
  await page.goto(base);
  await page.getByRole('button',{name:new RegExp(name)}).click();
  await page.getByLabel('PIN',{exact:true}).fill(pin);
  await page.getByRole('button',{name:'Anmelden'}).click();
  await page.locator('.sidebar').waitFor();
  return {page,context};
}
async function navigate(page,name) {
  const menu = page.getByRole('button',{name:'Menü',exact:true});
  if (await menu.isVisible()) await menu.click();
  await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();
}
try {
  const chef = await session('Alex','1234'), kitchen = await session('Samira','2345');
  const driver = await session('Leo','3456',{permissions:['geolocation'],geolocation:{latitude:48.14,longitude:11.58,accuracy:10}});
  const marker = page => page.locator('.driver-marker[data-driver-id="leo"]');
  for (const viewer of [chef,kitchen]) await expect(marker(viewer.page)).toHaveCount(0);
  await driver.page.getByRole('button',{name:'Standortfreigabe aktivieren'}).click();
  for (const viewer of [chef,kitchen]) {
    await expect(marker(viewer.page)).toHaveAttribute('data-latitude','48.14',{timeout:10000});
    await expect(viewer.page.locator('[data-location-status="leo"]')).toContainText('Live');
    await viewer.page.evaluate(() => {window.firstDriverMap = document.querySelector('.live-driver-map');});
  }
  await navigate(driver.page,'Plan');
  await expect(driver.page.getByRole('button',{name:'Standortfreigabe stoppen'})).toBeVisible();
  await driver.context.setGeolocation({latitude:48.145,longitude:11.589,accuracy:15});
  for (const viewer of [chef,kitchen]) {
    await expect(marker(viewer.page)).toHaveAttribute('data-latitude','48.145',{timeout:12000});
    expect(await viewer.page.evaluate(() => window.firstDriverMap === document.querySelector('.live-driver-map'))).toBe(true);
  }
  const initial = (await (await driver.context.request.get(base + '/api/state')).json()).employees[0].location.updatedAt;
  // The mock GPS provider must produce a new fix, even when its coordinates stay the same.
  await driver.context.setGeolocation({latitude:48.145,longitude:11.589,accuracy:15});
  await expect.poll(async () => (await (await driver.context.request.get(base + '/api/state')).json()).employees[0].location.updatedAt,{timeout:15000}).not.toBe(initial);
  await driver.page.reload();
  await expect(driver.page.getByRole('button',{name:'Standortfreigabe stoppen'})).toBeVisible();
  // A second driver appears simultaneously on both viewers' maps.
  const mia = await browser.newContext();
  await mia.request.post(base + '/api/login',{data:{id:'mia',pin:'4567'}});
  await mia.request.post(base + '/api/action',{data:{type:'saveLocation',latitude:48.13,longitude:11.57,accuracy:20}});
  for (const viewer of [chef,kitchen]) await expect(viewer.page.locator('.driver-marker')).toHaveCount(2);
  await kitchen.page.screenshot({path:evidence + '/live-kitchen-map.png',fullPage:true});
  await driver.page.getByRole('button',{name:'Standortfreigabe stoppen'}).click();
  for (const viewer of [chef,kitchen]) await expect(marker(viewer.page)).toHaveCount(0);
  // Chromium resets a granted permission in-place; WebKit retains its cached
  // grant. Exercise denied-permission recovery in Chromium, not by pretending
  // that WebKit's clearPermissions revokes a previously granted native prompt.
  if (!safari) {
    await driver.context.clearPermissions();
    await driver.page.getByRole('button',{name:'Standortfreigabe aktivieren'}).click();
    await expect(driver.page.getByText(/Standortzugriff blockiert/)).toBeVisible();
    await expect(driver.page.getByRole('button',{name:'Standortfreigabe aktivieren'})).toBeVisible();
  }
  await driver.context.grantPermissions(['geolocation']);
  await driver.page.getByRole('button',{name:'Standortfreigabe aktivieren'}).click();
  for (const viewer of [chef,kitchen]) await expect(marker(viewer.page)).toHaveCount(1,{timeout:10000});
  // Only the viewer's clock advances, so paused positions cannot remain labelled live.
  await chef.page.clock.install();
  await chef.page.clock.setFixedTime(new Date(Date.now() + 45000));
  await chef.page.clock.runFor(6000);
  await expect(marker(chef.page)).toHaveClass(/stale/);
  await chef.page.clock.setFixedTime(new Date(Date.now() + 135000));
  await chef.page.clock.runFor(6000);
  await expect(marker(chef.page)).toHaveCount(0);
  await navigate(driver.page,'Schicht');
  driver.page.once('dialog',dialog => dialog.accept());
  await driver.page.getByRole('button',{name:'Ausstempeln',exact:true}).click();
  await expect(marker(kitchen.page)).toHaveCount(0);
  const state = await (await driver.context.request.get(base + '/api/state')).json();
  expect(state.employees[0].location).toBeUndefined();
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`PASS ${safari ? 'iPhone/WebKit' : 'Chromium'} GPS watch, moving markers in chef/kitchen sessions, persistent sharing across pages, stationary refresh, multiple drivers, stop, ${safari ? '' : 'permission recovery, '}stale expiry and clock-out`);
} catch (error) {
  console.error('Browser errors:',errors);
  console.error('Action errors:',responses);
  for (const {page,name} of sessions) {
    console.error(name,await page.evaluate(() => ({now:Date.now(),sharing:document.querySelector('.location-sharing')?.textContent,locations:[...document.querySelectorAll('[data-location-status]')].map(e => e.textContent)})));
  }
  console.error('Stored test locations:',app.locals.store.read().employees.map(({id,location}) => ({id,location})));
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await app.locals.close();
  await rm(dir,{recursive:true,force:true});
}
