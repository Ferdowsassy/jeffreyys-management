import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './test-helper.js';

test('chef returns any employee’s delivered order to the queue and another driver can deliver it', async t => {
  const {request,login,app,dir}=await fixture(t);
  const chef=await login('alex','1234'), leo=await login('leo','3456'), mia=await login('mia','4567'), kitchen=await login('samira','2345');
  const id='demo-order-3'; // Mia’s order on a closed shift from the previous day.
  await app.locals.store.transact(s=>{
    Object.assign(s.orders.find(o=>o.id===id),{completionSource:'clockOut',claimedAt:new Date().toISOString(),assignedAt:new Date().toISOString(),assignedBy:'alex',tipOnline:3,tipCash:2});
  });
  const before=(await request('/api/state',undefined,chef)).body;
  const original=before.orders.find(o=>o.id===id);
  for (const cookie of [leo,mia,kitchen]) {
    assert.equal((await request('/api/action',{type:'returnDeliveredOrder',id},cookie)).status,403);
  }
  assert.equal((await request('/api/action',{type:'returnDeliveredOrder',id:'missing'},chef)).status,404);
  assert.equal((await request('/api/action',{type:'returnDeliveredOrder',id:'demo-order-2'},chef)).status,409);
  const returned=await request('/api/action',{type:'returnDeliveredOrder',id},chef);
  assert.equal(returned.status,200);
  const after=(await request('/api/state',undefined,chef)).body;
  const order=after.availableOrders.find(o=>o.id===id);
  assert.ok(order);
  assert.equal(order.employeeId,null); assert.equal(order.shiftId,null);
  assert.equal(order.status,'available'); assert.equal(order.deliveredAt,null); assert.equal(order.deliveryFee,0);
  assert.equal(order.claimedAt,undefined); assert.equal(order.completionSource,undefined);
  assert.equal(order.assignedAt,undefined); assert.equal(order.assignedBy,undefined);
  for (const key of ['orderNumber','address','amount','payment','createdAt','tipOnline','tipCash']) assert.equal(order[key],original[key]);
  assert.deepEqual(after.shifts,before.shifts);
  assert.deepEqual(after.salaryPayments,before.salaryPayments);
  const oldPay=before.payroll.find(p=>p.employeeId==='mia'), newPay=after.payroll.find(p=>p.employeeId==='mia');
  assert.equal(oldPay.deliveryPay-newPay.deliveryPay,original.deliveryFee);
  assert.equal(oldPay.collectedCash-newPay.collectedCash,original.amount);
  assert.equal(oldPay.onlineTips-newPay.onlineTips,3); assert.equal(oldPay.cashTips-newPay.cashTips,2);
  assert.equal(after.audit.at(-1).type,'returnDeliveredOrder');
  assert.equal(after.audit.at(-1).employeeId,'alex');
  assert.equal(after.audit.at(-1).previousEmployeeId,'mia');
  assert.equal(after.audit.at(-1).previousShiftId,original.shiftId);
  assert.equal(after.audit.at(-1).previousDeliveredAt,original.deliveredAt);
  assert.equal(JSON.parse(await readFile(dir+'/db.json','utf8')).orders.find(o=>o.id===id).status,'available');
  const driverView=(await request('/api/state',undefined,leo)).body;
  assert.ok(driverView.availableOrders.some(o=>o.id===id));
  assert.equal((await request('/api/action',{type:'returnDeliveredOrder',id},chef)).status,409);
  assert.equal((await request('/api/action',{type:'delivered',id},mia)).status,403);
  assert.equal((await request('/api/action',{type:'claimOrder',id},leo)).status,200);
  const claimed=app.locals.store.read().orders.find(o=>o.id===id);
  assert.equal(claimed.employeeId,'leo'); assert.equal(claimed.shiftId,'demo-shift-leo');
  assert.equal(claimed.deliveryFee,2);
  assert.equal((await request('/api/action',{type:'delivered',id},leo)).status,200);
  assert.equal(app.locals.store.read().orders.find(o=>o.id===id).completionSource,undefined);
  assert.equal((await request('/api/action',{type:'returnDeliveredOrder',id:'demo-order-1'},chef)).status,200);
});

test('returned orders without an address use the flat fee when claimed again', async t=>{
  const {request,login}=await fixture(t);
  const chef=await login('alex','1234'), driver=await login('leo','3456');
  await request('/api/action',{type:'saveSettings',flatFee:3.25},chef);
  await request('/api/action',{type:'addOrder',orderNumber:'RETURN-FLAT',noAddress:true,amount:10,payment:'online'},driver);
  const id=(await request('/api/state',undefined,driver)).body.orders.find(o=>o.orderNumber==='RETURN-FLAT').id;
  assert.equal((await request('/api/action',{type:'delivered',id},driver)).status,200);
  assert.equal((await request('/api/action',{type:'returnDeliveredOrder',id},chef)).status,200);
  assert.equal((await request('/api/action',{type:'claimOrder',id},driver)).status,200);
  assert.equal((await request('/api/state',undefined,driver)).body.orders.find(o=>o.id===id).deliveryFee,3.25);
});
