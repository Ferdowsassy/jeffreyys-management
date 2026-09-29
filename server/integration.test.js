import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-helper.js";
test("SSE is authenticated and actions invalidate state; logout closes stream", async (t) => {
  const { request, login, base } = await fixture(t);
  assert.equal((await request("/api/events")).status, 401);
  const cookie = await login("alex", "1234");
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(base + "/api/events", {
    headers: { cookie },
    signal: controller.signal,
  });
  assert.match(
    response.headers.get("content-type"),
    /^text\/event-stream(?:;|$)/,
  );
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /ready/);
  await request("/api/action", { type: "addTask", text: "SSE test" }, cookie);
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /invalidate/,
  );
  await request("/api/logout", {}, cookie);
  assert.equal((await reader.read()).done, true);
});
test("AI is explicit about missing credentials and coach is chef-only", async (t) => {
  const { request, login } = await fixture(t);
  const chef = await login("alex", "1234"),
    driver = await login("leo", "3456");
  assert.equal(
    (
      await request(
        "/api/ai/coach",
        { question: "How can we improve?" },
        driver,
      )
    ).status,
    403,
  );
  if (!process.env.OPENAI_API_KEY) {
    for (const endpoint of ["coach", "receipt"]) {
      const r = await request("/api/ai/" + endpoint, {}, chef);
      assert.equal(r.status, 503);
      assert.match(r.body.error, /not configured/);
    }
  }
});
test("parallel mutations persist atomically and invalid mutations roll back", async (t) => {
  const { request, login, app, dir } = await fixture(t);
  const cookie = await login("alex", "1234");
  const r = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      request(
        "/api/action",
        { type: "addTask", text: "Concurrent " + i },
        cookie,
      ),
    ),
  );
  assert.ok(r.every((x) => x.status === 200));
  const { readFile } = await import("node:fs/promises");
  const persisted = JSON.parse(await readFile(dir + "/db.json", "utf8"));
  assert.equal(
    persisted.tasks.filter((x) => x.text.startsWith("Concurrent")).length,
    10,
  );
  assert.match(persisted.employees[0].pinHash, /^[a-f0-9]+:[a-f0-9]+$/);
  const before = app.locals.store.read();
  await request(
    "/api/action",
    {
      type: "saveSettings",
      foodCostPercent: -3,
      fixedCosts: 10,
      longShiftHours: 8,
    },
    cookie,
  );
  assert.deepEqual(app.locals.store.read(), before);
});
test("login rate limiting and origin checks", async (t) => {
  const { request, base } = await fixture(t);
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await request("/api/login", { id: "alex", pin: "0000" })).status,
      401,
    );
  assert.equal(
    (await request("/api/login", { id: "alex", pin: "0000" })).status,
    429,
  );
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: {
      origin: "https://evil.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: "alex", pin: "1234" }),
  });
  assert.equal(response.status, 403);
});
