import {chromium,expect} from '@playwright/test';
import {createApp} from '../server/app.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
const dir=await mkdtemp(tmpdir()+'/jeffreyys-ocr-');
const app=await createApp({dataFile:dir+'/state.json',demo:true});
if(process.env.OCR_ASSET_ORIGIN)app.use('/ocr',async(req,res,next)=>{
  try {
    const response=await fetch(new URL('/ocr'+req.url,process.env.OCR_ASSET_ORIGIN));
    if(!response.ok)throw Error('Deployed OCR asset unavailable: '+response.status);
    res.type(response.headers.get('content-type')||'application/octet-stream').send(Buffer.from(await response.arrayBuffer()));
  }catch(error){next(error);}
});
app.use(express.static(resolve('dist')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage(), errors=[], forbidden=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  page.on('request',r=>{if((!r.url().startsWith(base+'/') && !/^https:\/\/fonts\./.test(r.url()) && !/^(blob|data):/.test(r.url())) || r.url().includes('/api/ai/receipt') || (r.method()==='POST' && !r.url().endsWith('/api/login')))forbidden.push(r.url());});
  await page.goto(base);
  await page.getByRole('button',{name:/Leo/}).click();
  await page.getByLabel('PIN',{exact:true}).fill('3456');
  await page.getByRole('button',{name:'Anmelden'}).click();
  await page.locator('.sidebar').waitFor();
  await page.locator('input[type=file]').setInputFiles(process.env.OCR_RECEIPT_FILE || resolve('scripts/fixtures/demo-receipt.png'));
  const expected=process.env.OCR_EXPECTED_JSON_FILE?JSON.parse(await readFile(process.env.OCR_EXPECTED_JSON_FILE,'utf8')):{amount:'27.5',orderNumber:'SCAN-123',address:'Teststraße 12',postalCode:'80802',city:'München',payment:'online'};
  await expect(page.getByText('Beleg prüfen & übernehmen',{exact:true})).toBeVisible({timeout:90000});
  for(const [field,label] of Object.entries({amount:'Betrag (€)',orderNumber:'Bestellnummer',address:'Straße & Hausnummer',postalCode:'PLZ (5 Ziffern)',city:'Ort',payment:'Zahlungsart'}))
    await expect(field==='payment'?page.locator('select[name="payment"]'):page.getByLabel(label,{exact:true})).toHaveValue(String(expected[field]),{timeout:1000});
  assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
  console.log('PASS real on-device OCR, customer address, order number, total and payment; no AI, image uploads or external OCR requests');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await app.locals.close();await rm(dir,{recursive:true,force:true});}
