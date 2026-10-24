import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-helper.js";
test("authentication never discloses PIN hashes and uses cookie sessions", async (t) => {
  const { request } = await fixture(t);
  assert.deepEqual((await request("/api/session")).body, { user: null });
  assert.equal((await request("/api/state")).status, 401);
  const people = (await request("/api/people")).body.people;
  assert.equal(people.length, 4);
  assert.deepEqual(Object.keys(people[0]).sort(), ["id", "name", "role"]);
  assert.equal(
    (await request("/api/login", { id: "alex", pin: "0000" })).status,
    401,
  );
  const login = await request("/api/login", { id: "alex", pin: "1234" });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  assert.equal(
    (await request("/api/session", undefined, login.cookie)).body.user.role,
    "chef",
  );
  assert.doesNotMatch(JSON.stringify(login.body), /pin|scrypt/i);
  await request("/api/logout", {}, login.cookie);
  assert.equal(
    (await request("/api/state", undefined, login.cookie)).status,
    401,
  );
});
test('chef PIN opens an audited employee session; ordinary PINs cannot act as a master', async t=>{
  const {request,app}=await fixture(t);
  assert.equal((await request('/api/login',{id:'leo',chefId:'samira',pin:'2345'})).status,401);
  assert.equal((await request('/api/login',{id:'leo',chefId:'alex',pin:'3456'})).status,401);
  const master=await request('/api/login',{id:'leo',chefId:'alex',pin:'1234'});
  assert.equal(master.body.user.id,'leo');assert.equal(master.body.access.chefName,'Alex');
  assert.doesNotMatch(JSON.stringify(master.body),/pinHash|chefPinHash/);
  assert.equal((await request('/api/action',{type:'saveEmployee',name:'No',role:'chef',hourlyRate:0,pin:'5555'},master.cookie)).status,403);
  assert.equal((await request('/api/account/pin',{currentPin:'3456',newPin:'5555',confirmPin:'5555'},master.cookie)).status,403);
  assert.equal((await request('/api/action',{type:'clockOut'},master.cookie)).status,200);
  assert.equal(app.locals.store.read().audit.find(a=>a.type==='clockOut').performedBy,'alex');
  assert.equal(app.locals.store.read().audit.find(a=>a.type==='masterLogin').employeeId,'alex');
  const back=await request('/api/account/return',{},master.cookie);
  assert.equal(back.body.user.id,'alex');assert.equal(back.body.access,undefined);
  assert.equal((await request('/api/state',undefined,master.cookie)).status,401);
  const again=await request('/api/login',{id:'leo',chefId:'alex',pin:'1234'});
  await app.locals.store.transact(s=>{s.employees.find(e=>e.id==='alex').active=false;});
  assert.equal((await request('/api/state',undefined,again.cookie)).status,401);
  assert.equal((await request('/api/login',{id:'leo',chefId:'alex',pin:'1234'})).status,401);
});
test('personal PIN change checks the old PIN and confirmation, keeps only its new session and revokes master sessions when chef PIN changes',async t=>{
  const {request,login,app}=await fixture(t);
  const first=await login('leo','3456'),second=await login('leo','3456');
  assert.equal((await request('/api/account/pin',{currentPin:'0000',newPin:'6789',confirmPin:'6789'},first)).status,401);
  assert.equal((await request('/api/account/pin',{currentPin:'3456',newPin:'6789',confirmPin:'6780'},first)).status,400);
  const changed=await request('/api/account/pin',{id:'alex',currentPin:'3456',newPin:'6789',confirmPin:'6789'},first);
  assert.equal(changed.status,200);assert.equal(changed.body.user.id,'leo');
  assert.equal((await request('/api/state',undefined,first)).status,401);
  assert.equal((await request('/api/state',undefined,second)).status,401);
  assert.equal((await request('/api/state',undefined,changed.cookie)).status,200);
  assert.equal((await request('/api/login',{id:'leo',pin:'3456'})).status,401);
  assert.equal((await request('/api/login',{id:'leo',pin:'6789'})).status,200);
  assert.equal(app.locals.store.read().audit.find(a=>a.type==='changeOwnPin').employeeId,'leo');
  const master=await request('/api/login',{id:'samira',chefId:'alex',pin:'1234'}),chef=await login('alex','1234');
  assert.equal((await request('/api/account/pin',{currentPin:'1234',newPin:'9876',confirmPin:'9876'},chef)).status,200);
  assert.equal((await request('/api/state',undefined,master.cookie)).status,401);
  assert.equal((await request('/api/login',{id:'samira',chefId:'alex',pin:'1234'})).status,401);
  assert.equal((await request('/api/login',{id:'samira',chefId:'alex',pin:'9876'})).status,200);
});
