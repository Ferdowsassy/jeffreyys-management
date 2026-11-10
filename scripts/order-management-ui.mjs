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
  for (const page of [driver,kitchen]) {
    await expect(page.getByRole('button',{name:'Bestellung stornieren',exact:true})).toHaveCount(0);
    await expect(page.locator('.completed-order-returns')).toHaveCount(0);
  }
  const completed=chef.locator('.completed-order-returns');
  await completed.locator('summary').click();
  const card=completed.locator('.panel').filter({has:chef.getByRole('heading',{name:'Bestellung DEMO-099',exact:true})}).last();
  await card.getByRole('combobox').first().selectOption('leo');
  await card.getByRole('combobox').nth(1).selectOption('demo-shift-leo');
  chef.once('dialog',d=>d.accept());
  await card.getByRole('button',{name:'Fahrer wechseln',exact:true}).click();
  await expect(card).toContainText('Leo');
  expect(app.locals.store.read().orders.find(o=>o.id==='demo-order-3').status).toBe('delivered');
  await chef.setViewportSize({width:390,height:844});
  expect(await chef.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  chef.once('dialog',async d=>{await d.accept('Doppelt erfasst');chef.once('dialog',d=>d.accept());});
  await card.getByRole('button',{name:'Bestellung stornieren',exact:true}).click();
  await expect(card).toHaveCount(0);
  expect(app.locals.store.read().orders.find(o=>o.id==='demo-order-3').status).toBe('cancelled');
  await driver.locator('.sidebar').getByRole('button',{name:'Meine Schicht',exact:true}).click();
  await driver.getByRole('button',{name:'Früher ausgestempelt?',exact:true}).click();
  const end=new Date(Date.now()-60000);
  const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const endValue=formatter.format(end).replace(' ','T');
  await driver.getByLabel('Tatsächliches Schichtende (Gerätezeit)').fill(endValue);
  await driver.getByRole('button',{name:'Ausstempeln und Freigabe anfragen',exact:true}).click();
  await expect(driver.getByRole('button',{name:'Jetzt einstempeln',exact:true})).toBeVisible();
  await expect(chef.getByText(/Zeitkorrektur-Anfrage\(n\) warten/)).toBeVisible();
  await chef.setViewportSize({width:1440,height:900});
  await chef.locator('.sidebar').getByRole('button',{name:'Arbeitszeiten',exact:true}).click();
  await expect(chef.getByText('Früher ausgestempelt · Die aktuelle Ausstempelzeit gilt bis zur Genehmigung.')).toBeVisible();
  await chef.getByRole('button',{name:'Genehmigen',exact:true}).click();
  await expect(chef.getByText('Keine offenen Anfragen.')).toBeVisible();
  expect(app.locals.store.read().shiftRequests.at(-1).status).toBe('approved');
  await driver.locator('.sidebar').getByRole('button',{name:'Meine Arbeitszeiten',exact:true}).click();
  await expect(driver.getByText('Genehmigt',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS delivered reassignment, cancellation, mobile layout, early clock-out, live chef notification and approval.');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await app.locals.close();await rm(dir,{recursive:true,force:true});
}
