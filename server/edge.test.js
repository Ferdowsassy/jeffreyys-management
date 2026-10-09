import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-helper.js";
import { payroll } from "./domain.js";
test("payroll counts returned cash once, with chef counts overriding provisional returns", () => {
  const base = {
    employees: [{ id: "d" }],
    shifts: [
      {
        employeeId: "d",
        start: "2026-01-01T10:00:00Z",
        end: "2026-01-01T12:00:00Z",
        hourlyRate: 15,
      },
    ],
    orders: [
      {
        employeeId: "d",
        status: "delivered",
        payment: "cash",
        amount: 20,
        deliveryFee: 2,
      },
      {
        employeeId: "d",
        status: "open",
        payment: "cash",
        amount: 999,
        deliveryFee: 99,
      },
    ],
    handoffs: [],
  };
  assert.equal(payroll(base)[0].payout, 12);
  base.handoffs = [
    {
      employeeId: "d",
      expected: 20,
      counted: null,
      driverConfirmed: true,
      chefConfirmed: false,
    },
  ];
  assert.equal(payroll(base)[0].payout, 32);
  base.handoffs[0].counted = 18;
  base.handoffs[0].chefConfirmed = true;
  assert.equal(payroll(base)[0].payout, 30);
  assert.equal(payroll(base)[0].retainedCash, 2);
});
test("kitchen action responses expose only own wages; seed includes handoff example", async (t) => {
  const { request, login } = await fixture(t);
  const kitchen = await login("samira", "2345"),
    chef = await login("alex", "1234");
  assert.doesNotMatch(
    JSON.stringify((await request("/api/session", undefined, kitchen)).body),
    /hourlyRate|wageHistory/,
  );
  await request(
    "/api/action",
    { type: "clockOut", cashConfirmed: false },
    kitchen,
  );
  const response = await request("/api/action", { type: "clockIn" }, kitchen);
  assert.equal(response.status, 200);
  assert.equal(response.body.state.employees.find(e => e.id === "samira").hourlyRate, 16);
  assert.doesNotMatch(JSON.stringify(response.body.state.employees.filter(e => e.id !== "samira")), /hourlyRate|wageHistory/);
  assert.doesNotMatch(JSON.stringify(response.body.state.shifts.filter(s => s.employeeId !== "samira")), /hourlyRate/);
  assert.ok(
    (await request("/api/state", undefined, chef)).body.handoffs.some(
      (h) => h.demo,
    ),
  );
});
test("chef shift editing, deactivation and driver validation enforce ownership", async (t) => {
  const { request, login } = await fixture(t);
  const chef = await login("alex", "1234"),
    driver = await login("leo", "3456");
  const act = (p, c = chef) => request("/api/action", p, c);
  assert.equal(
    (await act({ type: "deactivateEmployee", id: "alex" })).status,
    400,
  );
  assert.equal(
    (await act({ type: "deactivateEmployee", id: "leo" })).status,
    409,
  );
  assert.equal(
    (
      await act({
        type: "updateShift",
        id: "demo-shift-leo",
        start: new Date(Date.now() - 4 * 3600000).toISOString(),
        end: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await act({
        type: "updateShift",
        id: "demo-shift-leo",
        start: "bad",
        end: null,
      })
    ).status,
    400,
  );
  for (const p of [
    {
      type: "addOrder",
      noAddress: true,
      payment: "cash",
      amount: -1,
      orderNumber: "x",
    },
    {
      type: "addOrder",
      noAddress: true,
      payment: "bad",
      amount: 2,
      orderNumber: "x",
    },
    { type: "saveLocation", latitude: 0, longitude: 181 },
  ])
    assert.equal((await act(p, driver)).status, 400);
  assert.equal(
    (await act({ type: "saveLocation", latitude: 48, longitude: 11 }, driver))
      .status,
    200,
  );
  assert.equal(
    (
      await act({
        type: "saveEmployee",
        name: "Worker",
        role: "driver",
        hourlyRate: 15,
        pin: "4321",
      })
    ).status,
    200,
  );
  const state = (await request("/api/state", undefined, chef)).body,
    newId = state.employees.find((e) => e.name === "Worker").id;
  assert.equal(
    (await act({ type: "deactivateEmployee", id: newId })).status,
    200,
  );
  assert.equal(
    (await request("/api/login", { id: newId, pin: "4321" })).status,
    401,
  );
});
