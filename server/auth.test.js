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
