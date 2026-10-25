import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseWinorder,importWinorder} from './winorder.js';
import {resolveWinorderAddresses} from './winorder-address.js';
import {customerInfo} from '../src/customer-info.js';
import {fixture} from './test-helper.js';
import {repairWinorderFields} from './winorder-repair.js';

function sample({place=false,tip='5'}={}) {
  return {OrderList:{CreateDateTime:'2026-10-25T10:00:00Z',Order:{OrderID:'UBER-TEST',StoreData:{StoreId:'1'},
    Customer:{DeliveryAddress:{FirstName:'A.',LastName:'Test,',Street:place?'Places-ID: ChIJExamplePlace123':'Teststraße',...(place?{}:{HouseNo:'12',City:'81249 München, Deutschland'}),PhoneNo:'--',AddAddress:'2. Etage'}},
    AddInfo:{PaymentType:'UberEats Onlinezahlung',Total:'36.21',Tip:tip},
    ArticleList:{Article:[
      {Count:'1',Price:'0',Comment:"UberEats (Testfiliale) Bestellung von 11:00"},
      {Count:'1',Price:'0',Comment:'2. Etage'},
      {Count:'1',Price:'0',Comment:'Bitte kurz klingeln'},
      {Count:'1',Price:'0',Comment:'Deine Bestellnummer: AB123'},
      {Count:'1',Price:'0',Comment:'Tel. +49 32 211076159 (123 45 678)'},
      {Count:'2',Price:'12.90',ArticleName:'Burger',Comment:'Ohne Zwiebeln'},
    ]}}}};
}
const parse=value=>parseWinorder(Buffer.from(JSON.stringify(value)));
test('real Uber forwarding format separates PLZ, prepaid payment, tip and portal contact metadata',()=>{
  const [order]=parse(sample());
  assert.equal(order.postalCode,'81249');assert.equal(order.city,'München');assert.equal(order.address,'Teststraße 12');
  assert.equal(order.payment,'online');assert.equal(order.amount,31.21);assert.equal(order.tipOnline,5);assert.equal(order.tipCash,0);
  assert.deepEqual(order.reviewIssues,[]);
  const info=customerInfo(order);
  assert.equal(info.phone,'+49 32 211076159');assert.equal(info.providerReference,'AB123');
  assert.equal(info.notes,'2. Etage\nBitte kurz klingeln\nTelefon-Zugangscode: 123 45 678');
  assert.equal(order.orderNumber,'UBER-TEST');assert.equal(order.winorderDetails.Customer.DeliveryAddress.PhoneNo,'--');
  assert.equal(order.winorderDetails.ArticleList.Article[5].Comment,'Ohne Zwiebeln');
  const state={orders:[],settings:{},audit:[]};
  importWinorder(state,[order]);state.orders[0].status='open';state.orders[0].payment='cash';state.orders[0].postalCode='99999';
  assert.equal(importWinorder(state,parse(sample())).duplicates,1);assert.equal(state.orders[0].postalCode,'99999');assert.equal(state.orders[0].payment,'cash');
});
test('normalization keeps the previous source hash for unchanged assigned-order retries',()=>{
  const [order]=parse(sample({tip:''}));
  // Fingerprint produced by the previous parser for this exact source.
  const legacy={...order,postalCode:'',city:'81249 München, Deutschland',payment:null,customerPhone:'--',deliveryNotes:'2. Etage',reviewIssues:['Lieferart prüfen','Lieferadresse ergänzen','Zahlungsart prüfen']};
  const {winorderDetails,sourceHash,...record}=legacy;
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k==='StoreId'?'StoreID':k,canonical(x)]).sort(([a],[b])=>a.localeCompare(b))):v===null?null:String(v).trim();
  assert.equal(sourceHash,createHash('sha256').update(JSON.stringify({...record,createdAt:null,winorderDetails:canonical(winorderDetails)})).digest('hex'));
});
test('explicit Zip wins conflicts; missing Places API credentials never invent postal addresses',async()=>{
  const input=sample();input.OrderList.Order.Customer.DeliveryAddress.Zip='80999';
  assert.equal(parse(input)[0].postalCode,'80999');assert.equal(parse(input)[0].city,'81249 München, Deutschland');
  const orders=parse(sample({place:true})),hash=orders[0].sourceHash;
  await resolveWinorderAddresses(orders,'',()=>{throw Error('must not fetch');});
  assert.equal(orders[0].postalCode,'');
  await resolveWinorderAddresses(orders,'key',async()=>{throw Error('unavailable');});
  assert.equal(orders[0].postalCode,'');
  await resolveWinorderAddresses(orders,'key',async()=>Response.json({formattedAddress:'Teststraße 12, 81249 München, Deutschland'}));
  assert.equal(orders[0].postalCode,'81249');assert.equal(orders[0].address,'Teststraße 12');assert.equal(orders[0].sourceHash,hash);
});
test('receiver resolves Places IDs with the saved chef key and preserves import deduplication',async t=>{
  const credentials={username:'test',password:'a-test-password-at-least-24-characters'};
  let calls=0;
  const {app,base}=await fixture(t,{winorder:credentials,receiptMapsFetch:async()=>{calls++;return Response.json({formattedAddress:'Teststraße 12, 81249 München, Deutschland'});}});
  await app.locals.store.transact(s=>{s.settings.googleMapsServerKey='server-only-key';});
  for(let i=0;i<2;i++) {
    const response=await fetch(base+'/sendorder',{method:'POST',headers:{authorization:'Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64')},body:JSON.stringify(sample({place:true}))});
    assert.equal(response.status,200);
    assert.equal((await response.json()).data[i?'duplicates':'imported'],1);
  }
  const order=app.locals.store.read().orders.find(o=>o.orderNumber==='UBER-TEST');
  assert.equal(order.postalCode,'81249');assert.equal(order.payment,'online');assert.equal(calls,2);
});

test('existing-record repair fills missing fields without changing reviewed data or historical accounting',()=>{
  const [parsed]=parse(sample());
  const legacy={...parsed,status:'open',postalCode:'',city:'81249 München, Deutschland',payment:null,amount:36.21,tipOnline:0,customerPhone:'--',deliveryNotes:'2. Etage',deliveryFee:0,reviewIssues:['Lieferart prüfen','Lieferadresse ergänzen','Zahlungsart prüfen','Trinkgeld prüfen']};
  const patch=repairWinorderFields(legacy);
  assert.equal(patch.postalCode,'81249');assert.equal(patch.city,'München');assert.equal(patch.payment,'online');assert.equal(patch.amount,31.21);assert.equal(patch.tipOnline,5);assert.deepEqual(patch.reviewIssues,[]);
  const repaired={...legacy,...patch};assert.deepEqual(repairWinorderFields(repaired),{});
  assert.deepEqual(repairWinorderFields({...legacy,reviewedAt:'2026-10-25T11:00:00Z'}),{});
  const historical=repairWinorderFields({...legacy,status:'delivered',payment:'cash'});
  for(const key of ['payment','amount','tipOnline','tipCash','deliveryFee','employeeId','shiftId','sourceHash'])assert.equal(Object.hasOwn(historical,key),false);
});
