// Read-only production smoke check. Never logs the PIN or session cookie.
import {chromium, expect} from '@playwright/test';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const base = process.env.LIVE_ORIGIN;
if (!base || new URL(base).protocol !== 'https:' || !process.env.LIVE_PIN_FILE)
  throw new Error('Set LIVE_ORIGIN=https://your-host and LIVE_PIN_FILE to a private PIN file');
const pin = (await readFile(process.env.LIVE_PIN_FILE,'utf8')).trim();
const evidence = resolve(process.env.EVIDENCE_DIR || 'output/playwright');
await mkdir(evidence,{recursive:true});
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const people = await context.request.get(base+'/api/people').then(r=>r.json());
  const owner = people.people.find(p=>p.role==='chef');
  await page.goto(base);
  await page.getByRole('button').filter({has:page.getByText(owner.name,{exact:true})}).click();
  await page.getByLabel('PIN',{exact:true}).fill(pin);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByText('Live verbunden',{exact:true})).toBeVisible();
  const navigation = page.locator('.nav-item');
  for (let i=0; i<await navigation.count(); i++) {
    await navigation.nth(i).click();
    await expect(page.locator('main')).toBeVisible();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await page.screenshot({path:evidence+'/live-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await expect(page.getByText('Live verbunden',{exact:true})).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1);
  if (overflow) throw new Error('Mobile page overflows horizontally');
  await page.screenshot({path:evidence+'/live-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Menü',exact:true}).click();
  await page.getByRole('button',{name:'Abmelden',exact:true}).click();
  await expect(page.getByText('Schön, dass du da bist.')).toBeVisible();
  console.log('PASS live desktop/mobile login, management pages, live connection and logout; no writes performed');
} finally {await browser.close();}
