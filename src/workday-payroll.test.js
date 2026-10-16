import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyEarnings,orderWorkDate,shiftsById} from '../shared/daily-stats.js';
import {monthlyPayroll,periodStats} from '../shared/accounting.js';
import {payroll} from '../shared/payroll.js';

function night(start,end) {
  const employee={id:'a'}, shift={id:'night',employeeId:'a',start,end,hourlyRate:10};
  const data={employees:[employee],shifts:[shift],orders:[
    {id:'before',employeeId:'a',shiftId:'night',createdAt:new Date(Date.parse(start)+1800000).toISOString(),status:'delivered',amount:12,payment:'cash',deliveryFee:2.5},
    {id:'after',employeeId:'a',shiftId:'night',createdAt:new Date(Date.parse(end)-1800000).toISOString(),status:'delivered',amount:8,payment:'cash',deliveryFee:2.5},
  ],handoffs:[{employeeId:'a',shiftId:'night',expected:20,counted:5,chefConfirmed:true,createdAt:new Date(Date.parse(end)+86400000).toISOString()}],
  salaryPayments:[],expenses:[],settings:{foodCostPercent:0,fixedCosts:0}};
  return {employee,data,now:Date.parse(end)+172800000};
}

test('month-end wages, deliveries and cash settlement all remain in the start month without changing recorded salary payments',()=>{
  const {employee,data,now}=night('2026-09-30T22:00:00+02:00','2026-10-01T02:00:00+02:00');
  data.salaryPayments.push({employeeId:'a',month:'2026-09',amount:7});
  const september=monthlyPayroll(employee,data,'2026-09',now), october=monthlyPayroll(employee,data,'2026-10',now);
  assert.deepEqual(september,{hours:4,wages:40,fees:5,gross:45,cash:20,returned:5,retained:15,payout:30,paid:7,balance:23});
  assert.deepEqual(october,{hours:0,wages:0,fees:0,gross:0,cash:0,returned:0,retained:0,payout:0,paid:0,balance:0});
  const first=dailyEarnings(data,'a','2026-09-30',now), second=dailyEarnings(data,'a','2026-10-01',now);
  assert.deepEqual([first.hours,first.wages,first.fees,first.collectedCash],[4,40,5,20]);
  assert.equal(second.gross,0);
  const all=payroll(data,now)[0];
  assert.equal(september.gross+october.gross,all.gross);assert.equal(september.payout+october.payout,all.payout);
  const startMonth=periodStats(data,{role:'chef'},'month','2026-09',now), nextMonth=periodStats(data,{role:'chef'},'month','2026-10',now);
  assert.equal(startMonth.wages,45);assert.equal(nextMonth.wages,0);
  assert.equal(startMonth.revenue,12);assert.equal(nextMonth.revenue,8); // Sales keep their actual calendar dates.
});

test('a Sunday-night shift stays in its starting week and a December-night shift stays in its starting year',()=>{
  for(const [start,end,mode,first,next] of [
    ['2026-10-11T22:00:00+02:00','2026-10-12T02:00:00+02:00','week','2026-10-11','2026-10-12'],
    ['2026-12-31T22:00:00+01:00','2027-01-01T02:00:00+01:00','year','2026','2027'],
  ]) {
    const {employee,data,now}=night(start,end);
    const before=periodStats(data,{role:'chef'},mode,first,now), after=periodStats(data,{role:'chef'},mode,next,now);
    assert.equal(before.staff[0].hours,4);assert.equal(before.staff[0].gross,45);
    assert.equal(after.staff[0].hours,0);assert.equal(after.staff[0].gross,0);
    assert.equal(before.wages+after.wages,payroll(data,now)[0].gross);
    assert.equal(monthlyPayroll(employee,data,start.slice(0,7),now).gross,45);
  }
});

test('orders with missing or mismatched shift links retain their receipt date',()=>{
  const {data}=night('2026-09-30T22:00:00+02:00','2026-10-01T02:00:00+02:00');
  const order=data.orders[1], index=shiftsById(data.shifts);
  assert.equal(orderWorkDate(order,index),'2026-09-30');
  assert.equal(orderWorkDate({...order,shiftId:'missing'},index),'2026-10-01');
  assert.equal(orderWorkDate({...order,employeeId:'b'},index),'2026-10-01');
});
