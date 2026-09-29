import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';

test('AI coach sends only records inside the requested period', async (t) => {
  const dir = await mkdtemp(tmpdir() + '/jeffreyys-ai-scope-');
  const calls = [];
  const aiFetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Scoped result' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-key';
  const app = await createApp({ dataFile: dir + '/state.json', demo: true, aiFetch });
  await app.locals.store.transact((state) => {
    state.orders = [
      { id:'inside', employeeId:'leo', shiftId:'inside-shift', address:'', postalCode:'', city:'', amount:20, payment:'cash', orderNumber:'IN', status:'delivered', createdAt:'2026-09-10T12:00:00.000Z', deliveredAt:'2026-09-10T12:30:00.000Z', deliveryFee:2, noAddress:true, demo:false },
      { id:'outside', employeeId:'leo', shiftId:'outside-shift', address:'', postalCode:'', city:'', amount:999, payment:'cash', orderNumber:'OUT', status:'delivered', createdAt:'2026-08-10T12:00:00.000Z', deliveredAt:'2026-08-10T12:30:00.000Z', deliveryFee:99, noAddress:true, demo:false },
    ];
    state.shifts = [
      { id:'inside-shift', employeeId:'leo', start:'2026-09-10T11:00:00.000Z', end:'2026-09-10T13:00:00.000Z', hourlyRate:10, demo:false },
      { id:'outside-shift', employeeId:'leo', start:'2026-08-10T11:00:00.000Z', end:'2026-08-10T13:00:00.000Z', hourlyRate:100, demo:false },
    ];
    state.handoffs = [];
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id:'alex',pin:'1234'}) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(base + '/api/ai/coach', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({start:'2026-09-01T00:00:00.000Z',end:'2026-09-30T23:59:59.999Z'}) });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const prompt = JSON.parse(calls[0].messages[1].content);
  assert.deepEqual(prompt.summary.orders.map((order) => order.amount), [20]);
  assert.equal(prompt.summary.payroll.find((row) => row.hours > 0).hours, 2);
  assert.equal(prompt.period.start, '2026-09-01T00:00:00.000Z');
  assert.equal(prompt.period.end, '2026-09-30T23:59:59.999Z');
});
