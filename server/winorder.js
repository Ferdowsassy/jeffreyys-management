import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { berlinDate } from '../shared/daily-stats.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const list = value => value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];
const scalar = (value, max = 400) => {
  if (value === undefined || value === null) return '';
  if (!['string', 'number'].includes(typeof value)) fail('Invalid WinOrder field');
  const text = String(value).trim();
  if (text.length > max) fail('WinOrder field too long');
  return text;
};
const hash = value => createHash('sha256').update(value).digest();
function canonicalDetails(value, depth=0) {
  if (depth>30) fail('WinOrder details are nested too deeply');
  if (Array.isArray(value)) return value.map(entry=>canonicalDetails(entry,depth+1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, value]) => [key === 'StoreId' ? 'StoreID' : key,
      canonicalDetails(['Article','SubArticle'].includes(key) ? list(value) : value,depth+1)])
    .sort(([a], [b]) => a.localeCompare(b)));
  return value === null ? null : String(value).trim();
}
export function winorderCredentials(env = process.env) {
  const username = env.WINORDER_USERNAME || '';
  const password = env.WINORDER_PASSWORD || '';
  if (!username && !password) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(username) || password.length < 24 || password.length > 200)
    throw new Error('WinOrder requires WINORDER_USERNAME and a WINORDER_PASSWORD of 24–200 characters');
  return {username, password};
}
export function authenticateWinorder(req, credentials) {
  if (!credentials) fail('WinOrder integration is not configured', 503);
  const header = req.headers.authorization || '';
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(header);
  let username = '', password = '';
  if (match) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon >= 0) { username = decoded.slice(0, colon); password = decoded.slice(colon + 1); }
  }
  if (!timingSafeEqual(hash(username), hash(credentials.username)) || !timingSafeEqual(hash(password), hash(credentials.password)))
    fail('Invalid WinOrder credentials', 401);
}
function currency(value) {
  const text = scalar(value, 40).replace(/\s|€|EUR/gi, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount <= 100000 ? Math.round(amount * 100) / 100 : null;
}
function payment(value) {
  const label = value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^(bar|barzahlung|cash|cash payment|zahlung bei lieferung|bar bei lieferung)$/.test(label)) return 'cash';
  if (/^(online|online bezahlt|paypal|bezahlt|paid|vorkasse|vorab bezahlt|lieferando online|uber eats|ubereats|wolt)$/.test(label)) return 'online';
  // An unfamiliar payment method must be reviewed, never treated as cash collected.
  return null;
}
function createdTime(value, now) {
  const text = scalar(value, 80);
  if (!text) return now;
  let stamp;
  if (/^\d{10}$/.test(text)) stamp = Number(text) * 1000;
  else if (/^\d{13}$/.test(text)) stamp = Number(text);
  else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) stamp = Date.parse(text);
  else {
    const german = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    const date = german ? `${german[3]}-${german[2]}-${german[1]}` : iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
    const match = german || iso;
    if (match && date && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6] || 0) < 60) {
      // Resolve restaurant wall time against Berlin, including the day's DST offset.
      const wall = Date.parse(`${date}T${match[4]}:${match[5]}:${match[6] || '00'}Z`);
      stamp = wall;
      for (let i = 0; i < 3; i++) {
        const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(new Date(stamp));
        const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
        const asUTC = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
        stamp = wall - (asUTC - stamp);
      }
    }
  }
  if (!Number.isFinite(stamp) || stamp > Date.parse(now) + 300000) fail('Invalid WinOrder order creation time');
  return new Date(stamp).toISOString();
}
function decode(body) {
  const preview = body.subarray(0, 200).toString('ascii');
  const encoding = /encoding=["'](windows-1252|iso-8859-1)["']/i.exec(preview)?.[1] || 'utf-8';
  try { return new TextDecoder(encoding, {fatal:true}).decode(body).replace(/^\uFEFF/, ''); }
  catch { fail('Invalid WinOrder text encoding'); }
}
export function parseWinorder(body, now = new Date().toISOString()) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > 1048576) fail('Supply a WinOrder XML or JSON order');
  const text = decode(body).trim();
  const xml = text.startsWith('<');
  let document;
  if (xml) {
    // No document types, external entities or custom entity expansion are accepted.
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) fail('Invalid or unsupported WinOrder XML');
    try { document = new XMLParser({parseTagValue:false, maxNestedTags:30}).parse(text); }
    catch { fail('Invalid WinOrder XML'); }
  } else {
    try { document = JSON.parse(text); } catch { fail('Invalid WinOrder JSON'); }
  }
  // WinOrder's documented JSON omits the <WinOrder> XML envelope.
  // Preserve the previously accepted wrapped JSON for existing senders.
  const root = xml ? document?.WinOrder?.OrderList : document?.OrderList ?? document?.WinOrder?.OrderList;
  if (!root || typeof root !== 'object' || Array.isArray(root)) fail('Expected WinOrder.OrderList');
  const orders = list(root.Order);
  if (!orders.length || orders.length > 100) fail('WinOrder batch must contain 1–100 orders');
  const seen = new Set();
  return orders.map(order => {
    if (!order || typeof order !== 'object') fail('Invalid WinOrder order');
    const info = order.AddInfo || {}, address = order.Customer?.DeliveryAddress || {};
    const type = scalar(info.DeliverType || info.DeliveryType, 60).toLowerCase();
    // Pickup/table orders do not enter the driver's delivery queue.
    if (['abholer','abholung','pickup','take-away','dine-in','restaurant','tisch'].includes(type)) return null;
    const issues = [];
    if (type !== 'lieferung' && type !== 'delivery') issues.push('Lieferart prüfen');
    const externalOrderId = scalar(order.OrderID, 120);
    if (!externalOrderId) fail('WinOrder OrderID is required');
    const sourceTime = order.ServerData?.CreateDateTime || root.CreateDateTime;
    const createdAt = createdTime(sourceTime, now);
    const storeId = scalar(order.StoreData?.StoreID ?? order.StoreData?.StoreId, 80);
    const externalKey = `${storeId}:${berlinDate(createdAt)}:${externalOrderId}`;
    if (seen.has(externalKey)) fail('Duplicate OrderID in WinOrder batch');
    seen.add(externalKey);
    const street = [scalar(address.Street, 200), scalar(address.HouseNo, 30)].filter(Boolean).join(' ');
    const postalCode = scalar(address.Zip, 20), city = scalar(address.City, 100);
    const amount = currency(info.Total), paymentLabel = scalar(info.PaymentType, 100), paymentType = payment(paymentLabel);
    if (!street || !/^\d{5}$/.test(postalCode) || !city) issues.push('Lieferadresse ergänzen');
    if (amount === null) issues.push('Gesamtbetrag prüfen');
    if (paymentType === null) issues.push('Zahlungsart prüfen');
    // Invoice totals are authoritative; item prices/toppings are retained as delivery details,
    // not mixed into the existing article revenue report without price reconciliation.
    const articles = list(order.ArticleList?.Article);
    if (articles.length > 100) fail('Too many WinOrder articles');
    const description = articles.map(article => {
      const extras = list(article.SubArticleList?.SubArticle);
      if (extras.length > 100) fail('Too many WinOrder toppings');
      return [scalar(article.Count, 20), scalar(article.ArticleName, 120), scalar(article.ArticleSize, 80),
        scalar(article.Comment, 400), ...extras.map(extra => scalar(extra.ArticleName, 120))].filter(Boolean).join(' · ');
    }).join('\n');
    if (description.length > 16000) fail('WinOrder article details too long');
    const record = {externalOrderId, externalKey, createdAt, source:'winorder', address:street, postalCode, city,
      amount, payment:paymentType, paymentLabel, orderNumber:externalOrderId, reviewIssues:issues,
      customerName:[scalar(address.FirstName, 100), scalar(address.LastName, 100)].filter(Boolean).join(' '),
      customerPhone:scalar(address.PhoneNo || address.Mobile, 60),
      deliveryNotes:[scalar(address.AddAddress), scalar(address.DescriptionOfWay, 1000), scalar(info.Comment, 1000)].filter(Boolean).join('\n'),
      articleDescription:description};
    // A sender may recreate the envelope timestamp on retry. It is not a change
    // to the delivery itself; the source date is already part of externalKey.
    // Keep all business order fields, including optional and provider-specific
    // fields, prices, discounts, customer names and toppings. ServerData is
    // technical request metadata; its order timestamp is already normalized.
    const {ServerData, ...winorderDetails} = order;
    return {...record, winorderDetails,
      sourceHash:hash(JSON.stringify({...record, createdAt:null, winorderDetails:canonicalDetails(winorderDetails)})).toString('hex')};
  });
}
export function importWinorder(state, orders, now = new Date().toISOString()) {
  const results = {imported:0, updated:0, duplicates:0, ignored:0};
  for (const order of orders) {
    if (!order) {results.ignored++; continue;}
    const existing = state.orders.find(o => o.source === 'winorder' && o.externalKey === order.externalKey);
    if (existing) {
      if (!existing.winorderDetails) {
        const {winorderDetails, sourceHash, ...legacyRecord} = order;
        const legacyHash = hash(JSON.stringify({...legacyRecord, createdAt:null})).toString('hex');
        // An unchanged retry from the earlier parser can enrich an assigned
        // order without changing its assignment or chef-reviewed values.
        if (existing.sourceHash === legacyHash) {
          Object.assign(existing, {winorderDetails, sourceHash});
          results.duplicates++; continue;
        }
      }
      if (existing.sourceHash === order.sourceHash) { results.duplicates++; continue; }
      if (!['available','review'].includes(existing.status)) fail('This WinOrder order was already assigned or closed; review the change with the chef', 409);
      Object.assign(existing, order, {createdAt:existing.createdAt, status:'available', updatedAt:now});
      results.updated++;
    } else {
      if (state.orders.some(o => o.source !== 'winorder' && o.orderNumber === order.orderNumber && berlinDate(o.createdAt) === berlinDate(order.createdAt)))
        fail('This order number was already entered manually today; the chef must resolve the duplicate', 409);
      state.orders.push({...order, id:randomUUID(), employeeId:null, shiftId:null,
        status:'available', deliveryFee:0,
        deliveredAt:null, importedAt:now, items:[], noAddress:false, demo:false});
      results.imported++;
    }
  }
  state.settings.winorderLastReceivedAt = now;
  state.audit.push({id:randomUUID(), type:'winorderImport', employeeId:null, createdAt:now, demo:false, ...results});
  if (state.audit.length > 10000) state.audit = state.audit.slice(-10000);
  return results;
}
