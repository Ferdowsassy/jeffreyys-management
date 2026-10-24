import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-helper.js';
import {seed} from './store.js';
import {action,filterState} from './domain.js';
import {payroll} from '../shared/payroll.js';
import {monthlyPayroll,periodStats} from '../shared/accounting.js';
import {dailyEarnings} from '../shared/daily-stats.js';
import {parseWinorder,importWinorder} from './winorder.js';

function sample(payment='Online bezahlt',tip='3.25',total='23.25') {
  return Buffer.from(JSON.stringify({OrderList:{CreateDateTime:'2026-09-30T22:00:00+02:00',Order:{OrderID:'TIP-101',StoreData:{StoreID:'1'},Customer:{DeliveryAddress:{Street:'Teststraße',HouseNo:'1',Zip:'80802',City:'München'}},AddInfo:{DeliverType:'Lieferung',PaymentType:payment,Total:total,Tip:tip}}}}));
}
test('online and cash tips settle once, stay with their shift month, and are separate from wages and sales',()=>{
  const employee={id:'d',role:'driver'}, now=Date.parse('2026-10-02T12:00:00Z');
  const data={employees:[employee],shifts:[{id:'night',employeeId:'d',start:'2026-09-30T22:00:00+02:00',end:'2026-10-01T02:00:00+02:00',hourlyRate:10}],orders:[
    {id:'online',employeeId:'d',shiftId:'night',createdAt:'2026-10-01T00:30:00+02:00',status:'delivered',amount:20,payment:'online',deliveryFee:2,tipOnline:3.25,tipCash:1},
    {id:'cash',employeeId:'d',shiftId:'night',createdAt:'2026-10-01T01:30:00+02:00',status:'delivered',amount:10,payment:'cash',deliveryFee:2,tipCash:2},
    {id:'open',employeeId:'d',shiftId:'night',createdAt:'2026-10-01T01:40:00+02:00',status:'open',amount:5,payment:'online',deliveryFee:2,tipOnline:99},
  ],handoffs:[],salaryPayments:[],expenses:[],settings:{foodCostPercent:0,fixedCosts:0}};
  const p=payroll(data,now)[0];
  assert.equal(p.gross,44);assert.equal(p.onlineTips,3.25);assert.equal(p.cashTips,3);assert.equal(p.totalEarnings,50.25);
  assert.equal(p.retainedCash,10);assert.equal(p.payout,37.25);
  assert.equal(monthlyPayroll(employee,data,'2026-09',now).payout,37.25);
  assert.equal(monthlyPayroll(employee,data,'2026-10',now).tips,0);
  assert.equal(dailyEarnings(data,'d','2026-09-30',now).totalEarnings,50.25);
  assert.equal(periodStats(data,{role:'chef'},'month','2026-09',now).wages,44);
  assert.equal(periodStats(data,{role:'chef'},'month','2026-10',now).revenue,35);
});
test('WinOrder imports included tips separately and duplicate receipts never add tips twice',()=>{
  for(const [payment,field] of [['Online bezahlt','tipOnline'],['Bar','tipCash']]) {
    const s=seed(),parsed=parseWinorder(sample(payment));
    assert.equal(parsed[0].amount,20);assert.equal(parsed[0][field],3.25);
    assert.equal(importWinorder(s,parsed).imported,1);assert.equal(importWinorder(s,parsed).duplicates,1);
    assert.equal(s.orders.filter(o=>o.source==='winorder').length,1);
  }
  for(const bad of ['-1','not money','25']) assert.ok(parseWinorder(sample('Online bezahlt',bad))[0].reviewIssues.includes('Trinkgeld prüfen'));
});
test('only owner or chef can edit driver-order tips and invalid amounts do not alter records',()=>{
  const s=seed(), driver=s.employees.find(e=>e.id==='leo'),chef=s.employees.find(e=>e.id==='alex'),mia=s.employees.find(e=>e.id==='mia');
  const order=s.orders.find(o=>o.employeeId===driver.id);
  action(s,driver,{type:'saveOrderTips',id:order.id,tipOnline:3.25,tipCash:2});
  action(s,driver,{type:'saveOrderTips',id:order.id,tipOnline:3.25,tipCash:2});
  assert.equal(order.tipOnline,3.25);
  assert.throws(()=>action(s,mia,{type:'saveOrderTips',id:order.id,tipOnline:99,tipCash:0}),e=>e.status===403);
  for(const value of [-1,NaN,Infinity,'2',100001])assert.throws(()=>action(s,driver,{type:'saveOrderTips',id:order.id,tipOnline:value,tipCash:0}));
  assert.equal(order.tipOnline,3.25);
  action(s,chef,{type:'saveOrderTips',id:order.id,tipOnline:4,tipCash:0});
  assert.equal(order.tipOnline,4);
  assert.equal(filterState(s,mia).orders.some(o=>o.id===order.id),false);
});
test('private fuel CRUD stays out of other accounts, chef exports, audit, expenses and all payroll calculations',async t=>{
  const {request,login,app}=await fixture(t);
  const leo=await login('leo','3456'),mia=await login('mia','4567'),chef=await login('alex','1234'),kitchen=await login('samira','2345');
  const before=app.locals.store.read(), beforePay=payroll(before), date=new Date().toISOString().slice(0,10);
  const save={type:'saveDriverFuel',date,amount:42.5,liters:25,note:'Private tank stop'};
  const created=await request('/api/action',save,leo);
  assert.equal(created.status,200);
  const entry=created.body.state.driverFuel[0];assert.equal(entry.employeeId,'leo');assert.equal(entry.amount,42.5);
  assert.equal(created.body.state.driverFuel.length,1);
  for(const cookie of [mia,chef,kitchen]){
    assert.deepEqual((await request('/api/state',undefined,cookie)).body.driverFuel,[]);
    assert.equal((await request('/api/action',{...save,id:entry.id},cookie)).status,403);
    assert.equal((await request('/api/action',{type:'deleteDriverFuel',id:entry.id},cookie)).status,403);
  }
  assert.doesNotMatch(JSON.stringify((await request('/api/export',undefined,chef)).body),/Private tank stop/);
  assert.equal((await request('/api/action',{...save,id:entry.id,amount:50,liters:null},leo)).status,200);
  for(const invalid of [{amount:-1},{amount:0},{amount:'20'},{liters:0},{date:'2026-02-30'},{date:'2099-01-01'}])assert.equal((await request('/api/action',{...save,...invalid},leo)).status,400);
  const after=app.locals.store.read();
  // Fixed time avoids ticking open shifts obscuring changes to financial state.
  assert.deepEqual(payroll(after,Date.parse(date+'T12:00:00Z')),payroll(before,Date.parse(date+'T12:00:00Z')));
  assert.deepEqual(after.expenses,before.expenses);assert.deepEqual(after.audit,before.audit);assert.ok(beforePay.length);
  assert.equal((await request('/api/action',{type:'deleteDriverFuel',id:entry.id},leo)).status,200);
  assert.deepEqual((await request('/api/state',undefined,leo)).body.driverFuel,[]);
});
