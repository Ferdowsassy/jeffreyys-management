import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
test('WinOrder parser preserves identifiers, address, totals, notes and Berlin timestamps; flags unknown payments', () => {
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

// The official EShop specification's JSON example (pages 15–16) has OrderList
// at the top level, unlike XML's WinOrder > OrderList envelope.
function winorderJson(id='00042') {
  return {OrderList:{CreateDateTime:'2026-01-12T18:00:00+01:00',Order:{
    OrderID:id, StoreData:{StoreId:'1'},
    Customer:{DeliveryAddress:{FirstName:'Test',LastName:'Kunde',Street:'Teststraße',HouseNo:'12',Zip:'80802',City:'München',PhoneNo:'089123456',AddAddress:'2. Stock'}},
    ServerData:{CreateDateTime:'2026-01-12T18:00:00+01:00'},
    AddInfo:{DeliverType:'Lieferung',PaymentType:'Barzahlung',Total:'25.50',Comment:'Bitte klingeln'},
    ArticleList:{Article:[{ArticleName:'Burger & Pommes',Count:'1',Price:'25.50'}]},
  }}};
}

test('documented top-level JSON OrderList supports single orders and batches without changing XML validation', () => {
  const sample=winorderJson();
  const [order]=parseWinorder(Buffer.from(JSON.stringify(sample)));
  assert.equal(order.externalOrderId,'00042'); assert.equal(order.externalKey,'1:2026-01-12:00042');
  assert.equal(order.address,'Teststraße 12'); assert.equal(order.amount,25.5); assert.equal(order.payment,'cash');
  assert.equal(order.articleDescription,'1 · Burger & Pommes'); assert.deepEqual(order.reviewIssues,[]);
  assert.deepEqual(parseWinorder(Buffer.from(JSON.stringify({WinOrder:sample}))),[order]);
  sample.OrderList.Order=[sample.OrderList.Order,winorderJson('00043').OrderList.Order];
  assert.deepEqual(parseWinorder(Buffer.from(JSON.stringify(sample))).map(o=>o.externalOrderId),['00042','00043']);
  for(const invalid of [{OrderList:[]},{OrderList:'invalid'},{OrderList:null},{Order:sample.OrderList.Order}])
    assert.throws(()=>parseWinorder(Buffer.from(JSON.stringify(invalid))));
  assert.throws(()=>parseWinorder(Buffer.from('<OrderList><Order><OrderID>42</OrderID></Order></OrderList>')));
});

test('WinOrder forwarding JSON with no content type imports once and shares deduplication with XML', async t => {
  const {base,request,login,app}=await fixture(t,{winorder:credentials});
  const sample=winorderJson();
  async function send() {
    // A Buffer prevents fetch from adding its own Content-Type for a string.
    const response=await fetch(base+'/sendorder',{method:'POST',headers:{authorization:auth},body:Buffer.from(JSON.stringify(sample))});
    return {status:response.status,body:await response.json()};
  }
  const result=await send();
  assert.equal(result.status,200); assert.equal(result.body.data.imported,1);
  assert.equal((await send()).body.data.duplicates,1);
  const xml=winorderSample('00042',{timestamp:sample.OrderList.CreateDateTime}).replace('<PaymentType>Bar</PaymentType>','<PaymentType>Barzahlung</PaymentType>');
  assert.equal((await sender(base)(xml)).body.data.duplicates,1);
  assert.equal(app.locals.store.read().orders.filter(o=>o.source==='winorder').length,1);
  const chef=await login('alex','1234');
  const diagnostics=(await request('/api/integrations/winorder',undefined,chef)).body;
  assert.equal(diagnostics.attempts[1].status,200); assert.equal(diagnostics.attempts[1].contentType,'missing');
  assert.equal(diagnostics.attempts[1].authenticated,true); assert.ok(diagnostics.lastReceivedAt);
  const driver=await login('leo','3456');
  const queue=(await request('/api/state',undefined,driver)).body.availableOrders;
  assert.equal(queue.length,1); assert.equal(queue[0].orderNumber,'00042');
  assert.equal((await request('/api/action',{type:'claimOrder',id:queue[0].id},driver)).status,200);
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
  assert.equal(view.availableOrders[0].customerPhone,'089123456'); assert.equal(view.availableOrders[0].customerName,'Test Kunde');
  assert.equal((await request('/api/state',undefined,kitchen)).body.availableOrders.length,1);
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
test('incomplete imports are immediately claimable; assigned drivers can correct them without chef approval', async t => {
  const {base, request, login, app} = await fixture(t,{winorder:credentials}), send=sender(base);
  await send(winorderSample('REVIEW',{payment:'unbekannt',amount:''}));
  const chef=await login('alex','1234'), driver=await login('leo','3456'), other=await login('mia','4567'), kitchen=await login('samira','2345');
  const order=app.locals.store.read().orders.find(o=>o.orderNumber==='REVIEW');
  assert.equal(order.status,'available'); assert.equal((await request('/api/state',undefined,driver)).body.availableOrders.length,1);
  assert.equal((await request('/api/action',{type:'claimOrder',id:order.id},driver)).status,200);
  const board=(await request('/api/state',undefined,kitchen)).body.deliveryBoard.find(o=>o.id===order.id);
  assert.equal(board.driverName,'Leo'); assert.equal(board.employeeId,'leo'); assert.equal(board.status,'open');
  assert.equal(board.deliveryFee,undefined); assert.equal(board.customerName,'Test Kunde');
  assert.equal((await request('/api/action',{type:'delivered',id:order.id},driver)).status,409);
  assert.equal((await request('/api/action',{type:'clockOut'},driver)).status,409);
  const correction={type:'reviewImportedOrder',id:order.id,address:'Teststraße 12',postalCode:'80802',city:'München',amount:25.5,payment:'cash'};
  for(const cookie of [other,kitchen])assert.equal((await request('/api/action',correction,cookie)).status,403);
  assert.equal((await request('/api/action',correction,driver)).status,200);
  const corrected=app.locals.store.read().orders.find(o=>o.id===order.id);
  assert.equal(corrected.status,'open'); assert.equal(corrected.employeeId,'leo');
  assert.equal((await request('/api/action',{type:'delivered',id:order.id},driver)).status,200);
  assert.equal((await request('/api/state',undefined,driver)).body.availableOrders.length,0);
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

test('chef diagnostics distinguish missing auth, rejected credentials, invalid bodies and successful retries without exposing input', async t => {
  const {base, request, login, app} = await fixture(t,{winorder:credentials}), send=sender(base);
  const chef=await login('alex','1234'), driver=await login('leo','3456'), kitchen=await login('samira','2345');
  const status=() => request('/api/integrations/winorder',undefined,chef);
  assert.deepEqual((await status()).body.attempts,[]);
  assert.equal((await request('/api/integrations/winorder')).status,401);
  for (const cookie of [driver,kitchen]) assert.equal((await request('/api/integrations/winorder',undefined,cookie)).status,403);
  const xml=winorderSample('DIAGNOSTIC-PRIVATE-ID');
  assert.equal((await send(xml,{authorization:''})).status,401);
  let attempt=(await status()).body.attempts[0];
  assert.equal(attempt.authentication,'missing'); assert.equal(attempt.authenticated,false);
  assert.match(attempt.message,/Kein Authentifizierungsheader/);
  assert.equal((await send(xml,{authorization:'Bearer private-bearer-value'})).status,401);
  assert.equal((await status()).body.attempts[0].authentication,'other');
  assert.equal((await send(xml,{authorization:'Basic '+Buffer.from('private-user:private-password').toString('base64')})).status,401);
  attempt=(await status()).body.attempts[0];
  assert.equal(attempt.authentication,'basic'); assert.equal(attempt.authenticated,false);
  assert.match(attempt.message,/nicht akzeptiert/);
  const invalid='private-body-customer-data';
  assert.equal((await send(invalid,{contentType:'application/x-www-form-urlencoded; charset=utf-8'})).status,400);
  attempt=(await status()).body.attempts[0];
  assert.equal(attempt.authenticated,true); assert.equal(attempt.status,400);
  assert.equal(attempt.contentType,'application/x-www-form-urlencoded'); assert.equal(attempt.bytes,Buffer.byteLength(invalid));
  assert.match(attempt.message,/kein gültiges JSON/);
  assert.equal((await send('<WinOrder><Unexpected /></WinOrder>')).status,400);
  assert.match((await status()).body.attempts[0].message,/OrderList fehlt/);
  assert.equal((await send('x'.repeat(1048577))).status,413);
  attempt=(await status()).body.attempts[0];
  assert.equal(attempt.status,413); assert.equal(attempt.authenticated,true); assert.match(attempt.message,/1 MiB/);
  assert.equal((await send(xml)).status,200);
  assert.equal((await send(xml,{path:'/api/integrations/winorder/orders'})).status,200);
  const response=(await status()).body;
  assert.equal(response.attempts.length,8); assert.ok(response.lastReceivedAt);
  assert.equal(response.attempts[0].status,200); assert.equal(response.attempts[0].authenticated,true);
  const serialized=JSON.stringify(response.attempts);
  for (const secret of [credentials.password,auth,'private-bearer-value','private-user','private-password',invalid,'DIAGNOSTIC-PRIVATE-ID','Teststraße','089123456'])
    assert.equal(serialized.includes(secret),false,secret);
  assert.equal(app.locals.store.read().orders.filter(o=>o.source==='winorder').length,1);
});

test('diagnostics retain only twenty attempts and do not reflect arbitrary errors or header values', async t => {
  const {base, request, login, app} = await fixture(t,{winorder:credentials}), send=sender(base);
  const chef=await login('alex','1234');
  const status=() => request('/api/integrations/winorder',undefined,chef);
  const transact=app.locals.store.transact;
  app.locals.store.transact=async () => {throw new Error('private-database-host-password');};
  try {assert.equal((await send(winorderSample('FAILED-WRITE'))).status,500);}
  finally {app.locals.store.transact=transact;}
  let attempts=(await status()).body.attempts;
  assert.equal(attempts[0].status,500); assert.match(attempts[0].message,/Interner Fehler/);
  assert.equal(JSON.stringify(attempts).includes('private-database'),false);
  for (let i=0;i<22;i++) await send('private-body',{contentType:'application/private-secret; boundary=private-header'});
  attempts=(await status()).body.attempts;
  assert.equal(attempts.length,20); assert.ok(attempts.every(a=>a.status===400 && a.contentType==='other'));
  assert.equal(JSON.stringify(attempts).includes('private'),false);
  // Diagnostics are process-local and never written to the business store.
  assert.equal(JSON.stringify(app.locals.store.read()).includes('winorderAttempt'),false);
});

test('all business order details persist, are shared with the team, and price-only changes are detected', async t => {
  const {base,request,login,app,dir}=await fixture(t,{winorder:credentials});
  const sample=JSON.parse(await readFile(new URL('../scripts/fixtures/winorder-detailed.json',import.meta.url),'utf8'));
  const send=()=>sender(base)(JSON.stringify(sample),{contentType:'application/json'});
  assert.equal((await send()).body.data.imported,1);
  const driver=await login('leo','3456'), kitchen=await login('samira','2345');
  for(const cookie of [driver,kitchen]) {
    const queue=(await request('/api/state',undefined,cookie)).body.availableOrders;
    assert.equal(queue[0].customerName,'Erika Mustermann');
    assert.equal(queue[0].winorderDetails.Customer.BillAddress.Street,'Rechnungsstraße');
    assert.equal(queue[0].winorderDetails.ArticleList.Article[0].SubArticleList.SubArticle[0].Price,'1.50');
    assert.equal(queue[0].winorderDetails.AddInfo.DiscountValue,'3.00');
    assert.equal(queue[0].winorderDetails.AddInfo.Tip,'2.00');
    assert.equal(queue[0].winorderDetails.ProviderReference,'TEST-PORTAL-100');
    assert.equal(queue[0].winorderDetails.ServerData,undefined);
  }
  sample.OrderList.Order.ArticleList.Article[0].Price='13.00';
  assert.equal((await send()).body.data.updated,1);
  const order=app.locals.store.read().orders.find(o=>o.source==='winorder');
  assert.equal(order.amount,32.5); assert.deepEqual(order.items,[]); // Do not invent reconciled article revenue.
  assert.equal((await request('/api/action',{type:'claimOrder',id:order.id},driver)).status,200);
  const shared=(await request('/api/state',undefined,kitchen)).body.deliveryBoard.find(o=>o.id===order.id);
  assert.equal(shared.driverName,'Leo'); assert.equal(shared.winorderDetails.ArticleList.Article[0].Price,'13.00');
  const persisted=JSON.parse(await readFile(dir+'/db.json','utf8')).orders.find(o=>o.id===order.id);
  assert.equal(persisted.winorderDetails.Customer.DeliveryAddress.EMail,'erika@example.com');
  sample.OrderList.Order.ArticleList.Article[0].Price='14.00';
  assert.equal((await send()).status,409);
});

test('unchanged retries enrich legacy assigned orders without changing chef corrections; old review orders need no release', async t => {
  const {base,request,login,app}=await fixture(t,{winorder:credentials});
  const send=sender(base), xml=winorderSample('LEGACY');
  assert.equal((await send(xml)).status,200);
  const driver=await login('leo','3456'), kitchen=await login('samira','2345');
  const imported=app.locals.store.read().orders.find(o=>o.orderNumber==='LEGACY');
  const [parsed]=parseWinorder(Buffer.from(xml));
  const {winorderDetails,sourceHash,...oldRecord}=parsed;
  const oldHash=createHash('sha256').update(JSON.stringify({...oldRecord,createdAt:null})).digest('hex');
  await app.locals.store.transact(state=>{
    const order=state.orders.find(o=>o.id===imported.id);
    order.status='review';delete order.winorderDetails;order.sourceHash=oldHash;
  });
  assert.equal((await request('/api/state',undefined,kitchen)).body.availableOrders[0].status,'available');
  assert.equal((await request('/api/action',{type:'claimOrder',id:imported.id},driver)).status,200);
  await app.locals.store.transact(state=>{state.orders.find(o=>o.id===imported.id).amount=20;});
  assert.equal((await send(xml)).body.data.duplicates,1);
  const enriched=app.locals.store.read().orders.find(o=>o.id===imported.id);
  assert.equal(enriched.amount,20); assert.equal(enriched.employeeId,'leo'); assert.equal(enriched.status,'open');
  assert.ok(enriched.winorderDetails.Customer.DeliveryAddress); assert.equal(enriched.sourceHash,sourceHash);
});
