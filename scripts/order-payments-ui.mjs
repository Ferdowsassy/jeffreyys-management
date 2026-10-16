import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import express from 'express';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(tmpdir()+'/jeffreyys-order-payments-');
const credentials={username:'test-winorder',password:'isolated-ui-winorder-password-123456'};
const app=await createApp({demo:true,dataFile:dir+'/state.json',winorder:credentials});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const errors=[];
let browser;
async function login(name,pin,mobile=false) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},timezoneId:'Europe/Berlin'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button',{name:new RegExp(name)}).click();
  await page.getByLabel('PIN',{exact:true}).fill(pin);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.locator('.sidebar').waitFor();
  return {page,context};
}
async function nav(page,name) {
  if(page.viewportSize().width<768)await page.getByRole('button',{name:'Menü',exact:true}).click();
  await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();
}
async function fits(page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
try {
  browser=await chromium.launch({headless:true});
  const chef=await login('Alex','1234');
  await nav(chef.page,'Geld');
  const row=chef.page.getByRole('row').filter({has:chef.page.getByRole('button',{name:'Samira',exact:true})});
  const openPayment=()=>row.getByRole('button',{name:'Auszahlung erfassen',exact:true}).click();
  const dialog=chef.page.getByRole('dialog',{name:'Gehalt ausgezahlt · Samira',exact:true});
  await openPayment();
  await expect(dialog).toBeInViewport();
  await expect(dialog.getByLabel('Ausgezahlter Betrag (€)',{exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(app.locals.store.read().salaryPayments).toHaveLength(0);
  await openPayment();
  await dialog.getByLabel('Ausgezahlter Betrag (€)',{exact:true}).fill('100000');
  await dialog.getByRole('button',{name:'Erfolgte Auszahlung bestätigen',exact:true}).click();
  expect(await dialog.getByLabel('Ausgezahlter Betrag (€)',{exact:true}).evaluate(input=>input.validity.rangeOverflow)).toBe(true);
  expect(app.locals.store.read().salaryPayments).toHaveLength(0);
  await dialog.getByLabel('Ausgezahlter Betrag (€)',{exact:true}).fill('1');
  await dialog.getByLabel('Zahlungsart',{exact:true}).selectOption('cash');
  await dialog.getByLabel('Notiz',{exact:true}).fill('UI-Auszahlung');
  const saved=chef.page.waitForResponse(response=>response.url()===base+'/api/action' && response.request().postDataJSON()?.type==='recordSalaryPayment');
  await dialog.getByRole('button',{name:'Erfolgte Auszahlung bestätigen',exact:true}).click();
  const response=await saved;
  expect(response.status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  expect(app.locals.store.read().salaryPayments).toHaveLength(1);
  const payment=app.locals.store.read().salaryPayments[0];
  expect(payment.amount).toBe(1);expect(payment.method).toBe('cash');
  // A replay of the same successful request cannot record a second payout.
  expect((await chef.context.request.post(base+'/api/action',{data:response.request().postDataJSON()})).status()).toBe(200);
  expect(app.locals.store.read().salaryPayments).toHaveLength(1);
  await chef.page.reload();await chef.page.locator('.sidebar').waitFor();await nav(chef.page,'Geld');
  await expect(chef.page.getByText('UI-Auszahlung',{exact:true})).toBeVisible();
  await chef.page.setViewportSize({width:390,height:844});
  await expect(chef.page.locator('.sidebar')).not.toBeInViewport();
  await openPayment();await expect(dialog).toBeInViewport();
  await fits(chef.page);
  await dialog.screenshot({path:tmpdir()+'/jeffreyys-payment-mobile.png'});
  await chef.page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  console.log('PASS payout dialog opens in view, validates, saves, survives reload, rejects duplicate recording, and fits mobile.');

  const kitchen=await login('Samira','2345'), driver=await login('Leo','3456',true), other=await login('Mia','4567');
  for(const session of [kitchen,driver,other])await nav(session.page,'Bestellungen');
  const sample=JSON.parse(await readFile(new URL('./fixtures/winorder-detailed.json',import.meta.url),'utf8'));
  const now=new Date().toISOString();
  sample.OrderList.CreateDateTime=now;sample.OrderList.Order.ServerData.CreateDateTime=now;
  const imported=await fetch(base+'/sendorder',{method:'POST',headers:{authorization:'Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64')},body:Buffer.from(JSON.stringify(sample))});
  expect(imported.status).toBe(200);await imported.json();
  for(const session of [kitchen,driver,other]) {
    await expect(session.page.getByRole('heading',{name:'Bestellung DETAILS-100',exact:true})).toBeVisible();
    await expect(session.page.getByText('Frau Erika Mustermann',{exact:true})).toBeVisible();
    await expect(session.page.getByText('2 × Cheeseburger · Groß',{exact:true})).toBeVisible();
    await expect(session.page.getByText('2 × Extra Käse',{exact:true})).toBeVisible();
  }
  await expect(kitchen.page.getByRole('button',{name:'Übernehmen',exact:true})).toHaveCount(0);
  const card=driver.page.locator('.order-queue-card').filter({has:driver.page.getByRole('heading',{name:'Bestellung DETAILS-100',exact:true})});
  for(const [label,parameter] of [['Google Maps öffnen','destination'],['Waze öffnen','q']]) {
    const href=new URL(await card.getByRole('link',{name:label,exact:true}).getAttribute('href'));
    expect(href.searchParams.get(parameter)).toBe('Teststraße 12, 80802 München');
    if(parameter==='q')expect(href.searchParams.get('navigate')).toBe('yes');
  }
  await card.getByText('Alle Bestellangaben',{exact:true}).click();
  for(const value of ['Testgutschein','TEST-PORTAL-100','Rechnungsstraße'])await expect(card.getByText(value,{exact:true})).toBeVisible();
  await card.getByText('Alle Bestellangaben',{exact:true}).click();
  await fits(driver.page);await card.screenshot({path:tmpdir()+'/jeffreyys-order-details-mobile.png'});
  await card.getByRole('button',{name:'Übernehmen',exact:true}).click();
  for(const session of [kitchen,other]) {
    await expect(session.page.getByRole('heading',{name:'Bestellung DETAILS-100 · Leo',exact:true})).toBeVisible();
    await expect(session.page.getByRole('heading',{name:'Bestellung DETAILS-100',exact:true})).toHaveCount(0);
  }
  await kitchen.page.locator('.delivery-board').screenshot({path:tmpdir()+'/jeffreyys-kitchen-assignment.png'});
  await nav(driver.page,'Tour');
  await expect(driver.page.getByText('Frau Erika Mustermann',{exact:true})).toBeVisible();
  await expect(driver.page.getByRole('link',{name:'Waze öffnen',exact:true})).toBeVisible();
  await expect(driver.page.getByText('Preis laut Kasse: 12.50',{exact:true})).toBeVisible();
  await driver.page.getByRole('button',{name:'Zugestellt',exact:true}).click();
  await expect(kitchen.page.locator('.delivery-board-card').getByText('Zugestellt',{exact:true})).toBeVisible();
  await nav(driver.page,'Belege');
  await driver.page.getByText('Bestelldetails',{exact:true}).click();
  await expect(driver.page.getByText('Frau Erika Mustermann',{exact:true})).toBeVisible();
  console.log('PASS complete imported details and navigation links; immediate driver claim and kitchen live assignment/delivery updates without chef release.');
  if(errors.length)throw new Error(errors.join('\n'));
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await app.locals.close();await rm(dir,{recursive:true,force:true});
}
