import {chromium, expect} from '@playwright/test';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import express from 'express';
import {createApp} from '../server/app.js';
import {berlinDate,shiftDate} from '../shared/daily-stats.js';
const dir=await mkdtemp(tmpdir()+'/jeffreyys-ux-'), evidence=tmpdir()+'/jeffreyys-evidence';
await mkdir(evidence,{recursive:true});
const app=await createApp({dataFile:dir+'/state.json',demo:true});
const date=shiftDate(berlinDate(Date.now()),-1);
await app.locals.store.transact(state=>{
  state.shifts=[];state.orders=[];state.handoffs=[];
  for(const id of ['alex','samira','leo'])state.shifts.push({id:'ux-'+id,employeeId:id,start:date+'T10:00:00Z',end:date+'T11:30:00Z',hourlyRate:16});
});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({timezoneId:'Europe/Berlin',viewport:{width:1440,height:1000}});
await context.route('https://tile.openstreetmap.org/**',r=>r.fulfill({status:204}));
const page=await context.newPage(), errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function nav(name) {if(await page.getByRole('button',{name:'Menü',exact:true}).isVisible())await page.getByRole('button',{name:'Menü',exact:true}).click();await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();}
async function login(name,pin) {
  await page.goto(base);await page.getByRole('button',{name:new RegExp(name)}).click();await page.getByLabel('PIN',{exact:true}).fill(pin);await page.getByRole('button',{name:'Anmelden'}).click();await page.locator('.sidebar').waitFor();
}
try {
  for(const [name,pin,earnings] of [['Alex','1234','Geld'],['Samira','2345','Mein Verdienst'],['Leo','3456','Verdienst']]) {
    await page.setViewportSize({width:1440,height:1000});
    await login(name,pin);
    if(name!=='Alex') {
      await expect(page.getByRole('heading',{name:'Meine Arbeitszeiten',exact:true})).toHaveCount(0);
      await nav('Meine Arbeitszeiten');
      await expect(page.locator('tbody')).toContainText('1 Std. 30 Min.');
      await expect(page.getByRole('button',{name:'Vergessene Schicht melden'})).toBeVisible();
    }
    await nav(earnings);
    await page.getByLabel('Verdiensttag',{exact:true}).fill(date);
    await expect(page.locator('.earnings-detail')).toContainText('1 Std. 30 Min.');
    await expect(page.locator('.earnings-detail')).toContainText('24,00');
    await expect(page.getByRole('group',{name:'Verdienst nach Wochentag'}).getByRole('button')).toHaveCount(7);
    if(name==='Alex') {
      await page.getByLabel('Verdienst für',{exact:true}).selectOption('team');
      await expect(page.locator('.earnings-detail')).toContainText('72,00');
      await page.getByLabel('Verdienst für',{exact:true}).selectOption('samira');
      await expect(page.locator('.earnings-detail')).toContainText('24,00');
    } else await expect(page.getByLabel('Verdienst für',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Vorherige Verdienstwoche'}).click();
    await expect(page.locator('.earnings-detail')).toContainText('0,00');
    await page.getByRole('button',{name:'Nächste Verdienstwoche'}).click();
    await expect(page.locator('.earnings-detail')).toContainText('24,00');
    await page.getByRole('group',{name:'Verdienst nach Wochentag'}).getByRole('button',{pressed:false}).first().click();
    await expect(page.locator('.earnings-day.selected')).toHaveCount(1);
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);
    await page.screenshot({path:evidence+'/earnings-'+name.toLowerCase()+'-mobile.png',fullPage:true});
    await nav('Statistik');
    await page.getByLabel('Verdiensttag',{exact:true}).fill(date);
    await expect(page.locator('.earnings-detail')).toContainText('24,00');
    await page.setViewportSize({width:1440,height:1000});
    if(name==='Leo') {
      await nav('Tour');
      await expect(page.getByText('Entfernungssortierung',{exact:false})).toHaveCount(0);
      await expect(page.locator('input[type=file]')).toHaveCount(1);
      await page.getByRole('button',{name:'Beleg erfassen',exact:true}).click();
      await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Beleg prüfen & übernehmen'})).toHaveCount(0);
      await page.screenshot({path:evidence+'/driver-tour-clean.png',fullPage:true});
    }
    await page.getByRole('button',{name:'Abmelden'}).click();
  }
  expect(errors).toEqual([]);
  console.log('PASS weekly earnings and day selection for chef/kitchen/driver, role scope, dedicated work times, mobile width, receipt access/cancel and clean tour');
} catch(error) {await page.screenshot({path:evidence+'/ux-failure.png',fullPage:true});throw error;}
finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await app.locals.close();await rm(dir,{recursive:true,force:true});}
