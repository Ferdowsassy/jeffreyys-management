import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-helper.js";
test("role isolation removes customer addresses and wage data from kitchen", async (t) => {
  const { request, login } = await fixture(t);
  const chef = await login("alex", "1234"),
    kitchen = await login("samira", "2345"),
    driver = await login("leo", "3456");
  const all = (await request("/api/state", undefined, chef)).body;
  assert.equal(all.employees.length, 4);
  assert.ok(all.orders.length);
  assert.ok(all.orders.every((o) => o.demo));
  const k = (await request("/api/state", undefined, kitchen)).body;
  assert.doesNotMatch(
    JSON.stringify(k),
    /hourlyRate|pinHash|wageHistory|address|fixedCosts/,
  );
  const d = (await request("/api/state", undefined, driver)).body;
  assert.ok(d.orders.every((o) => o.employeeId === "leo"));
  assert.equal(d.employees.length, 1);
  assert.deepEqual(d.tasks, []);
  assert.deepEqual(d.audit, []);
  assert.equal((await request("/api/export", undefined, kitchen)).status, 403);
  assert.doesNotMatch(
    JSON.stringify((await request("/api/export", undefined, chef)).body),
    /pinHash/,
  );
});
