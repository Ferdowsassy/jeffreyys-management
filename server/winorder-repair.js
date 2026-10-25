import {winorderFields,usablePhone} from '../shared/winorder-fields.js';

// Fill omissions from retained source data. Historical accounting and explicit
// driver/chef reviews are never reinterpreted by a parser repair.
export function repairWinorderFields(order) {
  if(order.source!=='winorder' || !order.winorderDetails || order.reviewedAt)return {};
  const fields=winorderFields(order.winorderDetails), patch={};
  if(!order.postalCode && /^\d{5}$/.test(fields.postalCode))patch.postalCode=fields.postalCode;
  const originalCity=order.winorderDetails.Customer?.DeliveryAddress?.City || '';
  if((!order.city || order.city===originalCity) && fields.city!==order.city)patch.city=fields.city;
  if(!usablePhone(order.customerPhone) && fields.customerPhone)patch.customerPhone=fields.customerPhone;
  const notes=[...new Set([...(order.deliveryNotes || '').split('\n'),...fields.deliveryNotes.split('\n')].filter(Boolean))].join('\n');
  if(notes!==(order.deliveryNotes || ''))patch.deliveryNotes=notes;
  if(['available','review','open'].includes(order.status) && order.payment==null && fields.prepaid) {
    patch.payment='online';
    const info=order.winorderDetails.AddInfo || {}, total=Number(info.Total), tip=Number(info.Tip || 0);
    if(order.amount===total && !order.tipOnline && !order.tipCash && Number.isFinite(tip) && tip>=0 && tip<=total) {
      patch.tipOnline=tip;patch.amount=Math.round((total-tip)*100)/100;
    }
  }
  const next={...order,...patch};
  const issues=(order.reviewIssues || []).filter(issue=>{
    if(issue==='Lieferadresse ergänzen')return !(next.address && /^\d{5}$/.test(next.postalCode) && next.city);
    if(issue==='Zahlungsart prüfen')return !['online','cash'].includes(next.payment);
    if(issue==='Trinkgeld prüfen' && patch.tipOnline!==undefined)return false;
    if(issue==='Lieferart prüfen')return !!(order.winorderDetails.AddInfo?.DeliverType || order.winorderDetails.AddInfo?.DeliveryType);
    return true;
  });
  if(JSON.stringify(issues)!==JSON.stringify(order.reviewIssues || []))patch.reviewIssues=issues;
  return patch;
}
