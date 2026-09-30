import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from '../server/app.js';
const scenario=process.argv[2] || 'all';
const dir=await mkdtemp(tmpdir()+'/jeffreyys-ui-');
const evidence=process.env.EVIDENCE_DIR || tmpdir()+'/jeffreyys-evidence';
await mkdir(evidence,{recursive:true});
const app=await createApp({dataFile:dir+'/state.json',demo:true});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.tracing.start({screenshots:true,snapshots:true});
const page=await context.newPage(); const errors=[];
page.on('pageerror',e=>errors.push(e.message));
async function login(name,pin){
 await page.goto(base); await page.getByRole('button',{name:new RegExp(name)}).click();
 await page.getByLabel('PIN',{exact:true}).fill(pin);
 await page.getByRole('button',{name:'Anmelden'}).click();
 await page.locator('.sidebar').waitFor();
}
try {
 if (scenario==='reset'||scenario==='all') {
  await login('Alex','1234');
  await page.getByRole('button',{name:'Daten',exact:true}).click();
  page.once('dialog',d=>d.accept('RESET'));
  await page.getByRole('button',{name:'Alles zurücksetzen',exact:true}).click();
  await expect(page.getByRole('button',{name:/Alex/})).toBeVisible({timeout:3000});
  console.log('PASS reset returns login');
 }
 if (scenario==='receipt'||scenario==='all') {
  await context.request.post(base+'/api/logout',{data:{}});
  await login('Leo','3456');
  await page.locator('input[type=file]').setInputFiles(resolve('scripts/fixtures/demo-receipt.png'));
  await expect(page.getByLabel('Bestellnummer',{exact:true})).toHaveValue('SCAN-123',{timeout:90000});
  await expect(page.getByLabel('Betrag (€)',{exact:true})).toHaveValue('27.5');
  console.log('PASS local OCR fills reviewed receipt form');
 }
 if (scenario==='sse'||scenario==='all') {
  await context.request.post(base+'/api/logout',{data:{}});
  await login('Samira','2345');
  await expect(page.getByText('Live verbunden',{exact:true})).toBeVisible();
  const chef=await browser.newContext();
  await chef.request.post(base+'/api/login',{data:{id:'alex',pin:'1234'}});
  await chef.request.post(base+'/api/action',{data:{type:'addTask',text:'Live event regression'}});
  await expect(page.getByRole('button').filter({hasText:'Live event regression'})).toBeVisible({timeout:3000});
  await chef.close(); console.log('PASS named SSE updates second session without polling');
 }
 await page.screenshot({path:evidence+'/ui-'+scenario+'.png',fullPage:true});
 if(errors.length) throw Error(errors.join('\n'));
} finally {
 await context.tracing.stop({path:evidence+'/ui-'+scenario+'-trace.zip'});
 await browser.close(); server.closeAllConnections();
 await new Promise(r=>server.close(r)); await app.locals.store.close(); await rm(dir,{recursive:true,force:true});
}
