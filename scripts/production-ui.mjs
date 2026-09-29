import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(tmpdir() + '/jeffreyys-production-ui-');
const evidence = process.env.EVIDENCE_DIR || tmpdir() + '/jeffreyys-evidence';
await mkdir(evidence, { recursive: true });
const app = await createApp({
  dataFile: dir + '/state.json',
  bootstrap: { name: 'Owner', pin: '9876543210' },
});
app.use(express.static(resolve('dist')));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolveListening) => server.once('listening', resolveListening));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

async function login(name, pin) {
  await page.goto(base);
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByLabel('PIN', { exact: true }).fill(pin);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.locator('.sidebar').waitFor();
}
async function logout() {
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByText('Schön, dass du da bist.')).toBeVisible();
}
async function addEmployee(name, role, pin) {
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Mitarbeiter anlegen' }).click();
  await expect(page.getByText('Neuer Mitarbeiter', { exact: true })).toBeVisible();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('select[name="role"]').selectOption(role);
  const pinInput = page.locator('input[name="pin"]');
  await expect(pinInput).toHaveAttribute('pattern', '[0-9]{8,12}');
  await pinInput.fill(pin);
  await page.locator('input[name="hourlyRate"]').fill('15');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

try {
  await login('Owner', '9876543210');
  await addEmployee('Kitchen Test', 'kitchen', '11112222');
  await addEmployee('Driver Test', 'driver', '33334444');
  await logout();

  await login('Kitchen Test', '11112222');
  await expect(page.getByRole('button', { name: /Aufgaben/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team', exact: true })).toHaveCount(0);
  await logout();

  await login('Driver Test', '33334444');
  await expect(page.getByRole('button', { name: 'Schicht', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team', exact: true })).toHaveCount(0);
  await page.screenshot({ path: evidence + '/production-roles.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS production bootstrap and chef/kitchen/driver role flows');
} finally {
  await context.tracing.stop({ path: evidence + '/production-roles-trace.zip' });
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await app.locals.close();
  await rm(dir, { recursive: true, force: true });
}
