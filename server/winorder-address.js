import {winorderPlaceId} from '../shared/winorder-fields.js';
import {resolveReceiptMaps} from './receipt-maps.js';

// Address lookup is optional: an unavailable Places service must never reject
// an otherwise valid order. The unresolved address remains flagged for review.
export async function resolveWinorderAddresses(orders,key='',request=fetch) {
  if(!key)return orders;
  const lookups=new Map();
  for(const order of orders) {
    if(!order || /^\d{5}$/.test(order.postalCode))continue;
    const id=winorderPlaceId(order.address);
    if(!id)continue;
    if(!lookups.has(id))lookups.set(id,resolveReceiptMaps('https://www.google.com/maps/search/?api=1&query=Lieferadresse&query_place_id='+encodeURIComponent(id),request,key).catch(()=>null));
    const address=await lookups.get(id);
    if(!address)continue;
    Object.assign(order,address);
    order.reviewIssues=(order.reviewIssues || []).filter(issue=>issue!=='Lieferadresse ergänzen');
  }
  return orders;
}
