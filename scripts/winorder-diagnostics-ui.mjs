import {chromium, expect} from '@playwright/test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import express from 'express';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(tmpdir()+'/jeffreyys-winorder-ui-');
const credentials={username:'winorder-test',password:'isolated-winorder-test-password-123456'};
const app=await createApp({dataFile:dir+'/state.json',demo:true,winorder:credentials});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Europe/Berlin'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button',{name:/Alex/}).click();
  await page.getByLabel('PIN',{exact:true}).fill('1234');
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.locator('.sidebar').getByRole('button',{name:'Einstellungen',exact:true}).click();
  const panel=page.locator('.panel').filter({has:page.getByRole('heading',{name:'WinOrder',exact:true})});
  await expect(panel.getByText(/Noch kein Übertragungsversuch/)).toBeVisible();
  let response=await fetch(base+'/sendorder',{method:'POST',body:'private-customer-body'});
  if(response.status!==401)throw new Error('Expected missing-auth rejection');
  await response.text();
  response=await fetch(base+'/sendorder',{method:'POST',headers:{authorization:'Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64'),'content-type':'application/xml'},body:'<WinOrder><Unexpected /></WinOrder>'});
  if(response.status!==400)throw new Error('Expected order validation rejection');
  await response.text();
  await panel.getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await expect(panel.locator('.winorder-attempts li')).toHaveCount(2);
  await expect(panel.getByText(/OrderList fehlt/)).toBeVisible();
  await expect(panel.getByText(/Kein Authentifizierungsheader/)).toBeVisible();
  await expect(panel.getByText(/Authentifizierung: erfolgreich/)).toBeVisible();
  await expect(panel.getByText(/Authentifizierung: nicht angekommen/)).toBeVisible();
  await expect(panel).not.toContainText('private-customer-body');
  await expect(panel).not.toContainText(credentials.password);
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height});
    if(width<900)await expect(page.locator('.sidebar')).not.toBeInViewport();
    await expect(panel.getByRole('button',{name:'Aktualisieren',exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'Aktualisieren',exact:true}).click();
    await expect(panel.locator('.winorder-attempts li')).toHaveCount(2);
    await expect(panel.getByRole('button',{name:'Aktualisieren',exact:true})).toBeEnabled();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error(name+' horizontal overflow');
    await panel.screenshot({path:tmpdir()+'/jeffreyys-winorder-diagnostics-'+name+'.png'});
  }
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('WinOrder diagnostics: refresh, rejection reasons, privacy and desktop/mobile layout passed.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(r=>server.close(r));
  await app.locals.close();
  await rm(dir,{recursive:true,force:true});
}
