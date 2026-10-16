import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import express from 'express';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(tmpdir()+'/jeffreyys-overnight-');
const app=await createApp({demo:true,dataFile:dir+'/state.json'});
await app.locals.store.transact(state=>{
  state.shifts=['alex','samira','leo'].map(employeeId=>({id:'night-'+employeeId,employeeId,start:'2026-09-30T22:00:00+02:00',end:'2026-10-01T02:00:00+02:00',hourlyRate:10}));
  state.orders=[{id:'night-delivery',employeeId:'leo',shiftId:'night-leo',createdAt:'2026-10-01T00:30:00+02:00',deliveredAt:'2026-10-01T01:00:00+02:00',status:'delivered',amount:25,payment:'online',deliveryFee:2.5,orderNumber:'NIGHT-1',address:'Teststraße 12',postalCode:'80802',city:'München'}];
  state.handoffs=[];state.salaryPayments=[];
});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({headless:true});
  for(const [name,pin,view,amount] of [['Alex','1234','Geld','40,00'],['Samira','2345','Mein Verdienst','40,00'],['Leo','3456','Verdienst','42,50']]) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Berlin'});
    const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.getByRole('button',{name:new RegExp(name)}).click();
    await page.getByLabel('PIN',{exact:true}).fill(pin);await page.getByRole('button',{name:'Anmelden',exact:true}).click();
    await page.locator('.sidebar').getByRole('button',{name:view,exact:true}).click();
    for(const [date,hours,value] of [['2026-09-30','4 Std. 00 Min.',amount],['2026-10-01','0 Std. 00 Min.','0,00']]) {
      await page.getByLabel('Verdiensttag',{exact:true}).fill(date);
      await expect(page.locator('.earnings-detail')).toContainText(hours);
      await expect(page.locator('.earnings-detail')).toContainText(value);
    }
    for(const [month,hours,value] of [['2026-09','4 Std. 00 Min.',amount],['2026-10','0 Std. 00 Min.','0,00']]) {
      await page.getByLabel('Abrechnungsmonat',{exact:true}).fill(month);
      if(name==='Alex') {
        const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'Alex',exact:true})});
        await expect(row).toContainText(hours);await expect(row).toContainText(value);
      } else {
        await expect(page.locator('.personal-earnings')).toContainText(hours);
        await expect(page.locator('.personal-earnings')).toContainText(value);
      }
    }
    await page.locator('.sidebar').getByRole('button',{name:'Statistik',exact:true}).click();
    await page.getByLabel('Verdiensttag',{exact:true}).fill('2026-09-30');
    await expect(page.locator('.earnings-detail')).toContainText('4 Std. 00 Min.');
    await expect(page.locator('.earnings-detail')).toContainText(amount);
    await page.getByLabel('Verdiensttag',{exact:true}).fill('2026-10-01');
    await expect(page.locator('.earnings-detail')).toContainText('0 Std. 00 Min.');
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('.sidebar')).not.toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(errors.length)throw new Error(errors.join('\n'));
    await context.close();
  }
  console.log('PASS chef/kitchen/driver daily charts, monthly payroll and statistics place the entire overnight shift and delivery fees on its starting day/month, including mobile.');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await app.locals.close();await rm(dir,{recursive:true,force:true});
}
