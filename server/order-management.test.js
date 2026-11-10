import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './test-helper.js';
import {dailyStats,berlinDate} from '../shared/daily-stats.js';

test('chef transfers delivered history to another driver and shift, then cancels without deleting it',async t=>{
  const {app,request,login,dir}=await fixture(t);
  const chef=await login('alex','1234'), driver=await login('leo','3456'), kitchen=await login('samira','2345');
  const id='demo-order-3', payload={type:'assignOrder',id,employeeId:'leo',shiftId:'demo-shift-leo'};
  const original=structuredClone(app.locals.store.read().orders.find(o=>o.id===id));
  for(const cookie of [driver,kitchen]) {
    assert.equal((await request('/api/action',payload,cookie)).status,403);
    assert.equal((await request('/api/action',{type:'cancelOrder',id,reason:'Doppelt'},cookie)).status,403);
  }
  assert.equal((await request('/api/action',{...payload,shiftId:'demo-shift-mia'},chef)).status,409);
  assert.equal((await request('/api/action',{...payload,employeeId:'samira',shiftId:'demo-shift-samira'},chef)).status,409);
  assert.equal((await request('/api/action',payload,chef)).status,200);
  const state=(await request('/api/state',undefined,chef)).body, transferred=state.orders.find(o=>o.id===id);
  for(const key of ['status','deliveredAt','deliveryFee','amount','payment','createdAt']) assert.equal(transferred[key],original[key]);
  assert.equal(transferred.employeeId,'leo');assert.equal(transferred.shiftId,'demo-shift-leo');
  assert.equal(state.audit.at(-1).previousEmployeeId,'mia');
  assert.ok((await request('/api/state',undefined,driver)).body.orders.some(o=>o.id===id));
  assert.equal((await request('/api/action',{type:'cancelOrder',id,reason:''},chef)).status,400);
  const before=state.payroll.find(p=>p.employeeId==='leo');
  assert.equal((await request('/api/action',{type:'cancelOrder',id,reason:'Doppelt erfasst'},chef)).status,200);
  const after=(await request('/api/state',undefined,chef)).body;
  assert.equal(before.deliveryPay-after.payroll.find(p=>p.employeeId==='leo').deliveryPay,original.deliveryFee);
  assert.equal(after.orders.find(o=>o.id===id).status,'cancelled');
  assert.equal((await request('/api/action',{type:'delivered',id},driver)).status,409);
  assert.equal((await request('/api/action',{type:'cancelOrder',id,reason:'Erneut'},chef)).status,409);
  assert.equal(JSON.parse(await readFile(dir+'/db.json','utf8')).orders.find(o=>o.id===id).cancellationReason,'Doppelt erfasst');
  const stats=dailyStats(after,{role:'driver',id:'leo'},berlinDate(original.createdAt));
  assert.equal(stats.completed,after.orders.filter(o=>o.employeeId==='leo' && o.status==='delivered' && berlinDate(o.deliveredAt)===berlinDate(original.createdAt)).length);
});

test('early clock-out waits for chef, persists, and approval adjusts automatic deliveries once',async t=>{
  const {app,request,login,dir}=await fixture(t);
  const chef=await login('alex','1234'), driver=await login('mia','4567'), kitchen=await login('samira','2345');
  const end=new Date(Date.now()-60000).toISOString();
  const response=await request('/api/action',{type:'clockOut',end},driver);
  assert.equal(response.status,200);
  const pending=response.body.state.shiftRequests.at(-1), shift=response.body.state.shifts.find(s=>s.id===pending.shiftId);
  assert.equal(pending.kind,'earlyClockOut');assert.equal(pending.status,'pending');
  assert.notEqual(shift.end,end);assert.equal(pending.originalEnd,shift.end);
  assert.equal(response.body.state.orders.find(o=>o.id==='demo-order-2').deliveredAt,shift.end);
  assert.equal(JSON.parse(await readFile(dir+'/db.json','utf8')).shiftRequests.at(-1).status,'pending');
  assert.ok((await request('/api/state',undefined,chef)).body.shiftRequests.some(r=>r.id===pending.id));
  assert.equal((await request('/api/state',undefined,kitchen)).body.shiftRequests.length,0);
  for(const cookie of [driver,kitchen]) assert.equal((await request('/api/action',{type:'reviewShiftCorrection',id:pending.id,decision:'approved'},cookie)).status,403);
  const approved=await request('/api/action',{type:'reviewShiftCorrection',id:pending.id,decision:'approved'},chef);
  assert.equal(approved.status,200);
  assert.equal(approved.body.state.shifts.find(s=>s.id===pending.shiftId).end,end);
  assert.equal(approved.body.state.orders.find(o=>o.id==='demo-order-2').deliveredAt,end);
  assert.equal((await request('/api/action',{type:'reviewShiftCorrection',id:pending.id,decision:'approved'},chef)).status,409);
  // Rejection leaves the recorded clock-out untouched.
  const rejected=await request('/api/action',{type:'clockOut',end},kitchen);
  const r=rejected.body.state.shiftRequests.at(-1);
  assert.equal((await request('/api/action',{type:'reviewShiftCorrection',id:r.id,decision:'rejected'},chef)).status,200);
  assert.equal(app.locals.store.read().shifts.find(s=>s.id===r.shiftId).end,r.originalEnd);
});
