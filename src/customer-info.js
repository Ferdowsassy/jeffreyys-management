import {winorderFields,usablePhone} from '../shared/winorder-fields.js';
const text = value => typeof value==='string' || typeof value==='number' ? String(value).trim() : '';
const fullName = value => [text(value?.FirstName),text(value?.LastName)].filter(Boolean).join(' ');

export function customerInfo(order) {
  const customer=order.winorderDetails?.Customer || {}, address=customer.DeliveryAddress || {};
  const fields=winorderFields(order.winorderDetails);
  const name=fullName(address) || text(order.customerName) || fullName(customer);
  const phone=usablePhone(address.PhoneNo) || usablePhone(order.customerPhone) || fields.customerPhone || usablePhone(customer.PhoneNo);
  const mobile=usablePhone(address.Mobile) || usablePhone(customer.Mobile);
  return {
    name, displayName:[name && text(address.Title || customer.Title),name].filter(Boolean).join(' '),
    company:text(address.Company) || text(customer.Company), phone, mobile:mobile===phone ? '' : mobile,
    email:text(address.EMail || address.Email) || text(customer.EMail || customer.Email),
    number:text(customer.CustomerNo),
    notes:[...new Set([...text(order.deliveryNotes).split('\n'),...fields.deliveryNotes.split('\n')].filter(Boolean))].join('\n'),
    providerReference:fields.providerReference,
  };
}

export function orderReference(value) {
  const number=text(value);
  if (/^\{?[0-9a-f]{8}-[0-9a-f-]{27}\}?$/i.test(number)) return number.replace(/[{}]/g,'').slice(0,8);
  return number.length>24 ? number.slice(0,16)+'…'+number.slice(-4) : number || '—';
}

// Keep households at the same address separate when WinOrder identifies the customer.
export function customerRows(orders,now=Date.now()) {
  const groups=new Map();
  for (const order of orders) {
    if (order.noAddress || !order.address || !['available','review','open','delivered'].includes(order.status)) continue;
    const info=customerInfo(order);
    const address=[order.address,order.postalCode,order.city].filter(Boolean).join(' ');
    const identity=info.number ? ['number',info.number] : info.name ? ['name',info.name,info.company] : ['contact',info.phone || info.mobile || info.email || info.company];
    const key=JSON.stringify([address,...identity]).toLocaleLowerCase('de-DE');
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(order);
  }
  return [...groups.entries()].map(([key,group])=>{
    const sorted=group.slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),last=sorted.at(-1);
    const info={};
    for (const order of sorted) for (const [field,value] of Object.entries(customerInfo(order))) if (value) info[field]=value;
    const days=Math.max(0,Math.floor((now-Date.parse(last.createdAt))/86400000));
    const interval=group.length>1 ? (Date.parse(last.createdAt)-Date.parse(sorted[0].createdAt))/86400000/(group.length-1) : null;
    const status=interval!==null && days>Math.max(7,interval*1.5) ? 'Gefährdet' : group.length===1 ? 'Neu' : group.length>=5 ? 'Stammkunde' : 'Aktiv';
    const address=[last.address,[last.postalCode,last.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return {key,info,address,last,orders:sorted.reverse(),count:group.length,revenue:group.reduce((total,o)=>total+(Number(o.amount)||0),0),days,status};
  });
}
