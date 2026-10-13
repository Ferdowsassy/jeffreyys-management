import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './test-helper.js';
import {parseWinorder, winorderCredentials} from './winorder.js';

const credentials = {username:'winorder', password:'test-password-for-winorder-123456789'};
const auth = 'Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64');
export function winorderSample(id = 'WIN-101', {payment='Bar', amount='25.50', type='Lieferung', street='Teststraße', timestamp=new Date().toISOString()} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?><WinOrder><OrderList><CreateDateTime>${timestamp}</CreateDateTime><Order><OrderID>${id}</OrderID><Customer><DeliveryAddress><FirstName>Test</FirstName><LastName>Kunde</LastName><Street>${street}</Street><HouseNo>12</HouseNo><Zip>80802</Zip><City>München</City><PhoneNo>089123456</PhoneNo><AddAddress>2. Stock</AddAddress></DeliveryAddress></Customer><StoreData><StoreID>1</StoreID></StoreData><AddInfo><DeliverType>${type}</DeliverType><PaymentType>${payment}</PaymentType><Total>${amount}</Total><Comment>Bitte klingeln</Comment></AddInfo><ArticleList><Article><ArticleName>Burger &amp; Pommes</ArticleName><Count>1</Count><Price>25.50</Price></Article></ArticleList></Order></OrderList></WinOrder>`;
}
function sender(base) {
  return async (xml, {authorization=auth, path='/sendorder', contentType='text/xml'} = {}) => {
    const response = await fetch(base+path,{method:'POST',headers:{authorization,'content-type':contentType},body:xml});
    return {status:response.status, body:await response.json()};
  };
}
test('WinOrder parser preserves identifiers, address, totals, notes and Berlin timestamps; requires review for unknown payments', () => {
  const [order] = parseWinorder(Buffer.from(winorderSample('00001', {timestamp:'2026-01-12T18:00:00+01:00'})));
  assert.equal(order.orderNumber,'00001'); assert.equal(order.amount,25.5);
  assert.equal(order.address,'Teststraße 12'); assert.equal(order.customerPhone,'089123456');
  assert.equal(order.articleDescription,'1 · Burger & Pommes'); assert.equal(order.payment,'cash');
  assert.equal(order.createdAt,'2026-01-12T17:00:00.000Z'); assert.equal(order.externalKey,'1:2026-01-12:00001');
  for (const [text, expected] of [['12.01.2026 18:00:00','2026-01-12T17:00:00.000Z'],['12.07.2026 18:00:00','2026-07-12T16:00:00.000Z']]) {
    assert.equal(parseWinorder(Buffer.from(winorderSample('DATE',{timestamp:text})))[0].createdAt,expected);
  }
  assert.equal(parseWinorder(Buffer.from(winorderSample('UNKNOWN',{payment:'EC bei Lieferung'})))[0].payment,null);
  assert.deepEqual(parseWinorder(Buffer.from(winorderSample('PICKUP',{type:'Abholer'}))),[null]);
  assert.throws(() => parseWinorder(Buffer.from('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><WinOrder>&x;</WinOrder>')));
  assert.throws(() => parseWinorder(Buffer.from('<WinOrder><OrderList></WinOrder>')));
  assert.throws(() => winorderCredentials({WINORDER_USERNAME:'winorder',WINORDER_PASSWORD:'short'}));
});
test('authenticated WinOrder imports persist once, expose a safe shared queue and require an active shift to claim', async t => {
  const {base, request, login, app, dir} = await fixture(t,{winorder:credentials});
  const send = sender(base), xml = winorderSample();
  assert.equal((await send(xml,{authorization:''})).status,401);
  assert.equal((await send(xml,{authorization:'Basic '+Buffer.from('winorder:wrong').toString('base64')})).status,401);
  assert.equal(app.locals.store.read().orders.length,3);
  assert.equal((await send(xml)).body.data.imported,1);
  assert.equal((await send(xml,{path:'/api/integrations/winorder/orders'})).body.data.duplicates,1);
  assert.equal((await send(winorderSample())).body.data.duplicates,1);
  const driver=await login('leo','3456'), chef=await login('alex','1234'), kitchen=await login('samira','2345');
  const view = (await request('/api/state',undefined,driver)).body;
  assert.equal(view.availableOrders.length,1); assert.equal(view.orders.some(o=>o.source==='winorder'),false);
  assert.equal(view.availableOrders[0].customerPhone,undefined); assert.equal(view.availableOrders[0].customerName,undefined);
  assert.equal((await request('/api/state',undefined,kitchen)).body.availableOrders.length,0);
  assert.equal((await request('/api/integrations/winorder',undefined,kitchen)).status,403);
  const settings=(await request('/api/integrations/winorder',undefined,chef)).body;
  assert.equal(settings.configured,true); assert.equal(settings.password,undefined); assert.ok(settings.lastReceivedAt);
  const id=view.availableOrders[0].id;
  assert.equal((await request('/api/action',{type:'delivered',id},chef)).status,409);
  assert.equal((await request('/api/action',{type:'claimOrder',id},kitchen)).status,403);
  await request('/api/action',{type:'clockOut'},driver);
  assert.equal((await request('/api/action',{type:'claimOrder',id},driver)).status,409);
  await request('/api/action',{type:'clockIn'},driver);
  assert.equal((await request('/api/action',{type:'claimOrder',id,employeeId:'mia'},driver)).status,200);
  const claimed=(await request('/api/state',undefined,driver)).body.orders.find(o=>o.id===id);
  assert.equal(claimed.employeeId,'leo'); assert.equal(claimed.deliveryFee,2.5); assert.equal(claimed.customerPhone,'089123456');
  assert.ok(claimed.shiftId); assert.equal(claimed.status,'open');
  assert.equal((await send(xml)).body.data.duplicates,1);
  assert.equal((await send(winorderSample('WIN-101',{timestamp:claimed.createdAt,amount:'99.00'}))).status,409);
  assert.equal(app.locals.store.read().orders.find(o=>o.id===id).amount,25.5);
  assert.equal((await request('/api/action',{type:'releaseOrder',id},driver)).status,200);
  assert.equal(app.locals.store.read().orders.find(o=>o.id===id).employeeId,null);
  assert.equal((await request('/api/action',{type:'claimOrder',id,employeeId:'mia'},chef)).status,200);
  const persisted=JSON.parse(await readFile(dir+'/db.json','utf8')).orders.filter(o=>o.source==='winorder');
  assert.equal(persisted.length,1); assert.equal(persisted[0].employeeId,'mia');
});
test('two simultaneous driver claims have one winner and only the winner can finish the delivery', async t => {
  const {base, request, login, app} = await fixture(t,{winorder:credentials});
  await sender(base)(winorderSample('RACE'));
  const leo=await login('leo','3456'), mia=await login('mia','4567');
  const id=app.locals.store.read().orders.find(o=>o.orderNumber==='RACE').id;
  const responses=await Promise.all([leo,mia].map(cookie=>request('/api/action',{type:'claimOrder',id},cookie)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const winner=responses[0].status===200 ? leo : mia, loser=winner===leo ? mia : leo;
  assert.equal((await request('/api/action',{type:'delivered',id},loser)).status,403);
  assert.equal((await request('/api/action',{type:'delivered',id},winner)).status,200);
  const view=(await request('/api/state',undefined,winner)).body;
  assert.equal(view.availableOrders.length,0);
  const order=view.orders.find(o=>o.id===id), pay=view.payroll[0];
  assert.equal(order.status,'delivered'); assert.ok(pay.deliveryPay>=2.5); assert.ok(pay.collectedCash>=25.5);
});
test('unknown fields stay in chef review; JSON and Latin-1 work; invalid batches roll back; pickups are ignored', async t => {
  const {base, request, login, app} = await fixture(t,{winorder:credentials}), send=sender(base);
  await send(winorderSample('REVIEW',{payment:'unbekannt',amount:''}));
  const chef=await login('alex','1234'), driver=await login('leo','3456');
  const order=app.locals.store.read().orders.find(o=>o.orderNumber==='REVIEW');
  assert.equal(order.status,'review'); assert.equal((await request('/api/state',undefined,driver)).body.availableOrders.length,0);
  assert.equal((await request('/api/action',{type:'claimOrder',id:order.id},driver)).status,409);
  assert.equal((await request('/api/action',{type:'reviewImportedOrder',id:order.id,address:'Teststraße 12',postalCode:'80802',city:'München',amount:25.5,payment:'cash'},chef)).status,200);
  assert.equal((await request('/api/state',undefined,driver)).body.availableOrders.length,1);
  // An unchanged retransmission must preserve the chef's correction.
  assert.equal((await send(winorderSample('REVIEW',{timestamp:order.createdAt,payment:'unbekannt',amount:''}))).body.data.duplicates,1);
  const latin=Buffer.from(winorderSample('LATIN').replace('UTF-8','ISO-8859-1'),'latin1');
  assert.equal((await send(latin)).status,200);
  assert.equal(app.locals.store.read().orders.find(o=>o.orderNumber==='LATIN').city,'München');
  const json=JSON.stringify({WinOrder:{OrderList:{CreateDateTime:new Date().toISOString(),Order:[{OrderID:'JSON',Customer:{DeliveryAddress:{Street:'Test',HouseNo:'3',Zip:'80802',City:'München'}},AddInfo:{Total:12.5,PaymentType:'Online bezahlt',DeliverType:'Lieferung'}}]}}});
  assert.equal((await send(json,{contentType:'application/json'})).status,200);
  assert.equal((await send(winorderSample('PICKUP',{type:'Abholer'}))).body.data.ignored,1);
  assert.equal(app.locals.store.read().orders.some(o=>o.orderNumber==='PICKUP'),false);
  const count=app.locals.store.read().orders.length;
  const batch=winorderSample('GOOD').replace('</OrderList>', '<Order><OrderID></OrderID></Order></OrderList>');
  assert.equal((await send(batch)).status,400); assert.equal(app.locals.store.read().orders.length,count);
  assert.equal((await send('<WinOrder><bad></WinOrder>')).status,400);
});
