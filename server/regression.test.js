import test from 'node:test';
import { execFileSync } from 'node:child_process';
test('environment secret variants are ignored while example is trackable', () => {
 assert.equal(execFileSync('git',['check-ignore','.env.production','.env.local'],{encoding:'utf8'}).trim().split('\n').length,2);
 assert.throws(()=>execFileSync('git',['check-ignore','.env.example']));
});
import assert from 'node:assert/strict';
import { seed } from './store.js';
import { action, filterState, payroll as backendPayroll } from './domain.js';
import { payroll as frontendPayroll } from '../src/finance.js';
test('frontend payroll matches server for open orders, overreturns and per-shift rounding', () => {
  const date = '2026-09-01T10:00:00Z';
  const s = {employees:[{id:'d'}],shifts:[1,2].map(()=>({employeeId:'d',start:date,end:'2026-09-01T10:01:00Z',hourlyRate:1})),orders:[{employeeId:'d',createdAt:date,status:'open',deliveryFee:8,payment:'cash',amount:99}],handoffs:[{employeeId:'d',createdAt:date,chefConfirmed:true,counted:5}]};
  const a=backendPayroll(s)[0], b=frontendPayroll(s.employees[0],s,'2026-09');
  assert.deepEqual(b,{hours:a.hours,wages:a.hourlyPay,fees:a.deliveryPay,cash:a.collectedCash,returned:a.returnedCash,retained:a.retainedCash,payout:a.payout});
});
test('shift corrections cannot reopen settled cash or bypass handoff on manual close', () => {
 const {s,chef,driver} = setup();
 const closed=s.shifts.find(x=>x.id==='demo-shift-previous');
 assert.throws(()=>action(s,chef,{type:'updateShift',id:closed.id,start:closed.start,end:null}),/reopen/);
 const shift=s.shifts.find(x=>x.employeeId===driver.id);
 action(s,chef,{type:'updateShift',id:shift.id,start:shift.start,end:new Date().toISOString()});
 assert.equal(s.handoffs.filter(h=>h.shiftId===shift.id).length,1);
 assert.equal(s.handoffs.find(h=>h.shiftId===shift.id).expected,32.5);
 assert.equal(s.handoffs.find(h=>h.shiftId===shift.id).driverConfirmed,false);
 action(s,chef,{type:'updateShift',id:shift.id,start:shift.start,end:shift.end});
 assert.equal(s.handoffs.filter(h=>h.shiftId===shift.id).length,1);
});
test('clearing demo preserves entire cash dependency groups touched by real activity', () => {
 const {s,chef,driver} = setup();
 const order=action(s,driver,{type:'addOrder',noAddress:true,payment:'cash',amount:10,orderNumber:'REAL'});
 action(s,driver,{type:'delivered',id:order.id});
 const handoff=action(s,driver,{type:'clockOut',cashConfirmed:true});
 const expected=handoff.expected;
 action(s,chef,{type:'clearDemo'});
 assert.ok(s.shifts.some(x=>x.id===order.shiftId));
 assert.equal(s.orders.filter(o=>o.shiftId===order.shiftId).reduce((n,o)=>n+o.amount,0),expected);
 for(const o of [...s.orders,...s.handoffs]) assert.ok(s.shifts.some(x=>x.id===o.shiftId));
 assert.equal(s.orders.some(o=>o.demo),false);
});
test('partial settings updates preserve other values and flat fee is snapshotted only without address', () => {
 const {s,chef,driver}=setup(); const before={...s.settings};
 action(s,chef,{type:'saveSettings',flatFee:3.25});
 assert.equal(s.settings.fixedCosts,before.fixedCosts);
 const o=action(s,driver,{type:'addOrder',noAddress:true,payment:'online',amount:20,orderNumber:'FEE'});
 assert.equal(o.deliveryFee,3.25);
 action(s,chef,{type:'saveSettings',flatFee:9});
 assert.equal(o.deliveryFee,3.25);
 assert.throws(()=>action(s,chef,{type:'saveSettings',flatFee:-1}),/Invalid/);
});
test('copyWeek copies previous week into displayed week and reports actual inserts', () => {
 const {s,chef}=setup(); s.schedule=[{id:'old',employeeId:'leo',date:'2026-09-21',start:'17:00',end:'22:00'}];
 assert.equal(action(s,chef,{type:'copyWeek',weekStart:'2026-09-28'}).copied,1);
 assert.ok(s.schedule.some(x=>x.date==='2026-09-28'));
 assert.equal(action(s,chef,{type:'copyWeek',weekStart:'2026-09-28'}).copied,0);
});
const setup = () => { const s = seed(); return { s, chef: s.employees[0], kitchen: s.employees[1], driver: s.employees[2] }; };
test('customer follow-ups are chef-only including legacy tasks and toggle responses', () => {
  const {s,chef,kitchen} = setup();
  const privateTask = action(s,chef,{type:'addTask',text:'Customer private address',visibility:'chef'});
  s.tasks.push({id:'legacy',text:'Kundenreaktivierung prüfen: Private 12 12345'});
  assert.equal(filterState(s,kitchen).tasks.some(t=>[privateTask.id,'legacy'].includes(t.id)), false);
  assert.throws(()=>action(s,kitchen,{type:'toggleTask',id:privateTask.id}), /authorized/);
  assert.throws(()=>action(s,kitchen,{type:'addTask',text:'private',visibility:'chef'}), /authorized/);
});
