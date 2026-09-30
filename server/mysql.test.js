import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { createMysqlStore, databaseConfig } from './mysql-store.js';
import { seed } from './store.js';
import { createApp } from './app.js';

test('incomplete MySQL settings never silently use a file', () => {
  assert.equal(databaseConfig({}), undefined);
  assert.throws(() => databaseConfig({STORAGE_BACKEND:'mysql'}), /DB_NAME/);
  assert.throws(() => databaseConfig({DB_NAME:'app'}), /DB_USER/);
});

test('real MySQL preserves migration, rolls back, survives restart and serializes independent writers', {skip: !process.env.MYSQL_TEST_SOCKET}, async t => {
  const config = {socketPath:process.env.MYSQL_TEST_SOCKET, user:process.env.MYSQL_TEST_USER || process.env.USER};
  const admin = await mysql.createConnection(config);
  const database = 'jm_test_' + randomBytes(8).toString('hex');
  await admin.query(`CREATE DATABASE ${database}`);
  const stores = [], servers = [];
  t.after(async () => {
    for (const server of servers) {server.closeAllConnections(); await new Promise(r => server.close(r));}
    for (const store of stores) await store.close();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  });
  const open = async options => {const s=await createMysqlStore({...config,database}, options);stores.push(s);return s;};
  const original = seed();
  const a = await open({initialState:original});
  assert.deepEqual(a.read(), original);
  await assert.rejects(open({initialState:original}), /already contains/);
  const b = await open();
  await Promise.all(Array.from({length:20}, (_, i) => (i%2 ? a : b).transact(s => {
    s.tasks.push({id:'concurrent-'+i, text:'Task '+i, done:false, demo:false});
  })));
  await a.refresh();
  assert.equal(a.read().tasks.length, original.tasks.length+20);
  const before = a.read();
  await assert.rejects(a.transact(s => {s.employees=[];}), /active chef/);
  await assert.rejects(a.transact(s => {s.settings.flatFee=999;throw Error('abort');}), /abort/);
  await b.refresh();
  assert.deepEqual(b.read(), before);
  // Fail after the first record write: InnoDB must roll back partial changes.
  await admin.query(`CREATE TRIGGER ${database}.reject_order BEFORE INSERT ON ${database}.jm_orders FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced failure'`);
  await assert.rejects(a.transact(s => {
    s.employees[0].name='Should roll back';
    s.orders.push({...s.orders[0],id:'failure'});
  }), /forced failure/);
  await admin.query(`DROP TRIGGER ${database}.reject_order`);
  await a.close();
  const reopened = await open();
  assert.deepEqual(reopened.read(), before);

  const app = await createApp({database:{...config,database},demo:true});
  stores.push({close: () => app.locals.close()});
  const server = app.listen(0,'127.0.0.1');servers.push(server);
  await new Promise(r => server.once('listening',r));
  const base = 'http://127.0.0.1:'+server.address().port;
  const request = async (path,body,cookie='') => {
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
    return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  assert.equal((await request('/healthz')).body.storage,'mysql');
  const chef=(await request('/api/login',{id:'alex',pin:'1234'})).cookie;
  const driver=(await request('/api/login',{id:'leo',pin:'3456'})).cookie;
  const kitchen=(await request('/api/login',{id:'samira',pin:'2345'})).cookie;
  assert.equal((await request('/api/action',{type:'saveSettings',flatFee:5},driver)).status,403);
  assert.equal((await request('/api/state',undefined,kitchen)).body.orders[0].address,undefined);
  const created=await request('/api/action',{type:'addOrder',address:'Teststraße 1',postalCode:'80802',city:'München',amount:20.1,payment:'cash',orderNumber:'MYSQL-101'},driver);
  assert.equal(created.status,200);
  const order=created.body.state.orders.find(o=>o.orderNumber==='MYSQL-101');
  assert.equal((await request('/api/action',{type:'delivered',id:order.id},driver)).status,200);
  assert.equal((await request('/api/action',{type:'clockOut',cashConfirmed:true},driver)).status,200);
  const state=(await request('/api/state',undefined,chef)).body;
  const handoff=state.handoffs.find(h=>h.employeeId==='leo');
  assert.equal((await request('/api/action',{type:'confirmHandoff',id:handoff.id,counted:50},chef)).status,200);
  const payroll=(await request('/api/state',undefined,chef)).body.payroll.find(p=>p.employeeId==='leo');
  assert.equal(payroll.retainedCash,2.6);
  await reopened.refresh();
  assert.ok(reopened.read().handoffs.find(h=>h.id===handoff.id).chefConfirmed);
  const sse=await fetch(base+'/api/events',{headers:{cookie:chef}});
  const reader=sse.body.getReader();
  await reader.read();
  await reopened.transact(s=>s.tasks.push({id:'external',text:'External change',done:false}));
  const event=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Missing cross-process SSE')),5000).unref())]);
  assert.match(new TextDecoder().decode(event.value),/invalidate/);
  await reader.cancel();
});
