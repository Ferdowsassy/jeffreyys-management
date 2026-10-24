import test from 'node:test';
import assert from 'node:assert/strict';
import {revenueDate,dailyStats} from '../shared/daily-stats.js';
import {periodStats,monthlyPayroll} from '../shared/accounting.js';

test('restaurant day uses 02:00 Berlin wall time across month, year and DST boundaries',()=>{
  for(const [stamp,date] of [
    ['2026-10-09T00:00:00+02:00','2026-10-08'],
    ['2026-10-09T01:59:59+02:00','2026-10-08'],
    ['2026-10-09T02:00:00+02:00','2026-10-09'],
    ['2026-11-01T01:00:00+01:00','2026-10-31'],
    ['2027-01-01T01:00:00+01:00','2026-12-31'],
    ['2026-03-29T01:59:59+01:00','2026-03-28'],
    ['2026-03-29T03:00:00+02:00','2026-03-29'],
    ['2026-10-25T01:59:59+02:00','2026-10-24'],
    ['2026-10-25T02:00:00+02:00','2026-10-25'],
    ['2026-10-25T02:00:00+01:00','2026-10-25'],
  ])assert.equal(revenueDate(stamp),date,stamp);
});
function state(date,next) {
  const orders=[
    {id:'previous-tail',createdAt:date+'T01:30:00+01:00',amount:100,payment:'cash'},
    {id:'evening',createdAt:date+'T22:30:00+01:00',amount:10,payment:'cash'},
    {id:'late',createdAt:next+'T01:30:00+01:00',amount:20,payment:'online'},
    {id:'boundary',createdAt:next+'T02:00:00+01:00',amount:40,payment:'cash'},
  ].map(order=>({...order,employeeId:'d',status:'delivered',deliveryFee:0,deliveredAt:order.createdAt}));
  return {employees:[{id:'d'}],orders,shifts:[],handoffs:[],salaryPayments:[],expenses:[],settings:{foodCostPercent:0,fixedCosts:0}};
}
test('chef daily revenue, cash, counts and hourly series use one business day while employee dates remain unchanged',()=>{
  const data=state('2026-12-31','2027-01-01');
  const chef=dailyStats(data,{role:'chef'},'2026-12-31');
  assert.equal(chef.revenue,30);assert.equal(chef.cashRevenue,10);assert.equal(chef.orders,2);assert.equal(chef.completed,2);
  assert.equal(chef.hourly.at(-1).label,'01:00 (+1)');assert.equal(chef.hourly.at(-1).value,1);
  assert.equal(chef.weekly.at(-1).value,2);
  const driver=dailyStats(data,{role:'driver',id:'d'},'2026-12-31');
  assert.equal(driver.revenue,110);assert.equal(driver.hourly[1].label,'01:00');
});
test('late sales roll into the preceding day, week, month, year and custom period without double counting or changing payroll',()=>{
  for(const [date,next,mode,first,second] of [
    ['2026-12-31','2027-01-01','year','2026','2027'],
    ['2026-01-31','2026-02-01','month','2026-01','2026-02'],
    ['2026-02-01','2026-02-02','week','2026-02-01','2026-02-02'],
  ]) {
    const data=state(date,next),user={role:'chef'};
    // The early-morning receipt on the first date still belongs inside these
    // larger periods, while the late receipt moves back across their end.
    const before=periodStats(data,user,mode,first),after=periodStats(data,user,mode,second);
    assert.equal(before.revenue,130);assert.equal(after.revenue,40);
    assert.equal(before.cash,110);assert.equal(before.online,20);
    assert.equal(periodStats(data,user,'day',date).revenue,30);
    assert.equal(periodStats(data,user,'day',next).revenue,40);
    assert.equal(before.revenue+after.revenue,170);
    const range={first:date,end:next,from:Date.parse(date+'T00:00:00+01:00'),to:Date.parse(next+'T00:00:00+01:00')};
    assert.equal(periodStats(data,user,'range',range).revenue,30);
    assert.equal(monthlyPayroll(data.employees[0],data,date.slice(0,7)).payout,-(110+(next.slice(0,7)===date.slice(0,7)?40:0)));
  }
});
