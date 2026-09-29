import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
const errors=[];
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
// Authenticate through the API with generated local demo credentials; no real account is used.
const people=await (await context.request.get('http://127.0.0.1:5173/api/people')).json();
async function login(name,pin){const employee=people.people.find(p=>p.name===name);assert(employee);const response=await context.request.post('http://127.0.0.1:5173/api/login',{data:{id:employee.id,pin}});assert.equal(response.status(),200);await page.goto('http://127.0.0.1:5173');await page.locator('.sidebar').waitFor();}
try{
await login('Alex','1234');
for(const label of ['Heute','Plan','Geld','Analyse','Kasse','Kunden','Zeiten','Team','Gebiete','Aufgaben','Finanzen','Daten']){await page.locator('nav button').filter({hasText:new RegExp('^'+label+'(?:\\d+)?$')}).click();await page.locator('h1').waitFor();assert((await page.locator('h1').innerText()).length>0);console.log('Chef page OK:',label);}
await page.locator('nav button').filter({hasText:'Heute'}).click();await page.screenshot({path:'dashboard-desktop.png',fullPage:true});
const task='Browserprüfung '+Date.now();await page.getByLabel('Neue Aufgabe').fill(task);await page.getByRole('button',{name:'Hinzufügen',exact:true}).click();await page.getByRole('button').filter({hasText:task}).waitFor();
const state=await(await context.request.get('http://127.0.0.1:5173/api/state')).json();assert(state.tasks.some(t=>t.text===task));console.log('Task persisted/read-back OK');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'dashboard-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('Mobile dashboard has no page overflow');
await context.request.post('http://127.0.0.1:5173/api/logout',{data:{}});await login('Leo','3456');
await page.setViewportSize({width:1440,height:1000});
for(const label of ['Schicht','Tour','Belege','Plan','Verdienst']){await page.locator('nav button').filter({hasText:new RegExp('^'+label+'$')}).click();await page.locator('h1').waitFor();console.log('Driver page OK:',label)}
assert.equal(await page.locator('nav button').filter({hasText:'Finanzen'}).count(),0);
await context.request.post('http://127.0.0.1:5173/api/logout',{data:{}});await login('Samira','2345');
await page.getByRole('heading',{name:'Alles im Blick.'}).waitFor();console.log('Kitchen dashboard OK');
assert.deepEqual(errors,[]);console.log('No browser runtime errors');
}finally{await browser.close()}
