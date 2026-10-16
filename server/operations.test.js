import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {fixture} from './test-helper.js';
import {monthlyPayroll,periodStats,periodRange} from '../shared/accounting.js';
import {action,filterState} from './domain.js';
import {seed} from './store.js';
import {createApp} from './app.js';

const digest=data=>createHash('sha256').update(data).digest();
test('period costs use actual dated expenses, completed delivery fees, Berlin weeks and no future fixed-cost days',()=>{
 const data={employees:[{id:'a'},{id:'b'}],shifts:[{employeeId:'a',start:'2026-10-01T10:00:00Z',end:'2026-10-01T12:00:00Z',hourlyRate:10}],orders:[{employeeId:'a',createdAt:'2026-10-01T11:00:00Z',status:'delivered',amount:100,payment:'cash',deliveryFee:2},{employeeId:'b',createdAt:'2026-10-01T11:00:00Z',status:'open',amount:50,payment:'online',deliveryFee:5}],handoffs:[],settings:{fixedCosts:310,foodCostPercent:30},expenses:[{date:'2026-10-01',category:'food',amount:20},{date:'2026-10-01',category:'fuel',amount:5}]};
 const stats=periodStats(data,{role:'chef'},'month','2026-10',Date.parse('2026-10-02T12:00:00Z'));
 assert.equal(stats.revenue,150);assert.equal(stats.wages,22);assert.equal(stats.cash,100);assert.equal(stats.online,50);assert.equal(stats.estimatedFood,0);assert.equal(stats.actual,25);assert.equal(stats.estimatedFixed,20);assert.equal(stats.profit,83);
 const driver=periodStats(data,{role:'driver',id:'a'},'month','2026-10');assert.equal(driver.revenue,100);assert.equal(driver.staff.length,1);
 assert.deepEqual([periodRange('week','2026-10-15').first,periodRange('week','2026-10-15').end],['2026-10-12','2026-10-19']);
});
test('overnight wages stay in their start month; unlinked historical cash returns preserve their original allocation',()=>{
 const e={id:'d'},data={employees:[e],shifts:[{id:'wage-shift',employeeId:'d',start:'2026-09-30T21:00:00Z',end:'2026-09-30T23:00:00Z',hourlyRate:10}],orders:[['2026-08-01',1],['2026-09-01',1],['2026-10-01',1]].map(([d,amount])=>({employeeId:'d',shiftId:'s',createdAt:d+'T10:00:00Z',status:'delivered',amount,payment:'cash',deliveryFee:0})),handoffs:[{employeeId:'d',shiftId:'s',expected:3,counted:1,chefConfirmed:true,createdAt:'2026-10-02T10:00:00Z'}],salaryPayments:[]};
 const values=['2026-08','2026-09','2026-10'].map(m=>monthlyPayroll(e,data,m,Date.parse('2026-11-01T12:00:00Z')));
 assert.deepEqual(values.map(v=>v.wages),[0,20,0]);assert.equal(Math.round(values.reduce((n,v)=>n+v.returned,0)*100),100);
 assert.deepEqual(values.map(v=>v.retained),[.67,.66,.67]);
 data.salaryPayments.push({employeeId:'d',month:'2026-09',amount:2});assert.equal(monthlyPayroll(e,data,'2026-09').balance,17.34);
});
test('salary records are idempotent, reject overpayment, survive restart, and never leak other employees or invoice data',async t=>{
 const {request,login,app,dir}=await fixture(t),chef=await login('alex','1234'),driver=await login('leo','3456'),kitchen=await login('samira','2345');
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(new Date());
 const payment={type:'recordSalaryPayment',employeeId:'leo',month,requestId:'payment-test',amount:1,method:'transfer'};
 assert.equal((await request('/api/action',payment,driver)).status,403);
 assert.equal((await request('/api/action',payment,chef)).status,200);assert.equal((await request('/api/action',payment,chef)).status,200);
 assert.equal(app.locals.store.read().salaryPayments.length,1);
 assert.equal((await request('/api/action',{...payment,amount:2},chef)).status,409);
 assert.equal((await request('/api/action',{...payment,requestId:'overpay',amount:99999},chef)).status,409);
 assert.equal((await request('/api/state',undefined,kitchen)).body.salaryPayments.length,0);
 assert.equal((await request('/api/state',undefined,driver)).body.salaryPayments.length,1);
 const expense={type:'saveExpense',date:month+'-01',category:'fuel',description:'Test fuel',amount:12,attachment:{type:'application/pdf',name:'rechnung.pdf',data:Buffer.from('%PDF-1.4\nTest').toString('base64')}};
 const saved=await request('/api/action',expense,chef);assert.equal(saved.status,200);assert.ok(saved.body.result.hasAttachment);assert.equal(saved.body.result.attachment,undefined);
 assert.equal((await request('/api/state',undefined,driver)).body.expenses.length,0);
 assert.equal((await request('/api/export',undefined,chef)).body.expenses[0].attachment,undefined);
 const denied=await fetch((await fixture(t)).base+'/api/payroll.pdf?month='+month);assert.equal(denied.status,401);
 assert.equal((await request('/api/action',{...expense,attachment:{...expense.attachment,type:'text/html'}},chef)).status,400);
});
test('chef can reassign open orders, archive/restore employees and delete zones while preserving historical money',()=>{
 const s=seed(),chef=s.employees.find(e=>e.role==='chef'),mia=s.employees.find(e=>e.id==='mia'),o=s.orders.find(o=>o.status==='open');
 const fee=o.deliveryFee;action(s,chef,{type:'assignOrder',id:o.id,employeeId:'leo'});assert.equal(o.employeeId,'leo');assert.equal(o.deliveryFee,fee);
 assert.throws(()=>action(s,mia,{type:'assignOrder',id:o.id,employeeId:'mia'}),/authorized/);
 assert.throws(()=>action(s,chef,{type:'archiveEmployee',id:'mia'}),/laufende/);
 action(s,mia,{type:'clockOut'});action(s,chef,{type:'archiveEmployee',id:'mia'});assert.equal(mia.archived,true);assert.ok(s.shifts.some(x=>x.employeeId==='mia'));
 action(s,chef,{type:'restoreEmployee',id:'mia'});assert.equal(mia.active,true);
 const zone=s.zones[0];action(s,chef,{type:'deleteZone',id:zone.id});assert.ok(!s.zones.includes(zone));assert.equal(o.deliveryFee,fee);
 assert.throws(()=>action(s,chef,{type:'archiveEmployee',id:chef.id}),/eigenen/);
});
test('earlier clock-out persists the requested end and rejects future, before-start and before-delivery times',()=>{
 const s=seed(),kitchen=s.employees.find(e=>e.id==='samira'),shift=s.shifts.find(x=>x.employeeId===kitchen.id),end=new Date(Date.now()-3600000).toISOString();
 action(s,kitchen,{type:'clockOut',end});assert.equal(shift.end,end);assert.ok(shift.clockedOutAt);
 const driver=s.employees.find(e=>e.id==='mia'),active=s.shifts.find(x=>x.employeeId===driver.id && !x.end);
 assert.throws(()=>action(s,driver,{type:'clockOut',end:new Date(Date.now()+3600000).toISOString()}),/Vergangenheit/);
 assert.throws(()=>action(s,driver,{type:'clockOut',end:active.start}),/Vergangenheit/);
 assert.throws(()=>action(s,driver,{type:'clockOut',end:new Date(Date.now()-3600000).toISOString()}),/Bestellung/);
 assert.equal(active.end,null);
});
test('PDF and invoice routes enforce own-only access and produce a real PDF; new records survive a file-store reload',async t=>{
 const {app,base,request,login,dir}=await fixture(t),chef=await login('alex','1234'),driver=await login('leo','3456');
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(new Date());
 const pdf=await fetch(base+'/api/payroll.pdf?month='+month,{headers:{cookie:driver}});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 assert.equal((await fetch(base+'/api/payroll.pdf?month='+month+'&employeeId=mia',{headers:{cookie:driver}})).status,403);
 const saved=await request('/api/action',{type:'saveExpense',date:month+'-01',category:'fuel',description:'Persisted fuel',amount:5,attachment:{type:'image/png',name:'receipt.png',data:Buffer.from('invoice bytes').toString('base64')}},chef);
 const path=base+'/api/expenses/'+saved.body.result.id+'/attachment';assert.equal((await fetch(path,{headers:{cookie:driver}})).status,403);
 const invoice=await fetch(path,{headers:{cookie:chef}});assert.equal(await invoice.text(),'invoice bytes');
 await app.locals.store.close();const restored=await createApp({dataFile:dir+'/db.json',demo:true});try{assert.equal(restored.locals.store.read().expenses[0].amount,5);}finally{await restored.locals.close();}
});
for(const [employeeId,pin,role] of [['alex','1234','chef'],['samira','2345','kitchen'],['leo','3456','driver']])
test('passkeys for '+role+' verify signatures, require own PIN and device verification, and reject replay',async t=>{
 const {request,login,app}=await fixture(t,{origin:'http://localhost:5173'}),cookie=await login(employeeId,pin);
 assert.equal((await request('/api/passkeys/register/options',{pin:'wrong'},cookie)).status,401);
 assert.equal((await request('/api/passkeys/register/options',{pin})).status,401);
 const start=await request('/api/passkeys/register/options',{pin},cookie);assert.equal(start.status,200);
 const {options,challengeId}=start.body;assert.equal(Buffer.from(options.user.id,'base64url').toString(),employeeId);assert.equal(options.authenticatorSelection.userVerification,'required');
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32),counter=Buffer.alloc(4);
 const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 const length=Buffer.alloc(2);length.writeUInt16BE(id.length);
 const authData=Buffer.concat([digest('localhost'),Buffer.from([0x45]),counter,Buffer.alloc(16),length,id,cose]);
 const clientDataJSON=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:'http://localhost:5173'})).toString('base64url');
 const response={id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',response:{clientDataJSON,attestationObject:Buffer.from(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(authData)]]))).toString('base64url'),transports:['internal']},clientExtensionResults:{}};
 const registered=await request('/api/passkeys/register/verify',{challengeId,response},cookie);assert.equal(registered.status,200,JSON.stringify(registered.body));
 assert.equal((await request('/api/passkeys/register/verify',{challengeId,response},cookie)).status,400);
 const exposed=JSON.stringify((await request('/api/state',undefined,cookie)).body);assert.ok(!exposed.includes('publicKey'));assert.ok(!exposed.includes('passkeys'));
 const auth=await request('/api/passkeys/login/options',{id:employeeId});assert.equal(auth.status,200);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:auth.body.options.challenge,origin:'http://localhost:5173'}));counter.writeUInt32BE(1);
 const assertionData=Buffer.concat([digest('localhost'),Buffer.from([0x05]),counter]);
 const signature=sign('sha256',Buffer.concat([assertionData,digest(client)]),privateKey);
 const assertion={id:id.toString('base64url'),rawId:id.toString('base64url'),type:'public-key',response:{clientDataJSON:client.toString('base64url'),authenticatorData:assertionData.toString('base64url'),signature:signature.toString('base64url'),userHandle:Buffer.from(employeeId).toString('base64url')},clientExtensionResults:{}};
 const signed=await request('/api/passkeys/login/verify',{challengeId:auth.body.challengeId,response:assertion});assert.equal(signed.status,200,JSON.stringify(signed.body));assert.ok(signed.cookie);assert.equal(signed.body.user.id,employeeId);assert.equal(signed.body.user.role,role);
 assert.equal(app.locals.store.read().employees.find(e=>e.id===employeeId).passkeys[0].counter,1);
 assert.equal((await request('/api/passkeys/login/verify',{challengeId:auth.body.challengeId,response:assertion})).status,400);
});
test('push subscription validates endpoints, protects VAPID secrets and unsubscribes on logout',async t=>{
 const {request,login,app}=await fixture(t),cookie=await login('alex','1234');
 const config=await request('/api/notifications',undefined,cookie);assert.equal(config.status,200);assert.ok(config.body.publicKey);
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:randomBytes(65).toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 assert.equal((await request('/api/notifications/subscribe',{subscription:{...subscription,endpoint:'https://127.0.0.1/private'}},cookie)).status,400);
 assert.equal((await request('/api/notifications/subscribe',{subscription},cookie)).status,200);
 const exposed=JSON.stringify((await request('/api/export',undefined,cookie)).body);assert.ok(!exposed.includes('webPushVapid'));assert.ok(!exposed.includes(subscription.endpoint));
 assert.equal(app.locals.store.read().employees[0].pushSubscriptions.length,1);
 await request('/api/logout',{},cookie);assert.equal(app.locals.store.read().employees[0].pushSubscriptions.length,0);
});
