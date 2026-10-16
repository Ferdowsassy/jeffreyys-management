import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyEarnings, dailyStats, dayStart, shiftDate} from '../shared/daily-stats.js';

test('overnight earnings and deliveries stay on the shift start date and exclude open orders and other employees',()=>{
  const data={shifts:[{id:'a-shift',employeeId:'a',start:'2026-10-08T21:30:00Z',end:'2026-10-09T00:30:00Z',hourlyRate:16},
    {id:'b-shift',employeeId:'b',start:'2026-10-08T21:30:00Z',end:'2026-10-09T00:30:00Z',hourlyRate:20}],orders:[
    {employeeId:'a',shiftId:'a-shift',createdAt:'2026-10-08T21:50:00Z',status:'delivered',deliveryFee:2.5,payment:'cash',amount:10},
    {employeeId:'a',shiftId:'a-shift',createdAt:'2026-10-08T23:50:00Z',status:'delivered',deliveryFee:1.5,payment:'cash',amount:5},
    {employeeId:'a',createdAt:'2026-10-08T21:55:00Z',status:'open',deliveryFee:3,payment:'cash',amount:20},
    {employeeId:'b',createdAt:'2026-10-08T21:50:00Z',status:'delivered',deliveryFee:5,payment:'online',amount:30}]};
  const now=Date.parse('2026-10-10T12:00:00Z');
  const first=dailyEarnings(data,'a','2026-10-08',now), second=dailyEarnings(data,'a','2026-10-09',now);
  assert.equal(first.hours,3);assert.equal(first.wages,48);assert.equal(first.fees,4);assert.equal(first.gross,52);assert.equal(first.collectedCash,15);
  assert.equal(second.hours,0);assert.equal(second.wages,0);assert.equal(second.gross,0);
  assert.equal(dailyEarnings(data,null,'2026-10-08',now).gross,117);
  const scoped=dailyStats(data,{id:'a',role:'driver'},'2026-10-08',now);
  assert.equal(scoped.orders,2);assert.equal(scoped.gross,52);
});
test('Berlin day bounds account for daylight saving and ongoing shifts',()=>{
  assert.equal((dayStart('2026-03-30')-dayStart('2026-03-29'))/3600000,23);
  assert.equal((dayStart('2026-10-26')-dayStart('2026-10-25'))/3600000,25);
  const now=Date.parse('2026-10-09T10:30:00Z');
  const result=dailyEarnings({shifts:[{employeeId:'a',start:'2026-10-09T09:00:00Z',end:null,hourlyRate:15}],orders:[]},'a','2026-10-09',now);
  assert.equal(result.hours,1.5);assert.equal(result.gross,22.5);assert.equal(result.provisional,true);
  assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
});

test('an ongoing overnight shift keeps accruing on its start date, including daylight saving changes',()=>{
  const data={shifts:[{employeeId:'a',start:'2026-10-08T21:00:00Z',end:null,hourlyRate:10}],orders:[]};
  const now=Date.parse('2026-10-09T01:30:00Z');
  assert.deepEqual([dailyEarnings(data,'a','2026-10-08',now).hours,dailyEarnings(data,'a','2026-10-08',now).gross],[4.5,45]);
  assert.equal(dailyEarnings(data,'a','2026-10-08',now).provisional,true);
  assert.equal(dailyEarnings(data,'a','2026-10-09',now).gross,0);
  assert.equal(dailyEarnings(data,'a','2026-10-09',now).provisional,false);
  for(const [date,start,end,hours] of [
    ['2026-03-28','2026-03-28T23:30:00+01:00','2026-03-29T04:30:00+02:00',4],
    ['2026-10-24','2026-10-24T23:30:00+02:00','2026-10-25T04:30:00+01:00',6],
  ]) {
    const data={shifts:[{employeeId:'a',start,end,hourlyRate:15}],orders:[]};
    const result=dailyEarnings(data,'a',date,Date.parse(end)+1);
    assert.equal(result.hours,hours);assert.equal(result.wages,hours*15);
    assert.equal(dailyEarnings(data,'a',shiftDate(date,1),Date.parse(end)+1).gross,0);
  }
});
