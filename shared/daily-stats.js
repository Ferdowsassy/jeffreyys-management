const dateFormatter = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
const hourFormatter = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',hourCycle:'h23'});
const offsetFormatter = new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'});
export const berlinDate = value => dateFormatter.format(new Date(value));
export function shiftDate(date, offset) {
  const d = new Date(date+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
}
export function dayStart(date) {
  const midnight = Date.parse(date+'T00:00:00Z');
  let instant = midnight;
  for(let i=0;i<3;i++) {
    const offset = offsetFormatter.formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName').value;
    const match = offset.match(/^GMT([+-])(\d+)(?::(\d+))?$/);
    const milliseconds = match ? (match[1]==='-' ? -1 : 1)*(Number(match[2])*60+Number(match[3] || 0))*60000 : 0;
    instant = midnight-milliseconds;
  }
  return instant;
}
export function dailyEarnings(data, employeeId, date, now = Date.now()) {
  const from=dayStart(date), to=dayStart(shiftDate(date,1));
  const shifts=data.shifts.filter(s=>employeeId===null || s.employeeId===employeeId);
  let hours=0, wageCents=0;
  for(const shift of shifts) {
    const duration=Math.max(0,Math.min(Date.parse(shift.end || new Date(now).toISOString()),to,now)-Math.max(Date.parse(shift.start),from))/3600000;
    hours+=duration;wageCents+=Math.round(duration*Math.round((shift.hourlyRate || 0)*100));
  }
  const paidOrders=data.orders.filter(o=>o.status==='delivered' && berlinDate(o.createdAt)===date && (employeeId===null || o.employeeId===employeeId));
  const deliveryCents=paidOrders.reduce((n,o)=>n+Math.round((o.deliveryFee || 0)*100),0);
  return {hours,wages:wageCents/100,fees:deliveryCents/100,gross:(wageCents+deliveryCents)/100,
    collectedCash:paidOrders.filter(o=>o.payment==='cash').reduce((n,o)=>n+Math.round((o.amount || 0)*100),0)/100,
    provisional:shifts.some(s=>!s.end && Date.parse(s.start)<to && now>from)};
}
export function dailyStats(data, user, date, now = Date.now()) {
  // Scope even if this helper receives a full state rather than the API's filtered state.
  if(user.role==='driver')data={...data,orders:data.orders.filter(o=>o.employeeId===user.id)};
  const orders = data.orders.filter(o=>berlinDate(o.createdAt)===date);
  const completed = data.orders.filter(o=>o.deliveredAt && berlinDate(o.deliveredAt)===date);
  const earnings=dailyEarnings(data,user.role==='chef'?null:user.id,date,now);
  const measured=completed.filter(o=>o.completionSource!=='clockOut');
  return {
    orders:orders.length,completed:completed.length,automatic:completed.filter(o=>o.completionSource==='clockOut').length,
    open:data.orders.filter(o=>o.status==='open').length,...earnings,
    revenue:orders.reduce((n,o)=>n+Math.round((o.amount || 0)*100),0)/100,
    averageMinutes:measured.length ? measured.reduce((n,o)=>n+Math.max(0,Date.parse(o.deliveredAt)-Date.parse(o.createdAt))/60000,0)/measured.length : null,
    hourly:Array.from({length:24},(_,h)=>({label:String(h).padStart(2,'0')+':00',value:orders.filter(o=>Number(hourFormatter.format(new Date(o.createdAt)))===h).length})),
    weekly:Array.from({length:7},(_,i)=>{
      const key=shiftDate(date,i-6);
      return {label:key.slice(8)+'.'+key.slice(5,7),value:data.orders.filter(o=>berlinDate(o.createdAt)===key).length};
    }),
  };
}
