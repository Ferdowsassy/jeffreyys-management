import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import express from 'express';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(tmpdir()+'/jeffreyys-order-returns-');
const app=await createApp({demo:true,dataFile:dir+'/state.json'});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
const errors=[];
async function login(name,pin) {
  const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Europe/Berlin'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button',{name:new RegExp(name)}).click();
  await page.getByLabel('PIN',{exact:true}).fill(pin);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.locator('.sidebar').getByRole('button',{name:/^Bestellungen/}).click();
  return page;
}
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
  const chef=await login('Alex','1234'), driver=await login('Leo','3456'), kitchen=await login('Samira','2345');
  for (const page of [driver,kitchen]) await expect(page.locator('.completed-order-returns')).toHaveCount(0);
  const returns=chef.locator('.completed-order-returns');
  await returns.locator('summary').click();
  await expect(returns.getByRole('button',{name:'Zurück zu verfügbaren Bestellungen',exact:true})).toHaveCount(2);
  await returns.getByLabel('Mitarbeiter filtern').selectOption('mia');
  await expect(returns.getByRole('heading',{name:'Bestellung DEMO-099',exact:true})).toBeVisible();
  await expect(returns.getByRole('button',{name:'Zurück zu verfügbaren Bestellungen',exact:true})).toHaveCount(1);
  await returns.getByLabel('Zugestellte Bestellung suchen').fill('no-match');
  await expect(returns.getByText('Keine passenden zugestellten Bestellungen.')).toBeVisible();
  await returns.getByLabel('Zugestellte Bestellung suchen').fill('DEMO-099');
  chef.once('dialog',dialog=>dialog.dismiss());
  await returns.getByRole('button',{name:'Zurück zu verfügbaren Bestellungen',exact:true}).click();
  expect(app.locals.store.read().orders.find(o=>o.id==='demo-order-3').status).toBe('delivered');
  await chef.setViewportSize({width:390,height:844});
  expect(await chef.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  chef.once('dialog',async dialog=>{expect(dialog.message()).toContain('Mia');await dialog.accept();});
  await returns.getByRole('button',{name:'Zurück zu verfügbaren Bestellungen',exact:true}).click();
  await expect(chef.locator('.order-queue-card')).toContainText('DEMO-099');
  await expect(returns.getByRole('button',{name:'Zurück zu verfügbaren Bestellungen',exact:true})).toHaveCount(0);
  const card=driver.locator('.order-queue-card').filter({hasText:'DEMO-099'});
  await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Übernehmen',exact:true}).click();
  await expect(card).toHaveCount(0);
  expect(app.locals.store.read().orders.find(o=>o.id==='demo-order-3').employeeId).toBe('leo');
  await chef.reload();
  await chef.locator('.sidebar').waitFor({state:'attached'});
  expect(app.locals.store.read().orders.find(o=>o.id==='demo-order-3').status).toBe('open');
  expect(errors).toEqual([]);
  console.log('PASS chef-only returns, employee/search filters, cancel/confirm, mobile fit, live shared queue and driver reclaim.');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await app.locals.close();await rm(dir,{recursive:true,force:true});
}
