import {berlinDate, dayStart, shiftDate, shiftsById, orderWorkDate} from './daily-stats.js';
import {payroll} from './payroll.js';

export function periodRange(mode, value) {
  const pattern=mode==='year'?/^\d{4}$/:mode==='month'?/^\d{4}-(0[1-9]|1[0-2])$/:/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  if(typeof value!=='string' || !pattern.test(value) || Number(value.slice(0,4))<1900 || Number(value.slice(0,4))>2200)throw new Error('Ungültiger Zeitraum.');
  const first = mode === 'year' ? value+'-01-01' : mode === 'month' ? value+'-01' : mode==='week' ? shiftDate(value,-((new Date(value+'T12:00:00Z').getUTCDay()+6)%7)) : value;
  const end = mode === 'year' ? (Number(value)+1)+'-01-01' : mode === 'month'
    ? new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),1)).toISOString().slice(0,10) : shiftDate(first,mode==='week'?7:1);
  return {first,end,from:dayStart(first),to:dayStart(end)};
}

// Returns belong to the original cash orders, even when cash is handed in later.
// Earnings and their cash deductions belong to the shift's Berlin start date.
// Legacy orders without a matching shift retain their receipt date.
export function monthlyPayroll(employee, data, month, now=Date.now()) {
  periodRange('month',month);
  const shiftIndex=shiftsById(data.shifts);
  const workDate=order=>orderWorkDate(order,shiftIndex);
  const shifts=data.shifts.filter(s=>s.employeeId===employee.id && berlinDate(s.start).startsWith(month))
    .map(s=>({...s,end:new Date(Math.min(Date.parse(s.end || new Date(now).toISOString()),now)).toISOString()}));
  const orders=data.orders.filter(o=>o.employeeId===employee.id && workDate(o).startsWith(month));
  const handoffs=data.handoffs.filter(h=>h.employeeId===employee.id).map(h=>{
    const cash=data.orders.filter(o=>o.employeeId===employee.id && o.shiftId===h.shiftId && o.status==='delivered' && o.payment==='cash');
    const total=cash.reduce((n,o)=>n+Math.round(o.amount*100),0);
    const part=cash.filter(o=>workDate(o).startsWith(month)).reduce((n,o)=>n+Math.round(o.amount*100),0);
    const prior=cash.filter(o=>workDate(o).slice(0,7)<month).reduce((n,o)=>n+Math.round(o.amount*100),0);
    const shift=shiftIndex.get(h.shiftId);
    const handoffDate=berlinDate(shift && shift.employeeId===h.employeeId ? shift.start : h.createdAt);
    const allocate=value=>total ? (Math.round(Math.round(value*100)*(prior+part)/total)-Math.round(Math.round(value*100)*prior/total))/100 : handoffDate.startsWith(month)?value:0;
    return {...h,expected:allocate(h.expected),counted:h.counted===null ? null : allocate(h.counted)};
  });
  const p=payroll({employees:[employee],shifts,orders,handoffs},now)[0];
  const paidCents=(data.salaryPayments || []).filter(p=>p.employeeId===employee.id && p.month===month).reduce((n,p)=>n+Math.round(p.amount*100),0);
  return {hours:p.hours,wages:p.hourlyPay,fees:p.deliveryPay,gross:p.gross,cash:p.collectedCash,returned:p.returnedCash,retained:p.retainedCash,payout:p.payout,paid:paidCents/100,balance:Math.round(p.payout*100-paidCents)/100};
}

export function periodStats(data,user,mode,value,now=Date.now()) {
  const range=mode==='range'?value:periodRange(mode,value), inRange=d=>Date.parse(d)>=range.from && Date.parse(d)<range.to;
  const orders=data.orders.filter(o=>['open','delivered','available'].includes(o.status) && inRange(o.createdAt) && (user.role!=='driver' || o.employeeId===user.id));
  const employees=user.role==='chef' ? data.employees : data.employees.filter(e=>e.id===user.id);
  const ownIds=new Set(employees.map(e=>e.id));
  const shiftIndex=shiftsById(data.shifts);
  const earnedInRange=order=>{const date=dayStart(orderWorkDate(order,shiftIndex));return date>=range.from && date<range.to;};
  const scoped={...data,employees,orders:data.orders.filter(o=>ownIds.has(o.employeeId) && earnedInRange(o)),shifts:data.shifts.filter(s=>ownIds.has(s.employeeId) && inRange(s.start))
    .map(s=>({...s,end:new Date(Math.min(Date.parse(s.end || new Date(now).toISOString()),now)).toISOString()}))};
  const staff=payroll(scoped,now);
  const revenue=orders.reduce((n,o)=>n+Math.round((o.amount || 0)*100),0)/100;
  const cash=orders.filter(o=>o.payment==='cash').reduce((n,o)=>n+Math.round((o.amount || 0)*100),0)/100;
  const wages=staff.reduce((n,p)=>n+Math.round(p.gross*100),0)/100;
  const expenses=(data.expenses || []).filter(e=>e.date>=range.first && e.date<range.end);
  const actual=expenses.reduce((n,e)=>n+Math.round(e.amount*100),0)/100;
  let fixed=0;
  const estimateEnd=range.end<shiftDate(berlinDate(now),1)?range.end:shiftDate(berlinDate(now),1);
  for(let d=range.first;d<estimateEnd;d=shiftDate(d,1)) {
    const days=new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7)),0)).getUTCDate();
    fixed+=Number(data.settings.fixedCosts || 0)/days;
  }
  // Actual food/fixed-cost entries replace their corresponding estimate for this period.
  const estimatedFood=expenses.some(e=>e.category==='food') ? 0 : revenue*Number(data.settings.foodCostPercent || 0)/100;
  const estimatedFixed=expenses.some(e=>e.category==='fixed') ? 0 : fixed;
  return {range,orders,revenue,cash,online:Math.round((revenue-cash)*100)/100,staff,wages,expenses,actual,estimatedFood,estimatedFixed,profit:revenue-wages-actual-estimatedFood-estimatedFixed};
}
