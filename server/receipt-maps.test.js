import test from 'node:test';
import assert from 'node:assert/strict';
import {addressFromMaps, mapsURL} from '../shared/receipt-maps.js';
import {resolveReceiptMaps} from './receipt-maps.js';
import {fixture} from './test-helper.js';
const target='https://www.google.com/maps?q=Teststra%C3%9Fe%2010%2C%2080999%20M%C3%BCnchen';
test('only Maps postal addresses populate delivery fields, never fiscal QR data or coordinates',()=>{
  assert.deepEqual(addressFromMaps(target),{address:'Teststraße 10',postalCode:'80999',city:'München'});
  assert.deepEqual(addressFromMaps('https://www.google.de/maps/place/Teststr.+10,+80999+M%C3%BCnchen/'),{address:'Teststr. 10',postalCode:'80999',city:'München'});
  for(const value of ['V0;TSE;receipt;123','https://evil.example/maps?q=x','https://www.google.com.evil.example/maps','http://127.0.0.1/maps','https://www.google.com:8443/maps'])assert.equal(mapsURL(value),null);
  assert.equal(addressFromMaps('https://www.google.com/maps?q=48.1,11.5'),null);
});
test('short-link resolver validates each redirect and caps requests',async()=>{
  let calls=0;
  assert.deepEqual(await resolveReceiptMaps(target,()=>{throw Error('must not fetch');}),addressFromMaps(target));
  assert.deepEqual(await resolveReceiptMaps('https://maps.app.goo.gl/abcd',async()=>{calls++;return new Response(null,{status:302,headers:{location:target}});}),addressFromMaps(target));
  assert.equal(calls,1);
  for(const location of ['http://127.0.0.1/private','https://evil.example/maps','https://www.google.com:8443/maps'])
    await assert.rejects(resolveReceiptMaps('https://maps.app.goo.gl/abcd',async()=>new Response(null,{status:302,headers:{location}})),/nicht erlaubte/);
  calls=0;
  assert.equal(await resolveReceiptMaps('https://maps.app.goo.gl/abcd',async()=>{calls++;return new Response(null,{status:302,headers:{location:'/abcd'}});}),null);
  assert.equal(calls,4);
});
test('place-ID receipts use server-only Google Places credentials and extract the returned postal address',async()=>{
  const url='https://www.google.com/maps/search/?api=1&query=Google&query_place_id=ChIJExamplePlace123';
  await assert.rejects(resolveReceiptMaps(url),/Google-Orts-ID/);
  const result=await resolveReceiptMaps(url,async(input,options)=>{
    assert.equal(input,'https://places.googleapis.com/v1/places/ChIJExamplePlace123?languageCode=de');
    assert.equal(options.headers['X-Goog-Api-Key'],'test-secret');assert.equal(options.headers['X-Goog-FieldMask'],'formattedAddress');
    return Response.json({formattedAddress:'Teststraße 10, 80999 München, Deutschland'});
  },'test-secret');
  assert.deepEqual(result,addressFromMaps(target));
});
test('receipt Maps endpoint requires login and role, and settings never expose keys',async t=>{
  const {request,login}=await fixture(t);
  assert.equal((await request('/api/receipts/maps',{url:target})).status,401);
  const chef=await login('alex','1234'),driver=await login('leo','3456'),kitchen=await login('samira','2345');
  assert.equal((await request('/api/receipts/maps',{url:target},kitchen)).status,403);
  assert.deepEqual((await request('/api/receipts/maps',{url:target},driver)).body.address,addressFromMaps(target));
  assert.equal((await request('/api/action',{type:'saveReceiptMapsKey',key:'test-secret'},driver)).status,403);
  const saved=await request('/api/action',{type:'saveReceiptMapsKey',key:'test-secret'},chef);
  assert.equal(saved.status,200);assert.equal(saved.body.state.settings.receiptMapsConfigured,true);
  assert.ok(!JSON.stringify(saved.body).includes('test-secret'));
  assert.ok(!JSON.stringify((await request('/api/state',undefined,driver)).body).includes('test-secret'));
});
