import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyEarnings, dailyStats, dayStart, shiftDate} from '../shared/daily-stats.js';

test('daily earnings split overnight shifts, keep historical rates, and exclude open orders and other employees',()=>{
  const data={shifts:[{employeeId:'a',start:'2026-10-08T21:30:00Z',end:'2026-10-09T00:30:00Z',hourlyRate:16},
    {employeeId:'b',start:'2026-10-08T21:30:00Z',end:'2026-10-09T00:30:00Z',hourlyRate:20}],orders:[
    {employeeId:'a',createdAt:'2026-10-08T21:50:00Z',status:'delivered',deliveryFee:2.5,payment:'cash',amount:10},
    {employeeId:'a',createdAt:'2026-10-08T21:55:00Z',status:'open',deliveryFee:3,payment:'cash',amount:20},
    {employeeId:'b',createdAt:'2026-10-08T21:50:00Z',status:'delivered',deliveryFee:5,payment:'online',amount:30}]};
  const now=Date.parse('2026-10-10T12:00:00Z');
  const first=dailyEarnings(data,'a','2026-10-08',now), second=dailyEarnings(data,'a','2026-10-09',now);
  assert.equal(first.hours,.5);assert.equal(first.wages,8);assert.equal(first.fees,2.5);assert.equal(first.gross,10.5);
  assert.equal(second.hours,2.5);assert.equal(second.wages,40);assert.equal(second.gross,40);
  assert.equal(dailyEarnings(data,null,'2026-10-08',now).gross,25.5);
  const scoped=dailyStats(data,{id:'a',role:'driver'},'2026-10-08',now);
  assert.equal(scoped.orders,2);assert.equal(scoped.gross,10.5);
});
test('Berlin day bounds account for daylight saving and ongoing shifts',()=>{
  assert.equal((dayStart('2026-03-30')-dayStart('2026-03-29'))/3600000,23);
  assert.equal((dayStart('2026-10-26')-dayStart('2026-10-25'))/3600000,25);
  const now=Date.parse('2026-10-09T10:30:00Z');
  const result=dailyEarnings({shifts:[{employeeId:'a',start:'2026-10-09T09:00:00Z',end:null,hourlyRate:15}],orders:[]},'a','2026-10-09',now);
  assert.equal(result.hours,1.5);assert.equal(result.gross,22.5);assert.equal(result.provisional,true);
  assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
});
